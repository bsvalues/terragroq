export type HermesActivationRubricCriterion = {
  id: string
  label: string
  requiredEvidence: string[]
  currentStatus: "missing" | "insufficient" | "blocked"
  failureMeaning: string
}

export type HermesActivationReadinessRubric = {
  verdict: "NOT_READY_FOR_ACTIVATION"
  criteria: HermesActivationRubricCriterion[]
  minimumStandard: string
  safety: {
    approvesActivation: false
    createsLedgerEntry: false
    enablesRuntime: false
    enablesAutonomy: false
    enablesMcp: false
    permitsProductionWrite: false
  }
}

export function getHermesActivationReadinessRubric(): HermesActivationReadinessRubric {
  return {
    verdict: "NOT_READY_FOR_ACTIVATION",
    minimumStandard:
      "Hermes cannot move beyond preview until every criterion is supported by evidence and a separate owner-approved activation design exists.",
    criteria: [
      {
        id: "repeatability",
        label: "Repeated usefulness",
        requiredEvidence: ["multiple procedure replays", "operator-reviewed outcomes", "false-positive analysis"],
        currentStatus: "insufficient",
        failureMeaning: "A useful-looking one-off cannot justify runtime authority.",
      },
      {
        id: "quarantine",
        label: "Skill quarantine cleared",
        requiredEvidence: ["provenance record", "risk class", "ratification record", "activation ledger draft"],
        currentStatus: "missing",
        failureMeaning: "Skill-like outputs must remain non-invokable.",
      },
      {
        id: "sandbox",
        label: "Sandbox proof",
        requiredEvidence: ["read-only input proof", "egress review", "secret scan", "mutation block proof"],
        currentStatus: "missing",
        failureMeaning: "Sandbox output cannot be trusted or imported.",
      },
      {
        id: "authority",
        label: "Explicit owner authority",
        requiredEvidence: ["activation scope", "rollback plan", "expiry/review date", "owner decision"],
        currentStatus: "blocked",
        failureMeaning: "No authority exists for MCP, autonomy, workers, deploys, or production writes.",
      },
    ],
    safety: {
      approvesActivation: false,
      createsLedgerEntry: false,
      enablesRuntime: false,
      enablesAutonomy: false,
      enablesMcp: false,
      permitsProductionWrite: false,
    },
  }
}
