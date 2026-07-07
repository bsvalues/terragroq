import { describe, expect, it } from "vitest"
import type { WorkOrder } from "@/lib/db/schema"

import { getCompletionReportSurface } from "@/components/work-orders/completion-report-surface"

function workOrder(status: WorkOrder["status"], result: WorkOrder["result"] = null): WorkOrder {
  return {
    id: 1,
    userId: "user",
    ref: "WO-0001",
    title: "Close native loop",
    description: null,
    goal: "Make /loop native",
    loop: null,
    scope: "UI/copy/tests",
    nonGoals: [],
    allowedFiles: ["components/work-orders/*"],
    forbiddenFiles: ["lib/db/schema.ts"],
    validators: ["npm test -- --run"],
    stopConditions: ["scope expansion"],
    lane: "ui",
    phase: "WOE",
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
    evidence: ["tests passed"],
    result,
    commitRef: "abc123",
    tagRef: null,
    commitAllowed: true,
    tagAllowed: false,
    pushAllowed: false,
    supersedesId: null,
    supersededById: null,
    dueAt: null,
    closedAt: new Date("2026-07-01T00:00:00.000Z"),
    completedAt: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  }
}

describe("completion report surface", () => {
  it("renders reports for closed and aborted Work Orders only", () => {
    const surface = getCompletionReportSurface([
      workOrder("active"),
      workOrder("closed", "PASS"),
      workOrder("aborted", "PARTIAL"),
    ])

    expect(surface.items).toHaveLength(2)
    expect(surface.items.map((item) => item.status)).toEqual(["closed", "aborted"])
  })

  it("uses the lifecycle closure report format", () => {
    const surface = getCompletionReportSurface([workOrder("closed", "PASS")])

    expect(surface.items[0]?.report).toContain("RESULT: PASS")
    expect(surface.items[0]?.report).toContain("WORK ORDER: WO-0001")
    expect(surface.items[0]?.report).toContain("VALIDATORS:")
    expect(surface.items[0]?.report).toContain("EVIDENCE:")
  })

  it("does not record results, change gates, close work orders, or write production", () => {
    const surface = getCompletionReportSurface([])

    expect(surface.emptyState.title).toBe("No completion reports yet")
    expect(surface.description).toContain("proof packets")
    expect(surface.emptyState.description).toContain("before the next governed move")
    expect(surface.safety).toEqual({
      readOnly: true,
      recordsResult: false,
      changesGates: false,
      closesWorkOrder: false,
      writesProduction: false,
    })
  })
})
