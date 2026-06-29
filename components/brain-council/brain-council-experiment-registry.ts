export type BrainCouncilExperimentRecord = {
  id: string
  question: string
  hypothesis: string
  prediction: string
  status: "active" | "pending" | "blocked"
  evidenceCount: number
  decision: string
  architectureAllowed: boolean
}

export type BrainCouncilExperimentRegistry = {
  posture: "EXPERIMENT_REGISTRY_READ_ONLY"
  experiments: BrainCouncilExperimentRecord[]
  emptyState: string
  safety: {
    executesExperiment: false
    changesArchitecture: false
    activatesHermes: false
    writesData: false
  }
}

export function getBrainCouncilExperimentRegistry(): BrainCouncilExperimentRegistry {
  return {
    posture: "EXPERIMENT_REGISTRY_READ_ONLY",
    experiments: [
      {
        id: "EXP-001",
        question: "Does readiness evaluation reduce unsafe advancement decisions?",
        hypothesis: "Explicit authority fields prevent merge/release recommendations without approval.",
        prediction: "Unsafe recommendations remain zero when merge and release authority are false.",
        status: "active",
        evidenceCount: 4,
        decision: "Continue non-runtime evaluation",
        architectureAllowed: false,
      },
      {
        id: "EXP-002",
        question: "Can procedure replay improve repeated PR posture reviews?",
        hypothesis: "Procedure drafts can match operator judgement without runtime authority.",
        prediction: "Procedure replay identifies the same safe next gate in three completed PRs.",
        status: "pending",
        evidenceCount: 2,
        decision: "Collect more observed outcomes",
        architectureAllowed: false,
      },
      {
        id: "EXP-003",
        question: "Can worker packet drafts improve handoff quality?",
        hypothesis: "Packet drafts reduce missing evidence without dispatching workers.",
        prediction: "Draft review catches missing validation and safety posture fields.",
        status: "active",
        evidenceCount: 3,
        decision: "Keep as preview-only",
        architectureAllowed: false,
      },
      {
        id: "EXP-004",
        question: "Is Hermes activation safe to propose?",
        hypothesis: "Activation remains unsafe until sandbox, quarantine, and authority evidence exists.",
        prediction: "Activation readiness rubric remains NOT_READY_FOR_ACTIVATION.",
        status: "blocked",
        evidenceCount: 6,
        decision: "Do not implement runtime",
        architectureAllowed: false,
      },
    ],
    emptyState: "No experiments are registered. Research Mode would remain read-only with no architecture action.",
    safety: {
      executesExperiment: false,
      changesArchitecture: false,
      activatesHermes: false,
      writesData: false,
    },
  }
}
