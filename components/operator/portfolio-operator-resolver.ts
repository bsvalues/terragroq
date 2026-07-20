import {
  LOCAL_IDENTITY_RUNTIME_WORK_ORDER_TITLES,
  type PortfolioProgramRecord,
} from "@/components/operator/portfolio-operator-registry"
import { MULTI_AGENT_OPERATOR_WORK_ORDERS } from "@/components/operator/multi-agent-operator-registry"

export const OWNER_OUTCOME_DELIVERY_COMPLETED_COUNT = 0

export function deriveOrderedWorkOrderStatuses(totalWorkOrders: number, completedWorkOrders: number) {
  if (!Number.isInteger(totalWorkOrders) || totalWorkOrders < 1) {
    throw new RangeError("totalWorkOrders must be a positive integer")
  }
  if (!Number.isInteger(completedWorkOrders) || completedWorkOrders < 0 || completedWorkOrders > totalWorkOrders) {
    throw new RangeError("completedWorkOrders must be an integer within the work-order range")
  }

  return Array.from({ length: totalWorkOrders }, (_, index) =>
    index < completedWorkOrders
      ? "COMPLETE" as const
      : index === completedWorkOrders
        ? "READY" as const
        : "PENDING" as const,
  )
}

export function resolveNextPortfolioProgram(programs: PortfolioProgramRecord[]) {
  const complete = new Set(programs.filter((program) => program.state === "COMPLETE").map((program) => program.programId))
  const candidates = programs
    .filter((program) => ["SELECTED", "READY"].includes(program.state))
    .filter((program) => program.authorityMode === "CODEX_ELIGIBLE")
    .filter((program) => program.dependencies.every((dependency) => complete.has(dependency)))
    .filter((program) => {
      const loop = buildLoopPacket(program)
      return loop.eligibleWorkOrders.length > 0
        || (program.state === "SELECTED" && loop.remediationTransition !== null)
    })
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
    reasonCode: selected.state === "SELECTED" && buildLoopPacket(selected).remediationTransition !== null
      ? "SELECTED_PROGRAM_REMEDIATION_REQUIRED" as const
      : "HIGHEST_PRIORITY_EXECUTABLE_PROGRAM" as const,
    programId: selected.programId,
    goalId: selected.nextGoalId,
    ownerDecisionRequired: false as const,
  }
}

export type OperatorHost =
  | "LOCAL_OMEN_WINDOWS"
  | "LOCAL_OMEN_DOCKER_VALIDATION"
  | "DEDICATED_UBUNTU"
  | "GITHUB_ACTIONS"

export function evaluateOperatorHost(host: OperatorHost, explicitOwnerDecision = false) {
  if (host === "LOCAL_OMEN_WINDOWS") {
    return { selectable: true, reasonCode: "LOCAL_WINDOWS_IDENTITY_HOST_AUTHORIZED" as const }
  }
  if (host === "LOCAL_OMEN_DOCKER_VALIDATION") {
    return { selectable: true, reasonCode: "DOCKER_VALIDATION_ONLY" as const }
  }
  if (host === "DEDICATED_UBUNTU") {
    return { selectable: false, reasonCode: "PHASE_2_NOT_AUTHORIZED" as const }
  }
  return explicitOwnerDecision
    ? { selectable: true, reasonCode: "FUTURE_EXPLICIT_OWNER_DECISION" as const }
    : { selectable: false, reasonCode: "GITHUB_ACTIONS_HOST_PROHIBITED" as const }
}

export type CredentialCustody = "OS_KEYRING" | "RAW_GITHUB_SECRET" | "RAW_LOCAL_FILE"

export function evaluateCredentialCustody(custody: CredentialCustody) {
  if (custody === "OS_KEYRING") {
    return { selectable: true, reasonCode: "OWNER_LOGIN_KEYRING_REQUIRED" as const }
  }
  return custody === "RAW_GITHUB_SECRET"
    ? { selectable: false, reasonCode: "GITHUB_SECRET_CUSTODY_PROHIBITED" as const }
    : { selectable: false, reasonCode: "RAW_LOCAL_FILE_CUSTODY_PROHIBITED" as const }
}

