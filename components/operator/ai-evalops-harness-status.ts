export const AI_EVALOPS_MATURITY_STATES = [
  "MODEL_VERIFIED",
  "CONTRACT_VERIFIED",
  "ADAPTER_PROVEN",
  "RECOVERY_PROVEN",
  "SOAK_PROVEN",
  "PRODUCTION_AUTHORIZED",
] as const

export type AiEvalOpsMaturityState = (typeof AI_EVALOPS_MATURITY_STATES)[number]

export const AI_EVALOPS_MATURITY_DEFINITIONS: Readonly<Record<AiEvalOpsMaturityState, string>> = {
  MODEL_VERIFIED: "A deterministic or zero-input model passed tests; no live execution is implied.",
  CONTRACT_VERIFIED: "Exact input, authority, output, and failure semantics passed contract tests.",
  ADAPTER_PROVEN: "A bounded real operation executed through the reviewed adapter.",
  RECOVERY_PROVEN: "Restart and ambiguous-outcome recovery passed live failure tests.",
  SOAK_PROVEN: "The declared continuous-duration and useful-work soak passed.",
  PRODUCTION_AUTHORIZED: "Separate active authority covers the exact deployment and operation.",
}

export type AiEvalOpsEvidenceState = Readonly<{
  modelVerified: boolean
  contractVerified: boolean
  adapterProven: boolean
  recoveryProven: boolean
  soakProven: boolean
  productionAuthorityActive: boolean
}>

export type AiEvalOpsRuntimeClaims = Readonly<{
  schedulerActive: boolean
  backgroundWorkerActive: boolean
  runtimeActivated: boolean
  productionAuthorized: boolean
  issue357QuarantinedTerminal: boolean
}>

export type AiEvalOpsMaturityGate = Readonly<{
  status: "EVIDENCED" | "FUTURE_GATE"
  evidencePaths: readonly string[]
  requiredWorkOrders: readonly string[]
}>

export type AiEvalOpsHistoryReference = Readonly<{
  path: string
  purpose: string
  immutable: true
}>

export type AiEvalOpsCurrentStatus = Readonly<{
  schema: "williamos.ai-evalops-current-status/v1"
  programId: "PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001"
  goalId: "GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001"
  loopId: "LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001"
  currentMaturity: AiEvalOpsMaturityState
  statusLabel: string
  evidence: AiEvalOpsEvidenceState
  maturityGates: Readonly<Record<AiEvalOpsMaturityState, AiEvalOpsMaturityGate>>
  runtime: AiEvalOpsRuntimeClaims
  historyReferences: readonly AiEvalOpsHistoryReference[]
  nonProof: readonly string[]
}>

const evidenceByState: Readonly<Record<AiEvalOpsMaturityState, keyof AiEvalOpsEvidenceState>> = {
  MODEL_VERIFIED: "modelVerified",
  CONTRACT_VERIFIED: "contractVerified",
  ADAPTER_PROVEN: "adapterProven",
  RECOVERY_PROVEN: "recoveryProven",
  SOAK_PROVEN: "soakProven",
  PRODUCTION_AUTHORIZED: "productionAuthorityActive",
}

export const AI_EVALOPS_HISTORY_REFERENCES: readonly AiEvalOpsHistoryReference[] = [
  { path: "docs/governance/ai-evalops-harness-program.md", purpose: "program contract and maturity vocabulary", immutable: true },
  { path: "docs/governance/WO-AEH-000-ai-evalops-harness-program-coordination.md", purpose: "umbrella Work Order and non-activation boundary", immutable: true },
  { path: "docs/reports/ai-evalops-harness/WO-AEH-001-program-activation-registration-and-authority-map.md", purpose: "R1 program registration evidence", immutable: true },
  { path: "docs/reports/ai-evalops-harness/WO-AEH-002-current-state-and-drift-inventory.md", purpose: "read-only current-state inventory", immutable: true },
  { path: "docs/reports/WO-MAO-059-sustained-zero-touch-soak-rejection.md", purpose: "historical unattended-soak rejection", immutable: true },
  { path: "docs/reports/WO-MAO-062-program-closure-portfolio-continuation.md", purpose: "historical multi-agent program closure", immutable: true },
] as const

export function deriveAiEvalOpsStatusLabel(status: Pick<AiEvalOpsCurrentStatus, "currentMaturity" | "runtime">): string {
  return [
    status.currentMaturity,
    status.runtime.runtimeActivated ? "RUNTIME_ACTIVE" : "RUNTIME_NOT_ACTIVE",
    status.runtime.productionAuthorized ? "PRODUCTION_AUTHORIZED" : "PRODUCTION_NOT_AUTHORIZED",
  ].join(" / ")
}

