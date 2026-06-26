// WO-016 — Agent Claim Ingestion Rules (pure logic).
//
// Agent output is UNTRUSTED until verified. A claim never updates Current Truth
// directly. This module classifies a claim deterministically and produces the
// verification questions WilliamOS must ask before believing it.

export const CLAIM_CLASSIFICATIONS = [
  "SELF_REPORTED",
  "EVIDENCE_BACKED",
  "UNSUPPORTED",
  "CONFLICTING",
  "REQUIRES_VERIFICATION",
] as const
export type ClaimClassification = (typeof CLAIM_CLASSIFICATIONS)[number]

// Strong success assertions that demand evidence before they may be believed.
const ASSERTION_SIGNALS = [
  "all tests passed",
  "tests passed",
  "tests pass",
  "passing",
  "all green",
  "done",
  "complete",
  "completed",
  "it works",
  "works now",
  "fixed",
  "deployed",
  "shipped",
  "success",
  "ready for production",
  "production ready",
]

export interface ClassifyClaimInput {
  claim: string
  // True when the claim is tied to an evidence record OR carries command + head + repo.
  hasEvidence?: boolean
  // Set when the claim is known to contradict an existing truth/record.
  contradicts?: boolean
}

export interface ClaimClassificationResult {
  classification: ClaimClassification
  // Questions WilliamOS must resolve before the claim can become truth.
  questions: string[]
  canUpdateTruth: false // always false — claims never directly update truth
  reason: string
}

const VERIFICATION_QUESTIONS = [
  "What exact command was run?",
  "Which repository?",
  "Which branch?",
  "What HEAD commit?",
  "Where is the command output / evidence?",
  "What was NOT tested or covered?",
]

export function classifyAgentClaim(input: ClassifyClaimInput): ClaimClassificationResult {
  const text = (input.claim ?? "").toLowerCase()
  const asserts = ASSERTION_SIGNALS.some((s) => text.includes(s))

  if (input.contradicts) {
    return {
      classification: "CONFLICTING",
      questions: VERIFICATION_QUESTIONS,
      canUpdateTruth: false,
      reason: "Claim contradicts existing truth/record — a conflict must be registered and resolved.",
    }
  }
  if (input.hasEvidence) {
    return {
      classification: "EVIDENCE_BACKED",
      questions: [],
      canUpdateTruth: false,
      reason: "Claim is backed by evidence; still ingested as a claim, not auto-promoted to truth.",
    }
  }
  if (asserts) {
    return {
      classification: "UNSUPPORTED",
      questions: VERIFICATION_QUESTIONS,
      canUpdateTruth: false,
      reason: "Strong success assertion with no evidence attached — marked unsupported.",
    }
  }
  return {
    classification: "SELF_REPORTED",
    questions: VERIFICATION_QUESTIONS,
    canUpdateTruth: false,
    reason: "Self-reported statement; requires verification before it can inform truth.",
  }
}
