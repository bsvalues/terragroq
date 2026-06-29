import { describe, expect, it } from "vitest"
import { getBrainCouncilDecisionQualityDashboard } from "@/components/brain-council/brain-council-decision-quality"

describe("Brain Council decision quality dashboard", () => {
  it("shows decision quality records", () => {
    const dashboard = getBrainCouncilDecisionQualityDashboard()

    expect(dashboard.posture).toBe("DECISION_QUALITY_READ_ONLY")
    expect(dashboard.decisions.map((decision) => decision.id)).toContain("DQ-001")
  })

  it("tracks survival and reversal status", () => {
    const dashboard = getBrainCouncilDecisionQualityDashboard()

    expect(dashboard.decisions.every((decision) => decision.survivalDays >= 0)).toBe(true)
    expect(dashboard.decisions.every((decision) => typeof decision.reversed === "boolean")).toBe(true)
  })

  it("does not mutate decisions or lessons", () => {
    const dashboard = getBrainCouncilDecisionQualityDashboard()

    expect(dashboard.safety).toEqual({
      changesDecision: false,
      startsReview: false,
      writesLessons: false,
      mutatesData: false,
    })
  })
})
