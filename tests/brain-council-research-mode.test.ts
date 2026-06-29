import { describe, expect, it } from "vitest"
import { getBrainCouncilResearchModeOverview } from "@/components/brain-council/brain-council-research-mode"

describe("Brain Council research mode overview", () => {
  it("summarizes research signals without execution authority", () => {
    const overview = getBrainCouncilResearchModeOverview()

    expect(overview.mode).toBe("RESEARCH_MODE_READ_ONLY")
    expect(overview.signals.map((signal) => signal.id)).toEqual([
      "experiments",
      "predictions",
      "assumptions",
      "unknowns",
    ])
  })

  it("tracks calibration state", () => {
    const overview = getBrainCouncilResearchModeOverview()

    expect(overview.calibration.status).toBe("needs-more-observations")
    expect(overview.calibration.predictionCount).toBe(
      overview.calibration.verifiedCount + overview.calibration.pendingCount,
    )
  })

  it("keeps research mode read-only and non-runtime", () => {
    const overview = getBrainCouncilResearchModeOverview()

    expect(overview.safety).toEqual({
      readOnly: true,
      executesExperiments: false,
      activatesHermes: false,
      schedulesWork: false,
      writesProductionData: false,
    })
  })
})
