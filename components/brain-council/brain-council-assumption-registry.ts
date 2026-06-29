export type BrainCouncilAssumptionRecord = {
  id: string
  assumption: string
  confidence: number
  evidenceStrength: "weak" | "medium" | "strong"
  linkedQuestion: string
  linkedExperiment: string
  reviewDate: string
  status: "active" | "challenged" | "retired"
  reviewNeeded: boolean
}

export type BrainCouncilAssumptionRegistry = {
  posture: "ASSUMPTION_REGISTRY_READ_ONLY"
  assumptions: BrainCouncilAssumptionRecord[]
  safety: {
    changesBeliefs: false
    retiresAssumptions: false
    promotesMemory: false
    writesData: false
  }
}

export function getBrainCouncilAssumptionRegistry(): BrainCouncilAssumptionRegistry {
  return {
    posture: "ASSUMPTION_REGISTRY_READ_ONLY",
    assumptions: [
      {
        id: "ASM-001",
        assumption: "Hermes can improve repeated workflows when proposal-only and governed by Forge.",
        confidence: 61,
        evidenceStrength: "weak",
        linkedQuestion: "Q-001",
        linkedExperiment: "EXP-002",
        reviewDate: "2026-07-27",
        status: "active",
        reviewNeeded: true,
      },
      {
        id: "ASM-002",
        assumption: "Hermes should generate procedures first; skills only after repeated success.",
        confidence: 74,
        evidenceStrength: "medium",
        linkedQuestion: "Q-001",
        linkedExperiment: "EXP-002",
        reviewDate: "2026-07-27",
        status: "active",
        reviewNeeded: false,
      },
      {
        id: "ASM-003",
        assumption: "No Hermes skill generation should occur before quarantine and sandbox proof.",
        confidence: 82,
        evidenceStrength: "medium",
        linkedQuestion: "Q-002",
        linkedExperiment: "EXP-004",
        reviewDate: "2026-07-27",
        status: "challenged",
        reviewNeeded: true,
      },
    ],
    safety: {
      changesBeliefs: false,
      retiresAssumptions: false,
      promotesMemory: false,
      writesData: false,
    },
  }
}