export function buildGoalPacket(program: PortfolioProgramRecord) {
  const localIdentityRuntime =
    program.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001"
  const multiAgentOperator =
    program.programId === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  const ownerOutcomeDelivery =
    program.programId === "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001"

  return {
    goalId: program.nextGoalId,
    title: program.nextGoalTitle,
    mission: multiAgentOperator
      ? "Deliver useful repository work through dependency-cleared, reservation-compatible multi-agent lanes while William remains authority-only."
      : localIdentityRuntime
      ? "Replace raw credential files with owner-controlled browser login and keyring-backed native OMEN operation while activation remains disabled until its explicit gate."
      : ownerOutcomeDelivery
      ? "Turn the Owner's stated outcomes into a rolling bounded WilliamOS-native R0/R1 queue that continues without routine reauthorization or courier work."
      : `Deliver the bounded ${program.title} foundation using declared evidence and reversible R0/R1 changes.`,
    allowedScope: multiAgentOperator
      ? ["Phase 0/1 R1 integration and useful pilots", "Authorized R3 machine-control-plane implementation", "Native Codex teams", "Independent assurance", "Agent-owned GitHub delivery", "Tests and evidence"]
      : localIdentityRuntime
      ? ["Native Windows operator controls", "Keyring authentication contracts", "Docker validation-only isolation", "Tests and evidence"]
      : ownerOutcomeDelivery
      ? ["WilliamOS owner-outcome intake", "Portfolio and queue selection code", "Goal/loop/Work Order generation", "R0/R1 WilliamOS-native product work", "Tests and evidence"]
      : ["Static governance models", "Read-only surfaces", "Tests", "Evidence reports"],
    blockedScope: multiAgentOperator
      ? ["Owner operations", "Owner diagnostics", "Credential handling", "Rejected local runtime retry", "Production or higher-risk authority without an explicit grant"]
      : localIdentityRuntime
      ? ["Raw API keys or PAT files", "GitHub secrets", "Docker credential mounts", "Remote activation", "PACS, county, or TerraFusion production"]
      : ownerOutcomeDelivery
      ? ["Property Workbench, TerraPilot, county, or TerraFusion auto-selection", "Production writes", "Secrets", "Paid overages", "Runtime activation", "Rejected issue #357 retry", "Destructive operations"]
      : ["Production writes", "Secrets", "Destructive operations", "Runtime autonomy", "Auth or database changes"],
    successCriteria: multiAgentOperator
      ? ["Useful work is delivered by concurrent isolated agents.", "Dependencies release automatically from the eligible set.", "All five owner-operation/contact counters remain zero."]
      : localIdentityRuntime
      ? ["The raw credential contract is retired.", "A disabled native supervisor passes safety gates.", "One owner-activated R0/R1 pilot and recovery drill are evidenced."]
      : ownerOutcomeDelivery
      ? ["An owner outcome becomes an executable bounded program without a magic-word authorization ritual.", "The resolver cannot return NO_ACTIVE_PROGRAM while approved useful WilliamOS work remains.", "At least one real WilliamOS feature is delivered through the generated chain."]
      : ["The program baseline is reconciled.", "The bounded Work Order chain is evidenced.", "No authority wall is crossed."],
    authorityMode: program.authorityMode,
    riskCeiling: program.riskClass,
    mergeMode: "CODEX_ELIGIBLE" as const,
    stopConditions: multiAgentOperator
      ? ["Genuine authority expansion required", "Trust-boundary violation", "Secret exposure", "Reservation collision after dispatch"]
      : localIdentityRuntime
      ? ["Interactive owner login required", "Owner activation required", "Plaintext credential fallback", "Protected or higher-risk scope required"]
      : ownerOutcomeDelivery
      ? ["New R2+ authority required", "Protected external project requested", "Secret or destructive operation required", "No useful WilliamOS-native outcome remains"]
      : ["Protected authority required", "Unsafe validation repair", "Secrets or destructive operation required"],
    ownerDecisionRequired: program.authorityMode === "OWNER_GATED",
  }
}

