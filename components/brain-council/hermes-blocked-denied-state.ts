export type HermesBlockedDeniedItem = {
  label: string
  reason: string
  missingAuthority: string
  evidenceRequired: string
  nextReview: string
  actionTaken: "none"
}

export type HermesBlockedDeniedState = {
  title: string
  summary: string
  items: HermesBlockedDeniedItem[]
  safety: {
    noApprovalExecution: true
    activationButton: false
    dispatchAffordance: false
    workerStarted: false
    productionWrite: false
  }
}

export function getHermesBlockedDeniedState(): HermesBlockedDeniedState {
  return {
    title: "Hermes blocked and denied states",
    summary:
      "Blocked states explain why Hermes cannot act, what authority is missing, what evidence is required, and which review would be needed next. No action has been taken.",
    items: [
      {
        label: "Runtime denied",
        reason: "No Hermes runtime, scheduler, queue, or background worker is authorized.",
        missingAuthority: "Primary activation approval and separate runtime Work Order",
        evidenceRequired: "runtime threat model, rollback plan, safety tests",
        nextReview: "activation readiness review",
        actionTaken: "none",
      },
      {
        label: "Tool access blocked",
        reason: "MCP and external tools are disabled for Hermes.",
        missingAuthority: "tool-specific owner approval",
        evidenceRequired: "tool risk register, allowed actions, denied actions",
        nextReview: "tool authority review",
        actionTaken: "none",
      },
      {
        label: "Production write denied",
        reason: "Hermes cannot deploy or mutate production from this dock.",
        missingAuthority: "production-write approval gate",
        evidenceRequired: "deployment plan, verification plan, rollback condition",
        nextReview: "production authority review",
        actionTaken: "none",
      },
    ],
    safety: {
      noApprovalExecution: true,
      activationButton: false,
      dispatchAffordance: false,
      workerStarted: false,
      productionWrite: false,
    },
  }
}
