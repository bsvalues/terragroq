export type BrainCouncilProcedureCandidate = {
  id: string
  repeatedProcedure: string
  candidateSkill: string
  confidence: number
  ratificationStatus: "candidate" | "needs-evidence" | "rejected"
  activationStatus: "inactive"
  evidence: string[]
  blockedUntil: string
}

export type BrainCouncilProcedureCandidateSet = {
  candidates: BrainCouncilProcedureCandidate[]
  summary: {
    total: number
    candidates: number
    needsEvidence: number
    active: number
  }
  safety: {
    readOnly: true
    wouldExecute: false
    activationEnabled: false
    hermesRuntimeEnabled: false
    productionWrite: false
  }
}

const candidates: BrainCouncilProcedureCandidate[] = [
  {
    id: "proc-pr-review",
    repeatedProcedure: "Review PR, inspect checks, classify comments, merge if standing rules pass.",
    candidateSkill: "pr_readiness_reviewer",
    confidence: 0.79,
    ratificationStatus: "candidate",
    activationStatus: "inactive",
    evidence: [
      "Repeated across Brain Council visibility PRs.",
      "Standing merge rules are documented.",
      "Rate-limit reviewer comments are consistently non-blocking when validation is green.",
    ],
    blockedUntil: "Ratified skill card and worker packet boundary exist.",
  },
  {
    id: "proc-post-merge-verify",
    repeatedProcedure: "After merge, verify origin/main, health, and auth readiness.",
    candidateSkill: "post_merge_runtime_verifier",
    confidence: 0.84,
    ratificationStatus: "candidate",
    activationStatus: "inactive",
    evidence: [
      "Used after each merged Brain Council visibility slice.",
      "Health and auth readiness endpoints provide objective evidence.",
      "No mutation is required to perform verification.",
    ],
    blockedUntil: "Operator approves a read-only verification skill for preview use.",
  },
  {
    id: "proc-scope-boundary",
    repeatedProcedure: "Classify whether a proposed UI slice introduces execution, auth, DB, env, or deployment risk.",
    candidateSkill: "scope_boundary_classifier",
    confidence: 0.66,
    ratificationStatus: "needs-evidence",
    activationStatus: "inactive",
    evidence: [
      "Boundary checks are repeated in every WO.",
      "Some classifications still require human judgment.",
      "Risk-changing scope expansion remains an escalation condition.",
    ],
    blockedUntil: "More examples are collected across risky and non-risky changes.",
  },
]

export function getBrainCouncilProcedureCandidates(): BrainCouncilProcedureCandidateSet {
  return {
    candidates,
    summary: {
      total: candidates.length,
      candidates: candidates.filter((candidate) => candidate.ratificationStatus === "candidate").length,
      needsEvidence: candidates.filter((candidate) => candidate.ratificationStatus === "needs-evidence").length,
      active: candidates.filter((candidate) => candidate.activationStatus !== "inactive").length,
    },
    safety: {
      readOnly: true,
      wouldExecute: false,
      activationEnabled: false,
      hermesRuntimeEnabled: false,
      productionWrite: false,
    },
  }
}