export function validateAiEvalOpsCurrentStatus(status: AiEvalOpsCurrentStatus): void {
  const maturityIndex = AI_EVALOPS_MATURITY_STATES.indexOf(status.currentMaturity)
  if (maturityIndex < 0) throw new Error("unknown maturity state")
  if (new Set(AI_EVALOPS_MATURITY_STATES).size !== 6) throw new Error("maturity states must be six distinct values")

  for (let index = 0; index < AI_EVALOPS_MATURITY_STATES.length; index += 1) {
    const state = AI_EVALOPS_MATURITY_STATES[index]
    const present = status.evidence[evidenceByState[state]]
    if (index <= maturityIndex && !present) throw new Error(`maturity skip: ${state} lacks evidence`)
    if (index > maturityIndex && present) throw new Error(`maturity overclaim: ${state} exceeds ${status.currentMaturity}`)
  }

  if (maturityIndex < 2 && (status.runtime.runtimeActivated || status.runtime.schedulerActive || status.runtime.backgroundWorkerActive)) {
    throw new Error("runtime overclaim below ADAPTER_PROVEN")
  }
  if (status.runtime.productionAuthorized !== status.evidence.productionAuthorityActive) {
    throw new Error("production authority claim conflicts with authority evidence")
  }
  if (status.runtime.productionAuthorized && status.currentMaturity !== "PRODUCTION_AUTHORIZED") {
    throw new Error("production authorization cannot precede PRODUCTION_AUTHORIZED maturity")
  }
  if (!status.runtime.issue357QuarantinedTerminal) throw new Error("issue #357 quarantine must remain terminal")
  if (status.statusLabel !== deriveAiEvalOpsStatusLabel(status)) throw new Error("status label conflicts with structured truth")
  if (status.historyReferences.length === 0 || status.historyReferences.some((reference) => reference.immutable !== true)) {
    throw new Error("history references must be immutable")
  }
  if (new Set(status.historyReferences.map((reference) => reference.path)).size !== status.historyReferences.length) {
    throw new Error("history references must be unique")
  }
  const historyPaths = new Set(status.historyReferences.map((reference) => reference.path))
  for (const state of AI_EVALOPS_MATURITY_STATES) {
    const gate = status.maturityGates[state]
    const evidenced = status.evidence[evidenceByState[state]]
    if (gate.status === "EVIDENCED") {
      if (!evidenced) throw new Error(`evidence gate conflicts with false ${state} bit`)
      if (gate.evidencePaths.length === 0) throw new Error(`evidenced ${state} lacks evidence references`)
      if (gate.evidencePaths.some((evidencePath) => !historyPaths.has(evidencePath))) {
        throw new Error(`evidenced ${state} has an unbound history reference`)
      }
      if (gate.requiredWorkOrders.length !== 0) throw new Error(`evidenced ${state} cannot retain a future gate`)
    } else {
      if (evidenced) throw new Error(`unsupported ${state} claim remains future-gated`)
      if (gate.requiredWorkOrders.length === 0) throw new Error(`future ${state} lacks an explicit Work Order gate`)
      if (gate.evidencePaths.length !== 0) throw new Error(`future ${state} cannot claim evidence references`)
    }
  }
}

const evidence: AiEvalOpsEvidenceState = {
  modelVerified: true,
  contractVerified: false,
  adapterProven: false,
  recoveryProven: false,
  soakProven: false,
  productionAuthorityActive: false,
}

const maturityGates: Readonly<Record<AiEvalOpsMaturityState, AiEvalOpsMaturityGate>> = {
  MODEL_VERIFIED: {
    status: "EVIDENCED",
    evidencePaths: [
      "docs/governance/ai-evalops-harness-program.md",
      "docs/governance/WO-AEH-000-ai-evalops-harness-program-coordination.md",
    ],
    requiredWorkOrders: [],
  },
  CONTRACT_VERIFIED: { status: "FUTURE_GATE", evidencePaths: [], requiredWorkOrders: ["WO-AEH-021"] },
  ADAPTER_PROVEN: { status: "FUTURE_GATE", evidencePaths: [], requiredWorkOrders: ["WO-AEH-028"] },
  RECOVERY_PROVEN: { status: "FUTURE_GATE", evidencePaths: [], requiredWorkOrders: ["WO-AEH-034", "WO-AEH-052"] },
  SOAK_PROVEN: { status: "FUTURE_GATE", evidencePaths: [], requiredWorkOrders: ["WO-AEH-041"] },
  PRODUCTION_AUTHORIZED: { status: "FUTURE_GATE", evidencePaths: [], requiredWorkOrders: ["WO-AEH-042"] },
}

const runtime: AiEvalOpsRuntimeClaims = {
  schedulerActive: false,
  backgroundWorkerActive: false,
  runtimeActivated: false,
  productionAuthorized: false,
  issue357QuarantinedTerminal: true,
}

export const AI_EVALOPS_CURRENT_STATUS: AiEvalOpsCurrentStatus = {
  schema: "williamos.ai-evalops-current-status/v1",
  programId: "PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001",
  goalId: "GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001",
  loopId: "LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001",
  currentMaturity: "MODEL_VERIFIED",
  statusLabel: deriveAiEvalOpsStatusLabel({ currentMaturity: "MODEL_VERIFIED", runtime }),
  evidence,
  maturityGates,
  runtime,
  historyReferences: AI_EVALOPS_HISTORY_REFERENCES,
  nonProof: [
    "Program registration and deterministic contracts do not prove a live durable scheduler.",
    "Existing bounded adapters do not prove the new end-to-end AI lane or restart recovery.",
    "Historical capability snapshots do not prove current placement readiness.",
    "Only WO-AEH-041 may declare SOAK_PROVEN and only WO-AEH-042 with separate authority may declare PRODUCTION_AUTHORIZED.",
  ],
}

validateAiEvalOpsCurrentStatus(AI_EVALOPS_CURRENT_STATUS)
