export type DecisionCorrectionCaptureItem = {
  label: string
  description: string
  candidateType: "decision" | "correction" | "blocked-gate" | "lesson"
}

export type DecisionCorrectionCaptureSurface = {
  title: string
  summary: string
  items: DecisionCorrectionCaptureItem[]
  reviewFlow: string[]
  safety: {
    readOnlySurface: true
    writesMemory: false
    promotesCanon: false
    updatesTraining: false
    backgroundExtraction: false
  }
}

export function getDecisionCorrectionCaptureSurface(): DecisionCorrectionCaptureSurface {
  return {
    title: "Decision and correction capture",
    summary:
      "Owner decisions and corrections become reviewable memory/training candidates. They stay visible for Primary review before anything becomes canonical.",
    items: [
      {
        label: "Owner correction",
        candidateType: "correction",
        description: "A correction to agent reasoning, terminology, sequence, or safety posture.",
      },
      {
        label: "Decision record",
        candidateType: "decision",
        description: "A choice that should guide future Work Orders or product behavior.",
      },
      {
        label: "Blocked gate",
        candidateType: "blocked-gate",
        description: "A stop condition that prevented unsafe or unclear work.",
      },
      {
        label: "Lesson learned",
        candidateType: "lesson",
        description: "A reusable pattern that should become a memory or eval candidate after review.",
      },
    ],
    reviewFlow: [
      "capture candidate",
      "attach evidence",
      "Primary review",
      "accept, reject, or convert later",
    ],
    safety: {
      readOnlySurface: true,
      writesMemory: false,
      promotesCanon: false,
      updatesTraining: false,
      backgroundExtraction: false,
    },
  }
}
