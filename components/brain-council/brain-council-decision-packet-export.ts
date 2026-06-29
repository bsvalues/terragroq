import { getBrainCouncilReadinessEvaluation } from "@/components/brain-council/brain-council-readiness"
import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"

export type BrainCouncilDecisionPacketExportPreview = {
  format: "text/markdown-preview"
  title: string
  body: string
  lineCount: number
  safety: {
    readOnly: true
    wouldExecute: false
    fileWrite: false
    networkSend: false
    workerDispatch: false
    productionWrite: false
  }
}

export function getBrainCouncilDecisionPacketExportPreview(): BrainCouncilDecisionPacketExportPreview {
  const reasoning = getBrainCouncilReasoningPacket()
  const readiness = getBrainCouncilReadinessEvaluation()
  const lines = [
    "# Brain Council Decision Packet",
    "",
    `Question: ${reasoning.question}`,
    `Verdict: ${reasoning.decisionPacket.verdict}`,
    `Confidence: ${Math.round(reasoning.confidence * 100)}%`,
    `Readiness: ${readiness.verdict}`,
    "",
    "## Recommendation",
    reasoning.decisionPacket.recommendation,
    "",
    "## Evidence",
    ...reasoning.evidence.map((item) => `- ${item.label} (${item.source}): ${item.summary}`),
    "",
    "## Unknowns",
    ...reasoning.unknowns.map((item) => `- ${item}`),
    "",
    "## Required Verification",
    ...reasoning.decisionPacket.requiredVerification.map((item) => `- ${item}`),
    "",
    "## Next Action",
    reasoning.decisionPacket.nextAction,
    "",
    "## Denied Actions",
    ...reasoning.decisionPacket.blockedActions.map((item) => `- ${item}`),
  ]

  return {
    format: "text/markdown-preview",
    title: "Brain Council Decision Packet",
    body: lines.join("\n"),
    lineCount: lines.length,
    safety: {
      readOnly: true,
      wouldExecute: false,
      fileWrite: false,
      networkSend: false,
      workerDispatch: false,
      productionWrite: false,
    },
  }
}
