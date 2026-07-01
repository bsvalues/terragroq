export type WorkTrainingCaptureField = {
  label: string
  required: boolean
  description: string
}

export type WorkTrainingCaptureModel = {
  title: string
  summary: string
  fields: WorkTrainingCaptureField[]
  candidateOutputs: string[]
  safety: {
    modelOnly: true
    writesMemory: false
    promotesTraining: false
    runsFineTuning: false
    createsEvalAutomatically: false
    backgroundExtraction: false
  }
}

export function getWorkTrainingCaptureModel(): WorkTrainingCaptureModel {
  return {
    title: "Work-as-training capture model",
    summary:
      "A reviewable record shape for turning governed work into training material. Records remain proposed until the Primary accepts memory, training, or eval candidates.",
    fields: [
      { label: "Goal", required: true, description: "The active goal or phase outcome." },
      { label: "Loop", required: true, description: "The loop that inspected, repaired, or verified the work." },
      { label: "Work Order", required: true, description: "The governed execution unit." },
      { label: "Inputs", required: true, description: "User instructions, constraints, files, and starting state." },
      { label: "Decisions", required: true, description: "Owner decisions, agent choices, and authority gates." },
      { label: "Evidence", required: true, description: "Tests, builds, PR checks, route probes, and reports." },
      { label: "Validation", required: true, description: "Focused tests, full suite, build, and production checks." },
      { label: "Production result", required: true, description: "Observed production health or route result." },
      { label: "Owner correction", required: false, description: "Any correction to agent reasoning or direction." },
      { label: "Blocked gate", required: false, description: "Any stop condition, hard boundary, or pending approval." },
      { label: "Lesson learned", required: true, description: "The reusable operational pattern or failure mode." },
      { label: "Proposed memory record", required: false, description: "Candidate durable memory, not automatically promoted." },
      { label: "Proposed eval case", required: false, description: "Candidate regression/eval, not automatically created." },
    ],
    candidateOutputs: [
      "completion report",
      "evidence record",
      "decision record",
      "blocked gate record",
      "proposed memory update",
      "proposed training candidate",
      "proposed eval candidate",
    ],
    safety: {
      modelOnly: true,
      writesMemory: false,
      promotesTraining: false,
      runsFineTuning: false,
      createsEvalAutomatically: false,
      backgroundExtraction: false,
    },
  }
}

export function isWorkTrainingCaptureReviewable(
  fields: Partial<Record<WorkTrainingCaptureField["label"], string>>,
): boolean {
  return getWorkTrainingCaptureModel().fields.every((field) => {
    const value = fields[field.label]
    return !field.required || Boolean(value?.trim())
  })
}
