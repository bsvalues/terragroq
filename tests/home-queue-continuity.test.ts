import { describe, expect, it } from "vitest"

import { projectHomeQueueContinuity } from "@/components/dashboard/home-queue-continuity"
import type { OutcomeQueueRecord } from "@/lib/outcome-queue/engine"
import { projectOutcomeQueueOperatorSurface } from "@/lib/outcome-queue/operator-surface"

const NOW = "2026-07-28T12:00:00.000Z"
const ELIGIBILITY = {
  now: NOW,
  validApprovalDecisionIds: [100],
  validAuthorityGrantRefs: ["GRANT-HOME-QUEUE"],
} as const

function outcome(overrides: Partial<OutcomeQueueRecord> = {}): OutcomeQueueRecord {
  return {
    id: 1,
    userId: "owner",
    outcomeKey: "goal:GOAL-0006",
    goalId: 6,
    goalRef: "GOAL-0006",
    title: "Keep the delivery queue moving",
    objective: "Keep the delivery queue moving",
    queueOrder: 100,
    dependencyKeys: [],
    riskClass: "R1",
    approvalState: "approved",
    approvedBy: "owner",
    approvedAt: "2026-07-28T10:00:00.000Z",
    approvalDecisionId: 100,
    authorityState: "matched",
    authorityLevel: "A2_WRITE_OWN",
    authorityGrantRef: "GRANT-HOME-QUEUE",
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    lifecycleState: "approved",
    lifecycleReason: null,
    activeWorkOrderId: 10,
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
  return projectHomeQueueContinuity(
    projectOutcomeQueueOperatorSurface({ queue, ...ELIGIBILITY }),
  )
}

describe("Home queue continuity", () => {
  it("shows a live active outcome without claiming a separate next outcome", () => {
    const continuity = project([
      outcome({
        outcomeKey: "goal:active",
        goalRef: "GOAL-ACTIVE",
        title: "Deliver the active outcome",
        lifecycleState: "active",
        lifecycleReason: "Builder lane is executing.",
        executionBinding: "execution-1",
        leaseHolder: "supervisor-1",
        leaseToken: "lease-1",
        leaseExpiresAt: "2026-07-28T12:01:00.000Z",
      }),
      outcome({
        id: 2,
        outcomeKey: "goal:queued",
        goalRef: "GOAL-QUEUED",
        queueOrder: 200,
      }),
    ])

    expect(continuity).toMatchObject({
      state: "ACTIVE",
      active: {
        identity: "GOAL-ACTIVE",
        title: "Deliver the active outcome",
        status: "Active",
        context: "Builder lane is executing.",
        staleLease: false,
      },
      next: null,
      blockerReason: "The active outcome holds a live lease",
    })
  })

  it("shows the ready outcome and its activation mode", () => {
    const continuity = project([
      outcome({
        outcomeKey: "goal:ready",
        goalRef: "GOAL-READY",
        title: "Start the next bounded outcome",
      }),
    ])

    expect(continuity).toMatchObject({
      state: "READY",
      active: null,
      next: {
        identity: "GOAL-READY",
        title: "Start the next bounded outcome",
        mode: "Activate next outcome",
      },
      blockerReason: null,
    })
  })

  it("uses the aggregate queue reason for a dependency-blocked outcome", () => {
    const continuity = project([
      outcome({
        outcomeKey: "goal:blocked",
        goalRef: "GOAL-BLOCKED",
        lifecycleReason: "Item-specific context must remain supplemental.",
        dependencyKeys: ["goal:prerequisite"],
      }),
    ])

    expect(continuity).toMatchObject({
      state: "BLOCKED",
      active: null,
      next: null,
      blockerReason: "Queued outcomes are waiting on dependencies",
    })
  })

  it("shows a stale active outcome as both active and recovery-next", () => {
    const continuity = project([
      outcome({
        outcomeKey: "goal:stale",
        goalRef: "GOAL-STALE",
        title: "Recover the interrupted outcome",
        lifecycleState: "active",
        executionBinding: "execution-old",
        leaseHolder: "supervisor-old",
        leaseToken: "lease-old",
        leaseExpiresAt: "2026-07-28T11:59:59.000Z",
        fencingToken: 4,
      }),
    ])

    expect(continuity).toMatchObject({
      state: "RECOVERY_READY",
      active: {
        outcomeKey: "goal:stale",
        identity: "GOAL-STALE",
        status: "Active",
        staleLease: true,
      },
      next: {
        outcomeKey: "goal:stale",
        identity: "GOAL-STALE",
        mode: "Recover stale lease",
      },
      blockerReason: null,
    })
  })

  it("reports no blocker for an empty queue", () => {
    expect(project([])).toMatchObject({
      state: "EMPTY",
      active: null,
      next: null,
      blockerReason: null,
    })
  })

  it("reports no blocker when every outcome is terminal", () => {
    const continuity = project([
      outcome({
        lifecycleState: "completed",
        terminalResult: "READY_FOR_VALIDATION",
        terminalAt: "2026-07-28T11:30:00.000Z",
      }),
    ])

    expect(continuity).toMatchObject({
      state: "ALL_TERMINAL",
      active: null,
      next: null,
      blockerReason: null,
    })
  })

  it("provides exact Goal Console and Work Orders destinations", () => {
    expect(project([]).links).toEqual([
      { label: "Goal Console", href: "/goal-console" },
      { label: "Work Orders", href: "/work-orders" },
    ])
  })
})
