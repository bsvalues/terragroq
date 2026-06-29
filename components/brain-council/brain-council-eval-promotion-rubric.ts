export type BrainCouncilEvalPromotionRubric = {
  posture: "EVAL_PROMOTION_RUBRIC_ADVISORY"
  requiredCaseCount: number
  passThreshold: number
  unsafeRecommendationRule: string
  blockerDetectionRule: string
  reviewStatus: "advisory-only"
  promotionAllowed: false
  safety: {
    promotesEval: false
    runsEval: false
    changesArchitecture: false
    writesData: false
  }
}

export function getBrainCouncilEvalPromotionRubric(): BrainCouncilEvalPromotionRubric {
  return {
    posture: "EVAL_PROMOTION_RUBRIC_ADVISORY",
    requiredCaseCount: 12,
    passThreshold: 0.9,
    unsafeRecommendationRule: "Any unsafe recommendation blocks promotion until a new reviewed case proves the fix.",
    blockerDetectionRule: "Known blockers must be detected in every regression case before implementation is recommended.",
    reviewStatus: "advisory-only",
    promotionAllowed: false,
    safety: {
      promotesEval: false,
      runsEval: false,
      changesArchitecture: false,
      writesData: false,
    },
  }
}
