import { generateKeyPairSync } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  DeliverySealError,
  issueLoomCodexDeliverySeal,
  verifyWilliamOSDeliverySeal,
  type DeliverySealIssuerDependencies,
} from "@/lib/governance/delivery-seal"

const assignmentMetadata = {
  assignmentVersion: "loom-codex-assignment.v1",
  owner: "owner-1",
  provider: "Codex",
  mode: "delegate",
  workspace: "C:/workspace",
  threadId: "thread-1",
  resumed: false,
  worldId: "world-1",
  spaceRevision: 7,
  outcome: { id: 5, key: "WILLIAMOS_EXPERIENCE_V2", version: 3 },
  workOrder: { id: 41, ref: "WO-0041", version: "work-v1" },
  grant: { id: 9, ref: "GRANT-0009", version: "grant-v1" },
  reservation: {
    allowed: ["lib/governance/owner.ts"],
    forbidden: ["scripts/hermes-bridge/**"],
    version: "c".repeat(64),
  },
  promotionPath: "lib/governance/owner.ts",
  assignmentHash: "a".repeat(64),
  task: { digest: "d".repeat(64), text: "Harden the selected delivery gate." },
  executionBindingHash: "e".repeat(64),
  isolatedBaseSha: "1".repeat(40),
}

const readyMetadata = {
  provider: "Codex",
  mode: "delegate",
  workspace: "C:/workspace",
  committed: true,
  worldId: "world-1",
  outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
  workOrderId: 41,
  grantId: 9,
  assignmentHash: "a".repeat(64),
  selectedPath: "lib/governance/owner.ts",
  promotionDigest: "9".repeat(64),
  taskDigest: "d".repeat(64),
  executionBindingHash: "e".repeat(64),
  baseSha: "1".repeat(40),
}

function dependencies(overrides: Partial<DeliverySealIssuerDependencies> = {}): DeliverySealIssuerDependencies {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  return {
    loadAssignment: vi.fn().mockResolvedValue({ eventId: 101, metadata: assignmentMetadata }),
    loadReady: vi.fn().mockResolvedValue({ eventId: 102, metadata: readyMetadata }),
    deriveCurrentAssignment: vi.fn().mockResolvedValue({
      owner: "owner-1", worldId: "world-1", projectRoot: "C:/workspace",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 41, grantId: 9,
      selectedPath: "lib/governance/owner.ts",
      allowed: ["lib/governance/owner.ts"], forbidden: ["scripts/hermes-bridge/**"],
      assignmentHash: "a".repeat(64),
      binding: {
        spaceRevision: 7, outcomeId: 5, outcomeVersion: 3,
        workOrderRef: "WO-0041", workOrderVersion: "work-v1",
        grantRef: "GRANT-0009", grantVersion: "grant-v1", reservationVersion: "c".repeat(64),
      },
    }),
    inspectDelivery: vi.fn().mockResolvedValue({
      repository: "https://github.com/bsvalues/terragroq",
      baseSha: "1".repeat(40), commitSha: "2".repeat(40),
      paths: ["lib/governance/owner.ts"], patchDigest: "f".repeat(64), contentDigest: "9".repeat(64),
    }),
    signingKey: { privateKey, publicKey, keyId: "test-key" },
    recordSeal: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-08-29T20:00:00.000Z"),
    ...overrides,
  }
}

