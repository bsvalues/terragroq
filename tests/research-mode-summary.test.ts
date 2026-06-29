import { describe, expect, it } from "vitest"
import { getResearchModeHomeSummary } from "@/components/dashboard/research-mode-summary"

describe("Research Mode home summary", () => {
  it("surfaces research mode signals for Operator Home", () => {
    const summary = getResearchModeHomeSummary()
    const labels = summary.items.map((item) => item.label)

    expect(summary.posture).toBe("RESEARCH_MODE_HOME_SUMMARY_READ_ONLY")
    expect(labels).toContain("Open experiments")
    expect(labels).toContain("Cognitive debt")
  })

  it("keeps readiness and Hermes posture visible", () => {
    const summary = getResearchModeHomeSummary()

    expect(summary.readinessRegressionStatus).toBe("PASS")
    expect(summary.hermesStatus).toBe("preview-only")
  })

  it("does not start research, run evals, activate Hermes, or write data", () => {
    const summary = getResearchModeHomeSummary()

    expect(summary.safety).toEqual({
      startsResearch: false,
      runsEval: false,
      activatesHermes: false,
      writesData: false,
    })
  })
})
