import type { OperatorRiskClass, OperatorWorkOrderStatus } from "@/components/operator/codex-operator-registry"

export type PortfolioProgramState = "SELECTED" | "READY" | "BLOCKED" | "DEFERRED" | "COMPLETE" | "SUPERSEDED" | "TERMINAL"
export type PortfolioAuthorityMode = "CODEX_ELIGIBLE" | "OWNER_GATED"

export type PortfolioProgramRecord = {
  programId: string
  title: string
  businessValue: number
  engineeringValue: number
  riskClass: OperatorRiskClass
  dependencies: string[]
  authorityMode: PortfolioAuthorityMode
  state: PortfolioProgramState
  nextGoalId: string
  nextGoalTitle: string
  completionEvidence: string[]
  priorityScore: number
  blockedReason?: string
}

export type PortfolioWorkOrder = {
  workOrderId: string
  title: string
  status: OperatorWorkOrderStatus
  riskClass: "R0" | "R1"
}

const completedPrograms: PortfolioProgramRecord[] = [
  ["PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001", "WilliamOS Multi-Agent Operator", "GOAL-WOS-MULTI-AGENT-OPERATOR-001", "docs/reports/WO-MAO-062-program-closure-portfolio-continuation.md"],
  ["PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001", "Work Order Engine Detail Surfaces", "GOAL-WOE-DETAIL-SURFACES-001", "docs/reports/WO-WILLIAMOS-WOE-DETAIL-SURFACES-003-safety-and-rollup.md"],
  ["PROGRAM-WILLIAMOS-CODEX-OPERATOR-001", "WilliamOS Codex Operator System", "GOAL-WOS-CODEX-OPERATOR-001", "docs/reports/WO-CODEX-OPERATOR-024-final-rollup.md"],
  ["PROGRAM-WILLIAMOS-ACTIVE-QUEUE-001", "Active Program Queue Reconciliation", "GOAL-WOS-ACTIVE-PROGRAM-QUEUE-001", "docs/reports/WO-OPERATOR-QUEUE-005-active-program-queue-rollup.md"],
  ["PROGRAM-WILLIAMOS-COUNTY-OPS-001", "County Ops Knowledge Pack", "GOAL-COUNTY-001", "docs/reports/WO-COUNTY-010-county-ops-final-rollup.md"],
  ["PROGRAM-WILLIAMOS-TF-COMMAND-PREFLIGHT-001", "TerraFusion Command Preflight", "GOAL-TF-COMMAND-PREFLIGHT-001", "docs/reports/WO-TF-COMMAND-000F-preflight-rollup.md"],
  ["PROGRAM-WILLIAMOS-TF-COMMAND-001", "TerraFusion Project Command Layer", "GOAL-TF-COMMAND-001", "docs/reports/WO-TF-COMMAND-006-final-rollup.md"],
  ["PROGRAM-RELEASE-ENGINEERING-001", "Release Engineering", "GOAL-RELEASE-ENGINEERING-001", "docs/reports/release-engineering/WO-RELEASE-006-safety-rollup.md"],
  ["PROGRAM-DEVEX-HOOK-TOOLING-001", "DevEx / Hook Tooling", "GOAL-DEVEX-HOOK-TOOLING-001", "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-003-safety-rollup.md"],
  ["PROGRAM-BACKEND-OE-001", "Backend Operational Excellence", "GOAL-BACKEND-OE-001", "docs/reports/backend-oe/WO-BACKEND-OE-002-readiness-failure-boundary.md"],
].map(([programId, title, nextGoalId, evidence]) => ({
  programId,
  title,
  businessValue: 0,
  engineeringValue: 0,
  riskClass: "R0" as const,
  dependencies: [],
  authorityMode: "CODEX_ELIGIBLE" as const,
  state: "COMPLETE" as const,
  nextGoalId,
  nextGoalTitle: title,
  completionEvidence: [evidence],
  priorityScore: 0,
}))

