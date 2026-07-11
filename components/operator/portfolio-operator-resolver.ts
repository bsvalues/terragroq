import type { PortfolioProgramRecord } from "@/components/operator/portfolio-operator-registry"

export function resolveNextPortfolioProgram(programs: PortfolioProgramRecord[]) {
  const complete = new Set(programs.filter((program) => program.state === "COMPLETE").map((program) => program.programId))
  const candidates = programs
    .filter((program) => ["SELECTED", "READY"].includes(program.state))
    .filter((program) => program.authorityMode === "CODEX_ELIGIBLE")
    .filter((program) => program.dependencies.every((dependency) => complete.has(dependency)))
    .sort((left, right) => right.priorityScore - left.priorityScore || left.programId.localeCompare(right.programId))
  const selected = candidates[0]

  if (!selected) {
    return {
      decision: "OWNER_DECISION_REQUIRED" as const,
      reasonCode: "NO_APPROVED_EXECUTABLE_PROGRAM" as const,
      programId: null,
      goalId: null,
      ownerDecisionRequired: true as const,
    }
  }

  return {
    decision: "SELECT_PROGRAM" as const,
    reasonCode: "HIGHEST_PRIORITY_EXECUTABLE_PROGRAM" as const,
    programId: selected.programId,
    goalId: selected.nextGoalId,
    ownerDecisionRequired: false as const,
  }
}

export function buildGoalPacket(program: PortfolioProgramRecord) {
  return {
    goalId: program.nextGoalId,
    title: program.nextGoalTitle,
    mission: `Deliver the bounded ${program.title} foundation using declared evidence and reversible R0/R1 changes.`,
    allowedScope: ["Static governance models", "Read-only surfaces", "Tests", "Evidence reports"],
    blockedScope: ["Production writes", "Secrets", "Destructive operations", "Runtime autonomy", "Auth or database changes"],
    successCriteria: ["The program baseline is reconciled.", "The bounded Work Order chain is evidenced.", "No authority wall is crossed."],
    authorityMode: program.authorityMode,
    riskCeiling: program.riskClass,
    mergeMode: "CODEX_ELIGIBLE" as const,
    stopConditions: ["Protected authority required", "Unsafe validation repair", "Secrets or destructive operation required"],
    ownerDecisionRequired: program.authorityMode === "OWNER_GATED",
  }
}

export function buildLoopPacket(program: PortfolioProgramRecord) {
  const workOrders = buildWorkOrderChain(program)
  return {
    loopId: `LOOP-${program.nextGoalId.replace(/^GOAL-/, "")}`,
    goalId: program.nextGoalId,
    activeWorkOrder: workOrders[0]?.workOrderId ?? null,
    orderedWorkOrderQueue: workOrders.map((workOrder) => workOrder.workOrderId),
    validationCadence: "Focused tests, diff check, lint, full tests, build, PR checks, review threads, merged-main proof.",
    evidenceCadence: "Record observable proof at each Work Order and program closure.",
    prLifecycle: "Codex owns branch, PR, review remediation, eligible merge, and post-merge verification.",
    continuationRule: "After completion, return to the portfolio resolver instead of the Owner.",
    completionCondition: "All bounded Work Orders and evidence are complete.",
  }
}

export function buildWorkOrderChain(program: PortfolioProgramRecord) {
  const titles = program.programId === "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001"
    ? [
        "Runtime Authority and Threat Boundary",
        "Durable Work Order Envelope",
        "Authority Policy Evaluator",
        "Deterministic Lease and Idempotency Model",
        "Read-Only Codex Patch Boundary",
        "Validation and Publish Isolation",
        "Pull Request Check Monitor",
        "Review Remediation and Retry Ceiling",
        "Audit Artifact Attestation",
        "Kill Switch and Stop Runbook",
        "Adversarial Safety Tests",
        "Disabled Control Plane Deployment",
        "Owner Credential Activation Gate",
        "End-to-End Low-Risk Pilot",
      ]
    : program.programId === "PROGRAM-RELEASE-ENGINEERING-001"
    ? [
        "Current Release Evidence Reconciliation",
        "Release Artifact and Provenance Contract",
        "Release Readiness Gate Model",
        "Rollback Evidence Contract",
        "Release Operator Read-Only Surface",
        "Safety Validation and Program Rollup",
      ]
    : [`${program.title} Evidence Reconciliation`, `${program.title} Bounded First Slice`, `${program.title} Safety and Rollup`]

  const workOrderPrefix = program.programId === "PROGRAM-RELEASE-ENGINEERING-001"
    ? "WO-RELEASE"
    : program.programId === "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001"
      ? "WO-RUNTIME-OPERATOR"
      : `WO-${program.programId.replace(/^PROGRAM-/, "").replace(/-001$/, "")}`

  return titles.map((title, index) => ({
    workOrderId: `${workOrderPrefix}-${String(index + 1).padStart(3, "0")}`,
    title,
    objective: index === 0 ? `Reconcile existing ${program.title} evidence before any implementation.` : `Deliver the bounded ${title.toLowerCase()}.`,
    scope: ["Declared repository evidence", "Static/read-only models", "Tests and reports"],
    discoveryBoundary: ["docs/governance", "docs/reports", "components/operator", "tests"],
    riskClass: index === 0 ? "R0" as const : "R1" as const,
    status: index === 0 ? "ACTIVE" as const : "PENDING" as const,
    validationPlan: ["Focused tests", "git diff --check", "lint", "full tests", "build"],
    evidence: `docs/reports/${workOrderPrefix}-${String(index + 1).padStart(3, "0")}.md`,
    rollback: "Revert the scoped documentation and static model changes.",
    continuationTarget: index === titles.length - 1 ? "PORTFOLIO_RESOLVER" : `${workOrderPrefix}-${String(index + 2).padStart(3, "0")}`,
    stopConditions: ["Authority mode changes", "Protected runtime or production scope required", "Validation requires broad repair"],
  }))
}
