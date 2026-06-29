import { describe, expect, it } from "vitest"
import { getBrainCouncilPredictionCalibration } from "@/components/brain-council/brain-council-prediction-calibration"

describe("Brain Council prediction calibration", () => {
  it("shows pending and verified prediction states", () => {
    const calibration = getBrainCouncilPredictionCalibration()
    const statuses = calibration.predictions.map((prediction) => prediction.calibrationStatus)

    expect(statuses).toContain("pending")
    expect(statuses).toContain("verified")
  })

  it("links predictions to experiments with confidence", () => {
    const calibration = getBrainCouncilPredictionCalibration()

    expect(calibration.predictions.every((prediction) => prediction.linkedExperiment.startsWith("EXP-"))).toBe(true)
    expect(calibration.predictions.every((prediction) => prediction.confidence > 0 && prediction.confidence <= 1)).toBe(true)
  })

  it("does not update or verify predictions automatically", () => {
    const calibration = getBrainCouncilPredictionCalibration()

    expect(calibration.safety).toEqual({
      updatesPredictions: false,
      executesVerification: false,
      changesConfidenceAutomatically: false,
      writesData: false,
    })
  })
})
