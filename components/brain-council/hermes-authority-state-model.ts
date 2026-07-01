export type HermesAuthorityStateId =
  | "disabled"
  | "available-for-planning"
  | "proposed"
  | "blocked"
  | "ready-for-activation-review"
  | "authorized-design-only"
  | "execution-not-active"

export type HermesAuthorityState = {
  id: HermesAuthorityStateId
  label: string
  posture: "inactive" | "review" | "blocked"
  description: string
  requiredBeforeNext: string[]
  forbiddenActions: string[]
}

export type HermesAuthorityStateModel = {
  title: string
  summary: string
  states: HermesAuthorityState[]
  currentState: HermesAuthorityStateId
  safety: {
    modelOnly: true
    activatesHermes: false
    transitionsRuntime: false
    dispatchesJobs: false
    grantsAuthority: false
    writesProduction: false
  }
}

export function getHermesAuthorityStateModel(): HermesAuthorityStateModel {
  return {
    title: "Hermes authority state model",
    summary:
      "A read-only model for the states Hermes must pass through before any future activation review. The current posture is disabled and execution-not-active.",
    currentState: "disabled",
    states: [
      {
        id: "disabled",
        label: "Disabled",
        posture: "inactive",
        description: "Hermes has no runner, queue, scheduler, MCP access, or dispatch authority.",
        requiredBeforeNext: ["Work Order scope", "Primary review"],
        forbiddenActions: ["execute work", "dispatch jobs", "activate tools"],
      },
      {
        id: "available-for-planning",
        label: "Available for planning",
        posture: "review",
        description: "Hermes can be described in plans and readiness surfaces without becoming active.",
        requiredBeforeNext: ["candidate packet", "evidence requirements"],
        forbiddenActions: ["start worker", "poll queue"],
      },
      {
        id: "proposed",
        label: "Proposed",
        posture: "review",
        description: "A candidate Hermes work packet exists for review only.",
        requiredBeforeNext: ["blocked actions", "rollback plan", "authority gate"],
        forbiddenActions: ["issue packet", "run packet"],
      },
      {
        id: "blocked",
        label: "Blocked",
        posture: "blocked",
        description: "Missing evidence, authority, or safety review prevents movement.",
        requiredBeforeNext: ["clear blocker", "record evidence"],
        forbiddenActions: ["override gate", "auto-approve"],
      },
      {
        id: "ready-for-activation-review",
        label: "Ready for activation review",
        posture: "review",
        description: "Design material is ready for owner review, not runtime activation.",
        requiredBeforeNext: ["owner decision", "separate activation Work Order"],
        forbiddenActions: ["activate during review", "deploy worker"],
      },
      {
        id: "authorized-design-only",
        label: "Authorized-design only",
        posture: "review",
        description: "Design may be approved while execution remains explicitly disabled.",
        requiredBeforeNext: ["runtime design gate", "security review"],
        forbiddenActions: ["execute design", "grant production write"],
      },
      {
        id: "execution-not-active",
        label: "Execution not active",
        posture: "inactive",
        description: "Even reviewed work remains non-executing until a future activation lane exists.",
        requiredBeforeNext: ["new owner authorization"],
        forbiddenActions: ["background execution", "autonomous execution", "MCP execution"],
      },
    ],
    safety: {
      modelOnly: true,
      activatesHermes: false,
      transitionsRuntime: false,
      dispatchesJobs: false,
      grantsAuthority: false,
      writesProduction: false,
    },
  }
}
