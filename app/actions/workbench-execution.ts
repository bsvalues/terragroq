"use server"

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  agentClaim,
  eventLog,
  evidenceRecord,
  goal,
  governanceEvent,
  loopRun,
  outcomeQueueAcquisitionAttempt,
  outcomeQueueItem,
  project,
  workbenchThread,
  workbenchThreadSource,
  workOrder,
} from "@/lib/db/schema"
import {
  loadAuthenticatedWorkbenchExecution,
  type WorkbenchExecutionRepository,
  type WorkbenchExecutionTargets,
} from "@/lib/workbench/load-execution"
import { getUserId } from "@/lib/session"

const EXECUTION_EVENT_TYPES = [
  "HERMES_RUNTIME_CHECKPOINT",
  "HERMES_RUNTIME_FAILURE_EVAL",
  "HERMES_RUNTIME_LEASE",
  "HERMES_OUTCOME_PROVIDER_RECOVERED",
  "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED",
  "HERMES_OUTCOME_REVIEW_RECOVERED",
  "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED",
  "CI_RUNNING",
  "CI_PASSED",
  "CI_FAILED",
  "REVIEW_PENDING",
  "REVIEW_APPROVED",
  "REVIEW_CHANGES_REQUESTED",
  "REMEDIATING",
  "PR_OPEN",
  "PR_MERGED",
  "DELIVERED",
] as const

