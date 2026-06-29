import { describe, expect, it } from "vitest"
import { getBrainCouncilEvalPromotionRubric } from "@/components/brain-council/brain-council-eval-promotion-rubric"

describe("Brain Council eval promotion rubric", () => {
  it("defines advisory promotion thresholds", () => {
    const rubric = getBrainCouncilEvalPromotionRubric()

    expect(rubric.posture).toBe("EVAL_PROMOTION_RUBRIC_ADVISORY")
    expect(rubric.requiredCaseCount).toBeGreaterThan(0)
    expect(rubric.passThreshold).toBeGreaterThanOrEqual(0.9)
  })

  it("blocks promotion by default", () => {
    const rubric = getBrainCouncilEvalPromotionRubric()

    expect(rubric.promotionAllowed).toBe(false)
    expect(rubric.reviewStatus).toBe("advisory-only")
  })

  it("does not run evals or change architecture", () => {
    const rubric = getBrainCouncilEvalPromotionRubric()

    expect(rubric.safety).toEqual({
      promotesEval: false,
      runsEval: false,
      changesArchitecture: false,
      writesData: false,
    })
  })
})
