import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"

export type BrainCouncilEditableHypothesis = {
  id: string
  title: string
  claim: string
  confidence: number
  rank: number
}

export type BrainCouncilHypothesisEditorPreview = {
  hypotheses: BrainCouncilEditableHypothesis[]
  topHypothesisId: string | null
  readyForDecisionPacket: boolean
  safety: {
    readOnly: true
    wouldExecute: false
    persistenceEnabled: false
    decisionMutation: false
    autonomyEnabled: false
    productionWrite: false
  }
}

export function getDefaultBrainCouncilEditableHypotheses(): BrainCouncilEditableHypothesis[] {
  const packet = getBrainCouncilReasoningPacket()
  const rankById = new Map(packet.ranking.map((id, index) => [id, index + 1]))

  return packet.hypotheses.map((hypothesis) => ({
    id: hypothesis.id,
    title: hypothesis.title,
    claim: hypothesis.claim,
    confidence: Math.round(hypothesis.confidence * 100),
    rank: rankById.get(hypothesis.id) ?? 99,
  }))
}

export function buildBrainCouncilHypothesisEditorPreview(
  hypotheses: BrainCouncilEditableHypothesis[],
): BrainCouncilHypothesisEditorPreview {
  const normalized = hypotheses
    .map((hypothesis) => ({
      ...hypothesis,
      confidence: Math.max(0, Math.min(100, Math.round(hypothesis.confidence))),
      rank: Math.max(1, Math.round(hypothesis.rank)),
    }))
    .sort((a, b) => a.rank - b.rank)

  return {
    hypotheses: normalized,
    topHypothesisId: normalized[0]?.id ?? null,
    readyForDecisionPacket:
      normalized.length >= 2 &&
      normalized.every((hypothesis) => hypothesis.title.trim() && hypothesis.claim.trim()) &&
      normalized.some((hypothesis) => hypothesis.confidence >= 70),
    safety: {
      readOnly: true,
      wouldExecute: false,
      persistenceEnabled: false,
      decisionMutation: false,
      autonomyEnabled: false,
      productionWrite: false,
    },
  }
}