const repository: WorkbenchExecutionRepository = {
  async getScope(userId, projectId, threadId) {
    const rows = await db.select({
      projectId: workbenchThread.projectId,
      threadId: workbenchThread.id,
      userId: workbenchThread.userId,
    }).from(workbenchThread)
      .innerJoin(project, and(
        eq(project.userId, workbenchThread.userId),
        eq(project.id, workbenchThread.projectId),
      ))
      .where(and(
        eq(workbenchThread.userId, userId),
        eq(workbenchThread.projectId, projectId),
        eq(workbenchThread.id, threadId),
      ))
      .limit(1)
    return rows[0] ?? null
  },

  async listBindings(userId, threadId, limit) {
    return db.select({
      threadId: workbenchThreadSource.threadId,
      userId: workbenchThreadSource.userId,
      sourceType: workbenchThreadSource.sourceType,
      sourceId: workbenchThreadSource.sourceId,
      role: workbenchThreadSource.role,
    }).from(workbenchThreadSource)
      .where(and(
        eq(workbenchThreadSource.userId, userId),
        eq(workbenchThreadSource.threadId, threadId),
      ))
      .orderBy(sql`case when ${workbenchThreadSource.role} = 'root' then 0 else 1 end`, asc(workbenchThreadSource.id))
      .limit(limit) as Promise<Awaited<ReturnType<WorkbenchExecutionRepository["listBindings"]>>>
  },

  async listGoals(userId, ids, limit) {
    if (ids.length === 0) return []
    return db.select({
      id: goal.id, userId: goal.userId, linkedWorkOrderId: goal.linkedWorkOrderId, updatedAt: goal.updatedAt,
    }).from(goal)
      .where(and(eq(goal.userId, userId), inArray(goal.id, ids)))
      .orderBy(desc(goal.updatedAt), desc(goal.id))
      .limit(limit)
  },

  async listOutcomes(userId, selector, limit) {
    const predicates = [
      ...(selector.outcomeKeys.length > 0 ? [inArray(outcomeQueueItem.outcomeKey, selector.outcomeKeys)] : []),
      ...(selector.goalIds.length > 0 ? [inArray(outcomeQueueItem.goalId, selector.goalIds)] : []),
    ]
    if (predicates.length === 0) return []
    return db.select({
      id: outcomeQueueItem.id, userId: outcomeQueueItem.userId, outcomeKey: outcomeQueueItem.outcomeKey,
      goalId: outcomeQueueItem.goalId, title: outcomeQueueItem.title, lifecycleState: outcomeQueueItem.lifecycleState,
      activeWorkOrderId: outcomeQueueItem.activeWorkOrderId, leaseHolder: outcomeQueueItem.leaseHolder,
      leaseExpiresAt: outcomeQueueItem.leaseExpiresAt, terminalEvidenceId: outcomeQueueItem.terminalEvidenceId,
      updatedAt: outcomeQueueItem.updatedAt,
    }).from(outcomeQueueItem)
      .where(and(eq(outcomeQueueItem.userId, userId), or(...predicates)))
      .orderBy(desc(outcomeQueueItem.updatedAt), desc(outcomeQueueItem.id))
      .limit(limit)
  },

  async listWorkOrders(userId, ids, limit) {
    if (ids.length === 0) return []
    return db.select({
      id: workOrder.id, userId: workOrder.userId, ref: workOrder.ref,
      status: workOrder.status, assignee: workOrder.assignee, agent: workOrder.agent,
      updatedAt: workOrder.updatedAt,
    }).from(workOrder)
      .where(and(eq(workOrder.userId, userId), inArray(workOrder.id, ids)))
      .orderBy(desc(workOrder.updatedAt), desc(workOrder.id))
      .limit(limit)
  },

  async listClaims(userId, workOrderIds, limit) {
    if (workOrderIds.length === 0) return []
    return db.select({
      id: agentClaim.id, userId: agentClaim.userId, workOrderId: agentClaim.workOrderId,
      agent: agentClaim.agent, classification: agentClaim.classification, createdAt: agentClaim.createdAt,
    }).from(agentClaim)
      .where(and(eq(agentClaim.userId, userId), inArray(agentClaim.workOrderId, workOrderIds)))
      .orderBy(desc(agentClaim.createdAt), desc(agentClaim.id))
      .limit(limit)
  },

  async listLoops(userId, workOrderIds, limit) {
    if (workOrderIds.length === 0) return []
    return db.select({
      id: loopRun.id, userId: loopRun.userId, workOrderId: loopRun.workOrderId,
      loopType: loopRun.loopType, iteration: loopRun.iteration, status: loopRun.status,
      createdAt: loopRun.createdAt,
    }).from(loopRun)
      .where(and(eq(loopRun.userId, userId), inArray(loopRun.workOrderId, workOrderIds)))
      .orderBy(desc(loopRun.createdAt), desc(loopRun.id))
      .limit(limit)
  },

  async listEvidence(userId, workOrderIds, evidenceIds, limit) {
    const predicates = [
      ...(workOrderIds.length > 0 ? [inArray(evidenceRecord.workOrderId, workOrderIds)] : []),
      ...(evidenceIds.length > 0 ? [inArray(evidenceRecord.id, evidenceIds)] : []),
    ]
    if (predicates.length === 0) return []
    return db.select({
      id: evidenceRecord.id, userId: evidenceRecord.userId,
      workOrderId: evidenceRecord.workOrderId, result: evidenceRecord.result,
      validators: evidenceRecord.validators, notes: evidenceRecord.notes, createdAt: evidenceRecord.createdAt,
    }).from(evidenceRecord)
      .where(and(eq(evidenceRecord.userId, userId), or(...predicates)))
      .orderBy(desc(evidenceRecord.createdAt), desc(evidenceRecord.id))
      .limit(limit)
  },

  async listGovernanceEvents(userId, targets, limit) {
    const predicates = governancePredicates(targets)
    if (predicates.length === 0) return []
    return db.select({
      id: governanceEvent.id, userId: governanceEvent.userId, entityType: governanceEvent.entityType,
      entityId: governanceEvent.entityId, eventType: governanceEvent.eventType,
      reason: governanceEvent.reason, metadata: governanceEvent.metadata, createdAt: governanceEvent.createdAt,
    }).from(governanceEvent)
      .where(and(
        eq(governanceEvent.userId, userId),
        inArray(governanceEvent.eventType, [...EXECUTION_EVENT_TYPES]),
        or(...predicates),
      ))
      .orderBy(desc(governanceEvent.createdAt), desc(governanceEvent.id))
      .limit(limit)
  },

  async listAuditEvents(userId, targets, limit) {
    // eventLog.refId is numeric, while durable outcome membership is keyed by the
    // string outcomeKey. Do not query outcome-queue history without an exact FK.
    const predicates = [
      ...(targets.goalIds.length > 0 ? [and(eq(eventLog.register, "goals"), inArray(eventLog.refId, targets.goalIds))] : []),
      ...(targets.workOrderIds.length > 0 ? [and(eq(eventLog.register, "work-orders"), inArray(eventLog.refId, targets.workOrderIds))] : []),
    ]
    if (predicates.length === 0) return []
    return db.select({
      id: eventLog.id, userId: eventLog.userId, type: eventLog.type, summary: eventLog.summary,
      register: eventLog.register, refId: eventLog.refId, metadata: eventLog.metadata, createdAt: eventLog.createdAt,
    }).from(eventLog)
      .where(and(eq(eventLog.userId, userId), or(...predicates)))
      .orderBy(desc(eventLog.createdAt), desc(eventLog.id))
      .limit(limit)
  },

  async listAcquisitionAttempts(userId, outcomeKeys, workOrderIds, limit) {
    const predicates = [
      ...(outcomeKeys.length > 0 ? [inArray(outcomeQueueAcquisitionAttempt.outcomeKey, outcomeKeys)] : []),
      ...(workOrderIds.length > 0 ? [inArray(outcomeQueueAcquisitionAttempt.activeWorkOrderId, workOrderIds)] : []),
    ]
    if (predicates.length === 0) return []
    return db.select({
      id: outcomeQueueAcquisitionAttempt.id, userId: outcomeQueueAcquisitionAttempt.userId,
      outcomeKey: outcomeQueueAcquisitionAttempt.outcomeKey,
      activeWorkOrderId: outcomeQueueAcquisitionAttempt.activeWorkOrderId,
      processIdentity: outcomeQueueAcquisitionAttempt.processIdentity,
      leaseHolder: outcomeQueueAcquisitionAttempt.leaseHolder,
      checkpointSequence: outcomeQueueAcquisitionAttempt.checkpointSequence,
      checkpointState: outcomeQueueAcquisitionAttempt.checkpointState,
      disposition: outcomeQueueAcquisitionAttempt.disposition, reason: outcomeQueueAcquisitionAttempt.reason,
      attemptedAt: outcomeQueueAcquisitionAttempt.attemptedAt,
    }).from(outcomeQueueAcquisitionAttempt)
      .where(and(eq(outcomeQueueAcquisitionAttempt.userId, userId), or(...predicates)))
      .orderBy(desc(outcomeQueueAcquisitionAttempt.attemptedAt), desc(outcomeQueueAcquisitionAttempt.id))
      .limit(limit)
  },
}

function governancePredicates(targets: WorkbenchExecutionTargets) {
  return [
    ...(targets.goalIds.length > 0
      ? [and(eq(governanceEvent.entityType, "goal"), inArray(governanceEvent.entityId, targets.goalIds.map(String)))]
      : []),
    ...(targets.outcomeKeys.length > 0
      ? [and(eq(governanceEvent.entityType, "outcome_queue_item"), inArray(governanceEvent.entityId, targets.outcomeKeys))]
      : []),
    ...(targets.workOrderIds.length > 0
      ? [and(eq(governanceEvent.entityType, "work_order"), inArray(governanceEvent.entityId, targets.workOrderIds.map(String)))]
      : []),
  ]
}

export async function getWorkbenchExecution(projectId: number, threadId: string) {
  return loadAuthenticatedWorkbenchExecution(projectId, threadId, {
    authenticate: getUserId,
    repository,
  })
}
