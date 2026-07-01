import { describe, expect, it } from "vitest"
import type { WorkOrder } from "@/lib/db/schema"
import { getWorkOrdersCommandSurface } from "@/components/work-orders/work-orders-command-surface"

function workOrder(
  status: WorkOrder["status"],
  evidence: string[] = [],
): WorkOrder {
  return {
    id: 1,
    userId: "user",
    ref: "WO-0001",
    title: "Test work order",
    description: null,
    goal: null,
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
    createdAt: new Date("2026-06-30T00:00:00.000Z"),
    updatedAt: new Date("2026-06-30T00:00:00.000Z"),
  }
}

describe("Work Orders command surface", () => {
  it("summarizes active, ready, blocked, completed, and evidence-required work", () => {
    const surface = getWorkOrdersCommandSurface([
      workOrder("active"),
      workOrder("review", ["build passed"]),
      workOrder("draft"),
      workOrder("proposed"),
      workOrder("blocked"),
      workOrder("closed", ["merged"]),
      workOrder("aborted"),
    ])

    const cards = new Map(surface.cards.map((card) => [card.label, card.value]))

    expect(cards.get("Active Work")).toBe("2")
    expect(cards.get("Ready Next")).toBe("2")
    expect(cards.get("Blocked Decisions")).toBe("1")
    expect(cards.get("Total Completed")).toBe("2")
    expect(cards.get("Evidence Required")).toBe("4")
  })

  it("keeps the next recommended work order focused on evidence", () => {
    const surface = getWorkOrdersCommandSurface([])

    expect(surface.nextRecommendedWo).toMatchObject({
      label: "WO-SHELL-006 - Evidence Surface",
    })
    expect(surface.nextRecommendedWo.reason).toContain("validation")
  })

  it("connects decisions, work orders, evidence, and next move", () => {
    const surface = getWorkOrdersCommandSurface([])

    expect(surface.verificationFlow).toEqual([
      expect.objectContaining({
        label: "Decision",
        value: "Authority first",
        href: "/decisions",
      }),
      expect.objectContaining({
        label: "Work Order",
        value: "Scope locked",
        href: "/work-orders",
      }),
      expect.objectContaining({
        label: "Evidence",
        value: "Proof required",
        href: "/audit",
      }),
      expect.objectContaining({
        label: "Next Move",
        value: "Return Home",
        href: "/",
      }),
    ])
  })

  it("does not execute work, start loops, grant authority, or write production", () => {
    const surface = getWorkOrdersCommandSurface([workOrder("active")])

    expect(surface.safety).toEqual({
      readOnly: true,
      executesWork: false,
      startsLoop: false,
      grantsAuthority: false,
      writesProduction: false,
    })
  })
})
