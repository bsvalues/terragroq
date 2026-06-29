import { describe, expect, it } from "vitest"
import { getBrainCouncilExperimentDashboard } from "@/components/brain-council/brain-council-experiments"

describe("Brain Council experiment dashboard", () => {
  it("summarizes candidate experiments and calibration state", () => {
    const dashboard = getBrainCouncilExperimentDashboard()

    expect(dashboard.summary.total).toBe(3)
    expect(dashboard.summary.readyForReview).toBe(1)
    expect(dashboard.summary.watch).toBe(2)
    expect(dashboard.experiments.every((experiment) => experiment.evidence.length > 0)).toBe(true)
  })

  it("keeps each experiment prediction-based", () => {
    const dashboard = getBrainCouncilExperimentDashboard()

    expect(dashboard.experiments.every((experiment) => experiment.question.endsWith("?"))).toBe(true)
    expect(dashboard.experiments.every((experiment) => experiment.prediction.length > 0)).toBe(true)
    expect(dashboard.experiments.map((experiment) => experiment.calibration)).toEqual([
      "calibrated",
      "needs-more-signal",
      "not-started",
    ])
  })

  it("does not start a scheduler or autonomous runtime", () => {
    const dashboard = getBrainCouncilExperimentDashboard()

    expect(dashboard.safety.readOnly).toBe(true)
    expect(dashboard.safety.wouldExecute).toBe(false)
    expect(dashboard.safety.schedulerEnabled).toBe(false)
    expect(dashboard.safety.autonomyEnabled).toBe(false)
    expect(dashboard.safety.productionWrite).toBe(false)
  })
})
