import { describe, expect, it } from "vitest"

import {
  buildRuntimeExecutionTruth,
  projectRuntimeExecutionQuery,
  runtimeLeaseStatusForCheckpoint,
  type RuntimeExecutionGovernanceEventRecord,
  type RuntimeExecutionWorkOrderRecord,
} from "@/components/runtime/runtime-execution-model"

const owner = "owner-user"

function workOrder(
  overrides: Partial<RuntimeExecutionWorkOrderRecord> = {},
): RuntimeExecutionWorkOrderRecord {
  return {
    id: 42,
    userId: owner,
    ref: "WO-HERMES-OUTCOME-4",
    title: "Deliver runtime outcome",
    goal: "GOAL-4",
    lane: "runtime",
    status: "blocked",
    result: "FAIL",
    commitRef: "b".repeat(40),
    evidence: ["commit:" + "a".repeat(40), "pull-request:#448"],
    createdAt: new Date("2026-07-23T00:00:00.000Z"),
    updatedAt: new Date("2026-07-23T01:05:00.000Z"),
    closedAt: null,
    completedAt: null,
    ...overrides,
  }
}

function checkpoint(input: {
  id: number
  attempt: number
  sequence: number
  state: string
  at: string
  detail?: string | null
  metadata?: Record<string, unknown>
  userId?: string
  entityId?: string
}): RuntimeExecutionGovernanceEventRecord {
  return {
    id: input.id,
    userId: input.userId ?? owner,
    eventType: "HERMES_RUNTIME_CHECKPOINT",
    entityType: "work_order",
    entityId: input.entityId ?? "42",
    actor: "hermes-codex-bridge",
    reason: `Projected ${input.state}`,
    metadata: {
      idempotencyKey: `hermes-outcome:4:attempt:${input.attempt}:checkpoint:${input.sequence}`,
      outcomeId: 4,
      workOrderRef: "WO-HERMES-OUTCOME-4",
      attempt: input.attempt,
      checkpointSequence: input.sequence,
      checkpointState: input.state,
      checkpointDetail: input.detail ?? null,
      payloadDigest: "d".repeat(64),
      ...input.metadata,
    },
    createdAt: new Date(input.at),
  }
}

function failureEval(input: {
  id: number
  attempt: number
  sequence: number
  state?: string
  failureClass?: string
  disposition?: string
  at: string
}): RuntimeExecutionGovernanceEventRecord {
  return {
    id: input.id,
    userId: owner,
    eventType: "HERMES_RUNTIME_FAILURE_EVAL",
    entityType: "work_order",
    entityId: "42",
    actor: "hermes-codex-bridge",
    reason: "Recorded terminal runtime failure",
    metadata: {
      sourceCheckpointId: input.id - 1,
      sourceCheckpointKey: `hermes-outcome:4:attempt:${input.attempt}:checkpoint:${input.sequence}`,
      attempt: input.attempt,
      checkpointSequence: input.sequence,
      checkpointState: input.state ?? "FAILED_TERMINAL",
      failureClass: input.failureClass ?? "TERMINAL_RUNTIME_FAILURE",
      disposition: input.disposition ?? "terminal",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    },
    createdAt: new Date(input.at),
  }
}

function leaseEvent(input: {
  id: number
  attempt: number
  sequence: number
  status: "ACTIVE" | "ABANDONED" | "DEFERRED" | "RELEASED"
  at: string
}): RuntimeExecutionGovernanceEventRecord {
  return {
    id: input.id,
    userId: owner,
    eventType: "HERMES_RUNTIME_LEASE",
    entityType: "work_order",
    entityId: "42",
    actor: "hermes-codex-bridge",
    reason: `Projected ${input.status} lease`,
    metadata: {
      idempotencyKey: [
        "hermes-outcome:4",
        `attempt:${input.attempt}`,
        `lease:${input.status}`,
        `checkpoint:${input.sequence}`,
        `expires:${Date.parse(input.at)}`,
      ].join(":"),
      outcomeId: 4,
      workOrderRef: "WO-HERMES-OUTCOME-4",
      attempt: input.attempt,
      checkpointSequence: input.sequence,
      leaseStatus: input.status,
      leaseExpiresAt: input.at,
      payloadDigest: "e".repeat(64),
    },
    createdAt: new Date(input.at),
  }
}

