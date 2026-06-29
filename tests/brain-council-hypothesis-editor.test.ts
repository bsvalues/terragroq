import { describe, expect, it } from "vitest"
import {
  buildBrainCouncilHypothesisEditorPreview,
  getDefaultBrainCouncilEditableHypotheses,
} from "@/components/brain-council/brain-council-hypothesis-editor"

describe("Brain Council hypothesis editor", () => {
  it("builds ranked editable hypotheses from the reasoning packet", () => {
    const preview = buildBrainCouncilHypothesisEditorPreview(getDefaultBrainCouncilEditableHypotheses())

    expect(preview.hypotheses).toHaveLength(3)
    expect(preview.topHypothesisId).toBe("hypothesis-1")
    expect(preview.readyForDecisionPacket).toBe(true)
  })

  it("normalizes rank and confidence values", () => {
    const preview = buildBrainCouncilHypothesisEditorPreview([
      { id: "one", title: "One", claim: "Claim", confidence: 125, rank: -3 },
      { id: "two", title: "Two", claim: "Claim", confidence: -20, rank: 2 },
    ])

    expect(preview.hypotheses[0].confidence).toBe(100)
    expect(preview.hypotheses[0].rank).toBe(1)
    expect(preview.hypotheses[1].confidence).toBe(0)
  })

  it("does not persist or mutate decisions", () => {
    const preview = buildBrainCouncilHypothesisEditorPreview(getDefaultBrainCouncilEditableHypotheses())

    expect(preview.safety.readOnly).toBe(true)
    expect(preview.safety.wouldExecute).toBe(false)
    expect(preview.safety.persistenceEnabled).toBe(false)
    expect(preview.safety.decisionMutation).toBe(false)
    expect(preview.safety.autonomyEnabled).toBe(false)
    expect(preview.safety.productionWrite).toBe(false)
  })
})
