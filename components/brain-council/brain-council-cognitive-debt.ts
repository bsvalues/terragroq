export type BrainCouncilCognitiveDebtItem = {
  id: string
  label: string
  count: number
  severity: "low" | "medium" | "high"
  reason: string
}

export type BrainCouncilCognitiveDebtDashboard = {
  posture: "COGNITIVE_DEBT_READ_ONLY"
  items: BrainCouncilCognitiveDebtItem[]
  safety: {
    resolvesDebt: false
    updatesMemory: false
    changesPolicy: false
    mutatesData: false
  }
}

export function getBrainCouncilCognitiveDebtDashboard(): BrainCouncilCognitiveDebtDashboard {
  return {
    posture: "COGNITIVE_DEBT_READ_ONLY",
    items: [
      { id: "unreviewed-assumptions", label: "Unreviewed assumptions", count: 2, severity: "medium", reason: "Some active assumptions have weak evidence or review-needed status." },
      { id: "stale-memories", label: "Stale memories", count: 1, severity: "low", reason: "Procedure memory candidates need scheduled review before promotion." },
      { id: "old-experiments", label: "Old experiments", count: 1, severity: "medium", reason: "Readiness regression needs more observed cases before architecture decisions." },
      { id: "conflicting-policies", label: "Conflicting policies", count: 1, severity: "high", reason: "Procedure generation and skill generation boundaries must remain distinct." },
      { id: "outdated-skills", label: "Outdated skills", count: 103, severity: "high", reason: "Carried-forward skills are provenance-only and not invokable." },
      { id: "open-contradictions", label: "Open contradictions", count: 1, severity: "medium", reason: "Hermes usefulness and Hermes activation safety remain separate claims." },
    ],
    safety: {
      resolvesDebt: false,
      updatesMemory: false,
      changesPolicy: false,
      mutatesData: false,
    },
  }
}
