import { describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"

import { outcomeQueueMutationReceipt } from "@/lib/db/schema"
import {
  acquireNextEligibleOutcome,
  acquireOutcome as acquireOutcomeCompatibility,
  approveOutcomeQueueItem,
  approveOutcome as approveOutcomeCompatibility,
  bindOutcomeQueueWorkOrder,
  completeQueuedOutcome,
  completeOutcomeQueueItem,
  deferOutcomeLease as deferOutcomeLeaseCompatibility,
  deferOutcomeQueueLease,
  enqueueOutcome,
  listOutcomeQueue,
  matchOutcomeAuthorityGrant,
  matchOutcomeAuthority as matchOutcomeAuthorityCompatibility,
  mutateOutcomeQueueItem,
  OUTCOME_QUEUE_LEGAL_TRANSITIONS,
  OUTCOME_QUEUE_LEGACY_GOAL_REFS,
  OUTCOME_QUEUE_NO_SELECTION_REASONS,
  OUTCOME_QUEUE_SQL,
  persistOutcomeQueueItem,
  readLegacyOutcomeHistory,
  readOutcomeQueue,
  renewOutcomeLease as renewOutcomeLeaseCompatibility,
  renewOutcomeQueueLease,
  resumeOutcomeQueueAfterDecision,
  transitionOutcome as transitionOutcomeCompatibility,
  transitionOutcomeQueueItem,
} from "@/scripts/hermes-bridge/outcome-queue-source.mjs"

const now = "2026-07-28T12:00:00.000Z"
const userId = "owner"

function successorKey(idempotencyKey: string) {
  return `outcome:successor:${createHash("sha256")
    .update(`${userId}:${idempotencyKey.trim()}`)
    .digest("hex")
    .slice(0, 24)}`
}

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
    authorityGrantRef: "GRANT-WOS-V1.2",
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
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

function safeMutationRow(row: Record<string, unknown>) {
  const safe = { ...row }
  delete safe.executionBinding
  delete safe.leaseToken
  delete safe.fencingToken
  delete safe.acquisitionKey
  delete safe.terminalKey
  return safe
}

function acquisitionQuery({
  prior = [],
  replayEligibility = [{ approvalLive: true, authorityLive: true }],
  reclaimed = [],
  selected = [],
  counts = [],
}: {
  prior?: unknown[]
  replayEligibility?: unknown[]
  reclaimed?: unknown[]
  selected?: unknown[]
  counts?: unknown[]
}) {
  const run = vi.fn(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.readAcquisition) return { rows: prior }
    if (sql === OUTCOME_QUEUE_SQL.revalidateAcquisition) return { rows: replayEligibility }
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

function mutationQuery({
  current = queueRow(),
  mutated = queueRow({ version: 2 }),
  snapshot = [],
  rebound = [],
  governed = true,
}: {
  current?: Record<string, unknown>
  mutated?: Record<string, unknown>
  snapshot?: Record<string, unknown>[]
  rebound?: Record<string, unknown>[]
  governed?: boolean
} = {}) {
  const receipts = new Map<string, Record<string, unknown>>()
  const run = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.readMutationReceipt) {
      const receipt = receipts.get(String(values[1]))
      return { rows: receipt ? [receipt] : [] }
    }
    if (sql === OUTCOME_QUEUE_SQL.readMutationItem) return { rows: [current] }
    if (sql === OUTCOME_QUEUE_SQL.readMutationSnapshot) return { rows: snapshot }
    if (sql === OUTCOME_QUEUE_SQL.governedApprovalMutation) {
      return { rows: governed ? [mutated] : [] }
    }
    if ([
      OUTCOME_QUEUE_SQL.pauseMutation,
      OUTCOME_QUEUE_SQL.declineMutation,
      OUTCOME_QUEUE_SQL.supersedeMutation,
    ].includes(sql)) {
      return { rows: [mutated] }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertSupersedingOutcome) {
      return { rows: [queueRow({
        id: 2,
        outcomeKey: values[1],
        lifecycleState: "suggested",
        approvalState: "unapproved",
        authorityState: "unverified",
        version: 0,
      })] }
    }
    if (sql === OUTCOME_QUEUE_SQL.rebindSupersededDependents) return { rows: rebound }
    if (sql === OUTCOME_QUEUE_SQL.reorderMutation) {
      return { rows: [{
        ...snapshot.find((row) => row.outcomeKey === values[1]),
        queueOrder: values[3],
        version: Number(values[2]) + 1,
      }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertMutationReceipt) {
      receipts.set(String(values[1]), {
        id: 41,
        userId: values[0],
        idempotencyKey: values[1],
        operation: values[2],
        outcomeKey: values[3],
        requestHash: values[4],
        requestBinding: JSON.parse(String(values[5])),
        resultBinding: JSON.parse(String(values[6])),
        createdAt: values[7],
      })
      return { rows: [{ id: 41 }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertMutationAudit) return { rows: [{ id: 42 }] }
    if (sql === OUTCOME_QUEUE_SQL.insertMutationEvent) return { rows: [{ id: 43 }] }
    throw new Error(`unexpected query: ${sql}`)
  })
  return Object.assign(run, {
    connect: async () => ({ query: run, release: vi.fn() }),
  })
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
    expect(OUTCOME_QUEUE_SQL.readAcquisition).toMatch(/FOR UPDATE OF q\s*$/)
    expect(OUTCOME_QUEUE_SQL.readAcquisition).not.toContain("SKIP LOCKED")
    expect(OUTCOME_QUEUE_LEGAL_TRANSITIONS.active).toEqual(["blocked"])
    expect(OUTCOME_QUEUE_NO_SELECTION_REASONS).toContain("NO_ELIGIBLE_OUTCOME")
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
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `live_grant."grantedTo" = q."authoritySubject"`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `live_grant."scope" IN (q."outcomeKey", q."goalRef")`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_grant."blockedActions"`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_grant."allowedActions"`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."riskClass" IN ('R0', 'R1')`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."fencingToken" + 1`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."version" + 1`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live."leaseExpiresAt" > $1::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`live_grant."expiresAt" > $12::timestamptz`)
    expect(enqueueOutcome).toBe(persistOutcomeQueueItem)
    expect(listOutcomeQueue).toBe(readOutcomeQueue)
    expect(acquireOutcomeCompatibility).toBe(acquireNextEligibleOutcome)
    expect(approveOutcomeCompatibility).toBe(approveOutcomeQueueItem)
    expect(transitionOutcomeCompatibility).toBe(transitionOutcomeQueueItem)
    expect(matchOutcomeAuthorityCompatibility).toBe(matchOutcomeAuthorityGrant)
    expect(completeQueuedOutcome).toBe(completeOutcomeQueueItem)
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
    const run = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.persist) return { rows: [suggested] }
      if (sql === OUTCOME_QUEUE_SQL.read) return { rows: [suggested] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const query = Object.assign(run, {
      connect: async () => ({ query: run, release: vi.fn() }),
    })

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

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.persist,
      "COMMIT",
      OUTCOME_QUEUE_SQL.read,
    ])
    expect(query.mock.calls[2][1]).toEqual([
      userId, "goal:GOAL-1000", 1000, "GOAL-1000", "Deliver a bounded outcome",
      "Deliver a bounded outcome", 10, [], "R1", "unapproved", null, null,
      "unverified", "A2_WRITE_OWN", null, "operator", "outcome:execute",
      "suggested", null, null, null, null,
      [], null, now, null, now,
    ])
    expect(query.mock.calls[4]).toEqual([OUTCOME_QUEUE_SQL.read, [userId]])
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
    await expect(persistOutcomeQueueItem({
      query,
      userId,
      item: {
        outcomeKey: "goal:GOAL-TERMINAL-INJECTION",
        title: "Attempt terminal evidence injection",
        queueOrder: 12,
        dependencyKeys: [],
        riskClass: "R1",
        approvalState: "unapproved",
        authorityState: "unverified",
        authorityLevel: "A0_READ_ONLY",
        lifecycleState: "suggested",
        terminalResult: "PASS",
        terminalEvidenceRefs: ["EV-FORGED"],
      },
    })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_INTAKE_MUST_NOT_BE_TERMINAL",
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
    }, "NO_ELIGIBLE_OUTCOME"],
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
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readAcquisition,
      OUTCOME_QUEUE_SQL.revalidateAcquisition,
      "COMMIT",
    ])
  })

  it.each([
    [{ approvalLive: false, authorityLive: true }, "AWAITING_APPROVAL"],
    [{ approvalLive: true, authorityLive: false }, "AUTHORITY_INELIGIBLE"],
  ])("rejects same-key replay when live authority changes %#", async (live, reason) => {
    const query = acquisitionQuery({
      prior: [queueRow()],
      replayEligibility: [live],
    })
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: false,
      replayed: false,
      reason,
    })
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT")
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
    expect(OUTCOME_QUEUE_SQL.reclaimAcquisition).toContain(
      `live."id" <> q."id"`,
    )
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
    await expect(transitionOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      fromState: "approved",
      toState: "active",
      expectedVersion: 2,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_ACTIVE_REQUIRES_ACQUISITION" })
    await expect(transitionOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      fromState: "approved",
      toState: "superseded",
      expectedVersion: 2,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_SUPERSEDE_REQUIRES_MUTATION" })
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

  it("renews only the exact live queue fence without changing its version", async () => {
    const renewed = queueRow({
      lifecycleState: "active",
      version: 4,
      fencingToken: 3,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    })
    const query = vi.fn(async () => ({ rows: [renewed] }))

    await expect(renewOutcomeQueueLease({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 4,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 3,
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).resolves.toEqual(renewed)

    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.renewLease, [
      userId,
      "goal:GOAL-1000",
      4,
      "execution-a",
      "lease-a",
      3,
      now,
      "2026-07-28T12:50:00.000Z",
    ])
    expect(renewOutcomeLeaseCompatibility).toBe(renewOutcomeQueueLease)
    expect(OUTCOME_QUEUE_SQL.renewLease).not.toContain(`"version" = q."version" + 1`)
    expect(OUTCOME_QUEUE_SQL.renewLease).toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.renewLease).toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.renewLease)
      .toContain(`live_grant."expiresAt" > $7::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.renewLease)
      .not.toContain(`live_grant."expiresAt" > $1::timestamptz`)
  })

  it("defers the exact live queue fence until the provider retry time", async () => {
    const deferred = queueRow({
      lifecycleState: "active",
      version: 4,
      fencingToken: 3,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:15:00.000Z",
      lifecycleReason: "PROVIDER_UNAVAILABLE",
    })
    const query = vi.fn(async () => ({ rows: [deferred] }))

    await expect(deferOutcomeQueueLease({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 4,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 3,
      retryAfter: "2026-07-28T12:15:00.000Z",
      now,
    })).resolves.toEqual(deferred)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.deferLease, [
      userId,
      "goal:GOAL-1000",
      4,
      "execution-a",
      "lease-a",
      3,
      "2026-07-28T12:15:00.000Z",
      "PROVIDER_UNAVAILABLE",
      now,
    ])
    expect(deferOutcomeLeaseCompatibility).toBe(deferOutcomeQueueLease)
    expect(OUTCOME_QUEUE_SQL.deferLease)
      .toContain(`live_grant."expiresAt" > $9::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.deferLease)
      .not.toContain(`live_grant."expiresAt" > $1::timestamptz`)
  })

  it("binds the exact active queue fence to its projected Hermes Work Order", async () => {
    const bound = queueRow({ lifecycleState: "active", activeWorkOrderId: 472, version: 4 })
    const query = vi.fn(async () => ({ rows: [bound] }))

    await expect(bindOutcomeQueueWorkOrder({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 4,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 1,
      activeWorkOrderId: 472,
      now,
    })).resolves.toEqual(bound)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.bindWorkOrder, [
      userId, "goal:GOAL-1000", 4, "execution-a", "lease-a", 1, 472, now,
    ])
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`q."leaseExpiresAt" > $8::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`projected_work."userId" = q."userId"`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder)
      .toContain(`projected_work.ref = 'WO-HERMES-OUTCOME-' || q."goalId"::text`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`projected_work.goal = q."goalRef"`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder)
      .toContain(`live_grant."expiresAt" > $8::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder)
      .not.toContain(`live_grant."expiresAt" > $1::timestamptz`)
  })

  it("resumes a blocked queue item only through its exact accepted owner decision", async () => {
    const resumed = queueRow({
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    })
    const query = vi.fn(async () => ({ rows: [resumed] }))

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).resolves.toEqual(resumed)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.resumeAfterDecision, [
      userId,
      "goal:GOAL-1000",
      5,
      "execution-a",
      "acquire-a",
      3,
      91,
      "resident-hermes",
      "lease-a",
      "2026-07-28T12:50:00.000Z",
      now,
    ])
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`(approval.context::jsonb)->>'outcomeId' = q."goalId"::text`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`live_grant."expiresAt" > $11::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .not.toContain(`live_grant."expiresAt" > $1::timestamptz`)
  })

  it("keeps GOAL-0001 through GOAL-0005 user-scoped and history-only", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        legacyGoalId: 1,
        userId,
        ref: "GOAL-0001",
        command: "Historical bootstrap",
        status: "converted",
        linkedWorkOrderId: 451,
        workOrderStatus: "closed",
        workOrderResult: "PASS",
        workOrderCompletedAt: "2026-01-02T00:00:00.000Z",
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

  it("keeps a converted legacy draft nonterminal and nonselectable", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        legacyGoalId: 5,
        userId,
        ref: "GOAL-0005",
        command: "Historical draft conversion",
        status: "converted",
        linkedWorkOrderId: 455,
        workOrderStatus: "draft",
        workOrderResult: null,
        workOrderCompletedAt: null,
        createdAt: now,
        updatedAt: now,
      }],
    }))

    await expect(readLegacyOutcomeHistory({ query, userId })).resolves.toEqual([
      expect.objectContaining({
        lifecycleState: "blocked",
        lifecycleReason: "LEGACY_CONVERSION_REQUIRES_TERMINAL_WORK_ORDER",
        historyOnly: true,
        selectable: false,
      }),
    ])
  })

  it("serializes persistence and rejects a dependency on a superseded outcome", async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.readSupersededDependencies) {
        return {
          rows: [{
            outcomeKey: "goal:GOAL-OLD",
            supersededByOutcomeKey: "goal:GOAL-NEW",
          }],
        }
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const query = Object.assign(run, {
      connect: async () => ({ query: run, release: vi.fn() }),
    })

    await expect(persistOutcomeQueueItem({
      query,
      userId,
      now,
      item: {
        outcomeKey: "goal:GOAL-DEPENDENT",
        title: "Dependent outcome",
        queueOrder: 20,
        dependencyKeys: ["goal:GOAL-OLD"],
        riskClass: "R1",
        approvalState: "unapproved",
        authorityState: "unverified",
        authorityLevel: "A2_WRITE_OWN",
        lifecycleState: "suggested",
      },
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_DEPENDENCY_SUPERSEDED" })
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readSupersededDependencies,
      "ROLLBACK",
    ])
    expect(OUTCOME_QUEUE_SQL.readSupersededDependencies).toContain(
      `q."lifecycleState" = 'superseded'`,
    )
  })
})

