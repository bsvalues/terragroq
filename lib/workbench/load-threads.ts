import {
  projectWorkbenchThreads,
  type Thread,
  type ThreadBindingInput,
  type ThreadSourceInput,
  type ThreadSourceKind,
} from "@/lib/workbench/thread-projection"
import { projectRuntimeFindingDecisionSources } from "@/lib/workbench/runtime-finding-decision-projection"
import { readPendingRuntimeFindingDecisionRequest } from "@/scripts/hermes-bridge/runtime-finding-decision.mjs"
import { PRIMARY_DECISION_OWNER_EMAIL } from "@/scripts/hermes-bridge/primary-decision-provenance.mjs"

export const WORKBENCH_THREAD_LIMIT = 50
export const WORKBENCH_SOURCE_LIMIT = 500

type ProjectRow = { id: number; userId: string; key: string; name: string }
type ThreadRow = { id: string; userId: string; projectId: number; title: string; createdAt: Date; updatedAt: Date }
type PersistedSourceType =
  | "goal" | "outcome" | "outcome_queue_item" | "work_order" | "conversation_message"
  | "governance_event" | "evidence_record" | "decision" | "event_log" | "loop_run" | "artifact"
  | "resource" | "reconciliation"
type BindingRow = { threadId: string; userId: string; sourceType: PersistedSourceType; sourceId: string; role: "root" | "member" }
type GoalRow = { id: number; userId: string; ref: string | null; command: string; rationale: string | null; recommendedMove: string | null; verdict: string; linkedWorkOrderId: number | null; createdAt: Date; updatedAt: Date }
type OutcomeRow = { id: number; userId: string; outcomeKey: string; goalId: number | null; title: string; objective: string | null; lifecycleState: string; activeWorkOrderId: number | null; approvalDecisionId: number | null; terminalEvidenceId: number | null; createdAt: Date; updatedAt: Date }
type WorkOrderRow = { id: number; userId: string; ref: string | null; title: string; description: string | null; status: string; result: string | null; linkedDecisionId: number | null; createdAt: Date; updatedAt: Date }
type DecisionRow = { id: number; userId: string; ref: string | null; title: string; decision: string; status: string; authority: string; createdAt: Date; updatedAt: Date }
type EvidenceRow = { id: number; userId: string; ref: string | null; workOrderId: number; result: string; notes: string | null; validators: string[]; contentHash: string | null; artifactPath: string | null; createdAt: Date }
type GovernanceEventRow = { id: number; userId: string; ref: string | null; entityType: string | null; entityId: string | null; eventType: string; reason: string | null; metadata: unknown; createdAt: Date }
type AuditEventRow = { id: number; userId: string; type: string; summary: string; register: string | null; refId: number | null; metadata: unknown; createdAt: Date }

export type WorkbenchThreadTargets = Readonly<{ goalIds: number[]; workOrderIds: number[]; outcomeKeys: string[] }>

export interface WorkbenchThreadRepository {
  getProject(userId: string, projectId: number): Promise<ProjectRow | null>
  listThreads(userId: string, projectId: number, limit: number): Promise<ThreadRow[]>
  listRootBindings(userId: string, threadIds: string[]): Promise<BindingRow[]>
  listMemberBindings(userId: string, threadIds: string[], limit: number): Promise<BindingRow[]>
  listGoals(userId: string, ids: number[], limit: number): Promise<GoalRow[]>
  listOutcomes(userId: string, selector: { sourceIds: string[]; goalIds: number[] }, limit: number): Promise<OutcomeRow[]>
  listWorkOrders(userId: string, ids: number[], limit: number): Promise<WorkOrderRow[]>
  /**
   * Resolve work order refs to their rows, for a Thread whose binding names its work order the way
   * an objective thread records it. Optional: a repository that cannot resolve refs leaves such a
   * Thread fail-closed, which is the honest answer -- a ref's digits are not a row id.
   */
  listWorkOrdersByRef?(userId: string, refs: string[], limit: number): Promise<WorkOrderRow[]>
  listDecisions(userId: string, ids: number[], limit: number): Promise<DecisionRow[]>
  listEvidence(userId: string, workOrderIds: number[], evidenceIds: number[], limit: number): Promise<EvidenceRow[]>
  listGovernanceEvents(userId: string, targets: WorkbenchThreadTargets, limit: number): Promise<GovernanceEventRow[]>
  listAuditEvents(userId: string, targets: WorkbenchThreadTargets, limit: number): Promise<AuditEventRow[]>
}

