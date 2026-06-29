export type HermesExperimentStep = {
  id: string
  title: string
  method: string
  evidence: string[]
  successSignal: string
}

export type HermesNonRuntimeExperimentPlan = {
  posture: "NON_RUNTIME_EXPERIMENT_ONLY"
  question: string
  hypothesis: string
  steps: HermesExperimentStep[]
  blockedActions: string[]
  exitCriteria: string[]
  safety: {
    runsHermes: false
    dispatchesWorker: false
    schedulesLoop: false
    invokesSkill: false
    writesFiles: false
    writesProductionData: false
  }
}

export function getHermesNonRuntimeExperimentPlan(): HermesNonRuntimeExperimentPlan {
  return {
    posture: "NON_RUNTIME_EXPERIMENT_ONLY",
    question: "Can Hermes improve repeated operator workflows while staying proposal-only?",
    hypothesis:
      "Hermes is useful only if it first improves procedure drafts, evidence packets, and readiness classifications without receiving runtime authority.",
    steps: [
      {
        id: "procedure-replay",
        title: "Replay repeated procedure candidates",
        method: "Compare existing PR/work-order posture procedures against completed operator lanes.",
        evidence: ["procedure candidate metadata", "merged PR outcomes", "review comments"],
        successSignal: "Procedure draft identifies the same safe next action without proposing mutation.",
      },
      {
        id: "readiness-shadow",
        title: "Shadow readiness evaluations",
        method: "Run a paper-only readiness assessment beside the existing operator judgement.",
        evidence: ["readiness sample fields", "validation results", "explicit authority flags"],
        successSignal: "Readiness output correctly blocks merge/release when authority is false.",
      },
      {
        id: "packet-quality",
        title: "Assess worker packet quality",
        method: "Review draft worker packets for completeness before any worker receives them.",
        evidence: ["worker packet drafts", "broker egress policy", "missing evidence list"],
        successSignal: "Packet draft improves clarity without leaking secrets or issuing commands.",
      },
      {
        id: "risk-calibration",
        title: "Calibrate activation risk",
        method: "Check every candidate against the activation risk register and escalation-only topics.",
        evidence: ["activation ledger requirements", "risk register", "blocked capabilities"],
        successSignal: "Candidate remains non-runtime or is rejected before implementation.",
      },
    ],
    blockedActions: [
      "install Hermes",
      "run Hermes",
      "dispatch a worker",
      "schedule a loop",
      "invoke a skill",
      "activate MCP",
      "write repo files from Hermes",
      "write production data",
    ],
    exitCriteria: [
      "Three or more procedure drafts are useful without mutation authority.",
      "Readiness classifications match actual governance outcomes.",
      "Broker review finds no secret or egress violations.",
      "Activation risk stays denied unless a new owner-approved runtime design exists.",
    ],
    safety: {
      runsHermes: false,
      dispatchesWorker: false,
      schedulesLoop: false,
      invokesSkill: false,
      writesFiles: false,
      writesProductionData: false,
    },
  }
}
