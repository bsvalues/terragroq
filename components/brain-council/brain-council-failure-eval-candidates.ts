export type BrainCouncilFailureEvalCandidate = {
  id: string
  failureSource: string
  failedBehavior: string
  proposedEval: string
  priority: "low" | "medium" | "high"
  status: "candidate" | "needs-evidence" | "blocked"
  safeToPromote: false
}

export type BrainCouncilFailureEvalCandidateViewer = {
  posture: "FAILURE_TO_EVAL_CANDIDATES_READ_ONLY"
  candidates: BrainCouncilFailureEvalCandidate[]
  safety: {
    createsEval: false
    promotesEval: false
    runsEval: false
    mutatesData: false
  }
}

export function getBrainCouncilFailureEvalCandidates(): BrainCouncilFailureEvalCandidateViewer {
  return {
    posture: "FAILURE_TO_EVAL_CANDIDATES_READ_ONLY",
    candidates: [
      {
        id: "FE-001",
        failureSource: "PR review nit",
        failedBehavior: "Panel copy drifted from the safety flags it was supposed to explain.",
        proposedEval: "Detect UI copy that restates safety posture without matching the underlying contract.",
        priority: "medium",
        status: "candidate",
        safeToPromote: false,
      },
      {
        id: "FE-002",
        failureSource: "Readiness regression sample",
        failedBehavior: "Limited case count can overstate confidence in evaluator readiness.",
        proposedEval: "Require minimum case-count blockers before any architecture recommendation can be allowed.",
        priority: "high",
        status: "needs-evidence",
        safeToPromote: false,
      },
      {
        id: "FE-003",
        failureSource: "Hermes sandbox boundary",
        failedBehavior: "A sandbox output could be imported without egress review evidence.",
        proposedEval: "Reject Hermes candidates missing broker review, secret scan, and mutation-block proof.",
        priority: "high",
        status: "blocked",
        safeToPromote: false,
      },
    ],
    safety: {
      createsEval: false,
      promotesEval: false,
      runsEval: false,
      mutatesData: false,
    },
  }
}