type RuntimeFindingDecisionReader = (input: Readonly<{
  ownerEmail: string
  includeDecided?: boolean
  exactGateSettlementEventId?: number
}>) => Promise<Record<string, unknown> | null>

type Dependencies = Readonly<{
  authenticate: () => Promise<string>
  repository: WorkbenchThreadRepository
  readRuntimeFindingDecision?: RuntimeFindingDecisionReader
}>

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function owned<T extends { userId: string }>(rows: readonly T[], userId: string): T[] {
  return rows.filter((row) => row.userId === userId)
}

function bounded<T>(rows: readonly T[]): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, WORKBENCH_SOURCE_LIMIT), truncated: rows.length > WORKBENCH_SOURCE_LIMIT }
}

function metadata(record: unknown): Record<string, unknown> {
  return record !== null && typeof record === "object" && !Array.isArray(record)
    ? record as Record<string, unknown>
    : {}
}

function safeString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" && (record[key] as string).trim() ? (record[key] as string).trim() : undefined
}

function safePositiveInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function eventData(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of ["state", "checkpointState", "status", "detail"] as const) {
    const value = safeString(record, key)
    if (value) result[key] = value
  }
  return result
}

function sourceDrilldown(kind: ThreadSourceKind, id: string) {
  if (kind === "goal") {
    return { mode: "EXACT" as const, href: `/goal-console?goal=${encodeURIComponent(id)}#goal-delivery-timeline` }
  }
  if (kind === "work_order") {
    return { mode: "EXACT" as const, href: `/work-orders#work-order-${encodeURIComponent(id)}` }
  }
  if (kind === "evidence_record") {
    const reference = `evidence:${id}`
    return { mode: "EXACT" as const, href: `/audit?evidence=${encodeURIComponent(reference)}#evidence-record-evidence-${encodeURIComponent(id)}` }
  }
  if (kind === "governance_event") {
    const reference = `trace:${id}`
    return { mode: "EXACT" as const, href: `/trace?trace=${encodeURIComponent(reference)}#trace-record-trace-${encodeURIComponent(id)}` }
  }
  if (kind === "event_log") {
    const reference = `audit:${id}`
    return { mode: "EXACT" as const, href: `/audit?audit=${encodeURIComponent(reference)}#audit-record-audit-${encodeURIComponent(id)}` }
  }
  const registers: Partial<Record<ThreadSourceKind, string>> = {
    outcome_queue_item: "/goal-console", decision: "/decisions",
  }
  const register = registers[kind]
  return register ? { mode: "REGISTER" as const, href: register } : { mode: "UNAVAILABLE" as const, href: null }
}

/**
 * A persisted binding names its source in the table's vocabulary; the projection names it in
 * ThreadSourceKind. `outcome` is the table's older spelling of `outcome_queue_item`.
 *
 * The table's vocabulary is the whole ThreadSourceKind list plus the two resource-shaped kinds, and
 * a work_order-rooted Thread is the one that uses it: the objective flow binds its root as
 * work_order and hangs governance_event, resource, and reconciliation members beneath it. Every
 * persisted type is therefore mapped here. A type the projection has no kind for maps to null and
 * is skipped, so it is left out of the Thread rather than bound under an unnamed source kind.
 *
 * A goal or outcome binding's sourceId is the source's own identity and is carried verbatim. A
 * work_order binding names its work order either by row id or by ref — an objective thread binds
 * its root by ref, because a work order without a ref cannot be a thread root — so a ref is
 * resolved to the canonical row identity that the work_order sources, their drilldowns, and the
 * evidence and event joins already speak. A ref is resolved by lookup, never by reading digits out
 * of it: refs are a per-operator sequence, so WO-0026 is not row 26.
 */
