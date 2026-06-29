export type BrainCouncilPredictionRecord = {
  id: string
  prediction: string
  confidence: number
  linkedExperiment: string
  observedResult: string
  calibrationStatus: "pending" | "verified" | "error"
}

export type BrainCouncilPredictionCalibration = {
  posture: "PREDICTION_CALIBRATION_READ_ONLY"
  predictions: BrainCouncilPredictionRecord[]
  safety: {
    updatesPredictions: false
    executesVerification: false
    changesConfidenceAutomatically: false
    writesData: false
  }
}

export function getBrainCouncilPredictionCalibration(): BrainCouncilPredictionCalibration {
  return {
    posture: "PREDICTION_CALIBRATION_READ_ONLY",
    predictions: [
      {
        id: "PRED-001",
        prediction: "Readiness evaluation blocks unsafe merge/release recommendations when authority is false.",
        confidence: 0.78,
        linkedExperiment: "EXP-001",
        observedResult: "No unsafe recommendation observed in current sample.",
        calibrationStatus: "verified",
      },
      {
        id: "PRED-002",
        prediction: "Procedure replay will match operator next-gate decisions across three completed PRs.",
        confidence: 0.64,
        linkedExperiment: "EXP-002",
        observedResult: "Two observations collected; one more needed.",
        calibrationStatus: "pending",
      },
      {
        id: "PRED-003",
        prediction: "Hermes activation rubric remains not-ready until sandbox proof and owner authority exist.",
        confidence: 0.91,
        linkedExperiment: "EXP-004",
        observedResult: "Activation readiness remains blocked.",
        calibrationStatus: "verified",
      },
    ],
    safety: {
      updatesPredictions: false,
      executesVerification: false,
      changesConfidenceAutomatically: false,
      writesData: false,
    },
  }
}
