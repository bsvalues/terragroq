export type CouncilStateId =
  | "question-framed"
  | "evidence-gathering"
  | "hypothesis-ranking"
  | "decision-packet-ready"
  | "work-order-required"
  | "blocked-for-authority"

export type CouncilTransitionGuard =
  | "evidence-required"
  | "confidence-required"
  | "primary-authority-required"
  | "work-order-required"

export type CouncilStateTransition = {
  to: CouncilStateId
  label: string
  guard: CouncilTransitionGuard
}

export type CouncilStateDefinition = {
  id: CouncilStateId
  label: string
  description: string
  allowedTransitions: CouncilStateTransition[]
  blockedActions: string[]
}

export type CouncilStateMachine = {
  title: string
  summary: string
  initialState: CouncilStateId
  terminalState: CouncilStateId
  states: CouncilStateDefinition[]
  safety: {
    readOnlySchema: true
    executesTransitions: false
    dispatchesWorkers: false
    startsLoops: false
    writesProduction: false
  }
}

export function getCouncilStateMachine(): CouncilStateMachine {
  return {
    title: "Council state machine",
    summary:
      "A read-only schema for how Brain Council advisory work moves from question to evidence, hypotheses, decision packet, and Work Order boundary.",
    initialState: "question-framed",
    terminalState: "blocked-for-authority",
    states: [
      {
        id: "question-framed",
        label: "Question framed",
        description: "The Primary Operator has a bounded question or uncertainty for Council review.",
        allowedTransitions: [
          {
            to: "evidence-gathering",
            label: "Collect evidence",
            guard: "evidence-required",
          },
        ],
        blockedActions: ["execute answer", "dispatch worker"],
      },
      {
        id: "evidence-gathering",
        label: "Evidence gathering",
        description: "Claims, facts, unknowns, and system signals are collected before confidence is assigned.",
        allowedTransitions: [
          {
            to: "hypothesis-ranking",
            label: "Rank hypotheses",
            guard: "confidence-required",
          },
        ],
        blockedActions: ["skip verification", "write production data"],
      },
      {
        id: "hypothesis-ranking",
        label: "Hypothesis ranking",
        description: "Candidate explanations are compared with confidence, risk, and verification needs.",
        allowedTransitions: [
          {
            to: "decision-packet-ready",
            label: "Prepare packet",
            guard: "evidence-required",
          },
        ],
        blockedActions: ["convert confidence into authority", "activate Hermes"],
      },
      {
        id: "decision-packet-ready",
        label: "Decision packet ready",
        description: "The Council can present a bounded recommendation and required verification.",
        allowedTransitions: [
          {
            to: "work-order-required",
            label: "Draft Work Order",
            guard: "work-order-required",
          },
        ],
        blockedActions: ["auto-approve", "open execution path"],
      },
      {
        id: "work-order-required",
        label: "Work Order required",
        description: "Mutation requires governed scope, validation, blocked changes, and evidence.",
        allowedTransitions: [
          {
            to: "blocked-for-authority",
            label: "Request Primary authority",
            guard: "primary-authority-required",
          },
        ],
        blockedActions: ["run without Work Order", "bypass evidence"],
      },
      {
        id: "blocked-for-authority",
        label: "Blocked for authority",
        description: "The Council stops at the authority boundary until the Primary explicitly approves action.",
        allowedTransitions: [],
        blockedActions: ["grant authority", "execute approval", "start automation"],
      },
    ],
    safety: {
      readOnlySchema: true,
      executesTransitions: false,
      dispatchesWorkers: false,
      startsLoops: false,
      writesProduction: false,
    },
  }
}

export function getCouncilStateById(id: CouncilStateId): CouncilStateDefinition | undefined {
  return getCouncilStateMachine().states.find((state) => state.id === id)
}
