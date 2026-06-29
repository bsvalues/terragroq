import { describe, expect, it } from "vitest"
import {
  buildBrainCouncilEvidenceSelectionPreview,
  getBrainCouncilSelectableEvidence,
} from "@/components/brain-council/brain-council-evidence-selector"

describe("Brain Council evidence selector", () => {
  it("exposes existing evidence as selectable preview items", () => {
    const evidence = getBrainCouncilSelectableEvidence()

    expect(evidence.length).toBeGreaterThanOrEqual(3)
    expect(evidence.every((item) => item.id.length > 0)).toBe(true)
    expect(evidence.every((item) => item.selectedByDefault)).toBe(true)
  })

  it("normalizes selected evidence ids and readiness", () => {
    const preview = buildBrainCouncilEvidenceSelectionPreview([
      "evidence-1",
      "evidence-1",
      "missing",
      "evidence-2",
    ])

    expect(preview.selectedIds).toEqual(["evidence-1", "evidence-2"])
    expect(preview.selectedCount).toBe(2)
    expect(preview.readyForReasoning).toBe(true)
  })

  it("does not ingest or persist evidence", () => {
    const preview = buildBrainCouncilEvidenceSelectionPreview(["evidence-1"])

    expect(preview.readyForReasoning).toBe(false)
    expect(preview.safety.readOnly).toBe(true)
    expect(preview.safety.wouldExecute).toBe(false)
    expect(preview.safety.persistenceEnabled).toBe(false)
    expect(preview.safety.evidenceIngestion).toBe(false)
    expect(preview.safety.databaseMutation).toBe(false)
    expect(preview.safety.productionWrite).toBe(false)
  })
})
