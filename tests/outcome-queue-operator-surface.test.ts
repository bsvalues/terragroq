import { describe, expect, it } from "vitest"

import type { OutcomeQueueRecord } from "@/lib/outcome-queue/engine"
import { projectOutcomeQueueOperatorSurface } from "@/lib/outcome-queue/operator-surface"

const NOW = "2026-07-28T12:00:00.000Z"
const ELIGIBILITY = {
  now: NOW,
  validApprovalDecisionIds: [100],
  validAuthorityGrantRefs: ["GRANT-WOS-V1.2"],
} as const

function outcome(overrides: Partial<OutcomeQueueRecord> = {}): OutcomeQueueRecord {
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
    activeWorkOrderId: 474,
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

function project(queue: readonly OutcomeQueueRecord[]) {
  return projectOutcomeQueueOperatorSurface({ queue, ...ELIGIBILITY })
}

describe("outcome queue operator surface", () => {
  it("shows the live active item and its lease without claiming another item is next", () => {
    const active = outcome({
      outcomeKey: "goal:active",
      lifecycleState: "active",
      executionBinding: "execution-1",
      leaseHolder: "supervisor-1",
      leaseToken: "lease-1",
      leaseExpiresAt: "2026-07-28T12:01:00.000Z",
    })
    const queued = outcome({ id: 2, outcomeKey: "goal:queued", queueOrder: 200 })

    const surface = project([queued, active])

    expect(surface).toMatchObject({
      state: "ACTIVE",
      stateLabel: "Outcome active",
      reason: "ACTIVE_LEASE_HELD",
      activeItem: {
        outcomeKey: "goal:active",
        isActive: true,
        staleLease: false,
        leaseHolder: "supervisor-1",
      },
      nextEligibleItem: null,
      nextEligibleMode: null,
    })
    expect(surface.rows.find((row) => row.outcomeKey === "goal:queued")?.blockerReasons)
      .toContain("LEASE_NOT_STALE")
    expect(surface.activeItem).not.toHaveProperty("executionBinding")
    expect(surface.activeItem).not.toHaveProperty("fencingToken")
    expect(surface.activeItem).toHaveProperty("version", 0)
  })

  it("projects the next eligible item and activation mode", () => {
    const next = outcome({ outcomeKey: "goal:next", queueOrder: 20 })
    const later = outcome({ id: 2, outcomeKey: "goal:later", queueOrder: 30 })

    const surface = project([later, next])

    expect(surface).toMatchObject({
      state: "READY",
      reason: "NEXT_OUTCOME_ELIGIBLE",
      activeItem: null,
      nextEligibleItem: {
        outcomeKey: "goal:next",
        isNextEligible: true,
        blockerReasons: [],
      },
      nextEligibleMode: "ACTIVATE",
      nextEligibleModeLabel: "Activate next outcome",
    })
  })

  it("exposes scoped approval and authority candidates without treating them as active bindings", () => {
    const suggested = outcome({
      lifecycleState: "suggested",
      approvalState: "unapproved",
      approvalDecisionId: null,
      authorityState: "unverified",
      authorityGrantRef: null,
    })
    const surface = projectOutcomeQueueOperatorSurface({
      queue: [suggested],
      ...ELIGIBILITY,
      availableApprovalDecisionIdsByOutcomeKey: {
        [suggested.outcomeKey]: [200],
      },
      availableAuthorityGrantRefsByOutcomeKey: {
        [suggested.outcomeKey]: ["GRANT-CANDIDATE"],
      },
    })

    expect(surface.rows[0]).toMatchObject({
      approvalDecisionId: null,
      authorityGrantRef: null,
      availableApprovalDecisionId: 200,
      availableAuthorityGrantRef: "GRANT-CANDIDATE",
      blockerReasons: ["LIFECYCLE_INELIGIBLE", "APPROVAL_REQUIRED", "AUTHORITY_NOT_MATCHED"],
    })
  })

  it("reports per-row approval, authority, risk, lifecycle, and dependency blockers", () => {
    const blocked = outcome({
      outcomeKey: "goal:blocked",
      lifecycleState: "blocked",
      approvalState: "unapproved",
      approvalDecisionId: null,
      authorityState: "expired",
      authorityGrantRef: "OLD-GRANT",
      riskClass: "R2",
      dependencyKeys: ["goal:z", "goal:a", "goal:z"],
    })

    const surface = project([blocked])

    expect(surface).toMatchObject({
      state: "BLOCKED",
      rows: [{
        outcomeKey: "goal:blocked",
        dependencyGaps: ["goal:a", "goal:z"],
        blockerReasons: [
          "LIFECYCLE_INELIGIBLE",
          "APPROVAL_REQUIRED",
          "AUTHORITY_NOT_MATCHED",
          "DEPENDENCY_NOT_COMPLETED",
          "RISK_NOT_ALLOWED",
        ],
        lifecycleLabel: "Blocked",
        approvalLabel: "Awaiting approval",
        authorityLabel: "Authority expired",
      }],
    })
  })

  it("distinguishes a genuinely empty queue", () => {
    expect(project([])).toEqual({
      generatedAt: NOW,
      state: "EMPTY",
      stateLabel: "Queue empty",
      reason: "EMPTY_QUEUE",
      reasonLabel: "No outcomes are queued",
      rows: [],
      activeItem: null,
      nextEligibleItem: null,
      nextEligibleMode: null,
      nextEligibleModeLabel: null,
      countsByLifecycle: {
        suggested: 0,
        approved: 0,
        blocked: 0,
        active: 0,
        completed: 0,
        declined: 0,
        superseded: 0,
      },
      counts: { total: 0, nonTerminal: 0, terminal: 0 },
    })
  })

  it("distinguishes an all-terminal queue and counts each lifecycle", () => {
    const surface = project([
      outcome({ outcomeKey: "goal:complete", lifecycleState: "completed" }),
      outcome({ id: 2, outcomeKey: "goal:declined", lifecycleState: "declined" }),
      outcome({ id: 3, outcomeKey: "goal:superseded", lifecycleState: "superseded" }),
    ])

    expect(surface).toMatchObject({
      state: "ALL_TERMINAL",
      reason: "ALL_OUTCOMES_TERMINAL",
      countsByLifecycle: {
        suggested: 0,
        approved: 0,
        blocked: 0,
        active: 0,
        completed: 1,
        declined: 1,
        superseded: 1,
      },
      counts: { total: 3, nonTerminal: 0, terminal: 3 },
    })
  })

  it("orders rows by queue order, creation time, then outcome key without mutating input", () => {
    const queue = [
      outcome({ outcomeKey: "goal:c", queueOrder: 2 }),
      outcome({
        id: 2,
        outcomeKey: "goal:b",
        queueOrder: 1,
        createdAt: new Date("2026-07-28T09:00:00.000Z"),
      }),
      outcome({
        id: 3,
        outcomeKey: "goal:a",
        queueOrder: 1,
        createdAt: new Date("2026-07-28T09:00:00.000Z"),
      }),
    ]

    const surface = project(queue)

    expect(surface.rows.map((row) => row.outcomeKey)).toEqual([
      "goal:a",
      "goal:b",
      "goal:c",
    ])
    expect(queue.map((item) => item.outcomeKey)).toEqual(["goal:c", "goal:b", "goal:a"])
    expect(surface.rows[0].createdAt).toBe("2026-07-28T09:00:00.000Z")
    expect(() => JSON.stringify(surface)).not.toThrow()
  })

  it("surfaces stale active work as the next recoverable item", () => {
    const stale = outcome({
      lifecycleState: "active",
      executionBinding: "execution-old",
      leaseHolder: "supervisor-old",
      leaseToken: "lease-old",
      leaseExpiresAt: "2026-07-28T11:59:59.000Z",
      fencingToken: 4,
    })

    const surface = project([stale])

    expect(surface).toMatchObject({
      state: "RECOVERY_READY",
      reason: "STALE_LEASE_RECOVERY_ELIGIBLE",
      activeItem: {
        outcomeKey: stale.outcomeKey,
        staleLease: true,
        isActive: true,
      },
      nextEligibleItem: {
        outcomeKey: stale.outcomeKey,
        isNextEligible: true,
        nextMode: "RECOVER_STALE_LEASE",
        blockerReasons: [],
      },
      nextEligibleMode: "RECOVER_STALE_LEASE",
      nextEligibleModeLabel: "Recover stale lease",
    })
  })
})
