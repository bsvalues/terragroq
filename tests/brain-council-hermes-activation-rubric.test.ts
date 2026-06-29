import { describe, expect, it } from "vitest"
import { getHermesActivationReadinessRubric } from "@/components/brain-council/brain-council-hermes-activation-rubric"

describe("Hermes activation readiness rubric", () => {
  it("keeps Hermes not ready for activation", () => {
    const rubric = getHermesActivationReadinessRubric()

    expect(rubric.verdict).toBe("NOT_READY_FOR_ACTIVATION")
    expect(rubric.criteria.map((criterion) => criterion.id)).toContain("authority")
  })

  it("requires evidence for repeatability, quarantine, sandbox, and authority", () => {
    const rubric = getHermesActivationReadinessRubric()

    expect(rubric.criteria.every((criterion) => criterion.requiredEvidence.length >= 3)).toBe(true)
    expect(rubric.criteria.some((criterion) => criterion.currentStatus === "blocked")).toBe(true)
  })

  it("does not approve activation or enable runtime capabilities", () => {
    const rubric = getHermesActivationReadinessRubric()

    expect(rubric.safety).toEqual({
      approvesActivation: false,
      createsLedgerEntry: false,
      enablesRuntime: false,
      enablesAutonomy: false,
      enablesMcp: false,
      permitsProductionWrite: false,
    })
  })
})