export function buildLoopPacket(
  program: PortfolioProgramRecord,
  ownerOutcomeCompletedCount = OWNER_OUTCOME_DELIVERY_COMPLETED_COUNT,
) {
  const workOrders = buildWorkOrderChain(program, ownerOutcomeCompletedCount)
  const activeWorkOrder = program.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001"
    ? workOrders.find((workOrder) => workOrder.workOrderId === "WO-RUNTIME-IDENTITY-029")
    : workOrders.find((workOrder) => workOrder.status === "READY")
  const eligibleWorkOrders = workOrders
    .filter((workOrder) => workOrder.status === "READY")
    .map((workOrder) => workOrder.workOrderId)
  const remediationTransition = program.programId === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && workOrders.find((workOrder) => workOrder.workOrderId === "WO-MAO-034")?.status === "COMPLETE"
    && workOrders.find((workOrder) => workOrder.workOrderId === "WO-MAO-035")?.status === "PENDING"
      ? "CORRECT_REDUNDANT_WO_MAO_033_EDGES_BEFORE_WO_MAO_035_REPROOF" as const
      : null
  return {
    loopId: `LOOP-${program.nextGoalId.replace(/^GOAL-/, "")}`,
    goalId: program.nextGoalId,
    activeWorkOrder: activeWorkOrder?.workOrderId ?? null,
    eligibleWorkOrders,
    remediationTransition,
    orderedWorkOrderQueue: workOrders.map((workOrder) => workOrder.workOrderId),
    executionMode: program.programId === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
      ? "DEPENDENCY_RESERVATION_ELIGIBLE_SET" as const
      : "ORDERED_QUEUE" as const,
    validationCadence: "Focused tests, diff check, lint, full tests, build, PR checks, review threads, merged-main proof.",
    evidenceCadence: "Record observable proof at each Work Order and program closure.",
    prLifecycle: "Codex owns branch, PR, review remediation, eligible merge, and post-merge verification.",
    continuationRule: program.programId === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
      ? "Recompute and dispatch every dependency-cleared, reservation-compatible Work Order; contact the Owner only for a genuine authority wall or the final outcome."
      : program.programId === "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001"
      ? "Continue through the rolling owner-outcome queue and never return to NO_ACTIVE_PROGRAM while approved useful WilliamOS-native R0/R1 work remains."
      : "After completion, return to the portfolio resolver instead of the Owner.",
    completionCondition: program.programId === "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001"
      ? "The owner outcome is complete, the useful-work proof is merged, and no approved successor work remains."
      : "All bounded Work Orders and evidence are complete.",
  }
}

