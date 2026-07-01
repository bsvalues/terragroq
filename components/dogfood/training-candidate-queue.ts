export type TrainingCandidateState =
  | "proposed"
  | "needs review"
  | "accepted"
  | "rejected"
  | "stale"
  | "converted to memory"
  | "converted to eval"

export type TrainingCandidateQueueItem = {
  state: TrainingCandidateState
  label: string
  description: string
  authorityRequirement: string
}

export type TrainingCandidateQueueSurface = {
  title: string
  summary: string
  items: TrainingCandidateQueueItem[]
  reviewFlow: string[]
  safety: {
    readOnly: boolean
    writesMemory: boolean
    convertsAutomatically: boolean
    startsTraining: boolean
    createsEvalAutomatically: boolean
    backgroundExtraction: boolean
  }
}

export function getTrainingCandidateQueueSurface(): TrainingCandidateQueueSurface {
  return {
    title: "Training Candidate Queue",
    summary:
      "Completed work, owner corrections, blocked gates, and phase closures can become reviewable candidates before anything enters Memory, evaluation, or future training material.",
    items: [
      {
        state: "proposed",
        label: "Completed work order",
        description:
          "A completed Work Order can propose a training record only after validation and evidence are attached.",
        authorityRequirement: "Primary review before acceptance",
      },
      {
        state: "needs review",
        label: "Owner correction",
        description:
          "Corrections become candidates for durable lessons, but they do not silently rewrite doctrine or memory.",
        authorityRequirement: "Primary decides whether the correction becomes canon",
      },
      {
        state: "accepted",
        label: "Evidence-backed lesson",
        description:
          "Accepted lessons remain reviewable and traceable to the work, evidence, and decision that produced them.",
        authorityRequirement: "Evidence required before promotion",
      },
      {
        state: "converted to eval",
        label: "Failure-to-eval candidate",
        description:
          "Repeated failures can be proposed as eval cases without creating tests or training data automatically.",
        authorityRequirement: "Separate implementation Work Order required",
      },
    ],
    reviewFlow: [
      "proposed",
      "needs review",
      "accepted or rejected",
      "converted only by later Work Order",
    ],
    safety: {
      readOnly: true,
      writesMemory: false,
      convertsAutomatically: false,
      startsTraining: false,
      createsEvalAutomatically: false,
      backgroundExtraction: false,
    },
  }
}

export function isTrainingCandidateState(state: string): state is TrainingCandidateState {
  return [
    "proposed",
    "needs review",
    "accepted",
    "rejected",
    "stale",
    "converted to memory",
    "converted to eval",
  ].includes(state)
}
