import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"

export type BrainCouncilSelectableEvidence = {
  id: string
  label: string
  source: string
  summary: string
  selectedByDefault: boolean
}

export type BrainCouncilEvidenceSelectionPreview = {
  evidence: BrainCouncilSelectableEvidence[]
  selectedIds: string[]
  selectedCount: number
  readyForReasoning: boolean
  safety: {
    readOnly: true
    wouldExecute: false
    persistenceEnabled: false
    evidenceIngestion: false
    databaseMutation: false
    productionWrite: false
  }
}

export function getBrainCouncilSelectableEvidence(): BrainCouncilSelectableEvidence[] {
  return getBrainCouncilReasoningPacket().evidence.map((item, index) => ({
    id: `evidence-${index + 1}`,
    label: item.label,
    source: item.source,
    summary: item.summary,
    selectedByDefault: true,
  }))
}

export function buildBrainCouncilEvidenceSelectionPreview(
  selectedIds: string[],
): BrainCouncilEvidenceSelectionPreview {
  const evidence = getBrainCouncilSelectableEvidence()
  const validIds = new Set(evidence.map((item) => item.id))
  const normalizedSelectedIds = selectedIds.filter((id, index) => validIds.has(id) && selectedIds.indexOf(id) === index)

  return {
    evidence,
    selectedIds: normalizedSelectedIds,
    selectedCount: normalizedSelectedIds.length,
    readyForReasoning: normalizedSelectedIds.length >= 2,
    safety: {
      readOnly: true,
      wouldExecute: false,
      persistenceEnabled: false,
      evidenceIngestion: false,
      databaseMutation: false,
      productionWrite: false,
    },
  }
}