describe("governed outcome queue mutations", () => {
  it("defines an additive user-scoped exactly-once receipt register", () => {
    const config = getTableConfig(outcomeQueueMutationReceipt)
    expect(getTableName(outcomeQueueMutationReceipt)).toBe("outcome_queue_mutation_receipt")
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "userId",
      "idempotencyKey",
      "operation",
      "requestHash",
      "requestBinding",
      "resultBinding",
    ]))
    expect(config.indexes.some((index) => (
      index.config.name === "outcome_queue_mutation_receipt_user_key_idx"
      && index.config.unique === true
    ))).toBe(true)
  })

  it("pauses under a user lock, clears the active lease, and records receipt/audit/event atomically", async () => {
    const paused = queueRow({
      lifecycleState: "blocked",
      lifecycleReason: "Operator pause",
      executionBinding: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      acquisitionKey: null,
      fencingToken: 2,
      version: 2,
    })
    const query = mutationQuery({ mutated: paused })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "pause",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      idempotencyKey: "pause-1",
      reason: "Operator pause",
      now,
    })).resolves.toEqual({
      outcome: safeMutationRow(paused),
      affectedOutcomes: [safeMutationRow(paused)],
      successor: null,
      replayed: false,
    })

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readMutationReceipt,
      OUTCOME_QUEUE_SQL.readMutationItem,
      OUTCOME_QUEUE_SQL.pauseMutation,
      OUTCOME_QUEUE_SQL.insertMutationReceipt,
      OUTCOME_QUEUE_SQL.insertMutationAudit,
      OUTCOME_QUEUE_SQL.insertMutationEvent,
      "COMMIT",
    ])
    expect(query.mock.calls[1][1]).toEqual([`${userId}:outcome-queue`])
    expect(OUTCOME_QUEUE_SQL.pauseMutation).toContain(`q."fencingToken" + 1`)
    expect(OUTCOME_QUEUE_SQL.pauseMutation).toContain(`"leaseToken" = NULL`)
    expect(OUTCOME_QUEUE_SQL.pauseMutation).toContain(`q."version" = $3`)
  })

  it("requires a binding decision and live action-compatible grant for approve and resume", async () => {
    const approved = queueRow({
      lifecycleState: "approved",
      version: 1,
    })
    const query = mutationQuery({
      current: queueRow({
        lifecycleState: "suggested",
        approvalState: "unapproved",
        authorityState: "unverified",
        version: 0,
      }),
      mutated: approved,
    })
    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "approve",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 0,
      idempotencyKey: "approve-1",
      approvalDecisionId: 100,
      authorityGrantRef: "GRANT-WOS-V1.2",
      now,
    })).resolves.toEqual({
      outcome: safeMutationRow(approved),
      affectedOutcomes: [safeMutationRow(approved)],
      successor: null,
      replayed: false,
    })
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `approval."status" = 'accepted'`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `approval."authority" = 'binding'`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `grant."status" = 'active'`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `grant."allowedActions"`,
    )

    const unauthorized = mutationQuery({
      current: queueRow({ lifecycleState: "blocked", version: 2 }),
      governed: false,
    })
    await expect(mutateOutcomeQueueItem({
      query: unauthorized,
      userId,
      action: "resume",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 2,
      idempotencyKey: "resume-1",
      approvalDecisionId: 100,
      authorityGrantRef: "expired-grant",
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_APPROVAL_AUTHORITY_INVALID" })
    expect(unauthorized.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("requires a complete version-bound reorder snapshot", async () => {
    expect(OUTCOME_QUEUE_SQL.readMutationSnapshot).toContain(
      `q."lifecycleState" IN ('suggested', 'approved', 'blocked')`,
    )
    expect(OUTCOME_QUEUE_SQL.reorderMutation).toContain(
      `q."lifecycleState" IN ('suggested', 'approved', 'blocked')`,
    )
    const target = queueRow({ lifecycleState: "approved", queueOrder: 10, version: 3 })
    const other = queueRow({
      id: 2,
      outcomeKey: "goal:GOAL-1001",
      lifecycleState: "approved",
      queueOrder: 20,
      version: 7,
    })
    const query = mutationQuery({ snapshot: [target, other] })
    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "reorder",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-1",
      orderedOutcomes: [
        { outcomeKey: other.outcomeKey, expectedVersion: 7 },
        { outcomeKey: target.outcomeKey, expectedVersion: 3 },
      ],
      now,
    })).resolves.toEqual({
      outcome: expect.objectContaining({
        outcomeKey: target.outcomeKey,
        queueOrder: 1,
        version: 4,
      }),
      affectedOutcomes: [
        expect.objectContaining({
          outcomeKey: other.outcomeKey,
          queueOrder: 0,
          version: 8,
        }),
        expect.objectContaining({
          outcomeKey: target.outcomeKey,
          queueOrder: 1,
          version: 4,
        }),
      ],
      successor: null,
      replayed: false,
    })
    expect(query.mock.calls.filter(([sql]) => sql === OUTCOME_QUEUE_SQL.reorderMutation))
      .toHaveLength(2)

    await expect(mutateOutcomeQueueItem({
      query: mutationQuery({ snapshot: [target, other] }),
      userId,
      action: "reorder",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-target-only",
      queueOrder: 30,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_ORDERED_SNAPSHOT_REQUIRED" })

    const incomplete = mutationQuery({ snapshot: [target, other] })
    await expect(mutateOutcomeQueueItem({
      query: incomplete,
      userId,
      action: "reorder",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-2",
      orderedOutcomes: [{ outcomeKey: target.outcomeKey, expectedVersion: 3 }],
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_ORDERED_SNAPSHOT_INCOMPLETE" })
  })

  it("does not let decline or supersede directly terminate an active outcome", async () => {
    for (const action of ["decline", "supersede"] as const) {
      const query = mutationQuery()
      await expect(mutateOutcomeQueueItem({
        query,
        userId,
        action,
        outcomeKey: "goal:GOAL-1000",
        expectedVersion: 1,
        idempotencyKey: `${action}-active`,
        replacement: action === "supersede" ? {
          title: "Replacement",
        } : undefined,
        now,
      })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_ACTIVE_TERMINATION_ILLEGAL" })
      expect(query.mock.calls.some(([sql]) => (
        sql === OUTCOME_QUEUE_SQL.declineMutation
        || sql === OUTCOME_QUEUE_SQL.supersedeMutation
      ))).toBe(false)
    }
  })

  it("supersedes with inherited governance, complete receipt effects, and durable lineage", async () => {
    const replacementKey = successorKey("supersede-1")
    const superseded = queueRow({
      lifecycleState: "superseded",
      supersededByOutcomeKey: replacementKey,
      terminalResult: "SUPERSEDED",
      version: 2,
    })
    const current = queueRow({
      lifecycleState: "approved",
      queueOrder: 17,
      dependencyKeys: ["goal:GOAL-0999"],
      riskClass: "R0",
      authorityLevel: "A1_READ",
      authoritySubject: "primary-operator",
      authorityAction: "outcome:inspect",
    })
    const dependent = queueRow({
      id: 3,
      outcomeKey: "goal:GOAL-1002",
      dependencyKeys: [replacementKey],
      lifecycleState: "approved",
      version: 5,
    })
    const query = mutationQuery({
      current,
      mutated: superseded,
      rebound: [dependent],
    })
    const result = await mutateOutcomeQueueItem({
      query,
      userId,
      action: "supersede",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      idempotencyKey: "supersede-1",
      replacement: {
        title: "Replacement",
        objective: "Revised outcome",
        queueOrder: 999,
        dependencyKeys: ["attacker-controlled"],
        riskClass: "R1",
        authorityLevel: "A9_UNBOUNDED",
        authoritySubject: "attacker",
        authorityAction: "outcome:destroy",
      },
      now,
    })
    expect(result).toMatchObject({
      outcome: safeMutationRow(superseded),
      affectedOutcomes: [
        safeMutationRow(superseded),
        expect.objectContaining({
          outcomeKey: replacementKey,
          lifecycleState: "suggested",
          approvalState: "unapproved",
          authorityState: "unverified",
        }),
        safeMutationRow(dependent),
      ],
      successor: expect.objectContaining({ outcomeKey: replacementKey }),
      replayed: false,
    })
    expect(OUTCOME_QUEUE_SQL.insertSupersedingOutcome).toContain(`'unapproved'`)
    expect(OUTCOME_QUEUE_SQL.insertSupersedingOutcome).toContain(`'unverified'`)
    expect(OUTCOME_QUEUE_SQL.insertSupersedingOutcome).toContain(`"supersedesOutcomeKey"`)
    expect(OUTCOME_QUEUE_SQL.supersedeMutation).toContain(`"supersededByOutcomeKey" = $5`)
    expect(OUTCOME_QUEUE_SQL.rebindSupersededDependents).toContain(
      `$2 = ANY(q."dependencyKeys")`,
    )
    expect(OUTCOME_QUEUE_SQL.rebindSupersededDependents).toContain(
      `q."lifecycleState" IN ('suggested', 'approved', 'blocked')`,
    )
    const insertCall = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertSupersedingOutcome,
    )
    expect(insertCall?.[1]).toEqual([
      userId,
      replacementKey,
      current.goalId,
      current.goalRef,
      "Replacement",
      "Revised outcome",
      current.queueOrder,
      current.dependencyKeys,
      current.riskClass,
      current.authorityLevel,
      current.authoritySubject,
      current.authorityAction,
      current.outcomeKey,
      now,
    ])
    const receiptCall = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertMutationReceipt,
    )
    const receiptBinding = JSON.parse(String(receiptCall?.[1]?.[6]))
    expect(receiptBinding.affectedOutcomes).toHaveLength(3)
    expect(receiptBinding.successor.outcomeKey).toBe(replacementKey)
    for (const item of receiptBinding.affectedOutcomes) {
      expect(item).not.toHaveProperty("executionBinding")
      expect(item).not.toHaveProperty("leaseToken")
      expect(item).not.toHaveProperty("fencingToken")
      expect(item).not.toHaveProperty("acquisitionKey")
      expect(item).not.toHaveProperty("terminalKey")
    }
    const rebindCall = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.rebindSupersededDependents,
    )
    expect(rebindCall?.[1]?.slice(0, 3)).toEqual([
      userId,
      "goal:GOAL-1000",
      replacementKey,
    ])
  })

  it("derives the successor after idempotency normalization so equivalent replay keys match", async () => {
    const replacementKey = successorKey("supersede-normalized")
    const superseded = queueRow({
      lifecycleState: "superseded",
      supersededByOutcomeKey: replacementKey,
      terminalResult: "SUPERSEDED",
      version: 2,
    })
    const query = mutationQuery({
      current: queueRow({ lifecycleState: "approved" }),
      mutated: superseded,
    })
    const base = {
      query,
      userId,
      action: "supersede" as const,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      replacement: { title: "Replacement" },
      now,
    }
    await expect(mutateOutcomeQueueItem({
      ...base,
      idempotencyKey: " supersede-normalized ",
    })).resolves.toMatchObject({ replayed: false })
    await expect(mutateOutcomeQueueItem({
      ...base,
      idempotencyKey: "supersede-normalized",
    })).resolves.toMatchObject({
      replayed: true,
      successor: { outcomeKey: replacementKey },
    })
  })

  it("returns the recorded result for exact replay and rejects conflicting key reuse", async () => {
    const declined = queueRow({
      lifecycleState: "declined",
      terminalResult: "DECLINED",
      version: 2,
    })
    const query = mutationQuery({
      current: queueRow({ lifecycleState: "approved" }),
      mutated: declined,
    })
    const input = {
      query,
      userId,
      action: "decline" as const,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      idempotencyKey: "decline-1",
      reason: "No longer wanted",
      now,
    }
    await expect(mutateOutcomeQueueItem(input)).resolves.toEqual({
      outcome: safeMutationRow(declined),
      affectedOutcomes: [safeMutationRow(declined)],
      successor: null,
      replayed: false,
    })
    await expect(mutateOutcomeQueueItem(input)).resolves.toEqual({
      outcome: safeMutationRow(declined),
      affectedOutcomes: [safeMutationRow(declined)],
      successor: null,
      replayed: true,
    })
    expect(query.mock.calls.filter(([sql]) => sql === OUTCOME_QUEUE_SQL.declineMutation))
      .toHaveLength(1)

    await expect(mutateOutcomeQueueItem({
      ...input,
      reason: "Different intent",
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_IDEMPOTENCY_CONFLICT" })
  })
})