export function buildWorkOrderChain(
  program: PortfolioProgramRecord,
  ownerOutcomeCompletedCount = OWNER_OUTCOME_DELIVERY_COMPLETED_COUNT,
) {
  if (program.programId === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001") {
    return MULTI_AGENT_OPERATOR_WORK_ORDERS.map((record) => ({
      workOrderId: record.workOrderId,
      title: record.title,
      objective: `Deliver ${record.title.toLowerCase()} with dependency, reservation, authority, and evidence gates.`,
      scope: ["Declared repository evidence", `Reserved ${record.riskClass} paths`, "Tests and reports"],
      discoveryBoundary: ["docs/governance", "docs/reports", "components/operator", "scripts/multi-agent-operator", "tests"],
      riskClass: record.riskClass,
      status: record.status,
      resumable: record.resumable,
      validationPlan: ["Focused tests", "git diff --check", "lint", "full tests", "build"],
      evidence: record.evidencePath,
      rollback: "Revert only the lane-owned, reservation-scoped changes through normal review.",
      continuationTarget: "DEPENDENCY_RESERVATION_ELIGIBLE_SET",
      stopConditions: ["Genuine authority expansion required", "Trust-boundary violation", "Reservation conflict"],
      dependsOn: record.dependsOn,
      ownerOperationsAllowed: record.ownerOperationsAllowed,
    }))
  }

  const ownerOutcomeDelivery = program.programId === "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001"
  const titles = program.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001"
    ? LOCAL_IDENTITY_RUNTIME_WORK_ORDER_TITLES
    : program.programId === "PROGRAM-RELEASE-ENGINEERING-001"
    ? [
        "Current Release Evidence Reconciliation",
        "Release Artifact and Provenance Contract",
        "Release Readiness Gate Model",
        "Rollback Evidence Contract",
        "Release Operator Read-Only Surface",
        "Safety Validation and Program Rollup",
      ]
    : ownerOutcomeDelivery
    ? [
        "Current Continuation Dead-End Reconciliation",
        "Owner Outcome Intake Contract",
        "Rolling WilliamOS-Native Backlog",
        "No-Idle Resolver Invariant",
        "Useful WilliamOS Feature Delivery Proof",
        "Safety and Continuation Rollup",
      ]
    : [`${program.title} Evidence Reconciliation`, `${program.title} Bounded First Slice`, `${program.title} Safety and Rollup`]

  const workOrderPrefix = program.programId === "PROGRAM-RELEASE-ENGINEERING-001"
    ? "WO-RELEASE"
    : program.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001"
      ? "WO-RUNTIME-IDENTITY"
      : ownerOutcomeDelivery
        ? "WO-OWNER-OUTCOME"
        : `WO-${program.programId.replace(/^PROGRAM-/, "").replace(/-001$/, "")}`
  const ownerOutcomeStatuses = ownerOutcomeDelivery
    ? deriveOrderedWorkOrderStatuses(titles.length, ownerOutcomeCompletedCount)
    : null

  return titles.map((title, index) => ({
    workOrderId: `${workOrderPrefix}-${String(index + 1).padStart(3, "0")}`,
    title,
    objective: index === 0 ? `Reconcile existing ${program.title} evidence before any implementation.` : `Deliver the bounded ${title.toLowerCase()}.`,
    scope: program.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001"
      ? ["Declared repository and host evidence", "Bounded native runtime controls", "Tests and reports"]
      : ownerOutcomeDelivery
      ? ["WilliamOS portfolio and operator code", "Owner outcome and queue models", "R0/R1 product work", "Tests and reports"]
      : ["Declared repository evidence", "Static/read-only models", "Tests and reports"],
    discoveryBoundary: ownerOutcomeDelivery
      ? ["docs/governance", "docs/reports", "components/operator", "components/work-orders", "tests"]
      : ["docs/governance", "docs/reports", "components/operator", "tests"],
    riskClass: index === 0 ? "R0" as const : "R1" as const,
    status: program.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001"
      ? index < 26 || index === 27
        ? "COMPLETE" as const
        : index === 26 || index === 28
          ? "BLOCKED" as const
          : "PENDING" as const
      : ownerOutcomeDelivery
        ? ownerOutcomeStatuses![index]
        : index === 0 ? "READY" as const : "PENDING" as const,
    validationPlan: ["Focused tests", "git diff --check", "lint", "full tests", "build"],
    evidence: `docs/reports/${workOrderPrefix}-${String(index + 1).padStart(3, "0")}.md`,
    rollback: program.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001"
      ? "Disable the operator first, then revert only runtime-owned scoped changes through normal review."
      : ownerOutcomeDelivery
      ? "Revert only the owner-outcome program's scoped queue, resolver, surface, test, and evidence changes."
      : "Revert the scoped documentation and static model changes.",
    continuationTarget: index === titles.length - 1
      ? ownerOutcomeDelivery ? "ROLLING_OWNER_OUTCOME_RESOLVER" : "PORTFOLIO_RESOLVER"
      : `${workOrderPrefix}-${String(index + 2).padStart(3, "0")}`,
    stopConditions: ownerOutcomeDelivery
      ? ["R2+ authority required", "External project or protected data requested", "Secrets, paid overage, runtime activation, or destructive operation required"]
      : ["Authority mode changes", "Protected runtime or production scope required", "Validation requires broad repair"],
  }))
}
