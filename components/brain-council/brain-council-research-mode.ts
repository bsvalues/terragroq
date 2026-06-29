export type BrainCouncilResearchSignal = {
  id: string
  label: string
  status: "open" | "watch" | "ready" | "blocked"
  count: number
  summary: string
}

export type BrainCouncilResearchModeOverview = {
  mode: "RESEARCH_MODE_READ_ONLY"
  question: string
  signals: BrainCouncilResearchSignal[]
  calibration: {
    predictionCount: number
    verifiedCount: number
    pendingCount: number
    status: "needs-more-observations"
  }
  safety: {
    readOnly: true
    executesExperiments: false
    activatesHermes: false
    schedulesWork: false
    writesProductionData: false
  }
}

export function getBrainCouncilResearchModeOverview(): BrainCouncilResearchModeOverview {
  return {
    mode: "RESEARCH_MODE_READ_ONLY",
    question: "What does Brain Council believe, what evidence supports it, and what still needs verification?",
    signals: [
      {
        id: "experiments",
        label: "Experiments",
        status: "open",
        count: 4,
        summary: "Readiness, procedure replay, packet quality, and risk calibration remain tracked as non-runtime experiments.",
      },
      {
        id: "predictions",
        label: "Predictions",
        status: "watch",
        count: 3,
        summary: "Prediction confidence is visible, but calibration needs more observed outcomes.",
      },
      {
        id: "assumptions",
        label: "Assumptions",
        status: "open",
        count: 5,
        summary: "Procedure-first and proposal-only assumptions remain active until challenged by evidence.",
      },
      {
        id: "unknowns",
        label: "Unknowns",
        status: "blocked",
        count: 4,
        summary: "Runtime safety, sandbox proof, skill quarantine, and owner authority are unresolved.",
      },
    ],
    calibration: {
      predictionCount: 3,
      verifiedCount: 1,
      pendingCount: 2,
      status: "needs-more-observations",
    },
    safety: {
      readOnly: true,
      executesExperiments: false,
      activatesHermes: false,
      schedulesWork: false,
      writesProductionData: false,
    },
  }
}
