import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"

export type BrainCouncilInputDraft = {
  question: string
  context: string
  selectedBrains: string[]
  desiredOutput: string
}

export type BrainCouncilInputComposerPreview = BrainCouncilInputDraft & {
  packetMode: "preview-only"
  readyForReasoningPreview: boolean
  safety: {
    readOnly: true
    wouldExecute: false
    persistenceEnabled: false
    workerDispatch: false
    autonomyEnabled: false
    productionWrite: false
  }
}

export const AVAILABLE_BRAIN_CHOICES = [
  "Architect Brain",
  "Safety Brain",
  "Evidence Brain",
  "Operator Experience Brain",
  "Verification Brain",
]

export function getDefaultBrainCouncilInputDraft(): BrainCouncilInputDraft {
  const packet = getBrainCouncilReasoningPacket()

  return {
    question: packet.question,
    context:
      "Brain Council is visible and read-only. The next operator question should be framed as reasoning, not execution.",
    selectedBrains: packet.selectedBrains,
    desiredOutput: "Decision packet with hypotheses, confidence, required verification, and next safe action.",
  }
}

export function buildBrainCouncilInputComposerPreview(
  draft: BrainCouncilInputDraft,
): BrainCouncilInputComposerPreview {
  const questionReady = draft.question.trim().length >= 12
  const contextReady = draft.context.trim().length >= 12
  const brainsReady = draft.selectedBrains.length > 0
  const outputReady = draft.desiredOutput.trim().length >= 12

  return {
    ...draft,
    packetMode: "preview-only",
    readyForReasoningPreview: questionReady && contextReady && brainsReady && outputReady,
    safety: {
      readOnly: true,
      wouldExecute: false,
      persistenceEnabled: false,
      workerDispatch: false,
      autonomyEnabled: false,
      productionWrite: false,
    },
  }
}
