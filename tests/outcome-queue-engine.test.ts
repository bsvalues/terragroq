import { getTableName } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { outcomeQueueItem } from "@/lib/db/schema"
import {
  acquireOutcome,
  canTransitionOutcome,
  completeOutcome,
  fenceMatches,
  isLeaseStale,
  mapLegacyGoalToOutcome,
  selectNextOutcome,
  transitionOutcome,
  type OutcomeQueueRecord,
} from "@/lib/outcome-queue/engine"

const NOW = "2026-07-28T12:00:00.000Z"
const CURRENT_SELECTION = {
  now: NOW,
  validApprovalDecisionIds: [100],
  validAuthorityGrantRefs: ["GRANT-WOS-V1.2"],
} as const

function outcome(
  overrides: Partial<OutcomeQueueRecord> = {},
): OutcomeQueueRecord {
  return {
    id: 1,
    userId: "owner",
    outcomeKey: "goal:GOAL-1000",
    goalId: 1000,
    goalRef: "GOAL-1000",
    title: "Deliver a bounded outcome",
    objective: "Deliver a bounded outcome",
    queueOrder: 100,
    dependencyKeys: [],
    riskClass: "R1",
    approvalState: "approved",
    approvedBy: "owner",
    approvedAt: "2026-07-28T10:00:00.000Z",
    approvalDecisionId: 100,
    authorityState: "matched",
    authorityLevel: "A2_WRITE_OWN",
    authorityGrantRef: "GRANT-WOS-V1.2",
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    lifecycleState: "approved",
    lifecycleReason: null,
    activeWorkOrderId: 472,
    executionBinding: null,
    leaseHolder: null,
    leaseToken: null,
    leaseExpiresAt: null,
    fencingToken: 0,
    version: 0,
    acquisitionKey: null,
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    suggestedAt: "2026-07-28T10:00:00.000Z",
    activatedAt: null,
    terminalAt: null,
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:00.000Z",
    ...overrides,
  }
}

function acquire(
  item: OutcomeQueueRecord,
  overrides: Partial<Parameters<typeof acquireOutcome>[1]> = {},
) {
  return acquireOutcome(item, {
    now: NOW,
    leaseDurationMs: 60_000,
    leaseHolder: "supervisor-a",
    leaseToken: "lease-a",
    executionBinding: "execution-a",
    acquisitionKey: "acquire-a",
    expectedVersion: item.version,
    queue: [item],
    validApprovalDecisionIds: [100],
    validAuthorityGrantRefs: ["GRANT-WOS-V1.2"],
    ...overrides,
  })
}

function fence(item: OutcomeQueueRecord) {
  return {
    executionBinding: item.executionBinding!,
    leaseToken: item.leaseToken!,
    fencingToken: item.fencingToken,
  }
}

describe("outcome lifecycle", () => {
  it("binds the engine to the additive durable queue table", () => {
    expect(getTableName(outcomeQueueItem)).toBe("outcome_queue_item")
  })

  it("allows only explicit legal transitions and requires approval evidence", () => {
    expect(canTransitionOutcome("suggested", "approved")).toBe(true)
    expect(canTransitionOutcome("suggested", "active")).toBe(false)
    expect(canTransitionOutcome("completed", "approved")).toBe(false)

    const suggested = outcome({
      lifecycleState: "suggested",
      approvalState: "unapproved",
      approvedBy: null,
      approvedAt: null,
      approvalDecisionId: null,
    })
    expect(transitionOutcome(suggested, "approved", { now: NOW })).toMatchObject({
      ok: false,
      reason: "APPROVAL_EVIDENCE_REQUIRED",
    })

    const approved = transitionOutcome(suggested, "approved", {
      now: NOW,
      approvedBy: "owner",
      approvalDecisionId: 100,
      expectedVersion: 0,
    })
    expect(approved).toMatchObject({
      ok: true,
      replayed: false,
      item: {
        lifecycleState: "approved",
        approvalState: "approved",
        approvedBy: "owner",
        approvalDecisionId: 100,
        version: 1,
      },
    })
    if (!approved.ok) throw new Error("approval transition failed")
    expect(transitionOutcome(approved.item, "active", { now: NOW })).toMatchObject({
      ok: false,
      reason: "ACQUISITION_REQUIRED",
    })
  })

  it("requires the current fence for transitions out of active", () => {
    const acquired = acquire(outcome())
    if (!acquired.ok) throw new Error("acquisition failed")

    expect(transitionOutcome(acquired.item, "blocked", {
      now: NOW,
      fence: { ...fence(acquired.item), fencingToken: 0 },
    })).toMatchObject({ ok: false, reason: "FENCE_MISMATCH" })

    const blocked = transitionOutcome(acquired.item, "blocked", {
      now: NOW,
      fence: fence(acquired.item),
      reason: "VALIDATION_RETRY_SCHEDULED",
    })
    expect(blocked).toMatchObject({
      ok: true,
      item: {
        lifecycleState: "blocked",
        lifecycleReason: "VALIDATION_RETRY_SCHEDULED",
        leaseHolder: null,
        version: 2,
      },
    })
    expect(transitionOutcome(acquired.item, "completed", {
      now: NOW,
      fence: fence(acquired.item),
    })).toMatchObject({
      ok: false,
      reason: "ILLEGAL_TRANSITION",
    })
  })
})

