import { describe, expect, it, vi } from "vitest"

import {
  acquireNextEligibleOutcome,
  approveOutcomeQueueItem,
  completeOutcomeQueueItem,
  matchOutcomeAuthorityGrant,
  OUTCOME_QUEUE_LEGACY_GOAL_REFS,
  OUTCOME_QUEUE_SQL,
  persistOutcomeQueueItem,
  readLegacyOutcomeHistory,
  readOutcomeQueue,
  transitionOutcomeQueueItem,
} from "@/scripts/hermes-bridge/outcome-queue-source.mjs"

const now = "2026-07-28T12:00:00.000Z"
const userId = "owner"

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId,
    outcomeKey: "goal:GOAL-1000",
    goalId: 1000,
    goalRef: "GOAL-1000",
    title: "Deliver a bounded outcome",
    objective: "Deliver a bounded outcome",
    queueOrder: 10,
    dependencyKeys: [],
    riskClass: "R1",
    approvalState: "approved",
    approvedBy: "owner",
    approvedAt: now,
    approvalDecisionId: 100,
    authorityState: "matched",
    authorityLevel: "A2_WRITE_OWN",
    authorityGrantRef: "DECISION-WOS-V1.2",
    lifecycleState: "active",
    lifecycleReason: null,
    activeWorkOrderId: 472,
    executionBinding: "execution-a",
    leaseHolder: "supervisor-a",
    leaseToken: "lease-a",
    leaseExpiresAt: "2026-07-28T12:01:00.000Z",
    fencingToken: 1,
    version: 1,
    acquisitionKey: "acquire-a",
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    suggestedAt: now,
    activatedAt: now,
    terminalAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function acquisitionQuery({
  prior = [],
  reclaimed = [],
  selected = [],
  counts = [],
}: {
  prior?: unknown[]
  reclaimed?: unknown[]
  selected?: unknown[]
  counts?: unknown[]
}) {
  const run = vi.fn(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.readAcquisition) return { rows: prior }
    if (sql === OUTCOME_QUEUE_SQL.reclaimAcquisition) return { rows: reclaimed }
    if (sql === OUTCOME_QUEUE_SQL.acquire) return { rows: selected }
    if (sql === OUTCOME_QUEUE_SQL.noSelectionReason) return { rows: counts }
    throw new Error(`unexpected query: ${sql}`)
  })
  return Object.assign(run, {
    connect: async () => ({ query: run, release: vi.fn() }),
  })
}

const acquireInput = {
  userId,
  acquisitionKey: "acquire-a",
  leaseHolder: "supervisor-a",
  leaseToken: "lease-a",
  executionBinding: "execution-a",
  leaseDurationMs: 60_000,
  activeWorkOrderId: 472,
  now,
}

