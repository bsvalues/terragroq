import { describe, expect, it } from "vitest"
import { getBrainCouncilHermesNotReadyExplanation } from "@/components/brain-council/brain-council-hermes-not-ready"

describe("Brain Council Hermes not-ready explanation", () => {
  it("explains missing approvals and unresolved risks", () => {
    const explanation = getBrainCouncilHermesNotReadyExplanation()

    expect(explanation.posture).toBe("HERMES_NOT_READY_PREVIEW_ONLY")
    expect(explanation.missingRuntimeApprovals.length).toBeGreaterThan(0)
    expect(explanation.unresolvedRisks.length).toBeGreaterThan(0)
  })

  it("keeps skill quarantine and activation blocked", () => {
    const explanation = getBrainCouncilHermesNotReadyExplanation()

    expect(explanation.skillQuarantineStatus).toBe("quarantined")
    expect(explanation.activationRubricResult).toBe("not-ready")
  })

  it("does not activate Hermes or change approvals", () => {
    const explanation = getBrainCouncilHermesNotReadyExplanation()

    expect(explanation.safety).toEqual({
      activatesHermes: false,
      changesApprovals: false,
      startsScheduler: false,
      writesData: false,
    })
  })
})