describe("deterministic selection and eligibility", () => {
  it("orders by queue order, creation time, and stable outcome identity", () => {
    const selected = selectNextOutcome([
      outcome({ outcomeKey: "goal:c", queueOrder: 2 }),
      outcome({
        outcomeKey: "goal:b",
        queueOrder: 1,
        createdAt: "2026-07-28T09:00:00.000Z",
      }),
      outcome({
        outcomeKey: "goal:a",
        queueOrder: 1,
        createdAt: "2026-07-28T09:00:00.000Z",
      }),
    ], CURRENT_SELECTION)

    expect(selected).toMatchObject({
      selected: true,
      mode: "ACTIVATE",
      item: { outcomeKey: "goal:a" },
    })
  })

  it("requires completed dependencies and then releases the dependent", () => {
    const prerequisite = outcome({
      outcomeKey: "goal:prerequisite",
      lifecycleState: "active",
      leaseHolder: "supervisor-a",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:01:00.000Z",
    })
    const dependent = outcome({
      outcomeKey: "goal:dependent",
      queueOrder: 2,
      dependencyKeys: ["goal:prerequisite"],
    })

    expect(selectNextOutcome([prerequisite, dependent], CURRENT_SELECTION)).toMatchObject({
      selected: false,
      reason: "ACTIVE_LEASE_HELD",
    })

    const completedPrerequisite = {
      ...prerequisite,
      lifecycleState: "completed" as const,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: "PASS",
    }
    expect(selectNextOutcome([completedPrerequisite, dependent], CURRENT_SELECTION)).toMatchObject({
      selected: true,
      item: { outcomeKey: "goal:dependent" },
    })
  })

  it("returns typed truthful no-selection reasons", () => {
    expect(selectNextOutcome([], CURRENT_SELECTION)).toEqual({
      selected: false,
      reason: "EMPTY_QUEUE",
      blockers: [],
    })
    expect(selectNextOutcome([
      outcome({
        lifecycleState: "suggested",
        approvalState: "unapproved",
        authorityState: "unverified",
      }),
    ], CURRENT_SELECTION)).toMatchObject({
      selected: false,
      reason: "AWAITING_APPROVAL",
      blockers: [{
        reasons: expect.arrayContaining(["APPROVAL_REQUIRED", "AUTHORITY_NOT_MATCHED"]),
      }],
    })
    expect(selectNextOutcome([
      outcome({ authorityState: "expired" }),
    ], CURRENT_SELECTION)).toMatchObject({
      selected: false,
      reason: "AUTHORITY_INELIGIBLE",
    })
    expect(selectNextOutcome([
      outcome(),
    ], {
      now: NOW,
      validApprovalDecisionIds: [100],
      validAuthorityGrantRefs: [],
    })).toMatchObject({
      selected: false,
      reason: "AUTHORITY_INELIGIBLE",
    })
    expect(selectNextOutcome([
      outcome({ riskClass: "R2" }),
    ], CURRENT_SELECTION)).toMatchObject({
      selected: false,
      reason: "RISK_INELIGIBLE",
    })
    expect(selectNextOutcome([
      outcome({ lifecycleState: "completed" }),
    ], CURRENT_SELECTION)).toMatchObject({
      selected: false,
      reason: "ALL_OUTCOMES_TERMINAL",
    })
  })
})

