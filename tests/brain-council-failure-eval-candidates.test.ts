import { describe, expect, it } from "vitest"
import { getBrainCouncilFailureEvalCandidates } from "@/components/brain-council/brain-council-failure-eval-candidates"

describe("Brain Council failure-to-eval candidates", () => {
  it("exposes read-only failure candidates", () => {
    const viewer = getBrainCouncilFailureEvalCandidates()

    expect(viewer.posture).toBe("FAILURE_TO_EVAL_CANDIDATES_READ_ONLY")
    expect(viewer.candidates.map((candidate) => candidate.id)).toContain("FE-001")
  })

  it("keeps every candidate blocked from promotion", () => {
    const viewer = getBrainCouncilFailureEvalCandidates()

    expect(viewer.candidates.every((candidate) => candidate.safeToPromote === false)).toBe(true)
    expect(viewer.candidates.some((candidate) => candidate.priority === "high")).toBe(true)
  })

  it("does not create, run, or promote evals", () => {
    const viewer = getBrainCouncilFailureEvalCandidates()

    expect(viewer.safety).toEqual({
      createsEval: false,
      promotesEval: false,
      runsEval: false,
      mutatesData: false,
    })
  })
})
