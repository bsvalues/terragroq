import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"

import {
  createHermesStateStore,
  hermesTurnResultDigest,
  normalizeHermesTurnResult,
} from "@/scripts/hermes-bridge/state-store.mjs"

const dirs: string[] = []
const ownerDecisionPacket = {
  blockedAction: "Resume the exact blocked validation.",
  authorityBoundary: "Primary authority is required.",
  minimumChoice: "APPROVE_OR_DENY",
  approveConsequence: "Resume only the blocked validation.",
  denyConsequence: "Keep the Work Order blocked.",
}
const turnResult = {
  result: "READY_FOR_VALIDATION",
  workOrder: "WO-HERMES-5-001",
  branch: "codex/hermes-goal-5-5",
  commit: null,
  prUrl: null,
  merged: false,
  mergeCommit: null,
  validation: ["reviewed"],
  reviewThreads: 0,
  ownerTouchCount: 0,
  blockedScopeCrossed: false,
  nextState: "READY_FOR_HERMES_MERGE",
  blockedAction: null,
  authorityBoundary: null,
  minimumChoice: null,
  approveConsequence: null,
  denyConsequence: null,
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "hermes-state-")); dirs.push(dir)
  let now = Date.parse("2026-07-21T00:00:00.000Z")
  const store = createHermesStateStore(join(dir, "state.json"), { now: () => now })
  store.initialize()
  return {
    dir,
    store,
    advance: (milliseconds: number) => { now += milliseconds },
    setNow: (value: number) => { now = value },
  }
}

