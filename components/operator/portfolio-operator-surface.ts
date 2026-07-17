import { getPortfolioOperatorProgram } from "@/components/operator/portfolio-operator-registry"
import { buildLoopPacket, buildWorkOrderChain, resolveNextPortfolioProgram } from "@/components/operator/portfolio-operator-resolver"

type ActiveDependencyState = {
  total: number
  satisfied: number
  dependencies: Array<{
    workOrderId: string
    status: string
    satisfied: boolean
  }>
}

type ActiveReservation = {
  evidencePath: string
  scope: string[]
  discoveryBoundary: string[]
  rollback: string
  ownerOperationsAllowed: boolean
}

export function getPortfolioOperatorSurface(portfolio = getPortfolioOperatorProgram()) {
  const selection = resolveNextPortfolioProgram([...portfolio.completedPrograms, ...portfolio.backlog])
  const selected = portfolio.backlog.find((program) => program.programId === selection.programId) ?? null
  const workOrders = selected ? buildWorkOrderChain(selected) : []
  const loop = selected ? buildLoopPacket(selected) : null
  const activeWorkOrderId = loop?.activeWorkOrder ?? null
  const activeWorkOrder = workOrders.find((workOrder) => workOrder.workOrderId === activeWorkOrderId) ?? null
  const activeDependencies = activeWorkOrder && "dependsOn" in activeWorkOrder ? activeWorkOrder.dependsOn : []
  const activeOwnerOperationsAllowed = activeWorkOrder && "ownerOperationsAllowed" in activeWorkOrder
    ? activeWorkOrder.ownerOperationsAllowed
    : false
  const completedWorkOrders = workOrders.filter((workOrder) => workOrder.status === "COMPLETE")
  const readyWorkOrders = workOrders.filter((workOrder) => workOrder.status === "READY")
  const deferredWorkOrders = workOrders.filter((workOrder) => workOrder.status === "DEFERRED_PROVIDER_UNAVAILABLE")
  const blockedWorkOrders = workOrders.filter((workOrder) => workOrder.status === "BLOCKED")
  const completedIds = new Set(completedWorkOrders.map((workOrder) => workOrder.workOrderId))
  const activeDependencyState: ActiveDependencyState | null = activeWorkOrder
    ? {
        total: activeDependencies.length,
        satisfied: activeDependencies.filter((dependency) => completedIds.has(dependency)).length,
        dependencies: activeDependencies.map((dependency) => ({
          workOrderId: dependency,
          status: workOrders.find((workOrder) => workOrder.workOrderId === dependency)?.status ?? "UNKNOWN",
          satisfied: completedIds.has(dependency),
        })),
      }
    : null
  const activeReservation: ActiveReservation | null = activeWorkOrder
    ? {
        evidencePath: activeWorkOrder.evidence,
        scope: activeWorkOrder.scope,
        discoveryBoundary: activeWorkOrder.discoveryBoundary,
        rollback: activeWorkOrder.rollback,
        ownerOperationsAllowed: activeOwnerOperationsAllowed,
      }
    : null
  const evidenceChain = completedWorkOrders.slice(-6).map((workOrder) => ({
    workOrderId: workOrder.workOrderId,
    title: workOrder.title,
    evidencePath: workOrder.evidence,
    status: workOrder.status,
  }))
  const ownerAuthorityWalls = portfolio.backlog
    .filter((program) => program.authorityMode === "OWNER_GATED" || ["TERMINAL", "SUPERSEDED"].includes(program.state))
    .map((program) => ({
      programId: program.programId,
      title: program.title,
      state: program.state,
      authorityMode: program.authorityMode,
      reason: program.blockedReason ?? "Protected authority is required before activation.",
    }))
  const providerPosture = [
    {
      label: "Hosted Codex",
      status: "available",
      summary: "Current-session coordination and review lanes are proven; no durable unattended runtime is certified.",
    },
    {
      label: "Claude Code",
      status: "deferred",
      summary: "Provider lane remains deferred and unavailable through WO-MAO-033.",
    },
    {
      label: "Local nested Codex",
      status: "rejected",
      summary: "Issue #357 remains terminal; the rejected local adapter must not be retried or reused.",
    },
  ] as const
  const safetyFlags = Object.entries(portfolio.safety).map(([key, value]) => ({ key, value }))

  return {
    eyebrow: "GOAL-PORTFOLIO-OPERATOR-001",
    title: "Portfolio Operator",
    description: "Completed programs route to the highest-priority approved executable program. The Primary is involved only at a true authority wall.",
    selection,
    selectedProgram: selected,
    activeWorkOrder,
    loop,
    statusCounts: {
      total: workOrders.length,
      complete: completedWorkOrders.length,
      ready: readyWorkOrders.length,
      pending: workOrders.filter((workOrder) => workOrder.status === "PENDING").length,
      blocked: blockedWorkOrders.length,
      deferred: deferredWorkOrders.length,
    },
    activeDependencyState,
    activeReservation,
    evidenceChain,
    readyWorkOrders: readyWorkOrders.map((workOrder) => workOrder.workOrderId),
    blockedWorkOrders: blockedWorkOrders.map((workOrder) => workOrder.workOrderId),
    deferredWorkOrders: deferredWorkOrders.map((workOrder) => workOrder.workOrderId),
    ownerAuthorityWalls,
    providerPosture,
    safetyFlags,
    backlog: portfolio.backlog,
    controls: [] as never[],
    safety: portfolio.safety,
  }
}