const PERSISTED_SOURCE_KIND: Record<PersistedSourceType, ThreadSourceKind | null> = {
  goal: "goal",
  outcome: "outcome_queue_item",
  outcome_queue_item: "outcome_queue_item",
  work_order: "work_order",
  conversation_message: "conversation_message",
  governance_event: "governance_event",
  evidence_record: "evidence_record",
  decision: "decision",
  event_log: "event_log",
  loop_run: "loop_run",
  artifact: "artifact",
  resource: null,
  reconciliation: null,
}

/** A binding the projection can name, carrying the kind it was resolved to. */
type PersistedBinding = BindingRow & { kind: ThreadSourceKind }

function persistedKind(sourceType: PersistedSourceType): ThreadSourceKind | null {
  // `?? null` covers a row whose sourceType the table has since widened past this map.
  return PERSISTED_SOURCE_KIND[sourceType] ?? null
}

function workOrderRowId(sourceId: string): number | null {
  const value = Number(sourceId)
  return Number.isSafeInteger(value) ? value : null
}

function binding(threadId: string, userId: string, projectId: number, sourceKind: ThreadSourceKind, sourceId: string, role: "root" | "member" = "member"): ThreadBindingInput {
  return { threadId, userId, projectId, sourceKind, sourceId, role }
}

