import { describe, expect, it } from "vitest"
import type { WorkOrder } from "@/lib/db/schema"

import {
  filterWorkOrders,
  getDistinctWorkOrderFilterValues,
  getWorkOrderFilterOptions,
} from "@/components/work-orders/work-order-search-filter"

function workOrder(overrides: Partial<WorkOrder>): WorkOrder {
  return {
    id: 1,
    userId: "user",
    ref: "WO-0001",
    title: "Verify evidence rollup",
    description: null,
    goal: "Make evidence native",
    loop: null,
    scope: "UI/copy/tests",
    nonGoals: [],
    allowedFiles: [],
    forbiddenFiles: [],
    validators: ["npm test"],
    stopConditions: ["scope expansion"],
    lane: "ui",
    phase: "WOE",
    status: "active",
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
    evidence: ["build passed"],
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
    ...overrides,
  }
}

describe("work order search and filter", () => {
  it("filters by status without mutating orders", () => {
    const active = workOrder({ id: 1, status: "active" })
    const blocked = workOrder({ id: 2, status: "blocked" })

    expect(filterWorkOrders([active, blocked], { query: "", status: "blocked" })).toEqual([blocked])
  })

  it("searches refs, titles, goals, validators, evidence, lanes, and authority", () => {
    const orders = [
      workOrder({ id: 1, ref: "WO-1111", title: "Runtime proof", evidence: ["production ok"] }),
      workOrder({ id: 2, ref: "WO-2222", title: "Auth gate", authorityLevel: "A2_WRITE_OWN" }),
    ]

    expect(filterWorkOrders(orders, { query: "production", status: "all" })).toEqual([orders[0]])
    expect(filterWorkOrders(orders, { query: "A2_WRITE_OWN", status: "all" })).toEqual([orders[1]])
  })

  it("filters by native WOE goal, loop, lane, authority, owner decision, safety posture, and completion state", () => {
    const openReadOnly = workOrder({
      id: 1,
      goal: "GOAL-WOS-002",
      loop: "WILLIAMOS-WOE-INTEGRATION-BATCH-001",
      lane: "woe",
      authorityLevel: "A0_READ_ONLY",
      stopConditions: ["owner decision required before command runner"],
      status: "blocked",
    })
    const completeElevated = workOrder({
      id: 2,
      goal: "GOAL-AUTH-001",
      loop: "AUTH-BATCH",
      lane: "auth",
      authorityLevel: "A2_WRITE_OWN",
      stopConditions: [],
      status: "closed",
      completedAt: new Date("2026-07-02T00:00:00.000Z"),
    })

    const orders = [openReadOnly, completeElevated]

    expect(filterWorkOrders(orders, {
      query: "",
      status: "all",
      goal: "GOAL-WOS-002",
      loop: "WILLIAMOS-WOE-INTEGRATION-BATCH-001",
      lane: "woe",
      authority: "A0_READ_ONLY",
      ownerDecision: "required",
      safetyPosture: "read-only",
      completionState: "open",
    })).toEqual([openReadOnly])

    expect(filterWorkOrders(orders, {
      query: "",
      status: "all",
      ownerDecision: "not-required",
      safetyPosture: "elevated",
      completionState: "complete",
    })).toEqual([completeElevated])
  })

  it("returns distinct read-only filter values for the Work Orders view", () => {
    const orders = [
      workOrder({ id: 1, goal: "GOAL-WOS-002", loop: "BATCH-B", lane: "woe", authorityLevel: "A0_READ_ONLY" }),
      workOrder({ id: 2, goal: "GOAL-WOS-002", loop: "BATCH-A", lane: "shell", authorityLevel: "A0_READ_ONLY" }),
      workOrder({ id: 3, goal: "GOAL-AUTH-001", loop: null, lane: "auth", authorityLevel: "A2_WRITE_OWN" }),
    ]

    expect(getDistinctWorkOrderFilterValues(orders)).toEqual({
      goals: ["GOAL-AUTH-001", "GOAL-WOS-002"],
      loops: ["BATCH-A", "BATCH-B"],
      lanes: ["auth", "shell", "woe"],
      authorities: ["A0_READ_ONLY", "A2_WRITE_OWN"],
    })
  })

  it("exposes all lifecycle statuses plus all", () => {
    expect(getWorkOrderFilterOptions()[0]).toBe("all")
    expect(getWorkOrderFilterOptions()).toContain("blocked")
    expect(getWorkOrderFilterOptions()).toContain("closed")
  })
})