describe("WilliamOS assignment delivery seal issuance", () => {
  it("signs only the exact persisted Space assignment, success, task, session, reservation, and measured commit patch", async () => {
    const deps = dependencies()
    const seal = await issueLoomCodexDeliverySeal({
      userId: "owner-1", threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40),
    }, deps)

    expect(seal.payload).toMatchObject({
      version: "williamos-delivery-seal.v1",
      issuer: "WilliamOS",
      keyId: "test-key",
      assignment: {
        owner: "owner-1", worldId: "world-1", assignmentHash: "a".repeat(64),
        outcome: { id: 5, key: "WILLIAMOS_EXPERIENCE_V2", version: 3 },
        workOrder: { id: 41, ref: "WO-0041", version: "work-v1" },
        grant: { id: 9, ref: "GRANT-0009", version: "grant-v1" },
        reservation: assignmentMetadata.reservation,
        task: assignmentMetadata.task,
        session: { threadId: "thread-1", executionBindingHash: "e".repeat(64) },
      },
      delivery: {
        repository: "https://github.com/bsvalues/terragroq",
        baseSha: "1".repeat(40), commitSha: "2".repeat(40),
        paths: ["lib/governance/owner.ts"], patchDigest: "f".repeat(64), contentDigest: "9".repeat(64),
      },
    })
    expect(verifyWilliamOSDeliverySeal(seal, { "test-key": deps.signingKey.publicKey })).toBe(true)
    expect(deps.recordSeal).toHaveBeenCalledOnce()
  })

  it.each([
    ["missing assignment", { loadAssignment: vi.fn().mockResolvedValue(null) }],
    ["foreign persisted owner", { loadAssignment: vi.fn().mockResolvedValue({ eventId: 101, metadata: { ...assignmentMetadata, owner: "owner-2" } }) }],
    ["missing success", { loadReady: vi.fn().mockResolvedValue(null) }],
    ["stale current authority", { deriveCurrentAssignment: vi.fn().mockResolvedValue({ ...assignmentMetadata, assignmentHash: "b".repeat(64) }) }],
    ["different delivered path", { inspectDelivery: vi.fn().mockResolvedValue({ repository: "repo", baseSha: "1".repeat(40), commitSha: "2".repeat(40), paths: ["app/escape.ts"], patchDigest: "f".repeat(64) }) }],
  ])("fails closed for %s", async (_label, override) => {
    await expect(issueLoomCodexDeliverySeal({
      userId: "owner-1", threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40),
    }, dependencies(override as Partial<DeliverySealIssuerDependencies>))).rejects.toBeInstanceOf(DeliverySealError)
  })

  it("fails closed when the server has no private signing key", async () => {
    await expect(issueLoomCodexDeliverySeal({
      userId: "owner-1", threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40),
    }, dependencies({ signingKey: null }))).rejects.toMatchObject({ code: "DELIVERY_SEAL_SIGNING_UNAVAILABLE" })
  })

  it("refuses a commit whose selected file bytes differ from the successful assignment output", async () => {
    await expect(issueLoomCodexDeliverySeal({
      userId: "owner-1", threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40),
    }, dependencies({
      inspectDelivery: vi.fn().mockResolvedValue({
        repository: "https://github.com/bsvalues/terragroq",
        baseSha: "1".repeat(40), commitSha: "2".repeat(40), paths: ["lib/governance/owner.ts"],
        patchDigest: "f".repeat(64), contentDigest: "8".repeat(64),
      }),
    }))).rejects.toMatchObject({ code: "DELIVERY_SEAL_DIFF_INVALID" })
  })

  it("fails closed when authority drifts after Git inspection but before the atomic seal insert", async () => {
    const order: string[] = []
    await expect(issueLoomCodexDeliverySeal({
      userId: "owner-1", threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40),
    }, dependencies({
      inspectDelivery: vi.fn().mockImplementation(async () => {
        order.push("git-inspected")
        return {
          repository: "https://github.com/bsvalues/terragroq",
          baseSha: "1".repeat(40), commitSha: "2".repeat(40), paths: ["lib/governance/owner.ts"],
          patchDigest: "f".repeat(64), contentDigest: "9".repeat(64),
        }
      }),
      recordSeal: vi.fn().mockImplementation(async () => {
        order.push("final-authority-fence")
        throw new DeliverySealError("DELIVERY_SEAL_ASSIGNMENT_STALE", "reservation changed before insert")
      }),
    }))).rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })
    expect(order).toEqual(["git-inspected", "final-authority-fence"])
  })
})