describe("contention, fencing, and idempotency", () => {
  it("rechecks eligibility before direct acquisition", () => {
    expect(acquire(outcome({ riskClass: "R2" }))).toMatchObject({
      ok: false,
      reason: "OUTCOME_INELIGIBLE",
    })
    expect(acquire(outcome({
      dependencyKeys: ["goal:missing"],
    }))).toMatchObject({
      ok: false,
      reason: "OUTCOME_INELIGIBLE",
    })
  })

  it("accepts an equivalent queue snapshot without relying on object identity", () => {
    const item = outcome()
    expect(acquire(item, {
      queue: [{ ...item }],
    })).toMatchObject({
      ok: true,
      item: { lifecycleState: "active" },
    })
  })

  it("allows one contender from a shared snapshot", () => {
    const snapshot = outcome()
    const winner = acquire(snapshot)
    if (!winner.ok) throw new Error("winner acquisition failed")

    const loser = acquireOutcome(winner.item, {
      now: NOW,
      leaseDurationMs: 60_000,
      leaseHolder: "supervisor-b",
      leaseToken: "lease-b",
      executionBinding: "execution-b",
      acquisitionKey: "acquire-b",
      expectedVersion: snapshot.version,
      queue: [winner.item],
      validApprovalDecisionIds: [100],
      validAuthorityGrantRefs: ["GRANT-WOS-V1.2"],
    })
    expect(winner.item).toMatchObject({ lifecycleState: "active", fencingToken: 1, version: 1 })
    expect(loser).toMatchObject({ ok: false, reason: "VERSION_CONFLICT" })
  })

  it("replays the same acquisition and rejects key reuse with different binding", () => {
    const first = acquire(outcome())
    if (!first.ok) throw new Error("acquisition failed")

    expect(acquire(first.item)).toMatchObject({ ok: true, replayed: true, item: first.item })
    expect(acquire(first.item, {
      leaseHolder: "supervisor-b",
      executionBinding: "execution-b",
    })).toMatchObject({ ok: false, reason: "ACQUISITION_KEY_CONFLICT" })
  })

  it("fences the old supervisor after stale-lease recovery", () => {
    const old = acquire(outcome(), {
      now: "2026-07-28T11:00:00.000Z",
      leaseDurationMs: 30_000,
    })
    if (!old.ok) throw new Error("initial acquisition failed")
    expect(isLeaseStale(old.item, NOW)).toBe(true)
    expect(selectNextOutcome([old.item], CURRENT_SELECTION)).toMatchObject({
      selected: true,
      mode: "RECOVER_STALE_LEASE",
      staleLease: true,
    })

    const recovered = acquireOutcome(old.item, {
      now: NOW,
      leaseDurationMs: 60_000,
      leaseHolder: "supervisor-after-restart",
      leaseToken: "lease-recovered",
      executionBinding: "execution-recovered",
      acquisitionKey: "acquire-recovered",
      expectedVersion: old.item.version,
      queue: [old.item],
      validApprovalDecisionIds: [100],
      validAuthorityGrantRefs: ["GRANT-WOS-V1.2"],
    })
    if (!recovered.ok) throw new Error("recovery failed")
    expect(recovered.item).toMatchObject({
      lifecycleState: "active",
      lifecycleReason: "STALE_LEASE_RECOVERED",
      fencingToken: 2,
      version: 2,
    })
    expect(fenceMatches(recovered.item, fence(old.item), NOW)).toBe(false)
    expect(completeOutcome(recovered.item, {
      now: NOW,
      fence: fence(old.item),
      expectedVersion: recovered.item.version,
      terminalKey: "complete-a",
      result: "PASS",
      evidenceRefs: ["EV-1"],
    })).toMatchObject({ ok: false, reason: "FENCE_MISMATCH" })
  })

  it("reclaims an expired acquisition-key replay with a higher fence", () => {
    const expired = acquire(outcome(), {
      now: "2026-07-28T11:00:00.000Z",
      leaseDurationMs: 30_000,
    })
    if (!expired.ok) throw new Error("initial acquisition failed")

    const recovered = acquireOutcome(expired.item, {
      now: NOW,
      leaseDurationMs: 60_000,
      leaseHolder: "supervisor-after-restart",
      leaseToken: "lease-after-restart",
      executionBinding: "execution-after-restart",
      acquisitionKey: "acquire-a",
      expectedVersion: expired.item.version,
      queue: [expired.item],
      validApprovalDecisionIds: [100],
      validAuthorityGrantRefs: ["GRANT-WOS-V1.2"],
    })

    expect(recovered).toMatchObject({
      ok: true,
      replayed: false,
      item: {
        lifecycleState: "active",
        acquisitionKey: "acquire-a",
        fencingToken: 2,
        version: 2,
      },
    })
  })

  it("completes once with evidence and replays the same terminal operation", () => {
    const acquired = acquire(outcome())
    if (!acquired.ok) throw new Error("acquisition failed")
    const input = {
      now: NOW,
      fence: fence(acquired.item),
      expectedVersion: acquired.item.version,
      terminalKey: "complete-a",
      result: "PASS",
      evidenceRefs: ["EV-2", "EV-1", "EV-1"],
    }
    const completed = completeOutcome(acquired.item, input)
    expect(completed).toMatchObject({
      ok: true,
      replayed: false,
      item: {
        lifecycleState: "completed",
        terminalResult: "PASS",
        terminalEvidenceRefs: ["EV-1", "EV-2"],
        terminalKey: "complete-a",
        leaseHolder: null,
      },
    })
    if (!completed.ok) throw new Error("completion failed")
    expect(completeOutcome(completed.item, input)).toMatchObject({
      ok: true,
      replayed: true,
    })
    expect(completeOutcome(completed.item, {
      ...input,
      terminalKey: "complete-conflict",
    })).toMatchObject({ ok: false, reason: "TERMINAL_KEY_CONFLICT" })
    expect(completeOutcome(completed.item, {
      ...input,
      result: "PARTIAL",
    })).toMatchObject({ ok: false, reason: "TERMINAL_KEY_CONFLICT" })
  })

  it("rejects an expired holder before another supervisor reclaims the lease", () => {
    const expired = acquire(outcome(), {
      now: "2026-07-28T11:00:00.000Z",
      leaseDurationMs: 30_000,
    })
    if (!expired.ok) throw new Error("initial acquisition failed")

    expect(completeOutcome(expired.item, {
      now: NOW,
      fence: fence(expired.item),
      expectedVersion: expired.item.version,
      terminalKey: "expired-completion",
      result: "PASS",
      evidenceRefs: ["EV-EXPIRED"],
    })).toMatchObject({ ok: false, reason: "FENCE_MISMATCH" })
  })
})

