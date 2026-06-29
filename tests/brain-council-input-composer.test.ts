import { describe, expect, it } from "vitest"
import {
  buildBrainCouncilInputComposerPreview,
  getDefaultBrainCouncilInputDraft,
} from "@/components/brain-council/brain-council-input-composer"

describe("Brain Council reasoning input composer", () => {
  it("builds a preview-ready default draft", () => {
    const preview = buildBrainCouncilInputComposerPreview(getDefaultBrainCouncilInputDraft())

    expect(preview.packetMode).toBe("preview-only")
    expect(preview.readyForReasoningPreview).toBe(true)
    expect(preview.selectedBrains.length).toBeGreaterThanOrEqual(4)
  })

  it("requires meaningful input before preview readiness", () => {
    const preview = buildBrainCouncilInputComposerPreview({
      question: "short",
      context: "",
      selectedBrains: [],
      desiredOutput: "",
    })

    expect(preview.readyForReasoningPreview).toBe(false)
  })

  it("does not save, dispatch, or execute", () => {
    const preview = buildBrainCouncilInputComposerPreview(getDefaultBrainCouncilInputDraft())

    expect(preview.safety.readOnly).toBe(true)
    expect(preview.safety.wouldExecute).toBe(false)
    expect(preview.safety.persistenceEnabled).toBe(false)
    expect(preview.safety.workerDispatch).toBe(false)
    expect(preview.safety.autonomyEnabled).toBe(false)
    expect(preview.safety.productionWrite).toBe(false)
  })
})
