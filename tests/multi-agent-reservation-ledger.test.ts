import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

import {
  acquireReservations,
  inspectReservationLedger,
  releaseReservations,
} from "../scripts/multi-agent-operator/reservation-ledger.mjs"

const temporaryDirectories: string[] = []
const ledgerId = "LEDGER-MAO-018"

type PathReservation = string | { repository: string, path: string }
type ReservationOverrides = {
  paths?: PathReservation[]
  contracts?: string[]
  environments?: string[]
  repositories?: string[]
  protectedResources?: string[]
}

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mao-reservation-ledger-"))
  temporaryDirectories.push(directory)
  return directory
}

function reservationSet(id: string, overrides: ReservationOverrides = {}) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_SET",
    reservationSetId: id,
    workerId: `worker-${id}`,
    workOrderId: `WO-${id}`,
    reservations: {
      paths: [], contracts: [], environments: [], repositories: [], protectedResources: [],
      ...overrides,
    },
  }
}

function acquireRequest(id: string, token: string, overrides: ReservationOverrides = {}, laneId = `lane-${id}`) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_ACQUIRE_REQUEST",
    laneId,
    holderToken: token,
    reservationSet: reservationSet(id, overrides),
  }
}

function releaseRequest(id: string, token: string, fencingToken: number, expectedVersion?: number) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_RELEASE_REQUEST",
    reservationSetId: id,
    holderToken: token,
    fencingToken,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  }
}

function inspectRequest() {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST",
  }
}

