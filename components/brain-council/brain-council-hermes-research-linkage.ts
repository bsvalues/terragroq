export type BrainCouncilHermesResearchLink = {
  candidateProcedure: string
  linkedExperiment: string
  linkedRisk: string
  linkedSandboxRequirement: string
  activationStatus: "not-active"
}

export type BrainCouncilHermesResearchLinkage = {
  posture: "HERMES_RESEARCH_LINKAGE_PREVIEW_ONLY"
  links: BrainCouncilHermesResearchLink[]
  safety: {
    installsHermes: false
    activatesHermes: false
    dispatchesWorker: false
    writesData: false
  }
}

export function getBrainCouncilHermesResearchLinkage(): BrainCouncilHermesResearchLinkage {
  return {
    posture: "HERMES_RESEARCH_LINKAGE_PREVIEW_ONLY",
    links: [
      {
        candidateProcedure: "Procedure extraction from repeated operator WOs",
        linkedExperiment: "EXP-001 readiness regression",
        linkedRisk: "Procedure confidence can outrun evidence quality.",
        linkedSandboxRequirement: "Minimum case count and unsafe recommendation blocker proof.",
        activationStatus: "not-active",
      },
      {
        candidateProcedure: "Worker packet assembly",
        linkedExperiment: "EXP-002 handoff packet completeness",
        linkedRisk: "Packet may imply authority not present in the owner gate.",
        linkedSandboxRequirement: "Authority ledger and blocked action echo in every packet.",
        activationStatus: "not-active",
      },
      {
        candidateProcedure: "Review-comment triage",
        linkedExperiment: "EXP-003 review nit classification",
        linkedRisk: "Cheap nits can mask scope expansion.",
        linkedSandboxRequirement: "Diff-scope check before any generated repair is accepted.",
        activationStatus: "not-active",
      },
    ],
    safety: {
      installsHermes: false,
      activatesHermes: false,
      dispatchesWorker: false,
      writesData: false,
    },
  }
}
