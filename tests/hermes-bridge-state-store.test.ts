import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"

import { createHermesStateStore } from "@/scripts/hermes-bridge/state-store.mjs"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "hermes-state-")); dirs.push(dir)
  let now = Date.parse("2026-07-21T00:00:00.000Z")
  const store = createHermesStateStore(join(dir, "state.json"), { now: () => now })
  store.initialize()
  return { dir, store, advance: (milliseconds: number) => { now += milliseconds } }
}

describe("Hermes bridge durable state store", () => {
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

  it("abandons an interrupted holder for immediate fenced reclaim", () => {
    const { store } = fixture()
    const first = store.acquireLease({ outcomeId: "GOAL-1", holderId: "one", leaseDurationMs: 1000, idempotencyKey: "a" })
    const abandoned = store.abandonLease({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      reason: "APP_SERVER_TURN_INTERRUPTED", idempotencyKey: "abandon",
    })
    expect(abandoned.leaseExpiresAt).toBe("2026-07-21T00:00:00.000Z")
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
      },
    })
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
    const { store } = fixture()
    const prNumber = 448
    const terminalHeadRefOid = "a".repeat(40)
    const headRefOid = terminalHeadRefOid
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
      prNumber, headRefOid, mergeSha, proofDigest,
      idempotencyKey: "review-recover",
    }

    const reopened = store.reopenReviewRemediationExhausted(request)
    expect(reopened).toMatchObject({
      leaseStatus: "ABANDONED", checkpointSequence: 2,
      state: "REVIEW_REMEDIATION_RECOVERED", idempotent: false,
    })
    expect(store.reopenReviewRemediationExhausted(request)).toMatchObject({
      ...reopened, idempotent: true,
    })
    expect(store.read().executions["5"]).toMatchObject({
      lease: { status: "ABANDONED", recoverReason: "REVIEW_REMEDIATION_PROOF_ACCEPTED" },
      checkpoint: {
        sequence: 2, state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        threadId: null, turnId: null, prNumber, headRefOid, mergeSha,
        reviewRecoveryProofDigest: proofDigest,
      },
    })

    const reclaimed = store.reclaimLease({
      outcomeId: "5", holderId: "recovery-holder", leaseDurationMs: 1000,
      expectedFencingToken: first.fencingToken, idempotencyKey: "review-reclaim",
    })
    expect(reclaimed.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(() => store.checkpoint({
      outcomeId: "5", holderId: "review-holder", fencingToken: first.fencingToken,
      expectedCheckpointSequence: 2, state: "STALE", idempotencyKey: "review-stale",
    })).toThrowError(expect.objectContaining({ code: "FENCING_TOKEN_CONFLICT" }))
  })

  it("preserves terminal review remediation outside the exact recovery boundary", () => {
    for (const invalid of [
      "lease", "state", "detail", "pr", "head", "merge", "proof", "owner-touch", "fence",
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

      expect(() => store.reopenReviewRemediationExhausted({
        outcomeId: "5",
        expectedFencingToken: invalid === "fence" ? first.fencingToken + 1 : first.fencingToken,
        prNumber: invalid === "pr" ? prNumber + 1 : prNumber,
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

  it("persists owner-touch counters and enforces the kill switch", () => {
    const { store } = fixture()
    expect(store.recordOwnerTouch({ counter: "ownerDiagnosticTouchCount", idempotencyKey: "touch" }).ownerTouchCounters.OWNER_DIAGNOSTIC_TOUCH_COUNT).toBe(1)
    store.setKillSwitch({ active: true, reason: "operator stop", idempotencyKey: "stop" })
    expect(() => store.acquireLease({ outcomeId: "GOAL-2", holderId: "one", leaseDurationMs: 100, idempotencyKey: "blocked" })).toThrowError(expect.objectContaining({ code: "KILL_SWITCH_ACTIVE" }))
  })
})