function runCli(args: string[]) {
  return new Promise<{ code: number | null, stdout: string, stderr: string }>((resolve) => {
    const child = spawn(process.execPath,
      ["scripts/multi-agent-operator/reservation-ledger-cli.mjs", ...args],
      { cwd: process.cwd(), env: {}, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe("atomic multi-agent reservation ledger", () => {
  it("acquires all resources atomically, persists holder attribution, and grants no authority", () => {
    const ledger = path.join(tempDirectory(), "ledger.json")
    const outcome = acquireReservations(ledger, ledgerId, acquireRequest("alpha", "secret-alpha", {
      paths: [{ repository: "bsvalues/terragroq", path: "src/operator.ts" }],
      contracts: ["operator-v2"],
      environments: ["preview:alpha"],
      repositories: ["bsvalues/exclusive-repository"],
      protectedResources: ["github:issue:400"],
    }))
    expect(outcome).toMatchObject({
      status: "RESERVATION_ACQUIRED", acquired: true, ledgerVersion: 1, fencingToken: 1,
      dispatchReservationGateSatisfied: true, localLedgerOnly: true, authorityGranted: false,
    })
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest())).toMatchObject({
      status: "RESERVATION_LEDGER_VALID",
      reservations: [expect.objectContaining({
        reservationSetId: "alpha", workerId: "worker-alpha", workOrderId: "WO-alpha",
        laneId: "lane-alpha", fencingToken: 1,
      })],
      authorityGranted: false,
    })
    expect(fs.readFileSync(ledger, "utf8")).not.toContain("secret-alpha")
  })

  it("is idempotent for the exact holder and rejects duplicate IDs with changed scope or holder", () => {
    const ledger = path.join(tempDirectory(), "ledger.json")
    const first = acquireReservations(ledger, ledgerId,
      acquireRequest("alpha", "holder-alpha", {
        paths: [{ repository: "repo", path: "src/a.ts" }],
      }))
    const repeated = acquireReservations(ledger, ledgerId,
      acquireRequest("alpha", "holder-alpha", {
        paths: [{ repository: "repo", path: "src/a.ts" }],
      }))
    const changed = acquireReservations(ledger, ledgerId,
      acquireRequest("alpha", "holder-alpha", {
        paths: [{ repository: "repo", path: "src/b.ts" }],
      }))
    const stolen = acquireReservations(ledger, ledgerId,
      acquireRequest("alpha", "holder-other", {
        paths: [{ repository: "repo", path: "src/a.ts" }],
      }))
    expect(first).toMatchObject({ status: "RESERVATION_ACQUIRED", fencingToken: 1 })
    expect(repeated).toMatchObject({ status: "RESERVATION_ACQUIRE_IDEMPOTENT", ledgerVersion: 1, fencingToken: 1 })
    expect(changed.status).toBe("RESERVATION_SET_ID_ALREADY_ACTIVE")
    expect(stolen.status).toBe("RESERVATION_SET_ID_ALREADY_ACTIVE")
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest()).ledgerVersion).toBe(1)
  })

  it("returns stable collision evidence without partially acquiring any resource", () => {
    const ledger = path.join(tempDirectory(), "ledger.json")
    acquireReservations(ledger, ledgerId, acquireRequest("alpha", "holder-alpha", {
      paths: [{ repository: "repo", path: "src" }],
      contracts: ["shared-contract"], protectedResources: ["branch:main"],
    }))
    const blocked = acquireReservations(ledger, ledgerId, acquireRequest("beta", "holder-beta", {
      paths: [{ repository: "repo", path: "src/a.ts" }],
      contracts: ["shared-contract"], environments: ["free-environment"],
      protectedResources: ["branch:main"],
    }))
    expect(blocked).toMatchObject({
      status: "RESERVATION_COLLISION", acquired: false, ledgerVersion: 1,
      reasonCodes: ["PATH_ANCESTOR_COLLISION", "CONTRACT_COLLISION", "PROTECTED_RESOURCE_COLLISION"],
      collisions: [expect.objectContaining({
        blockingReservationSetId: "alpha", blockingWorkOrderId: "WO-alpha",
      })],
      dispatchReservationGateSatisfied: false,
    })
    const inspection = inspectReservationLedger(ledger, ledgerId, inspectRequest())
    expect(inspection.reservations).toHaveLength(1)
    expect(JSON.stringify(inspection)).not.toContain("free-environment")
  })

  it("scopes path collisions by repository and supports explicit whole-repository locks", () => {
    const ledger = path.join(tempDirectory(), "ledger.json")
    expect(acquireReservations(ledger, ledgerId, acquireRequest("repo-a", "holder-a", {
      paths: [{ repository: "bsvalues/repo-a", path: "src/operator.ts" }],
    })).status).toBe("RESERVATION_ACQUIRED")
    expect(acquireReservations(ledger, ledgerId, acquireRequest("repo-b", "holder-b", {
      paths: [{ repository: "bsvalues/repo-b", path: "src/operator.ts" }],
    })).status).toBe("RESERVATION_ACQUIRED")
    expect(acquireReservations(ledger, ledgerId, acquireRequest("repo-a-collision", "holder-a2", {
      paths: [{ repository: "bsvalues/repo-a", path: "src" }],
    }))).toMatchObject({ status: "RESERVATION_COLLISION", reasonCodes: ["PATH_ANCESTOR_COLLISION"] })

    expect(acquireReservations(ledger, ledgerId, acquireRequest("whole-repo", "whole", {
      repositories: ["bsvalues/repo-c"],
    })).status).toBe("RESERVATION_ACQUIRED")
    expect(acquireReservations(ledger, ledgerId, acquireRequest("whole-repo-2", "whole-2", {
      repositories: ["bsvalues/repo-c"],
    }))).toMatchObject({ status: "RESERVATION_COLLISION", reasonCodes: ["REPOSITORY_COLLISION"] })
    expect(acquireReservations(ledger, ledgerId, acquireRequest("path-under-whole-repo", "path-holder", {
      paths: [{ repository: "bsvalues/repo-c", path: "src/operator.ts" }],
    }))).toMatchObject({
      status: "RESERVATION_COLLISION",
      reasonCodes: ["REPOSITORY_PATH_COLLISION"],
      collisions: [expect.objectContaining({
        conflicts: [expect.objectContaining({
          reasonCode: "REPOSITORY_PATH_COLLISION",
          repositoryContext: "bsvalues/repo-c",
        })],
      })],
    })
  })

  it("fails closed, rather than throwing, for legacy paths against whole-repository claims", () => {
    const ledger = path.join(tempDirectory(), "ledger.json")
    expect(acquireReservations(ledger, ledgerId, acquireRequest("whole-repo", "whole", {
      repositories: ["bsvalues/repo-c"],
    })).status).toBe("RESERVATION_ACQUIRED")
    expect(acquireReservations(ledger, ledgerId, acquireRequest("legacy-path", "legacy", {
      paths: ["src/operator.ts"],
    }))).toMatchObject({
      status: "RESERVATION_COLLISION",
      acquired: false,
      reasonCodes: ["REPOSITORY_PATH_CONTEXT_UNRESOLVED"],
      collisions: [expect.objectContaining({
        conflicts: [expect.objectContaining({
          reasonCode: "REPOSITORY_PATH_CONTEXT_UNRESOLVED",
          implicitRepositoryContext: "@dispatch-repository",
        })],
      })],
    })
  })

  it("allows only the fenced holder to release, then reacquires with a greater fence", () => {
    const ledger = path.join(tempDirectory(), "ledger.json")
    const acquired = acquireReservations(ledger, ledgerId,
      acquireRequest("alpha", "holder-alpha", { contracts: ["contract-a"] }))
    expect(releaseReservations(ledger, ledgerId,
      releaseRequest("alpha", "holder-other", acquired.fencingToken))).toMatchObject({
      status: "RESERVATION_RELEASE_NOT_HOLDER", released: false,
    })
    expect(releaseReservations(ledger, ledgerId,
      releaseRequest("alpha", "holder-alpha", acquired.fencingToken + 1))).toMatchObject({
      status: "RESERVATION_RELEASE_NOT_HOLDER", released: false,
    })
    const released = releaseReservations(ledger, ledgerId,
      releaseRequest("alpha", "holder-alpha", acquired.fencingToken))
    expect(released).toMatchObject({ status: "RESERVATION_RELEASED", released: true, ledgerVersion: 2 })
    expect(releaseReservations(ledger, ledgerId,
      releaseRequest("alpha", "holder-alpha", acquired.fencingToken))).toMatchObject({
      status: "RESERVATION_RELEASE_IDEMPOTENT", ledgerVersion: 2,
    })
    const reacquired = acquireReservations(ledger, ledgerId,
      acquireRequest("alpha", "new-holder", { contracts: ["contract-a"] }))
    expect(reacquired).toMatchObject({ status: "RESERVATION_ACQUIRED", ledgerVersion: 3, fencingToken: 2 })
    expect(releaseReservations(ledger, ledgerId,
      releaseRequest("alpha", "holder-alpha", 1)).status).toBe("RESERVATION_RELEASE_NOT_HOLDER")
  })

  it("enforces compare-and-swap versions without mutating the ledger", () => {
    const ledger = path.join(tempDirectory(), "ledger.json")
    const request = acquireRequest("alpha", "holder-alpha", {
      paths: [{ repository: "repo", path: "a.ts" }],
    })
    Object.assign(request, { expectedVersion: 1 })
    expect(acquireReservations(ledger, ledgerId, request)).toMatchObject({
      status: "RESERVATION_LEDGER_VERSION_CONFLICT", acquired: false,
    })
    expect(fs.existsSync(ledger)).toBe(false)
  })

  it("has one winner in a real cross-process acquisition race", async () => {
    const directory = tempDirectory()
    const ledger = path.join(directory, "ledger.json")
    const left = path.join(directory, "left.json")
    const right = path.join(directory, "right.json")
    fs.writeFileSync(left, JSON.stringify(acquireRequest("left", "left-secret", {
      paths: [{ repository: "repo", path: "shared" }],
    })))
    fs.writeFileSync(right, JSON.stringify(acquireRequest("right", "right-secret", {
      paths: [{ repository: "repo", path: "shared/a.ts" }],
    })))

    const [leftRun, rightRun] = await Promise.all([
      runCli(["acquire", ledger, ledgerId, left]),
      runCli(["acquire", ledger, ledgerId, right]),
    ])
    expect(leftRun.stderr).toBe("")
    expect(rightRun.stderr).toBe("")
    const outcomes = [JSON.parse(leftRun.stdout), JSON.parse(rightRun.stdout)]
    expect(outcomes.filter((outcome) => outcome.status === "RESERVATION_ACQUIRED")).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === "RESERVATION_COLLISION")).toHaveLength(1)
    expect([leftRun.code, rightRun.code].sort()).toEqual([0, 3])
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest()).reservations).toHaveLength(1)
    expect(fs.readFileSync(ledger, "utf8")).not.toMatch(/left-secret|right-secret/)
  })

  it("uses crash-safe rename persistence and ignores an abandoned temporary write", () => {
    const directory = tempDirectory()
    const ledger = path.join(directory, "ledger.json")
    acquireReservations(ledger, ledgerId,
      acquireRequest("alpha", "holder-alpha", { environments: ["preview"] }))
    fs.writeFileSync(`${ledger}.tmp-crashed-writer`, "{truncated")
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest())).toMatchObject({
      status: "RESERVATION_LEDGER_VALID", ledgerVersion: 1,
      reservations: [expect.objectContaining({ reservationSetId: "alpha" })],
    })
    expect(acquireReservations(ledger, ledgerId,
      acquireRequest("beta", "holder-beta", { environments: ["staging"] }))).toMatchObject({
      status: "RESERVATION_ACQUIRED", ledgerVersion: 2,
    })
  })

  it("fails closed on malformed, duplicate, and internally colliding ledgers", () => {
    const directory = tempDirectory()
    const malformed = path.join(directory, "malformed.json")
    fs.writeFileSync(malformed, "{not-json")
    expect(acquireReservations(malformed, ledgerId,
      acquireRequest("alpha", "holder", {
        paths: [{ repository: "repo", path: "a" }],
      }))).toMatchObject({
      status: "RESERVATION_LEDGER_CORRUPT", acquired: false,
    })
    expect(fs.readFileSync(malformed, "utf8")).toBe("{not-json")

    const valid = path.join(directory, "valid.json")
    acquireReservations(valid, ledgerId,
      acquireRequest("alpha", "holder", {
        paths: [{ repository: "repo", path: "a" }],
      }))
    const corrupt = JSON.parse(fs.readFileSync(valid, "utf8"))
    corrupt.reservations.push({ ...corrupt.reservations[0] })
    fs.writeFileSync(valid, JSON.stringify(corrupt))
    expect(inspectReservationLedger(valid, ledgerId, inspectRequest()).status).toBe("RESERVATION_LEDGER_CORRUPT")

    const duplicateRelease = path.join(directory, "duplicate-release.json")
    const acquired = acquireReservations(duplicateRelease, ledgerId,
      acquireRequest("released", "release-holder", { contracts: ["released-contract"] }))
    releaseReservations(duplicateRelease, ledgerId,
      releaseRequest("released", "release-holder", acquired.fencingToken))
    const releasedLedger = JSON.parse(fs.readFileSync(duplicateRelease, "utf8"))
    releasedLedger.releases.push({ ...releasedLedger.releases[0] })
    fs.writeFileSync(duplicateRelease, JSON.stringify(releasedLedger))
    expect(inspectReservationLedger(duplicateRelease, ledgerId, inspectRequest()).status)
      .toBe("RESERVATION_LEDGER_CORRUPT")
  })

  it("rejects unknown fields at every request and reservation boundary", () => {
    const directory = tempDirectory()
    const ledger = path.join(directory, "ledger.json")
    const extraAcquire = { ...acquireRequest("extra", "holder"), unexpected: true }
    expect(acquireReservations(ledger, ledgerId, extraAcquire).status)
      .toBe("RESERVATION_ACQUIRE_REQUEST_INVALID")

    const extraSet = acquireRequest("extra-set", "holder")
    Object.assign(extraSet.reservationSet, { unexpected: true })
    expect(acquireReservations(ledger, ledgerId, extraSet).status)
      .toBe("RESERVATION_ACQUIRE_REQUEST_INVALID")

    const extraCollections = acquireRequest("extra-collections", "holder")
    Object.assign(extraCollections.reservationSet.reservations, { unexpected: [] })
    expect(acquireReservations(ledger, ledgerId, extraCollections).status)
      .toBe("RESERVATION_ACQUIRE_REQUEST_INVALID")

    const extraPath = acquireRequest("extra-path", "holder", {
      paths: [{ repository: "repo", path: "a" }],
    })
    Object.assign(extraPath.reservationSet.reservations.paths[0], { unexpected: true })
    expect(acquireReservations(ledger, ledgerId, extraPath).status)
      .toBe("RESERVATION_ACQUIRE_REQUEST_INVALID")

    const acquired = acquireReservations(ledger, ledgerId, acquireRequest("valid", "holder"))
    const extraRelease = {
      ...releaseRequest("valid", "holder", acquired.fencingToken),
      unexpected: true,
    }
    expect(releaseReservations(ledger, ledgerId, extraRelease).status)
      .toBe("RESERVATION_RELEASE_REQUEST_INVALID")
    expect(inspectReservationLedger(ledger, ledgerId, { ...inspectRequest(), unexpected: true }).status)
      .toBe("RESERVATION_INSPECT_REQUEST_INVALID")
  })

  it("rejects unknown persisted fields and unreachable fencing state", () => {
    const directory = tempDirectory()
    const ledger = path.join(directory, "ledger.json")
    acquireReservations(ledger, ledgerId, acquireRequest("alpha", "holder", {
      paths: [{ repository: "repo", path: "a" }],
    }))
    const original = JSON.parse(fs.readFileSync(ledger, "utf8"))

    fs.writeFileSync(ledger, JSON.stringify({ ...original, unexpected: true }))
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest()).status)
      .toBe("RESERVATION_LEDGER_CORRUPT")

    const entryExtra = structuredClone(original)
    entryExtra.reservations[0].unexpected = true
    fs.writeFileSync(ledger, JSON.stringify(entryExtra))
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest()).status)
      .toBe("RESERVATION_LEDGER_CORRUPT")

    const pathExtra = structuredClone(original)
    pathExtra.reservations[0].reservationSet.reservations.paths[0].unexpected = true
    fs.writeFileSync(ledger, JSON.stringify(pathExtra))
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest()).status)
      .toBe("RESERVATION_LEDGER_CORRUPT")

    const unreachableFence = structuredClone(original)
    unreachableFence.nextFencingToken = unreachableFence.version + 2
    fs.writeFileSync(ledger, JSON.stringify(unreachableFence))
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest()).status)
      .toBe("RESERVATION_LEDGER_CORRUPT")

    const activeReleaseOverlap = structuredClone(original)
    activeReleaseOverlap.version = 2
    activeReleaseOverlap.nextFencingToken = 3
    activeReleaseOverlap.releases = [{
      reservationSetId: "alpha",
      holderTokenDigest: "0".repeat(64),
      fencingToken: 2,
      releasedAt: new Date().toISOString(),
    }]
    fs.writeFileSync(ledger, JSON.stringify(activeReleaseOverlap))
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest()).status)
      .toBe("RESERVATION_LEDGER_CORRUPT")

    const releaseExtra = structuredClone(activeReleaseOverlap)
    releaseExtra.releases[0].unexpected = true
    fs.writeFileSync(ledger, JSON.stringify(releaseExtra))
    expect(inspectReservationLedger(ledger, ledgerId, inspectRequest()).status)
      .toBe("RESERVATION_LEDGER_CORRUPT")
  })

  it("recovers an abandoned stale lock but does not break a live lock", () => {
    const directory = tempDirectory()
    const ledger = path.join(directory, "ledger.json")
    const lock = `${ledger}.lock`
    fs.mkdirSync(lock)
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({
      pid: 999_999_999, hostname: os.hostname(),
    }))
    const previousHostname = process.env.HOSTNAME
    let staleOutcome
    try {
      process.env.HOSTNAME = "deliberately-different-environment-hostname"
      staleOutcome = acquireReservations(ledger, ledgerId,
        acquireRequest("alpha", "holder", {
          paths: [{ repository: "repo", path: "a" }],
        }),
        { staleLockMs: 0 })
    } finally {
      if (previousHostname === undefined) delete process.env.HOSTNAME
      else process.env.HOSTNAME = previousHostname
    }
    expect(staleOutcome).toMatchObject({ status: "RESERVATION_ACQUIRED" })

    fs.mkdirSync(lock)
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({
      pid: process.pid, hostname: os.hostname(),
    }))
    expect(acquireReservations(ledger, ledgerId,
      acquireRequest("beta", "holder", {
        paths: [{ repository: "repo", path: "b" }],
      }),
      { staleLockMs: 0, lockTimeoutMs: 0 })).toMatchObject({ status: "RESERVATION_LEDGER_LOCK_TIMEOUT" })
  })

  it("CLI is local-only and emits typed input, usage, inspect, and release results", () => {
    const directory = tempDirectory()
    const ledger = path.join(directory, "ledger.json")
    const acquireFile = path.join(directory, "acquire.json")
    fs.writeFileSync(acquireFile, JSON.stringify(acquireRequest("alpha", "holder", {
      paths: [{ repository: "repo", path: "a" }],
    })))
    return runCli(["acquire", ledger, ledgerId, acquireFile]).then(async (acquiredRun) => {
      expect(acquiredRun.code).toBe(0)
      const acquired = JSON.parse(acquiredRun.stdout)
      const releaseFile = path.join(directory, "release.json")
      fs.writeFileSync(releaseFile, JSON.stringify(releaseRequest("alpha", "holder", acquired.fencingToken)))
      const inspected = await runCli(["inspect", ledger, ledgerId])
      const released = await runCli(["release", ledger, ledgerId, releaseFile])
      const usage = await runCli([])
      const input = await runCli(["acquire", ledger, ledgerId, "missing.json"])
      expect(JSON.parse(inspected.stdout).status).toBe("RESERVATION_LEDGER_VALID")
      expect(JSON.parse(released.stdout).status).toBe("RESERVATION_RELEASED")
      expect(JSON.parse(usage.stdout).status).toBe("RESERVATION_LEDGER_CLI_USAGE_WALL")
      expect(JSON.parse(input.stdout).status).toBe("RESERVATION_LEDGER_INPUT_WALL")
      expect([released.code, usage.code, input.code]).toEqual([0, 2, 2])
    })
  }, 30_000)
})