describe("Hermes bridge durable state store", () => {
  it("persists a canonical secret-screened turn result only with its exact digest", () => {
    const { store } = fixture()
    const first = store.acquireLease({
      outcomeId: "5",
      holderId: "turn-holder",
      leaseDurationMs: 1000,
      idempotencyKey: "turn-result-acquire",
    })
    const canonical = normalizeHermesTurnResult(turnResult)
    const resultDigest = hermesTurnResultDigest(canonical)
    store.checkpoint({
      outcomeId: "5",
      holderId: "turn-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "CODEX_TURN_COMPLETED",
      metadata: { turnResult: canonical, turnResultDigest: resultDigest },
      idempotencyKey: "turn-result-checkpoint",
    })
    expect(store.read().executions["5"].metadata).toMatchObject({
      turnResult: canonical,
      turnResultDigest: resultDigest,
    })
    expect(() => store.checkpoint({
      outcomeId: "5",
      holderId: "turn-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 1,
      state: "HOST_VALIDATION_STARTED",
      metadata: { turnResult: canonical, turnResultDigest: "a".repeat(64) },
      idempotencyKey: "turn-result-bad-digest",
    })).toThrowError(expect.objectContaining({ code: "INVALID_TURN_RESULT_DIGEST" }))
  })

  it("rejects secret-like or schema-expanded turn results before persistence", () => {
    expect(() => normalizeHermesTurnResult({
      ...turnResult,
      validation: ["token=opaque-value"],
    })).toThrowError(expect.objectContaining({ code: "TURN_RESULT_SECRET_WALL" }))
    expect(() => normalizeHermesTurnResult({
      ...turnResult,
      unexpected: "field",
    })).toThrowError(expect.objectContaining({ code: "INVALID_TURN_RESULT" }))
  })

  it("atomically persists lease, metadata, checkpoint sequence, and idempotency", () => {
    const { dir, store } = fixture()
    const snapshot = { id: 1, command: "Improve WilliamOS", lane: "ui", risk: "R1", authority: "A2_WRITE_OWN" }
    const request = { outcomeId: "GOAL-1", holderId: "thread-1", leaseDurationMs: 1000, metadata: { threadId: "thread-1", turnId: "turn-1", branch: "codex/work", prNumber: 42, mergeSha: "a".repeat(40), outcome: snapshot }, idempotencyKey: "acquire-1" }
    const first = store.acquireLease(request)
    expect(store.acquireLease(request)).toMatchObject({ ...first, idempotent: true })
    const checkpoint = store.checkpoint({ outcomeId: "GOAL-1", holderId: "thread-1", fencingToken: first.fencingToken, expectedCheckpointSequence: 0, state: "EXECUTING", idempotencyKey: "checkpoint-1" })
    expect(checkpoint).toMatchObject({ checkpointSequence: 1, state: "EXECUTING" })
    expect(store.read().executions["GOAL-1"].metadata).toMatchObject({ threadId: "thread-1", turnId: "turn-1", branch: "codex/work", prNumber: 42, mergeSha: "a".repeat(40), outcome: snapshot })
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toMatchObject({ schemaVersion: 1 })
  })

  it("persists an exact queue fence and rejects corrupted restart bindings", () => {
    const { store } = fixture()
    const queueBinding = {
      userId: "primary-user",
      outcomeKey: "outcome:77",
      expectedVersion: 4,
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      fencingToken: 3,
      acquisitionKey: "acquisition-77",
    }
    store.acquireLease({
      outcomeId: "77",
      holderId: "resident-hermes",
      leaseDurationMs: 1000,
      metadata: { outcome: { id: 77, queueBinding } },
      idempotencyKey: "queue-binding-valid",
    })
    expect(store.read().executions["77"].metadata.outcome.queueBinding).toEqual(queueBinding)

    expect(() => store.acquireLease({
      outcomeId: "78",
      holderId: "resident-hermes",
      leaseDurationMs: 1000,
      metadata: { outcome: { id: 78, queueBinding: { ...queueBinding, leaseToken: "" } } },
      idempotencyKey: "queue-binding-invalid",
    })).toThrowError(expect.objectContaining({ code: "INVALID_OUTCOME_QUEUE_BINDING" }))
  })

  it("explicitly clears a stale reviewed head for pre-commit recovery", () => {
    const { store } = fixture()
    const lease = store.acquireLease({
      outcomeId: "GOAL-1", holderId: "thread-1", leaseDurationMs: 1000,
      metadata: { headRefOid: "a".repeat(40) }, idempotencyKey: "acquire-clear-head",
    })
    store.checkpoint({
      outcomeId: "GOAL-1", holderId: "thread-1", fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0, state: "HOST_VALIDATION_PASSED",
      metadata: { headRefOid: null }, idempotencyKey: "clear-head",
    })
    expect(store.read().executions["GOAL-1"].metadata.headRefOid).toBeNull()
  })

  it("explicitly clears stale App Server identity for provider reroute", () => {
    const { store } = fixture()
    const lease = store.acquireLease({
      outcomeId: "GOAL-1", holderId: "thread-1", leaseDurationMs: 1000,
      metadata: { threadId: "thread-1", turnId: "turn-1" }, idempotencyKey: "acquire-clear-thread",
    })
    store.checkpoint({
      outcomeId: "GOAL-1", holderId: "thread-1", fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0, state: "RETRYABLE_PROVIDER_WALL",
      metadata: { threadId: null, turnId: null }, idempotencyKey: "clear-thread",
    })
    expect(store.read().executions["GOAL-1"].metadata).toMatchObject({ threadId: null, turnId: null })
  })

  it("rejects non-string exact-head metadata", () => {
    const { store } = fixture()
    expect(() => store.acquireLease({
      outcomeId: "GOAL-1", holderId: "thread-1", leaseDurationMs: 1000,
      metadata: { headRefOid: ["a".repeat(40)] }, idempotencyKey: "invalid-head",
    })).toThrowError(expect.objectContaining({ code: "INVALID_HEAD_REF_OID" }))
  })

  it("persists bounded host validation evidence across state-store reads", () => {
    const { store } = fixture()
    const lease = store.acquireLease({
      outcomeId: "GOAL-1", holderId: "thread-1", leaseDurationMs: 1000,
      idempotencyKey: "acquire-validation-evidence",
    })
    store.checkpoint({
      outcomeId: "GOAL-1", holderId: "thread-1", fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0, state: "HOST_VALIDATION_PASSED",
      metadata: { validationEvidence: [{ command: "npm", args: ["test", "--", "--run"], code: 0 }] },
      idempotencyKey: "validation-evidence",
    })
    expect(store.read().executions["GOAL-1"].metadata.validationEvidence).toEqual([
      { command: "npm", args: ["test", "--", "--run"], code: 0, timedOut: false },
    ])
  })

  it("refuses secret-bearing validation failure evidence", () => {
    for (const [index, validationFailure] of [
      "postgresql://owner:credential@database.invalid/app",
      "redis://:credential@cache.invalid/0",
    ].entries()) {
      const { store } = fixture()
      const lease = store.acquireLease({
        outcomeId: "GOAL-1", holderId: "thread-1", leaseDurationMs: 1000,
        idempotencyKey: `acquire-secret-evidence-${index}`,
      })
      expect(() => store.checkpoint({
        outcomeId: "GOAL-1", holderId: "thread-1", fencingToken: lease.fencingToken,
        expectedCheckpointSequence: 0, state: "VALIDATION_REMEDIATION_REQUIRED",
        metadata: { validationFailure }, idempotencyKey: `secret-evidence-${index}`,
      })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILURE_SECRET_WALL" }))
    }
  })

  it("refuses secret-bearing validation failure evidence already persisted on disk", () => {
    const { dir, store } = fixture()
    store.acquireLease({
      outcomeId: "GOAL-1", holderId: "thread-1", leaseDurationMs: 1000,
      metadata: { validationFailure: "ordinary test failure" }, idempotencyKey: "acquire-persisted-secret",
    })
    const statePath = join(dir, "state.json")
    const state = JSON.parse(readFileSync(statePath, "utf8"))
    state.executions["GOAL-1"].metadata.validationFailure = "redis://:credential@cache.invalid/0"
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8")

    expect(() => store.read()).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILURE_SECRET_WALL" }))
  })

  it("refuses secret-bearing historical idempotency entries", () => {
    const { dir, store } = fixture()
    const statePath = join(dir, "state.json")
    const state = JSON.parse(readFileSync(statePath, "utf8"))
    state.idempotency.injected = { result: { validationFailure: "redis://:credential@cache.invalid/0" } }
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8")

    expect(() => store.read()).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_SECRET_WALL" }))
  })

  it("reclaims only expired leases and fences stale writers", () => {
    const { store, advance } = fixture()
    const first = store.acquireLease({ outcomeId: "GOAL-1", holderId: "one", leaseDurationMs: 100, idempotencyKey: "a" })
    expect(() => store.reclaimLease({ outcomeId: "GOAL-1", holderId: "two", leaseDurationMs: 100, expectedFencingToken: first.fencingToken, idempotencyKey: "early" })).toThrowError(expect.objectContaining({ code: "LEASE_NOT_EXPIRED" }))
    advance(101)
    const second = store.reclaimLease({ outcomeId: "GOAL-1", holderId: "two", leaseDurationMs: 100, expectedFencingToken: first.fencingToken, idempotencyKey: "reclaim" })
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(() => store.checkpoint({ outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken, expectedCheckpointSequence: 0, state: "STALE", idempotencyKey: "stale" })).toThrowError(expect.objectContaining({ code: "FENCING_TOKEN_CONFLICT" }))
  })

  it("renews a live lease without changing its fencing token", () => {
    const { store, advance } = fixture()
    const first = store.acquireLease({ outcomeId: "GOAL-1", holderId: "one", leaseDurationMs: 1000, idempotencyKey: "a" })
    advance(500)
    const renewed = store.renewLease({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      leaseDurationMs: 1000, idempotencyKey: "renew",
    })
    expect(renewed.fencingToken).toBe(first.fencingToken)
    expect(Date.parse(renewed.leaseExpiresAt)).toBe(Date.parse("2026-07-21T00:00:01.500Z"))
  })

  it("separates wall-clock lease deadlines from monotonic mutation evidence across a clock rollback", () => {
    const { store, advance, setNow } = fixture()
    const first = store.acquireLease({
      outcomeId: "GOAL-1", holderId: "one", leaseDurationMs: 2000, idempotencyKey: "rollback-acquire",
    })
    advance(5000)
    store.setKillSwitch({
      active: false, reason: "advance mutation clock", idempotencyKey: "rollback-clock-advance",
    })
    setNow(Date.parse("2026-07-21T00:00:01.000Z"))

    expect(() => store.acquireLease({
      outcomeId: "GOAL-1", holderId: "two", leaseDurationMs: 2000,
      idempotencyKey: "rollback-duplicate-acquire",
    })).toThrowError(expect.objectContaining({ code: "LEASE_ALREADY_HELD" }))
    expect(() => store.reclaimLease({
      outcomeId: "GOAL-1", holderId: "two", leaseDurationMs: 2000,
      expectedFencingToken: first.fencingToken, idempotencyKey: "rollback-premature-reclaim",
    })).toThrowError(expect.objectContaining({ code: "LEASE_NOT_EXPIRED" }))

    const renewed = store.renewLease({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      leaseDurationMs: 2000, idempotencyKey: "rollback-renew",
    })
    store.checkpoint({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "EXECUTING", idempotencyKey: "rollback-checkpoint",
    })

    const state = store.read()
    expect(renewed.leaseExpiresAt).toBe("2026-07-21T00:00:03.000Z")
    expect(state.updatedAt).toBe("2026-07-21T00:00:05.000Z")
    expect(state.executions["GOAL-1"].lease.renewedAt).toBe(state.updatedAt)
    expect(state.executions["GOAL-1"].checkpoint.recordedAt).toBe(state.updatedAt)
  })

  it("abandons an interrupted holder for immediate fenced reclaim across a clock rollback", () => {
    const { store, advance, setNow } = fixture()
    const first = store.acquireLease({
      outcomeId: "GOAL-1", holderId: "one", leaseDurationMs: 10_000, idempotencyKey: "a",
    })
    advance(5000)
    store.setKillSwitch({
      active: false, reason: "advance mutation clock", idempotencyKey: "abandon-clock-advance",
    })
    setNow(Date.parse("2026-07-21T00:00:00.500Z"))
    const abandoned = store.abandonLease({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      reason: "APP_SERVER_TURN_INTERRUPTED", idempotencyKey: "abandon",
    })
    expect(abandoned.leaseExpiresAt).toBe("2026-07-21T00:00:05.000Z")
    expect(() => store.checkpoint({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "STALE", idempotencyKey: "abandoned-checkpoint",
    })).toThrowError(expect.objectContaining({ code: "LEASE_NOT_HELD" }))
    expect(() => store.renewLease({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      leaseDurationMs: 1000, idempotencyKey: "abandoned-renew",
    })).toThrowError(expect.objectContaining({ code: "LEASE_NOT_HELD" }))
    expect(() => store.releaseLease({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      idempotencyKey: "abandoned-release",
    })).toThrowError(expect.objectContaining({ code: "LEASE_NOT_HELD" }))
    expect(() => store.abandonLease({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      reason: "STALE_ABANDON", idempotencyKey: "abandoned-again",
    })).toThrowError(expect.objectContaining({ code: "LEASE_NOT_HELD" }))
    const second = store.reclaimLease({
      outcomeId: "GOAL-1", holderId: "two", leaseDurationMs: 1000,
      expectedFencingToken: first.fencingToken, idempotencyKey: "reclaim",
    })
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(store.read().executions["GOAL-1"].lease).toMatchObject({ status: "ACTIVE", holderId: "two" })
  })

  it("reopens only an exact released transient provider terminal for fenced redispatch", () => {
    const { store } = fixture()
    const detail = "HERMES_REDISPATCH_REQUIRED_WITH_NATIVE_NODE_EXECUTION_AND_WRITABLE_GIT_METADATA; preserve the existing owned working-tree changes"
    const first = store.acquireLease({
      outcomeId: "5", holderId: "one", leaseDurationMs: 1000,
      metadata: { threadId: "stale-thread", turnId: "stale-turn" }, idempotencyKey: "a",
    })
    store.checkpoint({
      outcomeId: "5", holderId: "one", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "FAILED_TERMINAL", detail, idempotencyKey: "failed",
    })
    store.releaseLease({ outcomeId: "5", holderId: "one", fencingToken: first.fencingToken, idempotencyKey: "released" })

    expect(() => store.reopenProviderWall({
      outcomeId: "5", expectedFencingToken: first.fencingToken,
      expectedDetail: "different failure", idempotencyKey: "wrong",
    })).toThrowError(expect.objectContaining({ code: "PROVIDER_RECOVERY_STATE_WALL" }))

    expect(store.reopenProviderWall({
      outcomeId: "5", expectedFencingToken: first.fencingToken,
      expectedDetail: detail, idempotencyKey: "recover",
    })).toMatchObject({ leaseStatus: "ABANDONED", checkpointSequence: 2 })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "ABANDONED", recoverReason: "TRANSIENT_NATIVE_PROVIDER_WALL" },
      checkpoint: { state: "RETRYABLE_PROVIDER_WALL", detail },
      metadata: { threadId: null, turnId: null },
    })
  })

  it("reopens only the exact zero-touch validation infrastructure terminal", () => {
    const { store } = fixture()
    const first = store.acquireLease({
      outcomeId: "5", holderId: "one", leaseDurationMs: 1000,
      metadata: {
        validationFailure: "Error: spawn EPERM while starting an isolated host-only test",
        validationRemediationRound: 3,
        validationEvidence: [{ command: "npm", args: ["test", "--", "--run"], code: 1 }],
        headRefOid: "a".repeat(40),
      },
      idempotencyKey: "validation-acquire",
    })
    store.checkpoint({
      outcomeId: "5", holderId: "one", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED", idempotencyKey: "validation-failed",
    })
    store.releaseLease({
      outcomeId: "5", holderId: "one", fencingToken: first.fencingToken,
      idempotencyKey: "validation-released",
    })
    const validationFailure = "Error: spawn EPERM while starting an isolated host-only test"
    const validationFailureDigest = createHash("sha256").update(validationFailure).digest("hex")
    const proofDigest = "b".repeat(64)

    expect(store.reopenValidationInfrastructureWall({
      outcomeId: "5", expectedFencingToken: first.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED", validationFailure,
      expectedValidationFailureDigest: validationFailureDigest, proofDigest,
      idempotencyKey: "validation-recover",
    })).toMatchObject({
      leaseStatus: "ABANDONED", checkpointSequence: 2,
      state: "VALIDATION_INFRASTRUCTURE_RECOVERED",
    })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "ABANDONED", recoverReason: "VALIDATION_INFRASTRUCTURE_REMEDIATED" },
      checkpoint: { state: "VALIDATION_INFRASTRUCTURE_RECOVERED" },
      metadata: {
        validationFailure: null, validationEvidence: null, validationRemediationRound: 0,
        validationRecoveryProofDigest: proofDigest,
        validationRecoveryPhase: "PENDING_HOST_VALIDATION",
        validationRecoveryFencingToken: first.fencingToken,
        headRefOid: null,
      },
    })
  })

  it("reopens an exact missing-executable validation infrastructure terminal", () => {
    const { store } = fixture()
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const first = store.acquireLease({
      outcomeId: "12", holderId: "one", leaseDurationMs: 1000,
      metadata: { validationFailure, validationRemediationRound: 3 },
      idempotencyKey: "missing-tool-acquire",
    })
    store.checkpoint({
      outcomeId: "12", holderId: "one", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED", idempotencyKey: "missing-tool-failed",
    })
    store.releaseLease({
      outcomeId: "12", holderId: "one", fencingToken: first.fencingToken,
      idempotencyKey: "missing-tool-released",
    })

    expect(store.reopenValidationInfrastructureWall({
      outcomeId: "12", expectedFencingToken: first.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "c".repeat(64), idempotencyKey: "missing-tool-recover",
    })).toMatchObject({
      leaseStatus: "ABANDONED",
      state: "VALIDATION_INFRASTRUCTURE_RECOVERED",
    })
  })

  it.each([
    { validationRecoveryPhase: "PENDING_HOST_VALIDATION", validationRecoveryFencingToken: null },
    { validationRecoveryPhase: null, validationRecoveryFencingToken: 14 },
  ])("rejects an incomplete validation recovery metadata binding", (metadata) => {
    const { store } = fixture()
    expect(() => store.acquireLease({
      outcomeId: "binding", holderId: "one", leaseDurationMs: 1000,
      metadata, idempotencyKey: `binding-${metadata.validationRecoveryPhase ?? "token"}`,
    })).toThrow(expect.objectContaining({ code: "INVALID_VALIDATION_RECOVERY_BINDING" }))
  })

  it("refuses validation infrastructure recovery outside its exact boundary", () => {
    for (const invalid of ["detail", "failure", "owner-touch", "fence"] as const) {
      const { store } = fixture()
      const first = store.acquireLease({
        outcomeId: "5", holderId: "one", leaseDurationMs: 1000,
        metadata: { validationFailure: invalid === "failure" ? "ordinary assertion failure" : "spawn EPERM" },
        idempotencyKey: `${invalid}-acquire`,
      })
      store.checkpoint({
        outcomeId: "5", holderId: "one", fencingToken: first.fencingToken,
        expectedCheckpointSequence: 0, state: "FAILED_TERMINAL",
        detail: invalid === "detail" ? "OTHER_TERMINAL" : "VALIDATION_REMEDIATION_EXHAUSTED",
        idempotencyKey: `${invalid}-failed`,
      })
      store.releaseLease({
        outcomeId: "5", holderId: "one", fencingToken: first.fencingToken,
        idempotencyKey: `${invalid}-released`,
      })
      if (invalid === "owner-touch") {
        store.recordOwnerTouch({ counter: "ownerRoutineContactCount", idempotencyKey: "touch-owner" })
      }
      expect(() => store.reopenValidationInfrastructureWall({
        outcomeId: "5",
        expectedFencingToken: invalid === "fence" ? first.fencingToken + 1 : first.fencingToken,
        expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
        expectedValidationFailureDigest: createHash("sha256")
          .update(invalid === "failure" ? "ordinary assertion failure" : "spawn EPERM").digest("hex"),
        proofDigest: "b".repeat(64),
        idempotencyKey: `${invalid}-recover`,
      })).toThrowError(expect.objectContaining({
        code: invalid === "fence" ? "FENCING_TOKEN_CONFLICT" : "VALIDATION_INFRASTRUCTURE_RECOVERY_STATE_WALL",
      }))
    }
  })

  it("reopens an exact zero-touch review remediation terminal for immediate fenced reclaim", () => {
    const { dir, store } = fixture()
    const prNumber = 448
    const terminalHeadRefOid = "a".repeat(40)
    const headRefOid = "d".repeat(40)
    const mergeSha = "b".repeat(40)
    const proofDigest = "c".repeat(64)
    const first = store.acquireLease({
      outcomeId: "5", holderId: "review-holder", leaseDurationMs: 1000,
      metadata: {
        threadId: "review-thread", turnId: "review-turn", prNumber,
        headRefOid: terminalHeadRefOid, mergeSha: null,
      },
      idempotencyKey: "review-acquire",
    })
    store.checkpoint({
      outcomeId: "5", holderId: "review-holder", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "FAILED_TERMINAL",
      detail: "REVIEW_REMEDIATION_EXHAUSTED", idempotencyKey: "review-failed",
    })
    store.releaseLease({
      outcomeId: "5", holderId: "review-holder", fencingToken: first.fencingToken,
      idempotencyKey: "review-released",
    })
    const request = {
      outcomeId: "5", expectedFencingToken: first.fencingToken,
      prNumber, expectedPriorHeadRefOid: terminalHeadRefOid,
      headRefOid, mergeSha, proofDigest,
      mergeDetail: `Recovered reviewed PR #${prNumber}`,
      idempotencyKey: "review-recover",
    }

    const pending = store.beginReviewRemediationRecovery({
      ...request,
      idempotencyKey: "review-recover-begin",
    })
    expect(pending).toMatchObject({
      leaseStatus: "RELEASED", checkpointSequence: 2,
      state: "REVIEW_REMEDIATION_RECOVERY_PENDING",
    })
    const merged = store.recordReviewRemediationMerge({
      ...request,
      idempotencyKey: "review-recover-merged",
    })
    expect(merged).toMatchObject({
      leaseStatus: "RELEASED", checkpointSequence: 3, state: "PR_MERGED",
    })
    const reopened = store.finalizeReviewRemediationRecovery({
      ...request,
      idempotencyKey: "review-recover-finalize",
    })
    expect(reopened).toMatchObject({
      leaseStatus: "ABANDONED", checkpointSequence: 4,
      state: "REVIEW_REMEDIATION_RECOVERED", idempotent: false,
    })
    expect(store.finalizeReviewRemediationRecovery({
      ...request,
      idempotencyKey: "review-recover-finalize",
    })).toMatchObject({
      ...reopened, idempotent: true,
    })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "ABANDONED", recoverReason: "REVIEW_REMEDIATION_PROOF_ACCEPTED" },
      checkpoint: {
        sequence: 4, state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        threadId: null, turnId: null, prNumber,
        reviewRecoveryPriorHeadRefOid: terminalHeadRefOid,
        headRefOid, mergeSha,
        reviewRecoveryProofDigest: proofDigest,
      },
    })
    const legacyStatePath = join(dir, "state.json")
    const legacyState = JSON.parse(readFileSync(legacyStatePath, "utf8"))
    delete legacyState.executions["5"].metadata.reviewProjectionReconciledFromSequence
    writeFileSync(legacyStatePath, JSON.stringify(legacyState))

    const reconciled = store.reconcileReviewRemediationProjection({
      ...request,
      expectedCheckpointSequence: 4,
      idempotencyKey: "review-recover-projection",
    })
    expect(reconciled).toMatchObject({
      leaseStatus: "ABANDONED", checkpointSequence: 5,
      state: "REVIEW_REMEDIATION_RECOVERED",
    })
    expect(store.reconcileReviewRemediationProjection({
      ...request,
      expectedCheckpointSequence: 4,
      idempotencyKey: "review-recover-projection",
    })).toMatchObject({ ...reconciled, idempotent: true })
    expect(() => store.reconcileReviewRemediationProjection({
      ...request,
      expectedCheckpointSequence: 5,
      idempotencyKey: "review-recover-projection-again",
    })).toThrowError(expect.objectContaining({
      code: "REVIEW_REMEDIATION_PROJECTION_RECOVERY_STATE_WALL",
    }))

    const reclaimed = store.reclaimLease({
      outcomeId: "5", holderId: "recovery-holder", leaseDurationMs: 1000,
      expectedFencingToken: first.fencingToken, idempotencyKey: "review-reclaim",
    })
    expect(reclaimed.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(() => store.checkpoint({
      outcomeId: "5", holderId: "review-holder", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 5, state: "STALE", idempotencyKey: "review-stale",
    })).toThrowError(expect.objectContaining({ code: "FENCING_TOKEN_CONFLICT" }))
  })

  it("preserves terminal review remediation outside the exact recovery boundary", () => {
    for (const invalid of [
      "lease", "state", "detail", "pr", "prior-head", "head", "merge", "proof",
      "owner-touch", "fence",
    ] as const) {
      const { store } = fixture()
      const prNumber = 448
      const headRefOid = "a".repeat(40)
      const mergeSha = "b".repeat(40)
      const first = store.acquireLease({
        outcomeId: "5", holderId: "review-holder", leaseDurationMs: 1000,
        metadata: { prNumber, headRefOid: "d".repeat(40), mergeSha: null },
        idempotencyKey: `${invalid}-review-acquire`,
      })
      store.checkpoint({
        outcomeId: "5", holderId: "review-holder", fencingToken: first.fencingToken,
        expectedCheckpointSequence: 0,
        state: invalid === "state" ? "REMEDIATING" : "FAILED_TERMINAL",
        detail: invalid === "detail" ? "OTHER_TERMINAL" : "REVIEW_REMEDIATION_EXHAUSTED",
        idempotencyKey: `${invalid}-review-failed`,
      })
      if (invalid !== "lease") {
        store.releaseLease({
          outcomeId: "5", holderId: "review-holder", fencingToken: first.fencingToken,
          idempotencyKey: `${invalid}-review-released`,
        })
      }
      if (invalid === "owner-touch") {
        store.recordOwnerTouch({ counter: "ownerRoutineContactCount", idempotencyKey: "review-owner-touch" })
      }

      expect(() => store.beginReviewRemediationRecovery({
        outcomeId: "5",
        expectedFencingToken: invalid === "fence" ? first.fencingToken + 1 : first.fencingToken,
        prNumber: invalid === "pr" ? prNumber + 1 : prNumber,
        expectedPriorHeadRefOid: invalid === "prior-head" ? "e".repeat(40) : "d".repeat(40),
        headRefOid: invalid === "head" ? "not-a-sha" : headRefOid,
        mergeSha: invalid === "merge" ? "not-a-sha" : mergeSha,
        proofDigest: invalid === "proof" ? "not-a-digest" : "c".repeat(64),
        idempotencyKey: `${invalid}-review-recover`,
      })).toThrowError(expect.objectContaining({
        code: invalid === "fence"
          ? "FENCING_TOKEN_CONFLICT"
          : "REVIEW_REMEDIATION_RECOVERY_STATE_WALL",
      }))
      expect(store.read().executions["5"]).toMatchObject({
        lease: { status: invalid === "lease" ? "ACTIVE" : "RELEASED" },
        checkpoint: { state: invalid === "state" ? "REMEDIATING" : "FAILED_TERMINAL" },
      })
    }
  })

  it("recovers only an exact zero-touch external-tool wall after supervisor containment", () => {
    const { store } = fixture()
    const first = store.acquireLease({
      outcomeId: "5", holderId: "contained-holder", leaseDurationMs: 1000,
      metadata: { threadId: "blocked-thread", turnId: "blocked-turn" }, idempotencyKey: "external-acquire",
    })
    store.checkpoint({
      outcomeId: "5", holderId: "contained-holder", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "RETRYABLE_WALL", detail: "APP_SERVER_EXTERNAL_TOOL_WALL",
      idempotencyKey: "external-wall",
    })
    expect(store.recoverExternalToolWall({
      outcomeId: "5", expectedFencingToken: first.fencingToken,
      expectedHolderId: "contained-holder", activationDisabled: true,
      idempotencyKey: "external-recover",
    })).toMatchObject({ leaseStatus: "ABANDONED", checkpointSequence: 2 })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "ABANDONED", recoverReason: "APP_SERVER_EXTERNAL_TOOL_WALL" },
      checkpoint: { state: "EXTERNAL_TOOL_WALL_RECOVERED" },
      metadata: { threadId: null, turnId: null },
    })
  })

  it("recovers only an exact zero-touch post-merge cleanup interruption", () => {
    const { store } = fixture()
    const first = store.acquireLease({
      outcomeId: "5", holderId: "stopped-holder", leaseDurationMs: 1000,
      metadata: { prNumber: 440, headRefOid: "a".repeat(40), mergeSha: "b".repeat(40) },
      idempotencyKey: "post-merge-acquire",
    })
    store.checkpoint({
      outcomeId: "5", holderId: "stopped-holder", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "PR_MERGED", detail: "PR #440 merged",
      idempotencyKey: "post-merge-checkpoint",
    })
    expect(store.recoverPostMergeCleanupWall({
      outcomeId: "5", expectedFencingToken: first.fencingToken,
      expectedHolderId: "stopped-holder", activationDisabled: true,
      idempotencyKey: "post-merge-recover",
    })).toMatchObject({ leaseStatus: "ABANDONED", checkpointSequence: 2 })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "ABANDONED", recoverReason: "POST_MERGE_CLEANUP_INTERRUPTED" },
      checkpoint: { state: "POST_MERGE_CLEANUP_RECOVERED", detail: "PR #440" },
    })
  })

  it("reopens only an exact zero-touch exhausted terminal cleanup after external proof", () => {
    const { store } = fixture()
    const first = store.acquireLease({
      outcomeId: "5", holderId: "cleanup-holder", leaseDurationMs: 1000,
      metadata: {
        outcome: { id: 5 },
        branch: "codex/hermes-goal-0005-5",
        worktreePath: "C:\\owned\\hermes-goal-0005-5",
        prNumber: 440,
        headRefOid: "a".repeat(40),
        mergeSha: "b".repeat(40),
        postMergeCleanupRetryCount: 3,
      },
      idempotencyKey: "terminal-cleanup-acquire",
    })
    store.checkpoint({
      outcomeId: "5", holderId: "cleanup-holder", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "FAILED_TERMINAL",
      detail: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
      idempotencyKey: "terminal-cleanup-wall",
    })
    store.releaseLease({
      outcomeId: "5", holderId: "cleanup-holder", fencingToken: first.fencingToken,
      idempotencyKey: "terminal-cleanup-release",
    })

    const pending = store.beginTerminalPostMergeCleanupRecovery({
      outcomeId: "5",
      expectedFencingToken: first.fencingToken,
      expectedCheckpointSequence: 1,
      activationDisabled: true,
      prNumber: 440,
      branch: "codex/hermes-goal-0005-5",
      worktreePath: "C:\\owned\\hermes-goal-0005-5",
      headRefOid: "a".repeat(40),
      mergeSha: "b".repeat(40),
      proofDigest: "c".repeat(64),
      idempotencyKey: "terminal-cleanup-recover",
    })
    expect(pending).toMatchObject({ leaseStatus: "RELEASED", checkpointSequence: 2 })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "RELEASED" },
      checkpoint: {
        state: "POST_MERGE_CLEANUP_TERMINAL_RECOVERY_PENDING",
        detail: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
      },
    })
    expect(store.finalizeTerminalPostMergeCleanupRecovery({
      outcomeId: "5",
      expectedFencingToken: first.fencingToken,
      expectedCheckpointSequence: 2,
      activationDisabled: true,
      prNumber: 440,
      branch: "codex/hermes-goal-0005-5",
      worktreePath: "C:\\owned\\hermes-goal-0005-5",
      headRefOid: "a".repeat(40),
      mergeSha: "b".repeat(40),
      proofDigest: "c".repeat(64),
      idempotencyKey: "terminal-cleanup-finalize",
    })).toMatchObject({ leaseStatus: "ABANDONED", checkpointSequence: 3 })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "ABANDONED", recoverReason: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED" },
      checkpoint: { sequence: 3, state: "POST_MERGE_CLEANUP_RECOVERED", detail: "PR #440" },
      metadata: {
        postMergeCleanupRetryCount: 0,
        terminalCleanupRecoveryProofDigest: "c".repeat(64),
      },
    })
  })

  it("defers provider-unavailable work without losing its resumable execution", () => {
    const { store, advance } = fixture()
    const first = store.acquireLease({ outcomeId: "5", holderId: "one", leaseDurationMs: 1000, idempotencyKey: "a" })
    store.checkpoint({
      outcomeId: "5", holderId: "one", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "PROVIDER_UNAVAILABLE",
      detail: "BOUNDED_PROVIDER_REDISPATCH_EXHAUSTED",
      metadata: { providerRetryCount: 3, externalToolRetryCount: 3 },
      idempotencyKey: "provider-unavailable",
    })
    expect(store.deferProviderWall({
      outcomeId: "5", holderId: "one", fencingToken: first.fencingToken,
      retryAfter: "2026-07-21T00:15:00.000Z", idempotencyKey: "defer",
    })).toMatchObject({ leaseStatus: "DEFERRED", retryAfter: "2026-07-21T00:15:00.000Z" })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "DEFERRED", deferReason: "PROVIDER_UNAVAILABLE" },
      checkpoint: { state: "DEFERRED_PROVIDER_UNAVAILABLE" },
      metadata: { providerRetryCount: 0, externalToolRetryCount: 0 },
    })
    advance(15 * 60 * 1000 + 1)
    const resumed = store.reclaimLease({
      outcomeId: "5", holderId: "two", expectedFencingToken: first.fencingToken,
      leaseDurationMs: 1000, idempotencyKey: "resume",
    })
    expect(resumed.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(resumed.metadata.providerRetryCount).toBe(0)
    expect(resumed.metadata.externalToolRetryCount).toBe(0)
  })

  it("reopens an approved owner wall exactly once and preserves the fence", () => {
    const { store } = fixture()
    const first = store.acquireLease({
      outcomeId: "5", holderId: "owner-wall-holder", leaseDurationMs: 1000,
      idempotencyKey: "owner-wall-acquire",
      metadata: { threadId: "thread-owner-wall", ownerDecisionPacket },
    })
    store.checkpoint({
      outcomeId: "5", holderId: "owner-wall-holder", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "OWNER_DECISION_REQUIRED", detail: "EXACT_NEXT_STATE",
      idempotencyKey: "owner-wall-checkpoint",
    })
    store.releaseLease({
      outcomeId: "5", holderId: "owner-wall-holder", fencingToken: first.fencingToken,
      idempotencyKey: "owner-wall-release",
    })

    const request = {
      outcomeId: "5", expectedFencingToken: first.fencingToken,
      expectedNextState: "EXACT_NEXT_STATE", ownerDecisionId: 19,
      ownerDecisionRef: "OWNER-DECISION-5-88", requestKey: "owner-request",
      workOrderId: 55, terminalEventId: 88,
      decisionPacket: ownerDecisionPacket,
      decisionPacketDigest: createHash("sha256")
        .update(JSON.stringify(ownerDecisionPacket))
        .digest("hex"),
      idempotencyKey: "owner-wall-reopen",
    }
    expect(store.reopenOwnerDecisionWall(request)).toMatchObject({
      fencingToken: first.fencingToken, checkpointSequence: 2,
      leaseStatus: "ABANDONED", state: "OWNER_DECISION_ACCEPTED",
    })
    expect(store.reopenOwnerDecisionWall(request)).toMatchObject({
      idempotent: true, checkpointSequence: 2, leaseStatus: "ABANDONED",
    })
    expect(store.read().executions["5"]).toMatchObject({
      fencingToken: first.fencingToken,
      lease: { status: "ABANDONED", recoverReason: "OWNER_DECISION_ACCEPTED" },
      checkpoint: { state: "OWNER_DECISION_ACCEPTED", detail: "EXACT_NEXT_STATE" },
      metadata: {
        threadId: "thread-owner-wall",
        ownerDecisionId: 19,
        ownerDecisionRef: "OWNER-DECISION-5-88",
        ownerDecisionNextState: "EXACT_NEXT_STATE",
        ownerDecisionResumePhase: "PENDING",
        ownerDecisionWorkOrderId: 55,
        ownerDecisionTerminalEventId: 88,
        ownerDecisionPacketDigest: request.decisionPacketDigest,
        ownerDecisionPacket,
      },
    })
    expect(store.reclaimLease({
      outcomeId: "5", holderId: "resumed-holder", expectedFencingToken: first.fencingToken,
      leaseDurationMs: 1000, idempotencyKey: "owner-wall-reclaim",
    }).fencingToken).toBeGreaterThan(first.fencingToken)
  })

  it("rejects owner-wall reopen for stale state or a stale fence", () => {
    const { store } = fixture()
    const first = store.acquireLease({
      outcomeId: "5", holderId: "owner-wall-holder", leaseDurationMs: 1000,
      idempotencyKey: "owner-wall-invalid-acquire",
      metadata: { ownerDecisionPacket },
    })
    store.checkpoint({
      outcomeId: "5", holderId: "owner-wall-holder", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0, state: "OWNER_DECISION_REQUIRED", detail: "EXACT_NEXT_STATE",
      idempotencyKey: "owner-wall-invalid-checkpoint",
    })
    store.releaseLease({
      outcomeId: "5", holderId: "owner-wall-holder", fencingToken: first.fencingToken,
      idempotencyKey: "owner-wall-invalid-release",
    })
    expect(() => store.reopenOwnerDecisionWall({
      outcomeId: "5", expectedFencingToken: first.fencingToken + 1,
      expectedNextState: "EXACT_NEXT_STATE", idempotencyKey: "owner-wall-stale-fence",
    })).toThrowError(expect.objectContaining({ code: "FENCING_TOKEN_CONFLICT" }))
    expect(() => store.reopenOwnerDecisionWall({
      outcomeId: "5", expectedFencingToken: first.fencingToken,
      expectedNextState: "OTHER_NEXT_STATE", idempotencyKey: "owner-wall-stale-state",
    })).toThrowError(expect.objectContaining({ code: "OWNER_DECISION_REOPEN_STATE_WALL" }))
  })

  it("rejects malformed owner decision packets with a typed state wall", () => {
    const { store } = fixture()
    expect(() => store.acquireLease({
      outcomeId: "5",
      holderId: "owner-wall-holder",
      leaseDurationMs: 1000,
      idempotencyKey: "owner-wall-malformed-packet",
      metadata: { ownerDecisionPacket: "not-a-packet" },
    })).toThrowError(expect.objectContaining({ code: "INVALID_OWNER_DECISION_PACKET" }))
  })

  it.each([
    [{ ownerDecisionId: 0, ownerDecisionRef: "OWNER-DECISION-5-88", ownerDecisionRequestKey: "request" }, "INVALID_OWNER_DECISION_ID"],
    [{ ownerDecisionId: 19, ownerDecisionRef: "invalid", ownerDecisionRequestKey: "request" }, "INVALID_OWNER_DECISION_REF"],
    [{ ownerDecisionId: 19, ownerDecisionRef: "OWNER-DECISION-5-88", ownerDecisionRequestKey: "" }, "INVALID_OWNER_DECISION_REQUEST_KEY"],
    [{ ownerDecisionId: 19 }, "INVALID_OWNER_DECISION_BINDING"],
  ])("rejects malformed owner decision binding metadata", (metadata, code) => {
    const { store } = fixture()
    expect(() => store.acquireLease({
      outcomeId: "5",
      holderId: "owner-wall-holder",
      leaseDurationMs: 1000,
      idempotencyKey: `owner-wall-invalid-binding-${code}`,
      metadata,
    })).toThrowError(expect.objectContaining({ code }))
  })

  it("rejects a database approval bound to a different local authority packet", () => {
    const { store } = fixture()
    const first = store.acquireLease({
      outcomeId: "5",
      holderId: "owner-wall-holder",
      leaseDurationMs: 1000,
      idempotencyKey: "owner-wall-packet-acquire",
      metadata: { ownerDecisionPacket },
    })
    store.checkpoint({
      outcomeId: "5",
      holderId: "owner-wall-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED",
      detail: "EXACT_NEXT_STATE",
      idempotencyKey: "owner-wall-packet-checkpoint",
    })
    store.releaseLease({
      outcomeId: "5",
      holderId: "owner-wall-holder",
      fencingToken: first.fencingToken,
      idempotencyKey: "owner-wall-packet-release",
    })
    const conflictingPacket = {
      ...ownerDecisionPacket,
      blockedAction: "Resume a different action.",
    }
    expect(() => store.reopenOwnerDecisionWall({
      outcomeId: "5",
      expectedFencingToken: first.fencingToken,
      expectedNextState: "EXACT_NEXT_STATE",
      ownerDecisionId: 19,
      decisionPacket: conflictingPacket,
      decisionPacketDigest: createHash("sha256")
        .update(JSON.stringify(conflictingPacket))
        .digest("hex"),
      idempotencyKey: "owner-wall-packet-reopen",
    })).toThrowError(expect.objectContaining({ code: "OWNER_DECISION_REOPEN_STATE_WALL" }))
  })

  it("persists owner-touch counters and enforces the kill switch", () => {
    const { store } = fixture()
    expect(store.recordOwnerTouch({ counter: "ownerDiagnosticTouchCount", idempotencyKey: "touch" }).ownerTouchCounters.OWNER_DIAGNOSTIC_TOUCH_COUNT).toBe(1)
    store.setKillSwitch({ active: true, reason: "operator stop", idempotencyKey: "stop" })
    expect(() => store.acquireLease({ outcomeId: "GOAL-2", holderId: "one", leaseDurationMs: 100, idempotencyKey: "blocked" })).toThrowError(expect.objectContaining({ code: "KILL_SWITCH_ACTIVE" }))
  })
})
