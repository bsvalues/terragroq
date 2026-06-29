export type BrainCouncilExperiment = {
  id: string
  question: string
  prediction: string
  evidence: string[]
  calibration: "calibrated" | "needs-more-signal" | "not-started"
  status: "ready-for-review" | "watch" | "blocked"
}

export type BrainCouncilExperimentDashboard = {
  experiments: BrainCouncilExperiment[]
  summary: {
    total: number
    readyForReview: number
    watch: number
    blocked: number
  }
  safety: {
    readOnly: true
    wouldExecute: false
    schedulerEnabled: false
    autonomyEnabled: false
    productionWrite: false
  }
}

const experiments: BrainCouncilExperiment[] = [
  {
    id: "exp-reasoning-view",
    question: "Does a reasoning packet help the operator choose the next safe WO?",
    prediction:
      "Operators will prefer the reasoning view when a decision has competing hypotheses or ambiguous next steps.",
    evidence: [
      "Brain Council visibility is already merged.",
      "Reasoning packet exposes hypotheses and confidence.",
      "Readiness evaluator marks the packet safe for operator review.",
    ],
    calibration: "calibrated",
    status: "ready-for-review",
  },
  {
    id: "exp-readiness-threshold",
    question: "Which confidence threshold should require more evidence?",
    prediction:
      "Packets below 70% confidence should remain in evidence-gathering unless the next action is read-only.",
    evidence: [
      "Current packet confidence is 82%.",
      "Unknowns are visible before the decision packet.",
      "Blocked actions remain explicit.",
    ],
    calibration: "needs-more-signal",
    status: "watch",
  },
  {
    id: "exp-worker-packet-boundary",
    question: "When should a worker packet be prepared?",
    prediction:
      "Worker packets should be generated only after the reasoning packet and readiness evaluator both pass.",
    evidence: [
      "Decision packet has a bounded next action.",
      "Runtime execution remains disabled.",
      "Worker dispatch remains blocked.",
    ],
    calibration: "not-started",
    status: "watch",
  },
]

export function getBrainCouncilExperimentDashboard(): BrainCouncilExperimentDashboard {
  return {
    experiments,
    summary: {
      total: experiments.length,
      readyForReview: experiments.filter((experiment) => experiment.status === "ready-for-review").length,
      watch: experiments.filter((experiment) => experiment.status === "watch").length,
      blocked: experiments.filter((experiment) => experiment.status === "blocked").length,
    },
    safety: {
      readOnly: true,
      wouldExecute: false,
      schedulerEnabled: false,
      autonomyEnabled: false,
      productionWrite: false,
    },
  }
}
