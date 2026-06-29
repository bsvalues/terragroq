export type HermesQuarantinedSkill = {
  id: string
  label: string
  source: string
  quarantineReason: string
  reviewRequired: string[]
  status: "quarantined" | "provenance-only"
}

export type HermesSkillQuarantinePreview = {
  posture: "SKILL_QUARANTINE_PREVIEW_ONLY"
  skills: HermesQuarantinedSkill[]
  quarantineRule: string
  safety: {
    invokesSkill: false
    canonizesSkill: false
    promotesMemory: false
    importsSandboxOutput: false
    grantsRuntime: false
  }
}

export function getHermesSkillQuarantinePreview(): HermesSkillQuarantinePreview {
  return {
    posture: "SKILL_QUARANTINE_PREVIEW_ONLY",
    quarantineRule:
      "Skill-like outputs remain quarantined until provenance, risk, repeated-success evidence, ratification, broker review, and activation ledger requirements are satisfied.",
    skills: [
      {
        id: "pr-posture-check",
        label: "PR posture check",
        source: "brain-memory/procedures/pr-posture-review.meta.json",
        quarantineReason: "Linked from a procedure candidate, not an invokable skill.",
        reviewRequired: ["procedure replay evidence", "false-positive review", "ratification record"],
        status: "quarantined",
      },
      {
        id: "worker-packet-drafter",
        label: "Worker packet drafter",
        source: "broker/broker-policy.json",
        quarantineReason: "Draft packets are allowed egress only after review; they cannot dispatch workers.",
        reviewRequired: ["broker review", "secret scan", "blocked-egress scan"],
        status: "quarantined",
      },
      {
        id: "carried-forward-skills",
        label: "Carried-forward skills",
        source: "reports/assurance-report.json",
        quarantineReason: "103 carried-forward skills are provenance-only and not invokable.",
        reviewRequired: ["provenance check", "risk classification", "fresh ratification"],
        status: "provenance-only",
      },
    ],
    safety: {
      invokesSkill: false,
      canonizesSkill: false,
      promotesMemory: false,
      importsSandboxOutput: false,
      grantsRuntime: false,
    },
  }
}

export function getHermesSkillQuarantineSafetySummary(
  safety: HermesSkillQuarantinePreview["safety"],
): string {
  return Object.entries(safety)
    .filter(([, enabled]) => enabled === false)
    .map(([flag]) => flag.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`))
    .join(", ")
}
