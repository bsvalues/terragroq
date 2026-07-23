import { describe, expect, it } from "vitest"
import type { WorkOrder } from "@/lib/db/schema"

import {
  getActiveWorkQueueSurface,
  WORK_ORDER_BRIEFING_LIMIT,
} from "@/components/work-orders/active-work-queue"

function workOrder(
  id: number,
  status: WorkOrder["status"],
  overrides: Partial<WorkOrder> = {},
): WorkOrder {
  return {
    id,
    userId: "user",
    ref: `WO-${String(id).padStart(4, "0")}`,
    title: `Work Order ${id}`,
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
    evidence: [],
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
    createdAt: new Date(`2026-07-${String(id).padStart(2, "0")}T00:00:00.000Z`),
    updatedAt: new Date(`2026-07-${String(id).padStart(2, "0")}T00:00:00.000Z`),
    ...overrides,
  }
}

describe("Work Orders Hermes delivery radar", () => {
  it("separates current motion from explicit failures without relabeling blocked or aborted work", () => {
    const surface = getActiveWorkQueueSurface([
      workOrder(1, "active"),
      workOrder(2, "review", { evidence: ["independent review opened"] }),
      workOrder(3, "approved"),
      workOrder(4, "blocked"),
      workOrder(5, "closed", {
        result: "FAIL",
        completedAt: new Date("2026-07-08T00:00:00.000Z"),
        updatedAt: new Date("2026-07-09T00:00:00.000Z"),
        evidence: ["validation failure"],
      }),
      workOrder(6, "aborted", { result: "PARTIAL" }),
      workOrder(7, "active", { result: " fail " }),
    ])

    expect(surface.moving.items.map((item) => item.ref)).toEqual([
      "WO-0002",
      "WO-0001",
    ])
    expect(surface.failed.items.map((item) => item.ref)).toEqual([
      "WO-0005",
      "WO-0007",
    ])
    expect(surface.failed.items.every((item) => item.result === "FAIL")).toBe(true)
    expect(surface.failed.items.map((item) => item.ref)).not.toContain("WO-0004")
    expect(surface.failed.items.map((item) => item.ref)).not.toContain("WO-0006")
  })

  it("orders Hermes-next guidance by recovery and delivery priority", () => {
    const surface = getActiveWorkQueueSurface([
      workOrder(1, "approved"),
      workOrder(2, "active"),
      workOrder(3, "review"),
      workOrder(4, "blocked", {
        stopConditions: ["Reservation ownership is ambiguous."],
      }),
      workOrder(5, "active", { result: "FAIL" }),
    ])

    expect(surface.hermesNext.count).toBe(5)
    expect(surface.hermesNext.items.map((item) => item.ref)).toEqual([
      "WO-0005",
      "WO-0004",
      "WO-0003",
      "WO-0002",
    ])
    expect(surface.hermesNext.items.map((item) => item.action)).toEqual([
      "Route bounded recovery",
      "Recover or keep held",
      "Complete independent review",
      "Continue bounded delivery",
    ])
    expect(surface.hermesNext.items[1]?.detail).toContain(
      "Reservation ownership is ambiguous.",
    )
    expect(surface.hermesNext.items.map((item) => item.ref)).not.toContain("WO-0001")
  })

  it("does not relabel an ordinary Work Order description as a stop boundary", () => {
    const surface = getActiveWorkQueueSurface([
      workOrder(1, "blocked", {
        description: "Refresh the owner-facing delivery summary.",
      }),
      workOrder(2, "closed", {
        description: "Focused validation did not complete.",
        result: "FAIL",
      }),
    ])

    expect(surface.hermesNext.items[0]?.detail).toBe(
      "Hermes will recover, reroute, or keep this lane held without turning an operational wall into owner work.",
    )
    expect(surface.hermesNext.items[0]?.detail).not.toContain(
      "Refresh the owner-facing delivery summary.",
    )
    expect(surface.failed.items[0]?.detail).toBe(
      "Recorded Work Order context: Focused validation did not complete.",
    )
  })

  it("preserves complete counts while bounding each displayed lane", () => {
    const moving = Array.from({ length: WORK_ORDER_BRIEFING_LIMIT + 1 }, (_, index) =>
      workOrder(index + 1, "active"),
    )
    const failed = Array.from({ length: WORK_ORDER_BRIEFING_LIMIT + 1 }, (_, index) =>
      workOrder(index + 11, "closed", { result: "FAIL" }),
    )

    const surface = getActiveWorkQueueSurface([...moving, ...failed])

    expect(surface.moving.count).toBe(5)
    expect(surface.moving.items).toHaveLength(WORK_ORDER_BRIEFING_LIMIT)
    expect(surface.moving.items.map((item) => item.ref)).toEqual([
      "WO-0005",
      "WO-0004",
      "WO-0003",
      "WO-0002",
    ])
    expect(surface.failed.count).toBe(5)
    expect(surface.failed.items).toHaveLength(WORK_ORDER_BRIEFING_LIMIT)
    expect(surface.hermesNext.count).toBe(5)
    expect(surface.hermesNext.items).toHaveLength(WORK_ORDER_BRIEFING_LIMIT)
  })

  it("keeps a newly recorded terminal failure inside the bounded briefing", () => {
    const surface = getActiveWorkQueueSurface([
      workOrder(1, "closed", {
        result: "FAIL",
        completedAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-08T00:00:00.000Z"),
      }),
      workOrder(2, "closed", {
        result: "FAIL",
        completedAt: new Date("2026-07-09T00:00:00.000Z"),
        updatedAt: new Date("2026-07-10T00:00:00.000Z"),
      }),
      workOrder(3, "closed", {
        result: "FAIL",
        completedAt: new Date("2026-07-11T00:00:00.000Z"),
        updatedAt: new Date("2026-07-12T00:00:00.000Z"),
      }),
      workOrder(4, "closed", {
        result: "FAIL",
        completedAt: new Date("2026-07-13T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T00:00:00.000Z"),
      }),
      workOrder(5, "closed", {
        result: "FAIL",
        completedAt: new Date("2026-07-06T00:00:00.000Z"),
        updatedAt: new Date("2026-07-20T00:00:00.000Z"),
      }),
    ])

    expect(surface.failed.count).toBe(5)
    expect(surface.failed.items.map((item) => item.ref)).toEqual([
      "WO-0005",
      "WO-0004",
      "WO-0003",
      "WO-0002",
    ])
  })

  it("provides independent empty states when no recorded work fits a lane", () => {
    const surface = getActiveWorkQueueSurface([
      workOrder(1, "draft"),
      workOrder(2, "proposed"),
      workOrder(3, "closed", { result: "PASS" }),
      workOrder(4, "aborted", { result: "PARTIAL" }),
    ])

    expect(surface.moving).toMatchObject({
      count: 0,
      items: [],
      emptyState: "No Work Order is active or in review.",
    })
    expect(surface.failed).toMatchObject({
      count: 0,
      items: [],
      emptyState: "No explicit Work Order failure is recorded.",
    })
    expect(surface.hermesNext).toMatchObject({
      count: 0,
      items: [],
      emptyState:
        "Hermes has no authorized Work Order to advance and will not invent or launch work.",
    })
  })

  it("does not mutate input or claim live worker telemetry and exposes no execution controls", () => {
    const orders = [
      workOrder(1, "active"),
      workOrder(2, "review"),
    ]
    const originalOrder = orders.map((order) => order.id)
    const surface = getActiveWorkQueueSurface(orders)

    expect(orders.map((order) => order.id)).toEqual(originalOrder)
    expect(surface.sourceNote).toContain("not live worker telemetry")
    expect(surface.safety).toEqual({
      readOnly: true,
      startsLoop: false,
      executesWork: false,
      grantsAuthority: false,
      startsScheduler: false,
      startsBackgroundLoop: false,
      writesProduction: false,
      claimsLiveWorkerTelemetry: false,
    })
  })
})
