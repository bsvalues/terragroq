import { describe, expect, it } from "vitest"
import type { WorkOrder } from "@/lib/db/schema"

import { getActiveWorkQueueSurface } from "@/components/work-orders/active-work-queue"

function workOrder(status: WorkOrder["status"], evidence: string[] = []): WorkOrder {
  return {
    id: 1,
    userId: "user",
    ref: "WO-0001",
    title: "Verify native loop",
    description: null,
    goal: "/loop native concept",
    loop: null,
    scope: null,
    nonGoals: [],
    allowedFiles: [],
    forbiddenFiles: [],
    validators: [],
    stopConditions: [],
    lane: null,
    phase: null,
    status,
    priority: "medium",
    assignee: null,
    authorityLevel: "A0_READ_ONLY",
    authorityGranted: null,
    authorityGrantId: null,
    acceptanceCriteria: [],
    agent: null,
    approvedBy: null,
    approvedAt: null,
    linkedDecisionId: null,
    evidence,
    result: null,
    commitRef: null,
    tagRef: null,
    commitAllowed: false,
    tagAllowed: false,
    pushAllowed: false,
    supersedesId: null,
    supersededById: null,
    dueAt: null,
    closedAt: null,
    completedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  }
}

describe("active work queue surface", () => {
  it("shows approved, active, blocked, and review work in the active queue", () => {
    const surface = getActiveWorkQueueSurface([
      workOrder("draft"),
      workOrder("approved"),
      workOrder("active", ["tests passed"]),
      workOrder("blocked"),
      workOrder("review", ["production verified"]),
      workOrder("closed"),
    ])

    expect(surface.items.map((item) => item.status)).toEqual(["approved", "active", "blocked", "review"])
  })

  it("names next moves without creating execution controls", () => {
    const surface = getActiveWorkQueueSurface([workOrder("blocked")])

    expect(surface.items[0]?.nextMove).toContain("Resolve the authority gate")
    expect(surface.safety).toEqual({
      readOnly: true,
      startsLoop: false,
      executesWork: false,
      grantsAuthority: false,
      writesProduction: false,
    })
  })

  it("provides an empty state when no governed work is active", () => {
    const surface = getActiveWorkQueueSurface([workOrder("draft"), workOrder("closed")])

    expect(surface.items).toHaveLength(0)
    expect(surface.emptyState.title).toBe("No active governed work")
    expect(surface.emptyState.description).toContain("approved, active, blocked, or review-state")
  })
})
