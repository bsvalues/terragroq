export type CouncilStateId =
  | "DORMANT"
  | "DOCUMENTED"
  | "ADVISORY_READY"
  | "CONTEXT_REQUESTED"
  | "EVIDENCE_REVIEW"
  | "OPTIONS_FRAMED"
  | "CONFIDENCE_REVIEW"
  | "DECISION_PACKET_READY"
  | "WORK_ORDER_RECOMMENDED"
  | "AUTHORITY_REQUIRED"
  | "BLOCKED"
  | "DENIED"
  | "RETIRED"

export type CouncilTransitionGuard =
  | "doctrine-required"
  | "advisory-scope-required"
  | "context-required"
  | "evidence-required"
  | "options-required"
  | "confidence-required"
  | "decision-packet-required"
  | "authority-review-required"
  | "primary-authority-required"
  | "work-order-required"
  | "policy-boundary-required"
  | "retirement-review-required"

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
  allowedOutputs: string[]
  blockedActions: string[]
  requiredEvidence: string[]
  authorityImplication: string
}

export type CouncilStateMachine = {
  title: string
  summary: string
  initialState: CouncilStateId
  terminalState: CouncilStateId
  states: CouncilStateDefinition[]
  noRuntimeTransitionDisclaimer: string
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
      "A read-only schema for how Brain Council advisory work moves from dormant doctrine to evidence review, option framing, decision packets, Work Order recommendations, and owner authority boundaries.",
    initialState: "DORMANT",
    terminalState: "RETIRED",
    states: [
      {
        id: "DORMANT",
        label: "Dormant",
        description: "Brain Council exists as inactive doctrine and has no advisory surface selected for the lane.",
        allowedTransitions: [
          { to: "DOCUMENTED", label: "Document doctrine", guard: "doctrine-required" },
        ],
        allowedOutputs: ["doctrine gap note"],
        blockedActions: ["advise", "execute answer", "dispatch worker", "start runtime"],
        requiredEvidence: ["existing doctrine", "current Work Order scope"],
        authorityImplication: "No authority request is available from this state.",
      },
      {
        id: "DOCUMENTED",
        label: "Documented",
        description: "Static doctrine states what Council is, what it is not, and which powers remain blocked.",
        allowedTransitions: [
          { to: "ADVISORY_READY", label: "Expose advisory model", guard: "advisory-scope-required" },
        ],
        allowedOutputs: ["doctrine summary", "blocked powers list"],
        blockedActions: ["runtime transition", "tool call", "memory write"],
        requiredEvidence: ["Hermes boundary", "WOE boundary", "Academy/Wiki concepts"],
        authorityImplication: "Primary authority remains unchanged.",
      },
      {
        id: "ADVISORY_READY",
        label: "Advisory ready",
        description: "The Council can describe its advisory posture and request bounded context from the Primary or Codex packet.",
        allowedTransitions: [
          { to: "CONTEXT_REQUESTED", label: "Request context", guard: "context-required" },
        ],
        allowedOutputs: ["advisory posture", "context request"],
        blockedActions: ["start chat runtime", "invoke tool", "activate Hermes"],
        requiredEvidence: ["authorized goal", "scope boundary"],
        authorityImplication: "Context request is not permission to act.",
      },
      {
        id: "CONTEXT_REQUESTED",
        label: "Context requested",
        description: "The Council identifies the minimum static context needed before advice can be trusted.",
        allowedTransitions: [
          { to: "EVIDENCE_REVIEW", label: "Review evidence", guard: "evidence-required" },
        ],
        allowedOutputs: ["context checklist", "missing context note"],
        blockedActions: ["scan filesystem", "call GitHub API", "poll production"],
        requiredEvidence: ["current origin/main", "relevant GOAL/WO reports", "safety posture"],
        authorityImplication: "Missing context lowers confidence or blocks advice.",
      },
      {
        id: "EVIDENCE_REVIEW",
        label: "Evidence review",
        description: "Evidence is checked for relevance, freshness, source, and safety boundary before options are framed.",
        allowedTransitions: [
          { to: "OPTIONS_FRAMED", label: "Frame options", guard: "options-required" },
        ],
        allowedOutputs: ["evidence used", "missing evidence", "stale evidence"],
        blockedActions: ["invent proof", "treat stale proof as current", "write evidence"],
        requiredEvidence: ["tests/checks", "production verification", "blocked decisions"],
        authorityImplication: "Evidence can inform; it cannot authorize.",
      },
      {
        id: "OPTIONS_FRAMED",
        label: "Options framed",
        description: "Possible next moves are compared with scope, risks, and required authority.",
        allowedTransitions: [
          { to: "CONFIDENCE_REVIEW", label: "Review confidence", guard: "confidence-required" },
        ],
        allowedOutputs: ["options considered", "tradeoff summary"],
        blockedActions: ["choose action automatically", "dispatch work"],
        requiredEvidence: ["option evidence", "risk notes", "stop conditions"],
        authorityImplication: "Options remain advisory until a packet is accepted.",
      },
      {
        id: "CONFIDENCE_REVIEW",
        label: "Confidence review",
        description: "Confidence is reduced by missing, stale, conflicting, or high-risk evidence.",
        allowedTransitions: [
          { to: "DECISION_PACKET_READY", label: "Prepare packet", guard: "decision-packet-required" },
        ],
        allowedOutputs: ["confidence level", "risk level", "reducers"],
        blockedActions: ["hide uncertainty", "override safety flags"],
        requiredEvidence: ["confidence basis", "risk escalators", "unknowns"],
        authorityImplication: "Low confidence must block or recommend no action.",
      },
      {
        id: "DECISION_PACKET_READY",
        label: "Decision packet ready",
        description: "The Council can present a bounded recommendation with evidence, confidence, risks, and blocked actions.",
        allowedTransitions: [
          { to: "WORK_ORDER_RECOMMENDED", label: "Recommend Work Order", guard: "work-order-required" },
        ],
        allowedOutputs: ["decision packet", "recommended Work Order", "next safe gate"],
        blockedActions: ["approve packet", "submit endpoint", "auto-create WO"],
        requiredEvidence: ["packet fields", "authority required", "validation required"],
        authorityImplication: "Packet is review material, not approval.",
      },
      {
        id: "WORK_ORDER_RECOMMENDED",
        label: "Work Order recommended",
        description: "The Council can recommend a Work Order packet that the Owner may paste to Codex.",
        allowedTransitions: [
          { to: "AUTHORITY_REQUIRED", label: "Require authority", guard: "authority-review-required" },
        ],
        allowedOutputs: ["WO recommendation", "scope", "validators", "stop conditions"],
        blockedActions: ["invoke Codex", "create queue job", "run command"],
        requiredEvidence: ["WO fields", "blocked actions", "owner authority"],
        authorityImplication: "Codex operates only after Owner-authorized packet handoff.",
      },
      {
        id: "AUTHORITY_REQUIRED",
        label: "Authority required",
        description: "Any action beyond advice waits for Primary authority and a governed Work Order.",
        allowedTransitions: [
          { to: "BLOCKED", label: "Block until authority", guard: "primary-authority-required" },
        ],
        allowedOutputs: ["authority requirement", "owner decision packet"],
        blockedActions: ["grant authority", "execute approval", "bypass Work Order"],
        requiredEvidence: ["owner decision", "authority gate", "scope contract"],
        authorityImplication: "Primary decision is required before any mutation lane.",
      },
      {
        id: "BLOCKED",
        label: "Blocked",
        description: "The recommendation cannot advance because evidence, authority, or scope is missing.",
        allowedTransitions: [
          { to: "DENIED", label: "Deny unsafe request", guard: "policy-boundary-required" },
        ],
        allowedOutputs: ["blocked reason", "missing proof", "safe next gate"],
        blockedActions: ["retry in background", "notify as if running", "self-resolve"],
        requiredEvidence: ["blocker", "missing proof", "owner gate"],
        authorityImplication: "Blocked state preserves the boundary.",
      },
      {
        id: "DENIED",
        label: "Denied",
        description: "The recommendation crossed a policy, secret, production, autonomy, or runtime boundary.",
        allowedTransitions: [
          { to: "RETIRED", label: "Retire recommendation", guard: "retirement-review-required" },
        ],
        allowedOutputs: ["denial reason", "policy boundary", "safe alternative"],
        blockedActions: ["repackage unsafe request", "expose secrets", "write production"],
        requiredEvidence: ["denied boundary", "safety rationale"],
        authorityImplication: "Denied recommendations cannot become action without a new owner decision packet.",
      },
      {
        id: "RETIRED",
        label: "Retired",
        description: "The advisory item is closed as obsolete, superseded, or unsafe.",
        allowedTransitions: [],
        allowedOutputs: ["retirement note", "superseding packet reference"],
        blockedActions: ["resume automatically", "dispatch worker", "mutate state"],
        requiredEvidence: ["retirement reason", "replacement lane if any"],
        authorityImplication: "No further action is implied.",
      },
    ],
    noRuntimeTransitionDisclaimer:
      "These states are a static read model only. WilliamOS does not persist, execute, schedule, or advance Council state at runtime.",
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
