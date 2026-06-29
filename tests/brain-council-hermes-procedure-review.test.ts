import { describe, expect, it } from "vitest"
import { getHermesCandidateProcedureReview } from "@/components/brain-council/brain-council-hermes-procedure-review"

describe("Hermes candidate procedure review", () => {
  it("keeps procedures in review-only posture", () => {
    const review = getHermesCandidateProcedureReview()

    expect(review.posture).toBe("PROCEDURE_REVIEW_ONLY")
    expect(review.procedures.map((procedure) => procedure.id)).toContain("pr-posture-review")
  })

  it("requires ratification and activation before procedure escalation", () => {
    const review = getHermesCandidateProcedureReview()
    const procedure = review.procedures.find((item) => item.id === "pr-posture-review")

    expect(procedure?.blockedUntil).toContain("ratification record")
    expect(procedure?.blockedUntil).toContain("activation ledger entry")
  })

  it("does not promote, invoke, dispatch, or activate Hermes", () => {
    const review = getHermesCandidateProcedureReview()

    expect(review.safety).toEqual({
      promotesSkill: false,
      invokesProcedure: false,
      writesMemory: false,
      dispatchesWorker: false,
      activatesHermes: false,
    })
  })
})
