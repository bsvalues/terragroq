import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"

export type BrainCouncilReadinessCheck = {
  id: string
  label: string
  status: "pass" | "partial" | "fail"
  summary: string
}

export type BrainCouncilReadinessEvaluation = {
  verdict: "SAFE_FOR_OPERATOR_REVIEW" | "NEEDS_MORE_EVIDENCE" | "BLOCKED"
  confidence: number
  checks: BrainCouncilReadinessCheck[]
  nextGate: string
  blockedActions: string[]
  safety: {
    readOnly: true
    wouldExecute: false
    autonomyEnabled: false
    mcpActivation: false
    productionWrite: false
  }
}

export function getBrainCouncilReadinessEvaluation(): BrainCouncilReadinessEvaluation {
  const packet = getBrainCouncilReasoningPacket()

  const checks: BrainCouncilReadinessCheck[] = [
    {
      id: "question",
      label: "Question framed",
      status: packet.question.trim().length > 0 ? "pass" : "fail",
      summary: "The operator-facing question is explicit enough to anchor reasoning.",
    },
    {
      id: "evidence",
      label: "Evidence attached",
      status: packet.evidence.length >= 3 ? "pass" : packet.evidence.length > 0 ? "partial" : "fail",
      summary: `${packet.evidence.length} evidence records are available for the packet.`,
    },
    {
      id: "unknowns",
      label: "Unknowns declared",
      status: packet.unknowns.length >= 2 ? "pass" : packet.unknowns.length > 0 ? "partial" : "fail",
      summary: `${packet.unknowns.length} unresolved questions are visible before action.`,
    },
    {
      id: "hypotheses",
      label: "Alternatives compared",
      status: packet.hypotheses.length >= 3 ? "pass" : packet.hypotheses.length > 1 ? "partial" : "fail",
      summary: `${packet.hypotheses.length} hypotheses are ranked with confidence.`,
    },
    {
      id: "verification",
      label: "Verification required",
      status: packet.decisionPacket.requiredVerification.length > 0 ? "pass" : "fail",
      summary: "The decision packet states what must be checked before follow-on work.",
    },
    {
      id: "safety",
      label: "Runtime boundary intact",
      status:
        packet.safety.readOnly &&
        !packet.safety.wouldExecute &&
        !packet.safety.autonomyEnabled &&
        !packet.safety.mcpActivation &&
        !packet.safety.productionWrite
          ? "pass"
          : "fail",
      summary: "Brain Council remains preview-only and cannot run workers or write production data.",
    },
  ]

  const hasFailure = checks.some((check) => check.status === "fail")
  const hasPartial = checks.some((check) => check.status === "partial")

  return {
    verdict: hasFailure ? "BLOCKED" : hasPartial ? "NEEDS_MORE_EVIDENCE" : "SAFE_FOR_OPERATOR_REVIEW",
    confidence: hasFailure ? 0.2 : hasPartial ? 0.58 : 0.86,
    checks,
    nextGate: hasFailure
      ? "Repair the reasoning packet before operator review."
      : hasPartial
        ? "Attach more evidence or unknowns before worker-packet preparation."
        : "Proceed to Experiment Dashboard after this evaluator is validated.",
    blockedActions: packet.decisionPacket.blockedActions,
    safety: packet.safety,
  }
}