describe("persisted runtime execution truth", () => {
  it("groups ordered checkpoints into attempts and exposes current runtime and trace truth", () => {
    const records = [
      checkpoint({
        id: 13,
        attempt: 2,
        sequence: 2,
        state: "FAILED_TERMINAL",
        detail: "VALIDATION_REMEDIATION_EXHAUSTED",
        metadata: { prNumber: 448, headRefOid: "b".repeat(40) },
        at: "2026-07-23T01:04:00.000Z",
      }),
      checkpoint({
        id: 10,
        attempt: 1,
        sequence: 0,
        state: "LEASED",
        at: "2026-07-23T00:01:00.000Z",
      }),
      checkpoint({
        id: 12,
        attempt: 2,
        sequence: 0,
        state: "LEASED",
        at: "2026-07-23T01:01:00.000Z",
      }),
      failureEval({
        id: 14,
        attempt: 2,
        sequence: 2,
        at: "2026-07-23T01:04:01.000Z",
      }),
      checkpoint({
        id: 11,
        attempt: 1,
        sequence: 1,
        state: "RETRYABLE_WALL",
        at: "2026-07-23T00:04:00.000Z",
      }),
    ]

    const [truth] = buildRuntimeExecutionTruth(owner, [workOrder()], records)

    expect(truth.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2])
    expect(truth.attempts[0]).toMatchObject({
      leaseStatus: "ABANDON_PENDING",
      currentCheckpoint: { sequence: 1, state: "RETRYABLE_WALL" },
    })
    expect(truth.currentAttempt).toMatchObject({ attempt: 2 })
    expect(truth.currentCheckpoint).toMatchObject({
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
      leaseStatus: "RELEASE_PENDING",
      evidence: { prNumber: 448, headRefOid: "b".repeat(40) },
    })
    expect(truth.currentLeaseStatus).toBe("RELEASE_PENDING")
    expect(truth.terminalFailureEvaluation).toMatchObject({
      failureClass: "TERMINAL_RUNTIME_FAILURE",
      disposition: "terminal",
      sourceCheckpointId: 13,
    })
    expect(truth.trace.map((entry) => entry.kind)).toEqual([
      "CHECKPOINT",
      "CHECKPOINT",
      "CHECKPOINT",
      "CHECKPOINT",
      "FAILURE_EVALUATION",
    ])
    expect(truth.timestamps).toMatchObject({
      firstCheckpointAt: new Date("2026-07-23T00:01:00.000Z"),
      lastCheckpointAt: new Date("2026-07-23T01:04:00.000Z"),
    })
    expect(truth.commitRef).toBe("b".repeat(40))
    expect(truth.result).toBe("FAIL")
    expect(truth.evidence).toContain("pull-request:#448")

    const query = projectRuntimeExecutionQuery([truth])
    expect(query.terminalAttempts).toEqual([
      expect.objectContaining({
        workOrderRef: "WO-HERMES-OUTCOME-4",
        attempt: 2,
        checkpointSequence: 2,
        checkpointState: "FAILED_TERMINAL",
        commitRef: "b".repeat(40),
      }),
    ])
    expect(query.activeAttempts).toHaveLength(1)
    expect(query.completedAttempts).toEqual([])
    expect(query.events[0]).toMatchObject({
      eventType: "HERMES_RUNTIME_CHECKPOINT",
      entityId: "WO-HERMES-OUTCOME-4",
      metadata: { attempt: 1, checkpointSequence: 0, payloadDigest: "d".repeat(64) },
    })
  })

  it("keeps the read model user-scoped and ignores malformed or unrelated events", () => {
    const foreign = workOrder({ id: 99, userId: "other-user", ref: "WO-HERMES-OUTCOME-9" })
    const ordinary = workOrder({ id: 7, ref: "WO-0007" })
    const malformed = checkpoint({
      id: 20,
      attempt: 1,
      sequence: 0,
      state: "LEASED",
      at: "2026-07-23T00:01:00.000Z",
    })
    malformed.metadata = { checkpointState: "LEASED" }

    const truth = buildRuntimeExecutionTruth(owner, [foreign, ordinary, workOrder()], [
      checkpoint({
        id: 21,
        attempt: 1,
        sequence: 0,
        state: "LEASED",
        at: "2026-07-23T00:02:00.000Z",
        userId: "other-user",
      }),
      checkpoint({
        id: 22,
        attempt: 1,
        sequence: 0,
        state: "LEASED",
        at: "2026-07-23T00:03:00.000Z",
        entityId: "99",
      }),
      malformed,
    ])

    expect(truth).toHaveLength(1)
    expect(truth[0].workOrderId).toBe(42)
    expect(truth[0].attempts).toEqual([])
    expect(truth[0].currentLeaseStatus).toBe("UNKNOWN")
    expect(truth[0].trace).toEqual([])
  })

  it("uses conservative persisted lease projections", () => {
    expect(runtimeLeaseStatusForCheckpoint("LEASED")).toBe("ACTIVE")
    expect(runtimeLeaseStatusForCheckpoint("PR_REVIEW_REQUESTED")).toBe("ACTIVE")
    expect(runtimeLeaseStatusForCheckpoint("COMPLETE")).toBe("RELEASE_PENDING")
    expect(runtimeLeaseStatusForCheckpoint("FAILED_TERMINAL")).toBe("RELEASE_PENDING")
    expect(runtimeLeaseStatusForCheckpoint("POST_MERGE_CLEANUP_RETRY")).toBe("ABANDON_PENDING")
    expect(runtimeLeaseStatusForCheckpoint("PROVIDER_UNAVAILABLE")).toBe("ABANDON_PENDING")
    expect(runtimeLeaseStatusForCheckpoint("not-canonical")).toBe("UNKNOWN")
  })

  it("uses explicit persisted lease posture instead of terminal checkpoint inference", () => {
    const truth = buildRuntimeExecutionTruth(owner, [workOrder({
      status: "closed",
      result: "PASS",
    })], [
      checkpoint({
        id: 31,
        attempt: 2,
        sequence: 8,
        state: "COMPLETE",
        at: "2026-07-23T01:00:00.000Z",
      }),
      leaseEvent({
        id: 32,
        attempt: 2,
        sequence: 8,
        status: "RELEASED",
        at: "2026-07-23T01:00:01.000Z",
      }),
    ])

    expect(truth[0].currentAttempt).toMatchObject({
      leaseStatus: "RELEASED",
      currentLease: {
        status: "RELEASED",
        checkpointSequence: 8,
      },
    })
    expect(projectRuntimeExecutionQuery(truth).completedAttempts[0].leaseStatus).toBe("RELEASED")
  })

  it("classifies historical attempts by their own checkpoint instead of the final work-order status", () => {
    const truth = buildRuntimeExecutionTruth(owner, [workOrder({
      status: "closed",
      result: "PASS",
    })], [
      checkpoint({
        id: 41,
        attempt: 1,
        sequence: 3,
        state: "RETRYABLE_WALL",
        at: "2026-07-23T00:30:00.000Z",
      }),
      checkpoint({
        id: 42,
        attempt: 2,
        sequence: 9,
        state: "COMPLETE",
        at: "2026-07-23T01:30:00.000Z",
      }),
    ])

    const projected = projectRuntimeExecutionQuery(truth)
    expect(projected.activeAttempts).toEqual([
      expect.objectContaining({ attempt: 1, checkpointState: "RETRYABLE_WALL" }),
    ])
    expect(projected.completedAttempts).toEqual([
      expect.objectContaining({ attempt: 2, checkpointState: "COMPLETE" }),
    ])
  })
})
