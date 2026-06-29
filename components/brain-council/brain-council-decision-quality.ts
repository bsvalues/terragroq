export type BrainCouncilDecisionQualityRecord = {
  id: string
  linkedExperiment: string
  decision: string
  survivalDays: number
  reversed: boolean
  reviewDate: string
  lesson: string
}

export type BrainCouncilDecisionQualityDashboard = {
  posture: "DECISION_QUALITY_READ_ONLY"
  decisions: BrainCouncilDecisionQualityRecord[]
  safety: {
    changesDecision: false
    startsReview: false
    writesLessons: false
    mutatesData: false
  }
}

export function getBrainCouncilDecisionQualityDashboard(): BrainCouncilDecisionQualityDashboard {
  return {
    posture: "DECISION_QUALITY_READ_ONLY",
    decisions: [
      {
        id: "DQ-001",
        linkedExperiment: "EXP-001",
        decision: "Keep readiness evaluation preview-only until unsafe recommendation rate is proven.",
        survivalDays: 2,
        reversed: false,
        reviewDate: "2026-07-07",
        lesson: "Explicit authority flags are useful even before automation exists.",
      },
      {
        id: "DQ-002",
        linkedExperiment: "EXP-004",
        decision: "Block Hermes runtime activation while sandbox and quarantine evidence are missing.",
        survivalDays: 1,
        reversed: false,
        reviewDate: "2026-07-07",
        lesson: "Activation readiness should be visible before activation is discussed.",
      },
      {
        id: "DQ-003",
        linkedExperiment: "EXP-002",
        decision: "Use procedure replay as research evidence, not skill execution.",
        survivalDays: 1,
        reversed: false,
        reviewDate: "2026-07-14",
        lesson: "Procedure candidates need repeated outcomes before ratification.",
      },
    ],
    safety: {
      changesDecision: false,
      startsReview: false,
      writesLessons: false,
      mutatesData: false,
    },
  }
}
