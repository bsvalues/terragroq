import {
  projectWorkbenchExecution,
  type ExecutionAcquisitionRow,
  type ExecutionAuditRow,
  type ExecutionBindingRow,
  type ExecutionClaimRow,
  type ExecutionEvidenceRow,
  type ExecutionGoalRow,
  type ExecutionGovernanceRow,
  type ExecutionLoopRow,
  type ExecutionOutcomeRow,
  type ExecutionWorkOrderRow,
  type WorkbenchExecutionProjection,
  type WorkbenchExecutionProjectionInput,
} from "@/lib/workbench/execution-projection"

export const WORKBENCH_EXECUTION_SOURCE_LIMIT = 200

export type WorkbenchExecutionTargets = Readonly<{
  goalIds: number[]
  outcomeKeys: string[]
  workOrderIds: number[]
}>

type ScopeRow = { projectId: number; threadId: string; userId: string }

export interface WorkbenchExecutionRepository {
  getScope(userId: string, projectId: number, threadId: string): Promise<ScopeRow | null>
  listBindings(userId: string, threadId: string, limit: number): Promise<ExecutionBindingRow[]>
  listGoals(userId: string, ids: number[], limit: number): Promise<ExecutionGoalRow[]>
  listOutcomes(userId: string, selector: { outcomeKeys: string[]; goalIds: number[] }, limit: number): Promise<ExecutionOutcomeRow[]>
  listWorkOrders(userId: string, ids: number[], limit: number): Promise<ExecutionWorkOrderRow[]>
  listClaims(userId: string, workOrderIds: number[], limit: number): Promise<ExecutionClaimRow[]>
  listLoops(userId: string, workOrderIds: number[], limit: number): Promise<ExecutionLoopRow[]>
  listEvidence(userId: string, workOrderIds: number[], evidenceIds: number[], limit: number): Promise<ExecutionEvidenceRow[]>
  listGovernanceEvents(userId: string, targets: WorkbenchExecutionTargets, limit: number): Promise<ExecutionGovernanceRow[]>
  listAuditEvents(userId: string, targets: WorkbenchExecutionTargets, limit: number): Promise<ExecutionAuditRow[]>
  listAcquisitionAttempts(userId: string, outcomeKeys: string[], workOrderIds: number[], limit: number): Promise<ExecutionAcquisitionRow[]>
}

type Dependencies = Readonly<{
  authenticate: () => Promise<string>
  repository: WorkbenchExecutionRepository
  clock?: () => Date
}>

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function bounded<T>(rows: readonly T[]): { rows: T[]; truncated: boolean } {
  return {
    rows: rows.slice(0, WORKBENCH_EXECUTION_SOURCE_LIMIT),
    truncated: rows.length > WORKBENCH_EXECUTION_SOURCE_LIMIT,
  }
}

function emptyInput(
  userId: string,
  projectId: number,
  threadId: string,
  observedAt: Date,
  bindings: ExecutionBindingRow[] = [],
): WorkbenchExecutionProjectionInput {
  return {
    userId, projectId, threadId, observedAt, bindings,
    goals: [], outcomes: [], workOrders: [], claims: [], loops: [], evidence: [],
    governanceEvents: [], auditEvents: [], acquisitionAttempts: [], truncatedKinds: [],
  }
}

function owned<T extends { userId: string }>(rows: readonly T[], userId: string): T[] {
  return rows.filter((row) => row.userId === userId)
}