const backlogSeeds: Array<{
  programId: string
  title: string
  goalId: string
  businessValue: number
  engineeringValue: number
  riskClass: OperatorRiskClass
  dependencies?: string[]
  authorityMode?: PortfolioAuthorityMode
  priorityOverride?: number
  stateOverride?: PortfolioProgramState
}> = [
  { programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001", title: "WilliamOS Multi-Agent Operator", goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001", businessValue: 10, engineeringValue: 10, riskClass: "R3", priorityOverride: 300, stateOverride: "COMPLETE" },
  { programId: "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001", title: "WilliamOS Local-Identity Runtime Operator", goalId: "GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001", businessValue: 0, engineeringValue: 0, riskClass: "R2", priorityOverride: -2, stateOverride: "TERMINAL" },
  { programId: "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001", title: "Superseded Raw-Credential Runtime Operator", goalId: "GOAL-RUNTIME-OPERATOR-LOCAL-FIRST-REMEDIATION-001", businessValue: 0, engineeringValue: 0, riskClass: "R3", priorityOverride: -1, stateOverride: "SUPERSEDED" },
  { programId: "PROGRAM-RELEASE-ENGINEERING-001", title: "Release Engineering", goalId: "GOAL-RELEASE-ENGINEERING-001", businessValue: 9, engineeringValue: 9, riskClass: "R1", stateOverride: "COMPLETE" },
  { programId: "PROGRAM-DEVEX-HOOK-TOOLING-001", title: "DevEx / Hook Tooling", goalId: "GOAL-DEVEX-HOOK-TOOLING-001", businessValue: 7, engineeringValue: 9, riskClass: "R1", stateOverride: "COMPLETE" },
  { programId: "PROGRAM-BACKEND-OE-001", title: "Backend Operational Excellence", goalId: "GOAL-BACKEND-OE-001", businessValue: 8, engineeringValue: 8, riskClass: "R1", stateOverride: "COMPLETE" },
  { programId: "PROGRAM-PROPERTY-WORKBENCH-001", title: "Property Workbench", goalId: "GOAL-PROPERTY-WORKBENCH-001", businessValue: 9, engineeringValue: 7, riskClass: "R1", authorityMode: "OWNER_GATED", stateOverride: "BLOCKED" },
  { programId: "PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001", title: "Work Order Engine Detail Surfaces", goalId: "GOAL-WOE-DETAIL-SURFACES-001", businessValue: 8, engineeringValue: 9, riskClass: "R1", stateOverride: "COMPLETE" },
  { programId: "PROGRAM-TERRAPILOT-LIVE-001", title: "TerraPilot Live Integration", goalId: "GOAL-TERRAPILOT-LIVE-001", businessValue: 9, engineeringValue: 8, riskClass: "R2", authorityMode: "OWNER_GATED", dependencies: ["PROGRAM-BACKEND-OE-001"] },
  { programId: "PROGRAM-AI-BRAIN-OPS-001", title: "AI / Brain Operationalization", goalId: "GOAL-AI-BRAIN-OPS-001", businessValue: 8, engineeringValue: 8, riskClass: "R2", authorityMode: "OWNER_GATED" },
  { programId: "PROGRAM-COUNTY-RUNTIME-READINESS-001", title: "County Runtime Readiness", goalId: "GOAL-COUNTY-RUNTIME-READINESS-001", businessValue: 10, engineeringValue: 7, riskClass: "R3", authorityMode: "OWNER_GATED", dependencies: ["PROGRAM-PROPERTY-WORKBENCH-001"] },
  { programId: "PROGRAM-RELEASE-ROLLBACK-AUTOMATION-001", title: "Release and Rollback Automation", goalId: "GOAL-RELEASE-ROLLBACK-AUTOMATION-001", businessValue: 8, engineeringValue: 9, riskClass: "R2", authorityMode: "OWNER_GATED", dependencies: ["PROGRAM-RELEASE-ENGINEERING-001"] },
  { programId: "PROGRAM-PRODUCTION-COUNTY-DEPLOYMENT-001", title: "Production / County Deployment", goalId: "GOAL-PRODUCTION-COUNTY-DEPLOYMENT-001", businessValue: 10, engineeringValue: 8, riskClass: "R4", authorityMode: "OWNER_GATED", dependencies: ["PROGRAM-COUNTY-RUNTIME-READINESS-001", "PROGRAM-RELEASE-ROLLBACK-AUTOMATION-001"] },
]

function priorityScore(seed: (typeof backlogSeeds)[number]) {
  const dependencyBonus = seed.dependencies?.length ? 0 : 20
  const authorityPenalty = seed.authorityMode === "OWNER_GATED" ? 100 : 0
  const riskPenalty = { R0: 0, R1: 2, R2: 10, R3: 20, R4: 30 }[seed.riskClass]
  return seed.priorityOverride ?? seed.businessValue * 5 + seed.engineeringValue * 3 + dependencyBonus - authorityPenalty - riskPenalty
}

