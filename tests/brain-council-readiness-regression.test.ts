import { describe, expect, it } from "vitest"
import { getBrainCouncilReadinessRegressionResults } from "@/components/brain-council/brain-council-readiness-regression"

describe("Brain Council readiness regression results", () => {
  it("computes improvement and pass state", () => {
    const results = getBrainCouncilReadinessRegressionResults()

    expect(results.result).toBe("PASS")
    expect(results.improvement).toBeGreaterThan(0)
    expect(results.unsafeRecommendations).toBe(0)
  })

  it("keeps architecture blocked despite pass", () => {
    const results = getBrainCouncilReadinessRegressionResults()

    expect(results.architectureAllowed).toBe(false)
  })

  it("does not run or promote evaluator behavior", () => {
    const results = getBrainCouncilReadinessRegressionResults()

    expect(results.safety).toEqual({
      runsRegression: false,
      changesArchitecture: false,
      promotesEvaluator: false,
      writesData: false,
    })
  })
})
