import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

import {
  checkReservationCompatibility,
  normalizeRelativePath,
  normalizeReservationSet,
} from "../scripts/multi-agent-operator/reservation-set.mjs"

const temporaryDirectories: string[] = []

type PathReservation = string | { repository: string; path: string }
type ReservationOverrides = {
  paths?: PathReservation[]
  contracts?: string[]
  environments?: string[]
  repositories?: string[]
  protectedResources?: string[]
}

function reservationSet(id: string, reservations: ReservationOverrides = {}) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_SET",
    reservationSetId: id,
    workerId: `worker-${id}`,
    workOrderId: `WO-${id}`,
    reservations: {
      paths: [],
      contracts: [],
      environments: [],
      repositories: [],
      protectedResources: [],
      ...reservations,
    },
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe("multi-agent reservation-set compatibility", () => {
  it("normalizes repository-relative paths deterministically", () => {
    expect(normalizeRelativePath(" ./src//operator/../worker.ts ")).toBe("src/worker.ts")
    expect(normalizeRelativePath("docs\\reports\\result.md")).toBe("docs/reports/result.md")
    expect(normalizeRelativePath("../../escape")).toBeNull()
    expect(normalizeRelativePath("/absolute/path")).toBeNull()
    expect(normalizeRelativePath("C:\\absolute\\path")).toBeNull()
    expect(normalizeRelativePath("./")).toBeNull()
  })

  it("returns collision-free compatibility without claiming a ledger or authority", () => {
    const outcome = checkReservationCompatibility(
      reservationSet("left", {
        paths: [{ repository: "bsvalues/terragroq", path: "scripts/a.mjs" }],
        contracts: ["contract-a"], environments: ["preview"],
        repositories: ["bsvalues/terragroq"], protectedResources: ["github:issue:1"],
      }),
      reservationSet("right", {
        paths: [{ repository: "bsvalues/other", path: "tests/b.test.ts" }],
        contracts: ["contract-b"], environments: ["staging"],
        repositories: ["bsvalues/other"], protectedResources: ["github:issue:2"],
      }),
    )
    expect(outcome).toMatchObject({
      status: "COMPATIBLE",
      compatible: true,
      reasonCodes: [],
      conflicts: [],
      invalid: [],
      effect: "PRE_DISPATCH_CHECK_ONLY",
      ledgerClaimed: false,
      authorityGranted: false,
    })
  })

  it.each([
    ["PATH_EXACT_COLLISION", { paths: ["src/a.ts"] }, { paths: ["./src/a.ts"] }],
    ["PATH_ANCESTOR_COLLISION", { paths: ["src/operator"] }, { paths: ["src/operator/a.ts"] }],
    ["CONTRACT_COLLISION", { contracts: ["operator-v1"] }, { contracts: ["operator-v1"] }],
    ["ENVIRONMENT_COLLISION", { environments: ["production"] }, { environments: ["production"] }],
    ["REPOSITORY_COLLISION", { repositories: ["bsvalues/terragroq"] }, { repositories: ["bsvalues/terragroq"] }],
    ["PROTECTED_RESOURCE_COLLISION", { protectedResources: ["github:branch:main"] }, { protectedResources: ["github:branch:main"] }],
  ])("returns stable %s evidence", (reasonCode, left, right) => {
    expect(checkReservationCompatibility(reservationSet("left", left), reservationSet("right", right)))
      .toMatchObject({ status: "CONFLICT", compatible: false, reasonCodes: [reasonCode] })
  })

  it("sorts comprehensive cross-set collisions in stable reason order", () => {
    const common = {
      paths: [{ repository: "path-context", path: "src/a.ts" }], contracts: ["c"], environments: ["e"],
      repositories: ["r"], protectedResources: ["p"],
    }
    const outcome = checkReservationCompatibility(reservationSet("left", common), reservationSet("right", common))
    expect(outcome.reasonCodes).toEqual([
      "PATH_EXACT_COLLISION", "CONTRACT_COLLISION", "ENVIRONMENT_COLLISION",
      "REPOSITORY_COLLISION", "PROTECTED_RESOURCE_COLLISION",
    ])
    expect(outcome.conflicts).toHaveLength(5)
  })

  it("does not collide equal or ancestor-related paths in disjoint repositories", () => {
    const exact = checkReservationCompatibility(
      reservationSet("left", { paths: [{ repository: "bsvalues/repo-a", path: "src/operator.ts" }] }),
      reservationSet("right", { paths: [{ repository: "bsvalues/repo-b", path: "src/operator.ts" }] }),
    )
    expect(exact).toMatchObject({ status: "COMPATIBLE", compatible: true, reasonCodes: [] })

    const ancestor = checkReservationCompatibility(
      reservationSet("left", { paths: [{ repository: "bsvalues/repo-a", path: "src" }] }),
      reservationSet("right", { paths: [{ repository: "bsvalues/repo-b", path: "src/operator.ts" }] }),
    )
    expect(ancestor).toMatchObject({ status: "COMPATIBLE", compatible: true, reasonCodes: [] })
  })

  it("preserves exact and ancestor path collisions in overlapping repositories", () => {
    const exact = checkReservationCompatibility(
      reservationSet("left", { paths: [{ repository: "bsvalues/shared", path: "src/operator.ts" }] }),
      reservationSet("right", { paths: [{ repository: "bsvalues/shared", path: "./src/operator.ts" }] }),
    )
    expect(exact).toMatchObject({
      status: "CONFLICT",
      reasonCodes: ["PATH_EXACT_COLLISION"],
      conflicts: expect.arrayContaining([expect.objectContaining({
        reasonCode: "PATH_EXACT_COLLISION",
        repositoryContext: "bsvalues/shared",
      })]),
    })

    const ancestor = checkReservationCompatibility(
      reservationSet("left", { paths: [{ repository: "bsvalues/shared", path: "src" }] }),
      reservationSet("right", { paths: [{ repository: "bsvalues/shared", path: "src/operator.ts" }] }),
    )
    expect(ancestor).toMatchObject({
      status: "CONFLICT",
      reasonCodes: ["PATH_ANCESTOR_COLLISION"],
      conflicts: expect.arrayContaining([expect.objectContaining({
        reasonCode: "PATH_ANCESTOR_COLLISION",
        repositoryContext: "bsvalues/shared",
      })]),
    })
  })

  it("allows disjoint paths in the same repository without a whole-repository claim", () => {
    const outcome = checkReservationCompatibility(
      reservationSet("left", { paths: [{ repository: "bsvalues/shared", path: "src/a.ts" }] }),
      reservationSet("right", { paths: [{ repository: "bsvalues/shared", path: "tests/b.test.ts" }] }),
    )
    expect(outcome).toMatchObject({ status: "COMPATIBLE", compatible: true, reasonCodes: [] })
  })

  it("makes an explicit whole-repository claim conflict with a path claim in that repository", () => {
    const outcome = checkReservationCompatibility(
      reservationSet("left", { repositories: ["bsvalues/shared"] }),
      reservationSet("right", { paths: [{ repository: "bsvalues/shared", path: "src/a.ts" }] }),
    )
    expect(outcome).toMatchObject({
      status: "CONFLICT",
      compatible: false,
      reasonCodes: ["REPOSITORY_PATH_COLLISION"],
      conflicts: [expect.objectContaining({
        reasonCode: "REPOSITORY_PATH_COLLISION",
        repositoryContext: "bsvalues/shared",
      })],
    })

    const reverse = checkReservationCompatibility(
      reservationSet("path", { paths: [{ repository: "bsvalues/shared", path: "src/a.ts" }] }),
      reservationSet("repository", { repositories: ["bsvalues/shared"] }),
    )
    expect(reverse.reasonCodes).toEqual(["REPOSITORY_PATH_COLLISION"])

    const disjoint = checkReservationCompatibility(
      reservationSet("repo-a", { repositories: ["bsvalues/a"] }),
      reservationSet("path-b", { paths: [{ repository: "bsvalues/b", path: "src/a.ts" }] }),
    )
    expect(disjoint).toMatchObject({ status: "COMPATIBLE", compatible: true })
  })

  it("fails closed symmetrically for whole-repository claims versus legacy implicit paths", () => {
    const wholeThenImplicit = checkReservationCompatibility(
      reservationSet("repository", { repositories: ["bsvalues/shared"] }),
      reservationSet("legacy", { paths: ["src/a.ts"] }),
    )
    expect(wholeThenImplicit).toMatchObject({
      status: "CONFLICT",
      compatible: false,
      reasonCodes: ["REPOSITORY_PATH_CONTEXT_UNRESOLVED"],
      conflicts: [expect.objectContaining({
        reasonCode: "REPOSITORY_PATH_CONTEXT_UNRESOLVED",
        repositoryContext: null,
        implicitRepositoryContext: "@dispatch-repository",
      })],
    })

    const implicitThenWhole = checkReservationCompatibility(
      reservationSet("legacy", { paths: ["src/a.ts"] }),
      reservationSet("repository", { repositories: ["bsvalues/shared"] }),
    )
    expect(implicitThenWhole).toMatchObject({
      status: "CONFLICT",
      compatible: false,
      reasonCodes: ["REPOSITORY_PATH_CONTEXT_UNRESOLVED"],
    })

    const implicitLegacyPair = checkReservationCompatibility(
      reservationSet("legacy-a", { paths: ["src"] }),
      reservationSet("legacy-b", { paths: ["src/a.ts"] }),
    )
    expect(implicitLegacyPair).toMatchObject({
      status: "CONFLICT",
      reasonCodes: ["PATH_ANCESTOR_COLLISION"],
    })
  })

  it("scopes duplicate and self-overlap validation to each path repository", () => {
    const crossRepository = reservationSet("valid", { paths: [
      { repository: "bsvalues/a", path: "src" },
      { repository: "bsvalues/b", path: "src/a.ts" },
    ] })
    expect(normalizeReservationSet(crossRepository).valid).toBe(true)

    const sameRepository = reservationSet("invalid", { paths: [
      { repository: "bsvalues/a", path: "src" },
      { repository: "bsvalues/a", path: "src/a.ts" },
    ] })
    expect(normalizeReservationSet(sameRepository)).toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ reasonCode: "SELF_PATH_COLLISION" })],
    })
  })

  it("rejects malformed structured paths with stable diagnostics", () => {
    const malformed = reservationSet("malformed", { paths: [
      // @ts-expect-error deliberate invalid fixtures
      { repository: "bsvalues/a" },
      // @ts-expect-error deliberate invalid fixtures
      { path: "src/a.ts" },
      // @ts-expect-error deliberate invalid fixtures
      undefined,
    ] })
    const outcome = normalizeReservationSet(malformed)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics).toHaveLength(3)
    expect(outcome.diagnostics.every(({ reasonCode }) => reasonCode === "INVALID_RESERVATION_VALUE")).toBe(true)
  })

  it("rejects duplicates, self-overlapping paths, malformed values and duplicate set identities", () => {
    const malformed = reservationSet("same", {
      paths: ["src", "src/a.ts", "./src", "../../escape"],
      contracts: ["contract", " contract "],
      environments: [""],
    })
    const outcome = checkReservationCompatibility(malformed, reservationSet("same"))
    expect(outcome.status).toBe("INVALID")
    expect(outcome.compatible).toBe(false)
    expect(outcome.reasonCodes).toEqual([
      "INVALID_RESERVATION_VALUE", "DUPLICATE_RESERVATION", "SELF_PATH_COLLISION", "SAME_RESERVATION_SET_ID",
    ])
    expect(outcome.conflicts).toEqual([])
  })

  it("rejects missing schema collections instead of silently treating them as empty", () => {
    const incomplete = reservationSet("incomplete")
    // @ts-expect-error deliberate invalid fixture
    delete incomplete.reservations.repositories
    const outcome = normalizeReservationSet(incomplete)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "INVALID_RESERVATION_SET", kind: "REPOSITORY" }),
    ]))
  })

  it("rejects empty set, worker, and work-order identities", () => {
    const invalid = reservationSet(" ")
    invalid.workerId = "\t"
    invalid.workOrderId = ""
    expect(normalizeReservationSet(invalid)).toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ reasonCode: "INVALID_RESERVATION_SET", kind: "SET" })],
    })
  })

  it("CLI emits typed JSON and deterministic result codes without credentials", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-reservation-"))
    temporaryDirectories.push(directory)
    const left = path.join(directory, "left.json")
    const right = path.join(directory, "right.json")
    fs.writeFileSync(left, JSON.stringify(reservationSet("left", { paths: ["src"] })))
    fs.writeFileSync(right, JSON.stringify(reservationSet("right", { paths: ["src/a.ts"] })))

    const cli = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/reservation-set-cli.mjs", left, right],
      { cwd: process.cwd(), encoding: "utf8", env: {} })
    expect(cli.status).toBe(3)
    expect(cli.stderr).toBe("")
    expect(JSON.parse(cli.stdout)).toMatchObject({
      artifactType: "MULTI_AGENT_RESERVATION_COMPATIBILITY_RESULT",
      status: "CONFLICT",
      reasonCodes: ["PATH_ANCESTOR_COLLISION"],
      ledgerClaimed: false,
      authorityGranted: false,
    })
  })

  it("CLI reports input and usage walls as typed JSON with code 2", () => {
    const usage = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/reservation-set-cli.mjs"],
      { cwd: process.cwd(), encoding: "utf8" })
    expect(usage.status).toBe(2)
    expect(JSON.parse(usage.stdout).status).toBe("RESERVATION_SET_CLI_USAGE_WALL")

    const input = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/reservation-set-cli.mjs", "missing-left", "missing-right"],
      { cwd: process.cwd(), encoding: "utf8" })
    expect(input.status).toBe(2)
    expect(JSON.parse(input.stdout).status).toBe("RESERVATION_SET_INPUT_WALL")
  })
})
