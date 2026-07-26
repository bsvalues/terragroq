import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const actionSource = readFileSync("app/actions/goal-authority-decision.ts", "utf8")
const panelSource = readFileSync("components/goal-console/goal-timeline-panel.tsx", "utf8")
const viewSource = readFileSync("components/goal-console/goal-console-view.tsx", "utf8")

describe("Goal Console owner authority decision surface", () => {
  it("authenticates and forwards only the fully bound projection request", () => {
    expect(actionSource).toContain("const ownerUserId = await getUserId()")
    expect(actionSource).toContain("const timeline = await getGoalTimeline(submitted.goalId)")
    expect(actionSource).toContain("requestBindingMatches(submitted, current)")
    expect(actionSource).toContain("current.outcomeId")
    expect(actionSource).toContain("current.workOrderId")
    expect(actionSource).toContain("current.terminalEventId")
    expect(actionSource).toContain("ownerUserId,")
    expect(actionSource).toContain("current.expectedNextState")
    expect(actionSource).toContain("recordOwnerAuthorityDecision({")
    expect(actionSource).not.toContain("actor:")
    expect(actionSource).toContain('"RECORDED" | "REPLAYED" | "STALE" | "CONFLICT"')
  })

  it("offers deliberate actions only for an actionable owner wall", () => {
    expect(panelSource).toContain('decisionRequest.status === "ACTIONABLE"')
    expect(panelSource).toContain("Approve resume")
    expect(panelSource).toContain("Deny keep blocked")
    expect(panelSource).toContain('decisionRequest.status === "RECEIPT_RECORDED"')
    expect(panelSource).toContain('decisionRequest.status === "CONFLICTING"')
    expect(viewSource).toContain("recordGoalAuthorityDecision({")
    expect(viewSource).toContain('result.status === "REPLAYED"')
    expect(viewSource).toContain('result.status === "STALE"')
    expect(viewSource).toContain('result.status === "CONFLICT"')
    expect(viewSource).toContain("refreshGoalTimeline(timeline.goal.id)")
  })
})
