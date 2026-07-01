import { describe, expect, it } from "vitest"
import {
  getTrainingCandidateQueueSurface,
  isTrainingCandidateState,
} from "@/components/dogfood/training-candidate-queue"

describe("Training candidate queue", () => {
  it("defines the reviewable candidate states", () => {
    expect([
      "proposed",
      "needs review",
      "accepted",
      "rejected",
      "stale",
      "converted to memory",
      "converted to eval",
    ].every(isTrainingCandidateState)).toBe(true)

    expect(isTrainingCandidateState("auto-promoted")).toBe(false)
  })

  it("shows work-as-training records as review candidates", () => {
    const surface = getTrainingCandidateQueueSurface()

    expect(surface.title).toBe("Training Candidate Queue")
    expect(surface.summary).toContain("reviewable candidates")
    expect(surface.items.map((item) => item.label)).toEqual([
      "Completed work order",
      "Owner correction",
      "Evidence-backed lesson",
      "Failure-to-eval candidate",
    ])
    expect(surface.reviewFlow).toEqual([
      "proposed",
      "needs review",
      "accepted or rejected",
      "converted only by later Work Order",
    ])
  })

  it("does not automatically write memory, train, or create evals", () => {
    const surface = getTrainingCandidateQueueSurface()

    expect(surface.safety).toEqual({
      readOnly: true,
      writesMemory: false,
      convertsAutomatically: false,
      startsTraining: false,
      createsEvalAutomatically: false,
      backgroundExtraction: false,
    })
  })
})
