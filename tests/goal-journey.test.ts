import { describe, expect, it } from "vitest"
import { getGoalJourneyStep } from "@/components/goal-console/goal-journey"

describe("goal journey continuity", () => {
  it("routes allowed classified goals toward draft work orders", () => {
    expect(getGoalJourneyStep({ status: "classified", verdict: "allow" })).toMatchObject({
      label: "Ready for work order",
      action: "Draft work order",
    })
  })

  it("keeps approval-gated goals in authority review language", () => {
    expect(getGoalJourneyStep({ status: "classified", verdict: "requires_approval" })).toMatchObject({
      label: "Approval-gated",
      action: "Draft gated work order",
    })
  })

  it("routes refused goals to safe alternatives instead of execution", () => {
    expect(getGoalJourneyStep({ status: "classified", verdict: "refuse" })).toMatchObject({
      label: "Safe alternative required",
      action: "Rewrite objective",
    })
  })

  it("routes converted goals to work order review", () => {
    expect(getGoalJourneyStep({ status: "converted", verdict: "allow", linkedWorkOrderId: 7 })).toMatchObject({
      label: "Work order drafted",
      action: "Review drafted work order",
    })
  })
})
