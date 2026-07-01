import { describe, expect, it } from "vitest"
import {
  getWorkTrainingCaptureModel,
  isWorkTrainingCaptureReviewable,
} from "@/components/dogfood/work-training-capture-model"

describe("Work-as-training capture model", () => {
  it("defines the governed training record shape", () => {
    const model = getWorkTrainingCaptureModel()

    expect(model.fields.map((field) => field.label)).toEqual([
      "Goal",
      "Loop",
      "Work Order",
      "Inputs",
      "Decisions",
      "Evidence",
      "Validation",
      "Production result",
      "Owner correction",
      "Blocked gate",
      "Lesson learned",
      "Proposed memory record",
      "Proposed eval case",
    ])
  })

  it("produces reviewable candidate outputs without automatic promotion", () => {
    const model = getWorkTrainingCaptureModel()

    expect(model.candidateOutputs).toEqual([
      "completion report",
      "evidence record",
      "decision record",
      "blocked gate record",
      "proposed memory update",
      "proposed training candidate",
      "proposed eval candidate",
    ])
    expect(model.safety).toEqual({
      modelOnly: true,
      writesMemory: false,
      promotesTraining: false,
      runsFineTuning: false,
      createsEvalAutomatically: false,
      backgroundExtraction: false,
    })
  })

  it("requires core fields before a record is reviewable", () => {
    expect(
      isWorkTrainingCaptureReviewable({
        Goal: "GOAL-DOGFOOD-001",
        Loop: "WO-DOGFOOD-002",
        "Work Order": "Work-as-training capture model",
        Inputs: "User authorization",
        Decisions: "Capture candidates only",
        Evidence: "Focused tests and build",
        Validation: "Full suite",
        "Production result": "Health passed",
        "Lesson learned": "Production can be used as operating surface",
      }),
    ).toBe(true)

    expect(
      isWorkTrainingCaptureReviewable({
        Goal: "GOAL-DOGFOOD-001",
        Loop: "WO-DOGFOOD-002",
      }),
    ).toBe(false)
  })
})