describe("transactional durable outcome queue source", () => {
  it("uses the exact quoted schema contract and deterministic ordering", () => {
    expect(Object.isFrozen(OUTCOME_QUEUE_SQL)).toBe(true)
    for (const sql of Object.values(OUTCOME_QUEUE_SQL)) {
      expect(sql).not.toMatch(/\b(outcome_id|queue_order|dependency_outcome_ids|approval_state|authority_state|lifecycle_state|active_goal_id|active_work_order_id|lease_holder_id|lease_expires_at|fencing_token|terminal_result_id)\b/)
    }
    expect(OUTCOME_QUEUE_SQL.read).toMatch(
      /q\."queueOrder" ASC,\s*q\."createdAt" ASC,\s*q\."outcomeKey" ASC/,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toMatch(/FOR UPDATE OF q SKIP LOCKED/)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."approvalState" = 'approved'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`FROM "decision" AS live_approval`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `live_approval."scope" IN (q."outcomeKey", q."goalRef")`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."authorityState" = 'matched'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`FROM "authority_grant" AS live_grant`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_grant."revokedAt" IS NULL`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."riskClass" IN ('R0', 'R1')`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."fencingToken" + 1`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."version" + 1`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live."leaseExpiresAt" > $1::timestamptz`)
  })

  it("persists and reads all data in one user scope", async () => {
    const suggested = queueRow({
      lifecycleState: "suggested",
      approvalState: "unapproved",
      approvedBy: null,
      approvedAt: null,
      authorityState: "unverified",
      activeWorkOrderId: null,
    })
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [suggested] })
      .mockResolvedValueOnce({ rows: [suggested] })

    await expect(persistOutcomeQueueItem({
      query,
      userId,
      now,
      item: {
        outcomeKey: "goal:GOAL-1000",
        goalId: 1000,
        goalRef: "GOAL-1000",
        title: "Deliver a bounded outcome",
        objective: "Deliver a bounded outcome",
        queueOrder: 10,
        dependencyKeys: [],
        riskClass: "R1",
        approvalState: "unapproved",
        authorityState: "unverified",
        authorityLevel: "A2_WRITE_OWN",
        lifecycleState: "suggested",
      },
    })).resolves.toEqual(suggested)
    await expect(readOutcomeQueue({ query, userId })).resolves.toEqual([suggested])

    expect(query.mock.calls[0][0]).toBe(OUTCOME_QUEUE_SQL.persist)
    expect(query.mock.calls[0][1]).toEqual([
      userId, "goal:GOAL-1000", 1000, "GOAL-1000", "Deliver a bounded outcome",
      "Deliver a bounded outcome", 10, [], "R1", "unapproved", null, null,
      "unverified", "A2_WRITE_OWN", null, "suggested", null, null, null, null,
      [], null, now, null, now,
    ])
    expect(query.mock.calls[1]).toEqual([OUTCOME_QUEUE_SQL.read, [userId]])
    expect(OUTCOME_QUEUE_SQL.persist).toContain(
      `WHERE "outcome_queue_item"."lifecycleState" = 'suggested'`,
    )
    expect(OUTCOME_QUEUE_SQL.persist).toContain(
      `AND "outcome_queue_item"."authorityState" = 'unverified'`,
    )
    expect(OUTCOME_QUEUE_SQL.persist).not.toMatch(
      /"approvalState" = EXCLUDED\."approvalState"/,
    )
    await expect(persistOutcomeQueueItem({
      query,
      userId,
      item: {
        outcomeKey: "goal:GOAL-SELF-GRANT",
        title: "Attempt self grant",
        queueOrder: 11,
        dependencyKeys: [],
        riskClass: "R1",
        approvalState: "approved",
        approvedBy: "caller",
        approvedAt: now,
        authorityState: "matched",
        authorityGrantRef: "GRANT-FAKE",
        authorityLevel: "A2_WRITE_OWN",
        lifecycleState: "approved",
      },
    })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_INTAKE_MUST_BE_UNAUTHORIZED_SUGGESTION",
    })
  })

  it("matches authority only through an active, unexpired grant", async () => {
    const matched = queueRow({
      lifecycleState: "suggested",
      approvalState: "unapproved",
      authorityState: "matched",
      version: 1,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      acquisitionKey: null,
    })
    const query = vi.fn(async () => ({ rows: [matched] }))

    await expect(matchOutcomeAuthorityGrant({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 0,
      authorityGrantRef: "GRANT-1000",
      now,
    })).resolves.toEqual(matched)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.matchAuthority, [
      userId,
      "goal:GOAL-1000",
      0,
      "GRANT-1000",
      now,
    ])
    expect(OUTCOME_QUEUE_SQL.matchAuthority).toContain(`grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.matchAuthority).toContain(`grant."revokedAt" IS NULL`)
    expect(OUTCOME_QUEUE_SQL.matchAuthority).toContain(`grant."expiresAt" > $5::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.matchAuthority).toContain(
      `grant."authorityLevel" = q."authorityLevel"`,
    )
  })

  it("approves only through an accepted binding decision", async () => {
    const approved = queueRow({
      lifecycleState: "approved",
      version: 2,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      acquisitionKey: null,
    })
    const query = vi.fn(async () => ({ rows: [approved] }))

    await expect(approveOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      approvalDecisionId: 100,
      now,
    })).resolves.toEqual(approved)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.approve, [
      userId,
      "goal:GOAL-1000",
      1,
      100,
      now,
    ])
    expect(OUTCOME_QUEUE_SQL.approve).toContain(`approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.approve).toContain(`approval."authority" = 'binding'`)
    expect(OUTCOME_QUEUE_SQL.approve).toContain(
      `approval."scope" IN (q."outcomeKey", q."goalRef")`,
    )
  })

  it("requires a client obtained through connect for injected transactions", async () => {
    const query = vi.fn()
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_DEDICATED_CLIENT_REQUIRED" })
    expect(query).not.toHaveBeenCalled()
  })

  it.each([
    [{ totalCount: 0 }, "EMPTY_QUEUE"],
    [{ totalCount: 3, candidateStateCount: 0 }, "NO_ELIGIBLE_OUTCOME"],
    [{ totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 0 }, "AWAITING_APPROVAL"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2, authorityEligibleCount: 0,
    }, "AUTHORITY_INELIGIBLE"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2,
      authorityEligibleCount: 2, riskEligibleCount: 0,
    }, "RISK_INELIGIBLE"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2,
      authorityEligibleCount: 2, riskEligibleCount: 2, dependencyEligibleCount: 0,
    }, "DEPENDENCIES_UNSATISFIED"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2,
      authorityEligibleCount: 2, riskEligibleCount: 2,
      dependencyEligibleCount: 2, activeLeaseCount: 1,
    }, "ACTIVE_LEASE_HELD"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2,
      authorityEligibleCount: 2, riskEligibleCount: 2,
      dependencyEligibleCount: 2, activeLeaseCount: 0,
    }, "CONTENDED"],
  ])("returns typed no-selection reason %#", async (counts, reason) => {
    const query = acquisitionQuery({ counts: [counts] })
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
      acquisitionKey: "acquire-none",
    })).resolves.toMatchObject({ acquired: false, outcome: null, reason })
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readAcquisition,
      OUTCOME_QUEUE_SQL.acquire,
      OUTCOME_QUEUE_SQL.noSelectionReason,
      "COMMIT",
    ])
    expect(query.mock.calls[1][1]).toEqual([`${userId}:outcome-queue`])
    expect(query.mock.calls[2][1]).toEqual([userId, "acquire-none"])
    expect(query.mock.calls[4][1]).toEqual([now, userId])
  })

  it("acquires transactionally and replays the same live binding", async () => {
    const acquired = queueRow()
    const firstQuery = acquisitionQuery({ selected: [acquired] })
    await expect(acquireNextEligibleOutcome({
      query: firstQuery,
      ...acquireInput,
    })).resolves.toEqual({
      outcome: acquired,
      acquired: true,
      replayed: false,
      reclaimed: false,
      reason: null,
    })
    expect(firstQuery.mock.calls[3]).toEqual([
      OUTCOME_QUEUE_SQL.acquire,
      [
        now, userId, "acquire-a", "execution-a", "supervisor-a", "lease-a",
        "2026-07-28T12:01:00.000Z", 472,
      ],
    ])

    const replayQuery = acquisitionQuery({ prior: [acquired] })
    await expect(acquireNextEligibleOutcome({
      query: replayQuery,
      ...acquireInput,
    })).resolves.toMatchObject({ outcome: acquired, acquired: true, replayed: true })
    expect(replayQuery.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN", OUTCOME_QUEUE_SQL.acquireLock, OUTCOME_QUEUE_SQL.readAcquisition, "COMMIT",
    ])
  })

  it("returns not-acquired for live same-key contention", async () => {
    const query = acquisitionQuery({
      prior: [queueRow({ leaseToken: "other-token", executionBinding: "other-execution" })],
    })
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: false,
      replayed: false,
      reason: "ACQUISITION_KEY_CONFLICT",
    })
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT")
  })

  it("replays a completed acquisition key without selecting another outcome", async () => {
    const completed = queueRow({
      lifecycleState: "completed",
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: "PASS",
      terminalEvidenceRefs: ["EV-1"],
      terminalKey: "complete-a",
    })
    const query = acquisitionQuery({ prior: [completed] })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toEqual({
      outcome: completed,
      acquired: false,
      replayed: true,
      reclaimed: false,
      reason: "OUTCOME_ALREADY_COMPLETED",
    })
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readAcquisition,
      "COMMIT",
    ])
  })

  it("reclaims a stale same-key lease with a higher fence and version", async () => {
    const stale = queueRow({
      leaseExpiresAt: "2026-07-28T11:59:59.000Z",
      fencingToken: 3,
      version: 8,
    })
    const reclaimed = queueRow({
      leaseHolder: "supervisor-after-restart",
      leaseToken: "lease-after-restart",
      executionBinding: "execution-after-restart",
      leaseExpiresAt: "2026-07-28T12:01:00.000Z",
      fencingToken: 4,
      version: 9,
      lifecycleReason: "STALE_LEASE_RECOVERED",
    })
    const query = acquisitionQuery({ prior: [stale], reclaimed: [reclaimed] })
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
      leaseHolder: "supervisor-after-restart",
      leaseToken: "lease-after-restart",
      executionBinding: "execution-after-restart",
    })).resolves.toEqual({
      outcome: reclaimed,
      acquired: true,
      replayed: false,
      reclaimed: true,
      reason: null,
    })
    expect(query.mock.calls[3]).toEqual([
      OUTCOME_QUEUE_SQL.reclaimAcquisition,
      [
        now, userId, "goal:GOAL-1000", "execution-after-restart",
        "supervisor-after-restart", "lease-after-restart",
        "2026-07-28T12:01:00.000Z", 472, 8,
      ],
    ])
    expect(OUTCOME_QUEUE_SQL.reclaimAcquisition).toContain(`q."fencingToken" + 1`)
    expect(OUTCOME_QUEUE_SQL.reclaimAcquisition).toContain(`q."version" + 1`)
  })

  it("guards transitions by user, version, and live fence", async () => {
    const blocked = queueRow({ lifecycleState: "blocked", version: 2 })
    const query = vi.fn(async () => ({ rows: [blocked] }))
    await expect(transitionOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      fromState: "active",
      toState: "blocked",
      expectedVersion: 1,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 1,
      lifecycleReason: "VALIDATION_RETRY_SCHEDULED",
      now,
    })).resolves.toEqual(blocked)
    expect(query.mock.calls[0][1]).toEqual([
      userId, "goal:GOAL-1000", "active", "blocked", 1, "execution-a",
      "lease-a", 1, now, "VALIDATION_RETRY_SCHEDULED",
    ])
    expect(OUTCOME_QUEUE_SQL.transition).toContain(`q."userId" = $1`)
    expect(OUTCOME_QUEUE_SQL.transition).toContain(`q."version" = $5`)
    expect(OUTCOME_QUEUE_SQL.transition).toContain(`q."leaseExpiresAt" > $9::timestamptz`)
    await expect(transitionOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      fromState: "blocked",
      toState: "approved",
      expectedVersion: 2,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_APPROVAL_DECISION_REQUIRED" })
  })

  it("guards completion and makes only an exact terminal replay idempotent", async () => {
    const completed = queueRow({
      lifecycleState: "completed",
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: "PASS",
      terminalEvidenceRefs: ["EV-1", "EV-2"],
      terminalKey: "complete-a",
      terminalAt: now,
      version: 2,
    })
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [completed] })
    await expect(completeOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 1,
      acquisitionKey: "acquire-a",
      terminalKey: "complete-a",
      terminalResult: "PASS",
      terminalEvidenceRefs: ["EV-2", "EV-1", "EV-1"],
      now,
    })).resolves.toEqual({ outcome: completed, replayed: true })
    expect(query.mock.calls[0][1]).toEqual([
      userId, "goal:GOAL-1000", 1, "execution-a", "lease-a", 1,
      "acquire-a", "complete-a", "PASS", null, ["EV-1", "EV-2"], now,
    ])
    expect(query.mock.calls[1]).toEqual([
      OUTCOME_QUEUE_SQL.readOne,
      [userId, "goal:GOAL-1000"],
    ])
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`q."version" = $3`)
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`q."leaseExpiresAt" > $12::timestamptz`)
  })

  it("keeps GOAL-0001 through GOAL-0005 user-scoped and history-only", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        legacyGoalId: 1,
        userId,
        ref: "GOAL-0001",
        command: "Historical bootstrap",
        status: "converted",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }],
    }))
    const history = await readLegacyOutcomeHistory({ query, userId })
    expect(query).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.legacyHistory,
      [userId, OUTCOME_QUEUE_LEGACY_GOAL_REFS],
    )
    expect(OUTCOME_QUEUE_SQL.legacyHistory).toContain(`g."userId" = $1`)
    expect(history).toEqual([expect.objectContaining({
      userId,
      outcomeKey: "goal:GOAL-0001",
      goalRef: "GOAL-0001",
      lifecycleState: "completed",
      compatibility: "LEGACY_GOAL_HISTORY",
      historyOnly: true,
      selectable: false,
      approvalState: "unapproved",
      authorityState: "unverified",
      executionAuthority: false,
    })])
    expect(OUTCOME_QUEUE_SQL.acquire).not.toMatch(/FROM "goal"/)
  })
})