export async function loadAuthenticatedWorkbenchExecution(
  projectId: number,
  threadId: string,
  dependencies: Dependencies,
): Promise<WorkbenchExecutionProjection> {
  const userId = await dependencies.authenticate()
  const observedAt = (dependencies.clock ?? (() => new Date()))()
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || typeof threadId !== "string" || threadId.trim() !== threadId || threadId.length === 0) {
    return projectWorkbenchExecution(emptyInput(userId, projectId, threadId, observedAt))
  }

  try {
  const scope = await dependencies.repository.getScope(userId, projectId, threadId)
  if (!scope || scope.userId !== userId || scope.projectId !== projectId || scope.threadId !== threadId) {
    return projectWorkbenchExecution(emptyInput(userId, projectId, threadId, observedAt))
  }

  const bindingRead = bounded(await dependencies.repository.listBindings(
    userId,
    threadId,
    WORKBENCH_EXECUTION_SOURCE_LIMIT + 1,
  ))
  const bindings = owned(bindingRead.rows, userId).filter((row) => row.threadId === threadId)
  if (bindings.filter((row) => row.role === "root").length !== 1) {
    return projectWorkbenchExecution(emptyInput(userId, projectId, threadId, observedAt, bindings))
  }

  const directGoalIds = distinct(bindings
    .filter((row) => row.sourceType === "goal")
    .map((row) => Number(row.sourceId))
    .filter((id) => Number.isSafeInteger(id) && id > 0))
    .sort((left, right) => left - right)
  const directOutcomeKeys = distinct(bindings.filter((row) => row.sourceType === "outcome").map((row) => row.sourceId)).sort()
  const outcomeRead = bounded(await dependencies.repository.listOutcomes(
    userId,
    { outcomeKeys: directOutcomeKeys, goalIds: directGoalIds },
    WORKBENCH_EXECUTION_SOURCE_LIMIT + 1,
  ))
  const outcomes = owned(outcomeRead.rows, userId).filter((row) => (
    directOutcomeKeys.includes(row.outcomeKey)
    || (row.goalId !== null && directGoalIds.includes(row.goalId))
  ))
  const goalIds = distinct([
    ...directGoalIds,
    ...outcomes.flatMap((row) => row.goalId === null ? [] : [row.goalId]),
  ]).sort((left, right) => left - right)
  const goalRead = bounded(await dependencies.repository.listGoals(
    userId,
    goalIds,
    WORKBENCH_EXECUTION_SOURCE_LIMIT + 1,
  ))
  const goals = owned(goalRead.rows, userId).filter((row) => goalIds.includes(row.id))
  const outcomeKeys = distinct(outcomes.map((row) => row.outcomeKey)).sort()
  const workOrderIds = distinct([
    ...goals.flatMap((row) => row.linkedWorkOrderId === null ? [] : [row.linkedWorkOrderId]),
    ...outcomes.flatMap((row) => row.activeWorkOrderId === null ? [] : [row.activeWorkOrderId]),
  ]).sort((left, right) => left - right)
  const workOrderRead = bounded(await dependencies.repository.listWorkOrders(
    userId,
    workOrderIds,
    WORKBENCH_EXECUTION_SOURCE_LIMIT + 1,
  ))
  const workOrders = owned(workOrderRead.rows, userId).filter((row) => workOrderIds.includes(row.id))
  const ownedWorkOrderIds = workOrders.map((row) => row.id).sort((left, right) => left - right)
  const terminalEvidenceIds = distinct(outcomes.flatMap((row) => row.terminalEvidenceId === null ? [] : [row.terminalEvidenceId])).sort((left, right) => left - right)
  const targets = { goalIds, outcomeKeys, workOrderIds: ownedWorkOrderIds }
  const limit = WORKBENCH_EXECUTION_SOURCE_LIMIT + 1

  const [claimRead, loopRead, evidenceRead, governanceRead, auditRead, acquisitionRead] = await Promise.all([
    dependencies.repository.listClaims(userId, ownedWorkOrderIds, limit).then(bounded),
    dependencies.repository.listLoops(userId, ownedWorkOrderIds, limit).then(bounded),
    dependencies.repository.listEvidence(userId, ownedWorkOrderIds, terminalEvidenceIds, limit).then(bounded),
    dependencies.repository.listGovernanceEvents(userId, targets, limit).then(bounded),
    dependencies.repository.listAuditEvents(userId, targets, limit).then(bounded),
    dependencies.repository.listAcquisitionAttempts(userId, outcomeKeys, ownedWorkOrderIds, limit).then(bounded),
  ])

  const truncatedKinds: string[] = []
  for (const [read, kind] of [
    [bindingRead, "workbench_thread_source"], [goalRead, "goal"], [outcomeRead, "outcome_queue_item"],
    [workOrderRead, "work_order"], [claimRead, "agent_claim"], [loopRead, "loop_run"],
    [evidenceRead, "evidence_record"], [governanceRead, "governance_event"], [auditRead, "event_log"],
    [acquisitionRead, "outcome_queue_acquisition_attempt"],
  ] as const) {
    if (read.truncated) truncatedKinds.push(kind)
  }

  return projectWorkbenchExecution({
    userId, projectId, threadId, observedAt, bindings, goals, outcomes, workOrders,
    claims: owned(claimRead.rows, userId).filter((row) => row.workOrderId !== null && ownedWorkOrderIds.includes(row.workOrderId)),
    loops: owned(loopRead.rows, userId).filter((row) => row.workOrderId !== null && ownedWorkOrderIds.includes(row.workOrderId)),
    evidence: owned(evidenceRead.rows, userId).filter((row) => ownedWorkOrderIds.includes(row.workOrderId) || terminalEvidenceIds.includes(row.id)),
    governanceEvents: owned(governanceRead.rows, userId),
    auditEvents: owned(auditRead.rows, userId),
    acquisitionAttempts: owned(acquisitionRead.rows, userId).filter((row) => (
      (row.activeWorkOrderId !== null && ownedWorkOrderIds.includes(row.activeWorkOrderId))
      || (row.outcomeKey !== null && outcomeKeys.includes(row.outcomeKey))
    )),
    truncatedKinds,
  })
  } catch {
    return projectWorkbenchExecution({
      ...emptyInput(userId, projectId, threadId, observedAt),
      degraded: true,
    })
  }
}