export const PORTFOLIO_BACKLOG: PortfolioProgramRecord[] = backlogSeeds.map((seed) => ({
  programId: seed.programId,
  title: seed.title,
  businessValue: seed.businessValue,
  engineeringValue: seed.engineeringValue,
  riskClass: seed.riskClass,
  dependencies: seed.dependencies ?? [],
  authorityMode: seed.authorityMode ?? "CODEX_ELIGIBLE",
  state: seed.stateOverride ?? (seed.authorityMode === "OWNER_GATED" ? "BLOCKED" : "READY"),
  nextGoalId: seed.goalId,
  nextGoalTitle: `${seed.title} Foundation`,
  completionEvidence: [],
  priorityScore: priorityScore(seed),
  blockedReason: seed.programId === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    ? "Closed with evidence-backed rejection: hosted Codex delivery advanced, but durable unattended background-runtime certification was not proven."
    : seed.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001"
    ? "Terminal and nonselectable: issue #357 failed at CODEX_NETWORK_WALL and must not be retried; issue #358 remains dependency-blocked; activation remains disabled."
    : seed.programId === "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001"
      ? "Superseded by the local-identity runtime program; raw credential files and identity-bearing Docker hosting are prohibited."
      : seed.programId === "PROGRAM-PROPERTY-WORKBENCH-001"
        ? "Owner-gated and nonselectable: property/TerraFusion/county placeholder work must not start from the WilliamOS portfolio queue."
      : seed.programId === "PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001"
        ? "Activated by owner packet and completed as a WilliamOS-native read-only detail surface program."
      : seed.authorityMode === "OWNER_GATED" ? "Protected authority is required before activation." : undefined,
}))

export const LOCAL_IDENTITY_RUNTIME_WORK_ORDER_TITLES = [
  "Live Baseline and Containment Reconciliation",
  "Credential-Custody Failure Record",
  "Inert Docker Operator Freeze",
  "Raw Credential Placeholder Retirement",
  "Codex ChatGPT Login Contract",
  "GitHub Browser Login Contract",
  "Windows User-Context Runtime Decision",
  "Docker Validation-Only Boundary",
  "Authentication Status Adapter",
  "Local Identity Threat Model",
  "Native Runtime Directory Contract",
  "PowerShell Supervisor",
  "Activation and Kill Switch",
  "Single-Instance Lock and Host Lease",
  "Durable Checkpoint Store",
  "Workspace and Git Safety",
  "Codex Non-Interactive Adapter",
  "Patch Envelope and Path Policy",
  "GitHub CLI Adapter",
  "Retry, Recovery, and Idempotency",
  "Append-Only Audit Ledger",
  "Cost, Rate, and Run Budgets",
  "Authority Evaluator Integration",
  "Secret and Exfiltration Defense",
  "Native Supervisor Test Suite",
  "Disabled End-to-End Dry Run",
  "Authenticated Read-Only Smoke",
  "Pilot Work Order Packet",
  "Owner Activation Gate",
  "One-Work-Order Pilot Execution",
  "PR, Review, and Eligible Merge Proof",
  "Kill, Restart, and Recovery Drill",
  "At-Logon Scheduling",
  "Operator Status and Owner UX",
  "Runbook, Academy, and Incident Procedure",
  "Final Safety and Evidence Rollup",
  "Portfolio Continuation Handoff",
  "Phase 2 Ubuntu Decision Packet",
] as const

const portfolioWorkOrders: PortfolioWorkOrder[] = [
  "Current-State and Completed-Program Reconciliation",
  "Canonical Program Backlog",
  "Program Priority Model",
  "Next-Goal Resolver",
  "Goal Generator",
  "Loop Generator",
  "Work Order Chain Generator",
  "Continuous Operator Activation",
  "Owner Decision Queue",
  "Portfolio Evidence Rollup",
].map((title, index) => ({
  workOrderId: `WO-PORTFOLIO-${String(index + 1).padStart(3, "0")}`,
  title,
  status: "COMPLETE" as const,
  riskClass: index === 3 || index === 4 || index === 5 || index === 6 ? "R1" as const : "R0" as const,
}))

export function getPortfolioOperatorProgram() {
  return {
    programId: "portfolio-operator",
    goal: {
      goalId: "GOAL-PORTFOLIO-OPERATOR-001",
      title: "Continuous Program and Goal Selection",
      status: "COMPLETE" as const,
    },
    loop: {
      loopId: "LOOP-PORTFOLIO-OPERATOR-001",
      continuation: "Select the next approved executable program after verified completion.",
    },
    completedPrograms,
    backlog: PORTFOLIO_BACKLOG,
    workOrders: portfolioWorkOrders,
    safety: {
      commandRunnerAdded: false,
      autonomousRuntimeLoopAdded: false,
      backgroundWorkerAdded: false,
      productionWriteAdded: false,
      authChanged: false,
      databaseOrSchemaChanged: false,
      envOrPackageChanged: false,
      hermesMcpWorkerActivated: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      dynamicIngestionAdded: false,
      terraFusionPacsTouched: false,
      secretsExposed: false,
    },
  }
}