describe("legacy Goal compatibility", () => {
  it("maps GOAL-0001 through GOAL-0005 with stable identity and no inferred authority", () => {
    for (let id = 1; id <= 5; id += 1) {
      const ref = `GOAL-${String(id).padStart(4, "0")}`
      const mapped = mapLegacyGoalToOutcome({
        id,
        userId: "owner",
        ref,
        command: `Historical outcome ${id}`,
        risk: "low",
        authority: "A2_WRITE_OWN",
        verdict: "allow",
        requiresApproval: false,
        recommendedMove: "Execute this suggestion immediately",
        status: "classified",
        createdAt: `2026-07-${String(id).padStart(2, "0")}T00:00:00.000Z`,
      })

      expect(mapped).toMatchObject({
        outcomeKey: `goal:${ref}`,
        goalId: id,
        goalRef: ref,
        queueOrder: id,
        lifecycleState: "suggested",
        approvalState: "unapproved",
        authorityState: "unverified",
        authorityGrantRef: null,
        riskClass: "R1",
      })
      expect(selectNextOutcome([mapped], { now: NOW })).toMatchObject({
        selected: false,
        reason: "AWAITING_APPROVAL",
      })
    }
  })

  it.each([
    ["medium", "R2"],
    ["high", "R2"],
    ["critical", "R2"],
  ] as const)("normalizes legacy %s risk to %s", (risk, riskClass) => {
    const mapped = mapLegacyGoalToOutcome({
      id: 6,
      userId: "owner",
      ref: "GOAL-0006",
      command: "Historical elevated-risk outcome",
      risk,
      authority: "A3_EXTERNAL_WRITE",
      verdict: "deny",
      requiresApproval: true,
      recommendedMove: null,
      status: "classified",
      createdAt: "2026-07-06T00:00:00.000Z",
    })

    expect(mapped.riskClass).toBe(riskClass)
  })

  it("maps terminal legacy evidence without re-authorizing historical work", () => {
    const mapped = mapLegacyGoalToOutcome({
      id: 4,
      userId: "owner",
      ref: "GOAL-0004",
      command: "Show bounded runtime evidence history",
      risk: "low",
      authority: "A2_WRITE_OWN",
      verdict: "allow",
      requiresApproval: false,
      status: "converted",
      linkedWorkOrderId: 451,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    }, {
      workOrderStatus: "closed",
      terminalResult: "PASS",
      terminalEvidenceRefs: ["PR-451"],
    })

    expect(mapped).toMatchObject({
      lifecycleState: "completed",
      terminalResult: "PASS",
      terminalEvidenceRefs: ["PR-451"],
      approvalState: "unapproved",
      authorityState: "unverified",
      activeWorkOrderId: 451,
    })
  })
})
