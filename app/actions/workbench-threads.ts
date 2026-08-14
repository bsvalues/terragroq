"use server"

import { and, desc, eq, inArray, or } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  decision,
  eventLog,
  evidenceRecord,
  goal,
  governanceEvent,
  outcomeQueueItem,
  project,
  workbenchThread,
  workbenchThreadSource,
  workOrder,
} from "@/lib/db/schema"
import {
  loadAuthenticatedWorkbenchThreads,
  type WorkbenchThreadRepository,
  type WorkbenchThreadTargets,
} from "@/lib/workbench/load-threads"
import { getUserId } from "@/lib/session"

const repository: WorkbenchThreadRepository = {
  async getProject(userId, projectId) {
    const rows = await db.select({ id: project.id, userId: project.userId, key: project.key, name: project.name })
      .from(project)
      .where(and(eq(project.userId, userId), eq(project.id, projectId)))
      .limit(1)
    return rows[0] ?? null
  },

  async listThreads(userId, projectId, limit) {
    return db.select({
      id: workbenchThread.id, userId: workbenchThread.userId, projectId: workbenchThread.projectId,
      title: workbenchThread.title, createdAt: workbenchThread.createdAt, updatedAt: workbenchThread.updatedAt,
    }).from(workbenchThread)
      .where(and(eq(workbenchThread.userId, userId), eq(workbenchThread.projectId, projectId)))
      .orderBy(desc(workbenchThread.updatedAt), desc(workbenchThread.id))
      .limit(limit)
  },

  async listRootBindings(userId, threadIds) {
    if (threadIds.length === 0) return []
    return db.select({
      threadId: workbenchThreadSource.threadId, userId: workbenchThreadSource.userId,
      sourceType: workbenchThreadSource.sourceType, sourceId: workbenchThreadSource.sourceId,
      role: workbenchThreadSource.role,
    }).from(workbenchThreadSource)
      .where(and(eq(workbenchThreadSource.userId, userId), inArray(workbenchThreadSource.threadId, threadIds), eq(workbenchThreadSource.role, "root")))
      .orderBy(workbenchThreadSource.threadId, workbenchThreadSource.id) as Promise<Array<{ threadId: string; userId: string; sourceType: "goal" | "outcome"; sourceId: string; role: "root" | "member" }>>
  },

  async listMemberBindings(userId, threadIds, limit) {
    if (threadIds.length === 0) return []
    return db.select({
      threadId: workbenchThreadSource.threadId, userId: workbenchThreadSource.userId,
      sourceType: workbenchThreadSource.sourceType, sourceId: workbenchThreadSource.sourceId,
      role: workbenchThreadSource.role,
    }).from(workbenchThreadSource)
      .where(and(eq(workbenchThreadSource.userId, userId), inArray(workbenchThreadSource.threadId, threadIds), eq(workbenchThreadSource.role, "member")))
      .orderBy(desc(workbenchThreadSource.createdAt), desc(workbenchThreadSource.id))
      .limit(limit) as Promise<Array<{ threadId: string; userId: string; sourceType: "goal" | "outcome"; sourceId: string; role: "root" | "member" }>>
  },

  async listGoals(userId, ids, limit) {
    if (ids.length === 0) return []
    return db.select({
      id: goal.id, userId: goal.userId, ref: goal.ref, command: goal.command, rationale: goal.rationale,
      recommendedMove: goal.recommendedMove, verdict: goal.verdict, linkedWorkOrderId: goal.linkedWorkOrderId,
      createdAt: goal.createdAt, updatedAt: goal.updatedAt,
    }).from(goal).where(and(eq(goal.userId, userId), inArray(goal.id, ids))).orderBy(desc(goal.updatedAt), desc(goal.id)).limit(limit)
  },

  async listOutcomes(userId, selector, limit) {
    const predicates = [
      ...(selector.sourceIds.length > 0 ? [inArray(outcomeQueueItem.outcomeKey, selector.sourceIds)] : []),
      ...(selector.goalIds.length > 0 ? [inArray(outcomeQueueItem.goalId, selector.goalIds)] : []),
    ]
    if (predicates.length === 0) return []
    return db.select({
      id: outcomeQueueItem.id, userId: outcomeQueueItem.userId, outcomeKey: outcomeQueueItem.outcomeKey,
      goalId: outcomeQueueItem.goalId, title: outcomeQueueItem.title, objective: outcomeQueueItem.objective,
      lifecycleState: outcomeQueueItem.lifecycleState, activeWorkOrderId: outcomeQueueItem.activeWorkOrderId,
      approvalDecisionId: outcomeQueueItem.approvalDecisionId, terminalEvidenceId: outcomeQueueItem.terminalEvidenceId,
      createdAt: outcomeQueueItem.createdAt, updatedAt: outcomeQueueItem.updatedAt,
    }).from(outcomeQueueItem)
      .where(and(eq(outcomeQueueItem.userId, userId), or(...predicates)))
      .orderBy(desc(outcomeQueueItem.updatedAt), desc(outcomeQueueItem.id))
      .limit(limit)
  },

  async listWorkOrders(userId, ids, limit) {
    if (ids.length === 0) return []
    return db.select({
      id: workOrder.id, userId: workOrder.userId, ref: workOrder.ref, title: workOrder.title,
      description: workOrder.description, status: workOrder.status, result: workOrder.result,
      linkedDecisionId: workOrder.linkedDecisionId, createdAt: workOrder.createdAt, updatedAt: workOrder.updatedAt,
    }).from(workOrder).where(and(eq(workOrder.userId, userId), inArray(workOrder.id, ids))).orderBy(desc(workOrder.updatedAt), desc(workOrder.id)).limit(limit)
  },

  async listDecisions(userId, ids, limit) {
    if (ids.length === 0) return []
    return db.select({
      id: decision.id, userId: decision.userId, ref: decision.ref, title: decision.title,
      decision: decision.decision, status: decision.status, authority: decision.authority,
      createdAt: decision.createdAt, updatedAt: decision.updatedAt,
    }).from(decision).where(and(eq(decision.userId, userId), inArray(decision.id, ids))).orderBy(desc(decision.updatedAt), desc(decision.id)).limit(limit)
  },

  async listEvidence(userId, workOrderIds, evidenceIds, limit) {
    const predicates = [
      ...(workOrderIds.length > 0 ? [inArray(evidenceRecord.workOrderId, workOrderIds)] : []),
      ...(evidenceIds.length > 0 ? [inArray(evidenceRecord.id, evidenceIds)] : []),
    ]
    if (predicates.length === 0) return []
    return db.select({
      id: evidenceRecord.id, userId: evidenceRecord.userId, ref: evidenceRecord.ref,
      workOrderId: evidenceRecord.workOrderId, result: evidenceRecord.result, notes: evidenceRecord.notes,
      validators: evidenceRecord.validators, contentHash: evidenceRecord.contentHash,
      artifactPath: evidenceRecord.artifactPath, createdAt: evidenceRecord.createdAt,
    }).from(evidenceRecord)
      .where(and(eq(evidenceRecord.userId, userId), or(...predicates)))
      .orderBy(desc(evidenceRecord.createdAt), desc(evidenceRecord.id))
      .limit(limit)
  },

  async listGovernanceEvents(userId, targets, limit) {
    const predicates = governancePredicates(targets)
    if (predicates.length === 0) return []
    return db.select({
      id: governanceEvent.id, userId: governanceEvent.userId, ref: governanceEvent.ref,
      entityType: governanceEvent.entityType, entityId: governanceEvent.entityId,
      eventType: governanceEvent.eventType, reason: governanceEvent.reason,
      metadata: governanceEvent.metadata, createdAt: governanceEvent.createdAt,
    }).from(governanceEvent)
      .where(and(eq(governanceEvent.userId, userId), or(...predicates)))
      .orderBy(desc(governanceEvent.createdAt), desc(governanceEvent.id))
      .limit(limit)
  },

  async listAuditEvents(userId, targets, limit) {
    const predicates = [
      ...(targets.goalIds.length > 0 ? [and(eq(eventLog.register, "goals"), inArray(eventLog.refId, targets.goalIds))] : []),
      ...(targets.workOrderIds.length > 0 ? [and(eq(eventLog.register, "work-orders"), inArray(eventLog.refId, targets.workOrderIds))] : []),
      ...(targets.goalIds.length > 0 ? [and(eq(eventLog.register, "outcome-queue"), inArray(eventLog.refId, targets.goalIds))] : []),
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
}

function governancePredicates(targets: WorkbenchThreadTargets) {
  return [
    ...(targets.goalIds.length > 0
      ? [and(eq(governanceEvent.entityType, "goal"), inArray(governanceEvent.entityId, targets.goalIds.map(String)))]
      : []),
    ...(targets.workOrderIds.length > 0
      ? [and(eq(governanceEvent.entityType, "work_order"), inArray(governanceEvent.entityId, targets.workOrderIds.map(String)))]
      : []),
    ...(targets.outcomeKeys.length > 0
      ? [and(eq(governanceEvent.entityType, "outcome_queue_item"), inArray(governanceEvent.entityId, targets.outcomeKeys))]
      : []),
  ]
}

export async function getWorkbenchThreads(projectId: number) {
  return loadAuthenticatedWorkbenchThreads(projectId, { authenticate: getUserId, repository })
}
