export type BrainCouncilContradictionRecord = {
  id: string
  subject: string
  sideA: string
  sideB: string
  severity: "medium" | "high"
  resolutionPath: string
  status: "open" | "resolved"
}

export type BrainCouncilContradictionReview = {
  posture: "CONTRADICTION_REVIEW_READ_ONLY"
  contradictions: BrainCouncilContradictionRecord[]
  safety: {
    resolvesContradiction: false
    changesBelief: false
    changesPolicy: false
    mutatesData: false
  }
}

export function getBrainCouncilContradictionReview(): BrainCouncilContradictionReview {
  return {
    posture: "CONTRADICTION_REVIEW_READ_ONLY",
    contradictions: [
      {
        id: "CON-001",
        subject: "Hermes usefulness versus Hermes activation safety",
        sideA: "Hermes can improve repeated workflows when proposal-only.",
        sideB: "Hermes must remain inactive until sandbox, quarantine, and owner authority are proven.",
        severity: "high",
        resolutionPath: "Keep usefulness experiments separate from activation readiness.",
        status: "open",
      },
      {
        id: "CON-002",
        subject: "Procedure candidates versus executable skills",
        sideA: "Procedure candidates may improve operator handoffs.",
        sideB: "Skill execution is blocked until ratification plus activation ledger evidence exists.",
        severity: "medium",
        resolutionPath: "Promote only after repeated success, risk classification, and separate activation review.",
        status: "open",
      },
      {
        id: "CON-003",
        subject: "Readiness confidence versus limited sample size",
        sideA: "Readiness evaluation currently appears useful.",
        sideB: "Observed sample size is too small for architecture changes.",
        severity: "medium",
        resolutionPath: "Add regression cases before changing architecture.",
        status: "resolved",
      },
    ],
    safety: {
      resolvesContradiction: false,
      changesBelief: false,
      changesPolicy: false,
      mutatesData: false,
    },
  }
}
