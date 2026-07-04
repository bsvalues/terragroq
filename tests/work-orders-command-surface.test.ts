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
    expect(cards.get("Local Phase Complete")).toBe("Stable")
    expect(cards.get("Next Batch")).toBe("Shell / WOE")
  })

  it("keeps the next recommended batch focused on Work Order detail surfaces", () => {
    const surface = getWorkOrdersCommandSurface([])

    expect(surface.nextRecommendedWo).toMatchObject({
      label: "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
    })
    expect(surface.nextRecommendedWo.reason).toContain("Work Order detail surfaces")
    expect(surface.completedPhase.label).toBe("Local OMEN Phase 1")
    expect(surface.nextBatch.label).toBe("WILLIAMOS-SHELL-WOE-RESUME-BATCH-001")
    expect(surface.blockedDecisions.map((item) => item.label)).toContain("Metadata expansion")
  })

  it("connects decisions, work orders, evidence, and next move", () => {
    const surface = getWorkOrdersCommandSurface([])

    expect(surface.verificationFlow).toEqual([
      expect.objectContaining({
        label: "Decision",
        value: "Authority call",
        href: "/decisions",
      }),
      expect.objectContaining({
        label: "Work Order",
        value: "Mutation contract",
        href: "/work-orders",
      }),
      expect.objectContaining({
        label: "Evidence",
        value: "Proof required",
        href: "/audit",
      }),
      expect.objectContaining({
        label: "Next Move",
        value: "Safe continuation",
        href: "/",
      }),
    ])
  })

  it("does not mutate work orders, execute work, start loops, grant authority, or write production", () => {
    const surface = getWorkOrdersCommandSurface([workOrder("active")])

    expect(surface.safety).toEqual({
      readOnly: true,
      executesWork: false,
      mutatesWorkOrders: false,
      startsLoop: false,
      startsScheduler: false,
      grantsAuthority: false,
      approvesWork: false,
      changesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
  })

  it("frames Work Orders as governed mutation control, not task management", () => {
    const surface = getWorkOrdersCommandSurface([])
    const text = [
      surface.title,
      surface.eyebrow,
      surface.description,
      ...surface.verificationFlow.flatMap((step) => [
        step.label,
        step.value,
        step.description,
      ]),
      ...surface.cards.flatMap((card) => [card.label, card.value, card.description]),
      surface.nextRecommendedWo.label,
      surface.nextRecommendedWo.reason,
    ].join(" ")

    expect(text).toContain("native WilliamOS control primitive")
    expect(text.toLowerCase()).toContain("mutation control")
    expect(text).toContain("authority gates")
    expect(text).not.toMatch(
      /task board|kanban|project management|tickets|productivity pipeline|team queue|sprint|one-click execute|auto-run/i,
    )
  })
})
