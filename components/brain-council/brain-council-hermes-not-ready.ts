export type BrainCouncilHermesNotReadyExplanation = {
  posture: "HERMES_NOT_READY_PREVIEW_ONLY"
  missingRuntimeApprovals: string[]
  unresolvedRisks: string[]
  sandboxRequirements: string[]
  skillQuarantineStatus: "quarantined"
  activationRubricResult: "not-ready"
  safety: {
    activatesHermes: false
    changesApprovals: false
    startsScheduler: false
    writesData: false
  }
}

export function getBrainCouncilHermesNotReadyExplanation(): BrainCouncilHermesNotReadyExplanation {
  return {
    posture: "HERMES_NOT_READY_PREVIEW_ONLY",
    missingRuntimeApprovals: [
      "Owner has not authorized Hermes runtime activation.",
      "MCP activation remains denied.",
      "Worker dispatch and scheduler authority remain denied.",
    ],
    unresolvedRisks: [
      "Procedure confidence is not calibrated against enough regression cases.",
      "Sandbox egress review is not proven for candidate outputs.",
      "Skill quarantine has not produced activation evidence.",
    ],
    sandboxRequirements: [
      "No network egress without broker evidence.",
      "No secret exposure in packet input or output.",
      "No file, database, or production mutation capability.",
      "Human-readable denial reason for every blocked action.",
    ],
    skillQuarantineStatus: "quarantined",
    activationRubricResult: "not-ready",
    safety: {
      activatesHermes: false,
      changesApprovals: false,
      startsScheduler: false,
      writesData: false,
    },
  }
}