export async function loadAuthenticatedWorkbenchThreads(
  projectId: number,
  dependencies: Dependencies,
): Promise<Thread[]> {
  const userId = await dependencies.authenticate()
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return []
  const repo = dependencies.repository
  const project = await repo.getProject(userId, projectId)
  if (!project || project.userId !== userId || project.id !== projectId) return []

  const rawThreads = await repo.listThreads(userId, projectId, WORKBENCH_THREAD_LIMIT + 1)
  const threadListTruncated = rawThreads.length > WORKBENCH_THREAD_LIMIT
  const threads = owned(rawThreads, userId)
    .filter((row) => row.projectId === projectId)
    .slice(0, WORKBENCH_THREAD_LIMIT)
  if (threads.length === 0) return []

  const rootBindings = await repo.listRootBindings(userId, threads.map((row) => row.id))
  const memberBindingRead = bounded(await repo.listMemberBindings(userId, threads.map((row) => row.id), WORKBENCH_SOURCE_LIMIT + 1))
  const persistedBindings: PersistedBinding[] = owned([...rootBindings, ...memberBindingRead.rows], userId)
    .filter((row) => threads.some((thread) => thread.id === row.threadId))
    .flatMap((row) => {
      const kind = persistedKind(row.sourceType)
      return kind === null ? [] : [{ ...row, kind }]
    })

  const persistedGoalIds = distinct(persistedBindings
    .filter((row) => row.kind === "goal")
    .map((row) => Number(row.sourceId))
    .filter(Number.isSafeInteger)).sort((left, right) => left - right)
  const persistedOutcomeIds = distinct(persistedBindings.filter((row) => row.kind === "outcome_queue_item").map((row) => row.sourceId)).sort()
  const persistedWorkOrderBindings = persistedBindings.filter((row) => row.kind === "work_order")
  const persistedWorkOrderRefs = distinct(persistedWorkOrderBindings
    .map((row) => row.sourceId)
    .filter((sourceId) => workOrderRowId(sourceId) === null)).sort()
  const workOrderRefRead = bounded<WorkOrderRow>(persistedWorkOrderRefs.length > 0 && repo.listWorkOrdersByRef
    ? await repo.listWorkOrdersByRef(userId, persistedWorkOrderRefs, WORKBENCH_SOURCE_LIMIT + 1)
    : [])
  const refWorkOrders = owned(workOrderRefRead.rows, userId)
    .filter((row) => row.ref !== null && persistedWorkOrderRefs.includes(row.ref))
  const workOrderIdByRef = new Map<string, number>()
  for (const ref of persistedWorkOrderRefs) {
    // One ref naming two rows is not a Thread whose work order can be identified, so it stays
    // unresolved rather than attaching whichever row was returned first.
    const matches = distinct(refWorkOrders.filter((row) => row.ref === ref).map((row) => row.id))
    if (matches.length === 1) workOrderIdByRef.set(ref, matches[0])
  }
  const workOrderIdFor = (sourceId: string): number | null => (
    workOrderRowId(sourceId) ?? workOrderIdByRef.get(sourceId) ?? null
  )
  const persistedSourceId = (row: PersistedBinding): string => {
    if (row.kind !== "work_order") return row.sourceId
    const id = workOrderIdFor(row.sourceId)
    return id === null ? row.sourceId : String(id)
  }
  const persistedWorkOrderIds = distinct(persistedWorkOrderBindings
    .map((row) => workOrderIdFor(row.sourceId))
    .filter((id): id is number => id !== null)).sort((left, right) => left - right)

  const outcomeRead = bounded(await repo.listOutcomes(userId, {
    sourceIds: persistedOutcomeIds,
    goalIds: persistedGoalIds,
  }, WORKBENCH_SOURCE_LIMIT + 1))
  const outcomes = owned(outcomeRead.rows, userId).filter((row) => (
    persistedOutcomeIds.includes(row.outcomeKey)
    || (row.goalId !== null && persistedGoalIds.includes(row.goalId))
  ))
  const goalIds = distinct([...persistedGoalIds, ...outcomes.flatMap((row) => row.goalId === null ? [] : [row.goalId])]).sort((left, right) => left - right)
  const goalRead = bounded(await repo.listGoals(userId, goalIds, WORKBENCH_SOURCE_LIMIT + 1))
  const goals = owned(goalRead.rows, userId).filter((row) => goalIds.includes(row.id))

  const workOrderIds = distinct([
    ...persistedWorkOrderIds,
    ...goals.flatMap((row) => row.linkedWorkOrderId === null ? [] : [row.linkedWorkOrderId]),
    ...outcomes.flatMap((row) => row.activeWorkOrderId === null ? [] : [row.activeWorkOrderId]),
  ]).sort((left, right) => left - right)
  const workOrderRead = bounded(await repo.listWorkOrders(userId, workOrderIds, WORKBENCH_SOURCE_LIMIT + 1))
  const workOrders = owned(workOrderRead.rows, userId).filter((row) => workOrderIds.includes(row.id))
  const decisionIds = distinct([
    ...outcomes.flatMap((row) => row.approvalDecisionId === null ? [] : [row.approvalDecisionId]),
    ...workOrders.flatMap((row) => row.linkedDecisionId === null ? [] : [row.linkedDecisionId]),
  ]).sort((left, right) => left - right)
  const decisionRead = bounded(await repo.listDecisions(userId, decisionIds, WORKBENCH_SOURCE_LIMIT + 1))
  const decisions = owned(decisionRead.rows, userId).filter((row) => decisionIds.includes(row.id))
  const terminalEvidenceIds = distinct(outcomes.flatMap((row) => row.terminalEvidenceId === null ? [] : [row.terminalEvidenceId])).sort((left, right) => left - right)
  const evidenceRead = bounded(await repo.listEvidence(userId, workOrderIds, terminalEvidenceIds, WORKBENCH_SOURCE_LIMIT + 1))
  const evidence = owned(evidenceRead.rows, userId).filter((row) => workOrderIds.includes(row.workOrderId) || terminalEvidenceIds.includes(row.id))
  const targets = { goalIds: goals.map((row) => row.id), workOrderIds: workOrders.map((row) => row.id), outcomeKeys: outcomes.map((row) => row.outcomeKey) }
  const governanceRead = bounded(await repo.listGovernanceEvents(userId, targets, WORKBENCH_SOURCE_LIMIT + 1))
  const governance = owned(governanceRead.rows, userId).filter((row) => (
    (row.entityType === "goal" && row.entityId !== null && targets.goalIds.includes(Number(row.entityId)))
    || (row.entityType === "work_order" && row.entityId !== null && targets.workOrderIds.includes(Number(row.entityId)))
    || (row.entityType === "outcome_queue_item" && row.entityId !== null && targets.outcomeKeys.includes(row.entityId))
  ))
  const auditRead = bounded(await repo.listAuditEvents(userId, targets, WORKBENCH_SOURCE_LIMIT + 1))
  const audits = owned(auditRead.rows, userId).filter((row) => (
    (row.register === "goals" && row.refId !== null && targets.goalIds.includes(row.refId))
    || (row.register === "work-orders" && row.refId !== null && targets.workOrderIds.includes(row.refId))
    || (row.register === "outcome-queue" && row.refId !== null && targets.goalIds.includes(row.refId))
  ))

  const runtimeFindingRequests: Record<string, unknown>[] = []
  const reader = dependencies.readRuntimeFindingDecision
    ?? readPendingRuntimeFindingDecisionRequest as unknown as RuntimeFindingDecisionReader
  const runtimeGateIds = distinct(governance
    .filter((row) => row.eventType === "RUNTIME_FINDING_OWNER_GATED" && !governance.some((candidate) => {
      if (candidate.eventType !== "RUNTIME_FINDING_OWNER_DECIDED"
        || candidate.entityType !== row.entityType
        || candidate.entityId !== row.entityId) return false
      const gateMetadata = metadata(row.metadata)
      const receiptMetadata = metadata(candidate.metadata)
      return safePositiveInteger(receiptMetadata, "gateSettlementEventId") === row.id
        || safePositiveInteger(receiptMetadata, "sourceFindingEventId") === safePositiveInteger(gateMetadata, "sourceFindingEventId")
        || (safeString(receiptMetadata, "findingId") !== undefined
          && safeString(receiptMetadata, "findingId") === safeString(gateMetadata, "findingId"))
    }))
    .map((row) => row.id)).sort((left, right) => left - right)
  for (const gateSettlementEventId of runtimeGateIds) {
    try {
      const candidate = await reader({
        ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
        includeDecided: false,
        exactGateSettlementEventId: gateSettlementEventId,
      })
      if (candidate?.ownerUserId === userId) runtimeFindingRequests.push(candidate)
    } catch {
      // A gate that cannot pass the canonical exact reader is never projected as actionable or
      // owner-decided. Other Thread history remains available.
    }
  }

  const directWorkOrderIdByThread = new Map<string, number>()
  const directOwnersByWorkOrderId = new Map<number, string[]>()
  for (const thread of threads) {
    const directIds = distinct(persistedBindings
      .filter((row) => row.threadId === thread.id && row.kind === "work_order" && row.role === "root")
      .map((row) => workOrderIdFor(row.sourceId))
      .filter((id): id is number => id !== null))
    if (directIds.length !== 1) continue
    directWorkOrderIdByThread.set(thread.id, directIds[0])
    directOwnersByWorkOrderId.set(directIds[0], [...(directOwnersByWorkOrderId.get(directIds[0]) ?? []), thread.id])
  }

  const allBindings: ThreadBindingInput[] = []
  const runtimeDecisionSources: ThreadSourceInput[] = []
  for (const thread of threads) {
    const persisted = persistedBindings.filter((row) => row.threadId === thread.id)
    for (const row of persisted) {
      allBindings.push(binding(thread.id, userId, projectId, row.kind, persistedSourceId(row), row.role))
    }
    const threadOutcomes = outcomes.filter((outcome) => persisted.some((row) => (
      row.kind === "outcome_queue_item" && row.sourceId === outcome.outcomeKey
    )) || (outcome.goalId !== null && persisted.some((row) => row.kind === "goal" && Number(row.sourceId) === outcome.goalId)))
    const threadGoalIds = distinct([
      ...persisted.filter((row) => row.kind === "goal").map((row) => Number(row.sourceId)).filter(Number.isSafeInteger),
      ...threadOutcomes.flatMap((row) => row.goalId === null ? [] : [row.goalId]),
    ])
    const threadGoals = goals.filter((row) => threadGoalIds.includes(row.id))
    const threadWorkOrderIds = distinct([
      ...persisted.filter((row) => row.kind === "work_order").map((row) => workOrderIdFor(row.sourceId)).filter((id): id is number => id !== null),
      ...threadGoals.flatMap((row) => row.linkedWorkOrderId === null ? [] : [row.linkedWorkOrderId]),
      ...threadOutcomes.flatMap((row) => row.activeWorkOrderId === null ? [] : [row.activeWorkOrderId]),
    ])
    const threadWorkOrders = workOrders.filter((row) => threadWorkOrderIds.includes(row.id))
    const threadDecisionIds = distinct([
      ...threadOutcomes.flatMap((row) => row.approvalDecisionId === null ? [] : [row.approvalDecisionId]),
      ...threadWorkOrders.flatMap((row) => row.linkedDecisionId === null ? [] : [row.linkedDecisionId]),
    ])
    for (const row of threadOutcomes) allBindings.push(binding(thread.id, userId, projectId, "outcome_queue_item", row.outcomeKey))
    for (const id of threadGoalIds) allBindings.push(binding(thread.id, userId, projectId, "goal", String(id)))
    for (const id of threadWorkOrderIds) allBindings.push(binding(thread.id, userId, projectId, "work_order", String(id)))
    for (const id of threadDecisionIds) allBindings.push(binding(thread.id, userId, projectId, "decision", String(id)))
    for (const row of evidence.filter((candidate) => threadWorkOrderIds.includes(candidate.workOrderId) || threadOutcomes.some((outcome) => outcome.terminalEvidenceId === candidate.id))) allBindings.push(binding(thread.id, userId, projectId, "evidence_record", String(row.id)))
    for (const row of governance.filter((candidate) => !["RUNTIME_FINDING_OWNER_GATED", "RUNTIME_FINDING_OWNER_DECIDED"].includes(candidate.eventType) && ((candidate.entityType === "goal" && threadGoalIds.includes(Number(candidate.entityId))) || (candidate.entityType === "work_order" && threadWorkOrderIds.includes(Number(candidate.entityId))) || (candidate.entityType === "outcome_queue_item" && candidate.entityId !== null && threadOutcomes.some((outcome) => outcome.outcomeKey === candidate.entityId))))) allBindings.push(binding(thread.id, userId, projectId, "governance_event", String(row.id)))
    for (const row of audits.filter((candidate) => (candidate.register === "goals" && candidate.refId !== null && threadGoalIds.includes(candidate.refId)) || (candidate.register === "work-orders" && candidate.refId !== null && threadWorkOrderIds.includes(candidate.refId)) || (candidate.register === "outcome-queue" && candidate.refId !== null && threadGoalIds.includes(candidate.refId)))) allBindings.push(binding(thread.id, userId, projectId, "event_log", String(row.id)))
    const directWorkOrderId = directWorkOrderIdByThread.get(thread.id)
    const directWorkOrder = directWorkOrderId === undefined ? null : workOrders.find((row) => row.id === directWorkOrderId) ?? null
    if (directWorkOrder && directOwnersByWorkOrderId.get(directWorkOrder.id)?.length === 1) {
      const projection = projectRuntimeFindingDecisionSources({
        userId,
        projectId,
        thread: { id: thread.id, workOrderId: directWorkOrder.id },
        workOrder: { id: directWorkOrder.id, ref: directWorkOrder.ref },
        events: governance,
        actionableRequest: runtimeFindingRequests,
      })
      allBindings.push(...projection.bindings)
      runtimeDecisionSources.push(...projection.sources)
    }
  }

  const sources: ThreadSourceInput[] = [
    ...goals.map((row) => ({
      kind: "goal" as const, id: String(row.id), userId, occurredAt: row.updatedAt, ref: row.ref,
      drilldown: sourceDrilldown("goal", String(row.id)),
      links: distinct([
        ...(row.linkedWorkOrderId === null ? [] : [row.linkedWorkOrderId]),
        ...outcomes.filter((outcome) => outcome.goalId === row.id && outcome.activeWorkOrderId !== null).map((outcome) => outcome.activeWorkOrderId!),
      ]).map((id) => ({ relation: "work_order", kind: "work_order" as const, id: String(id) })),
      data: { command: row.command, rationale: row.rationale, recommendedMove: row.recommendedMove, verdict: row.verdict },
    })),
    ...outcomes.map((row) => ({
      kind: "outcome_queue_item" as const, id: row.outcomeKey, userId, occurredAt: row.updatedAt, ref: row.outcomeKey,
      drilldown: sourceDrilldown("outcome_queue_item", row.outcomeKey),
      links: [
        ...(row.goalId === null ? [] : [{ relation: "goal", kind: "goal" as const, id: String(row.goalId) }]),
        ...(row.activeWorkOrderId === null ? [] : [{ relation: "work_order", kind: "work_order" as const, id: String(row.activeWorkOrderId) }]),
        ...(row.approvalDecisionId === null ? [] : [{ relation: "decision", kind: "decision" as const, id: String(row.approvalDecisionId) }]),
      ],
      data: { title: row.title, objective: row.objective, lifecycleState: row.lifecycleState },
    })),
    ...workOrders.map((row) => ({ kind: "work_order" as const, id: String(row.id), userId, occurredAt: row.updatedAt, ref: row.ref, drilldown: sourceDrilldown("work_order", String(row.id)), data: { title: row.title, description: row.description, status: row.status, result: row.result } })),
    ...decisions.map((row) => ({ kind: "decision" as const, id: String(row.id), userId, occurredAt: row.updatedAt, ref: row.ref, drilldown: sourceDrilldown("decision", String(row.id)), data: { title: row.title, decision: row.decision, status: row.status, authority: row.authority } })),
    ...evidence.map((row) => ({ kind: "evidence_record" as const, id: String(row.id), userId, occurredAt: row.createdAt, ref: row.ref, drilldown: sourceDrilldown("evidence_record", String(row.id)), data: { result: row.result, summary: row.notes, validators: row.validators, contentHash: row.contentHash, artifactLabel: row.contentHash ? "Hashed evidence artifact" : undefined } })),
    ...governance.filter((row) => !["RUNTIME_FINDING_OWNER_GATED", "RUNTIME_FINDING_OWNER_DECIDED"].includes(row.eventType)).map((row) => { const meta = metadata(row.metadata); return { kind: "governance_event" as const, id: String(row.id), userId, occurredAt: row.createdAt, ref: row.ref, mirrorKey: safeString(meta, "mirrorKey") ?? `governance_event:${row.id}`, drilldown: sourceDrilldown("governance_event", String(row.id)), data: { eventType: row.eventType, reason: row.reason, ...eventData(meta) } } }),
    ...runtimeDecisionSources,
    ...audits.map((row) => { const meta = metadata(row.metadata); const governanceEventId = safePositiveInteger(meta, "governanceEventId"); return { kind: "event_log" as const, id: String(row.id), userId, occurredAt: row.createdAt, mirrorKey: safeString(meta, "mirrorKey") ?? (governanceEventId ? `governance_event:${governanceEventId}` : undefined), drilldown: sourceDrilldown("event_log", String(row.id)), data: { type: row.type, summary: row.summary, ...eventData(meta) } } }),
  ]

  const truncatedSourceKinds = new Set<ThreadSourceKind>()
  if (threadListTruncated || memberBindingRead.truncated) {
    for (const row of persistedBindings.filter((candidate) => candidate.role === "root")) truncatedSourceKinds.add(row.kind)
  }
  for (const [read, kind] of [
    [goalRead, "goal"], [outcomeRead, "outcome_queue_item"], [workOrderRead, "work_order"], [workOrderRefRead, "work_order"],
    [decisionRead, "decision"], [evidenceRead, "evidence_record"], [governanceRead, "governance_event"], [auditRead, "event_log"],
  ] as const) if (read.truncated) truncatedSourceKinds.add(kind)

  const bindingsBySource = new Map<string, ThreadBindingInput>()
  for (const candidate of allBindings) {
    const key = `${candidate.threadId}:${candidate.sourceKind}:${candidate.sourceId}`
    const prior = bindingsBySource.get(key)
    if (!prior || candidate.role === "root") bindingsBySource.set(key, candidate)
  }

  return projectWorkbenchThreads({
    userId, projectId, conversationPersistence: "MISSING", truncatedSourceKinds: [...truncatedSourceKinds],
    threads: threads.map((thread) => {
      const roots = persistedBindings.filter((row) => row.threadId === thread.id && row.role === "root")
      const root = roots.length === 1 ? roots[0] : null
      return { ...thread, projectKey: project.key, projectName: project.name, rootSourceKind: root === null ? null : root.kind, rootSourceId: root === null ? null : persistedSourceId(root) }
    }),
    bindings: [...bindingsBySource.values()],
    sources,
  })
}
