"use server"

import { and, desc, eq, inArray, or } from "drizzle-orm"

import {
  buildGoalTimelineReadModel,
  type GoalTimelineAuditRecord,
  type GoalTimelineDecisionRecord,
  type GoalTimelineEvidenceRecord,
  type GoalTimelineGoalRecord,
  type GoalTimelineProjection,
  type GoalTimelineWorkOrderRecord,
} from "@/components/goal-console/goal-timeline-read-model"
import type { RuntimeExecutionGovernanceEventRecord } from "@/components/runtime/runtime-execution-model"
import { db } from "@/lib/db"
import {
  decision,
  eventLog,
  evidenceRecord,
  goal,
  governanceEvent,
  workOrder,
} from "@/lib/db/schema"
import { getUserId } from "@/lib/session"

const GOAL_TIMELINE_LIMIT = 25
const GOAL_TIMELINE_BATCH_LIMIT = 25
const EVENTS_PER_RUNTIME_LIMIT = 250
const RELATED_RECORD_LIMIT = 500

async function readGoalTimelines(goalIds?: number[]): Promise<GoalTimelineProjection[]> {
  const userId = await getUserId()
  const goals = await db
    .select({
      id: goal.id,
      userId: goal.userId,
      ref: goal.ref,
      command: goal.command,
      lane: goal.lane,
      mode: goal.mode,
      risk: goal.risk,
      authority: goal.authority,
      verdict: goal.verdict,
      rationale: goal.rationale,
      recommendedMove: goal.recommendedMove,
      requiresApproval: goal.requiresApproval,
      linkedWorkOrderId: goal.linkedWorkOrderId,
      status: goal.status,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    })
    .from(goal)
    .where(goalIds === undefined
      ? eq(goal.userId, userId)
      : and(eq(goal.userId, userId), inArray(goal.id, goalIds)))
    .orderBy(desc(goal.updatedAt), desc(goal.id))
    .limit(goalIds === undefined ? GOAL_TIMELINE_LIMIT : goalIds.length)

  if (goals.length === 0) {
    return buildGoalTimelineReadModel({
      userId,
      goals: [],
      workOrders: [],
      governanceEvents: [],
      evidenceRecords: [],
      decisions: [],
      auditRecords: [],
      observedAt: new Date(),
    })
  }

  const runtimeRefs = goals.map((record) => `WO-HERMES-OUTCOME-${record.id}`)
  const workOrderGroups = await Promise.all(runtimeRefs.map((runtimeRef) => db
    .select({
      id: workOrder.id,
      userId: workOrder.userId,
      ref: workOrder.ref,
      title: workOrder.title,
      description: workOrder.description,
      goal: workOrder.goal,
      lane: workOrder.lane,
      phase: workOrder.phase,
      status: workOrder.status,
      result: workOrder.result,
      commitRef: workOrder.commitRef,
      evidence: workOrder.evidence,
      assignee: workOrder.assignee,
      validators: workOrder.validators,
      stopConditions: workOrder.stopConditions,
      linkedDecisionId: workOrder.linkedDecisionId,
      createdAt: workOrder.createdAt,
      updatedAt: workOrder.updatedAt,
      closedAt: workOrder.closedAt,
      completedAt: workOrder.completedAt,
    })
    .from(workOrder)
    .where(and(
      eq(workOrder.userId, userId),
      eq(workOrder.ref, runtimeRef),
    ))
    .orderBy(desc(workOrder.updatedAt), desc(workOrder.id))
    .limit(3)))
  const truncatedRuntimeGoalIds = workOrderGroups.flatMap((records, index) => (
    records.length > 2 ? [goals[index].id] : []
  ))
  const workOrders = workOrderGroups.flatMap((records) => records.slice(0, 2))

  const workOrderIds = workOrders.map((record) => record.id)
  const workOrderEntityIds = workOrderIds.map(String)
  const decisionIds = [...new Set(workOrders
    .map((record) => record.linkedDecisionId)
    .filter((id): id is number => id !== null))]

  const [eventGroups, evidenceRecordGroups, decisions, auditRecordGroups] = await Promise.all([
    Promise.all([
      ...workOrderEntityIds.map((entityId) => (
        db
          .select({
            id: governanceEvent.id,
            userId: governanceEvent.userId,
            eventType: governanceEvent.eventType,
            entityType: governanceEvent.entityType,
            entityId: governanceEvent.entityId,
            actor: governanceEvent.actor,
            reason: governanceEvent.reason,
            evidenceId: governanceEvent.evidenceId,
            metadata: governanceEvent.metadata,
            createdAt: governanceEvent.createdAt,
          })
          .from(governanceEvent)
          .where(and(
            eq(governanceEvent.userId, userId),
            eq(governanceEvent.entityType, "work_order"),
            eq(governanceEvent.entityId, entityId),
            inArray(governanceEvent.eventType, [
              "HERMES_RUNTIME_CHECKPOINT",
              "HERMES_RUNTIME_FAILURE_EVAL",
              "HERMES_RUNTIME_LEASE",
            ]),
          ))
          .orderBy(desc(governanceEvent.id))
          .limit(EVENTS_PER_RUNTIME_LIMIT + 1)
      )),
      ...goals.map((record) => db
        .select({
          id: governanceEvent.id,
          userId: governanceEvent.userId,
          eventType: governanceEvent.eventType,
          entityType: governanceEvent.entityType,
          entityId: governanceEvent.entityId,
          actor: governanceEvent.actor,
          reason: governanceEvent.reason,
          evidenceId: governanceEvent.evidenceId,
          metadata: governanceEvent.metadata,
          createdAt: governanceEvent.createdAt,
        })
        .from(governanceEvent)
        .where(and(
          eq(governanceEvent.userId, userId),
          eq(governanceEvent.entityType, "goal"),
          eq(governanceEvent.entityId, String(record.id)),
          inArray(governanceEvent.eventType, [
            "HERMES_OUTCOME_TERMINAL",
            "HERMES_OUTCOME_PROVIDER_RECOVERED",
            "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED",
            "HERMES_OUTCOME_REVIEW_RECOVERED",
            "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED",
            "HERMES_OWNER_AUTHORITY_DECISION",
          ]),
        ))
        .orderBy(desc(governanceEvent.id))
        .limit(EVENTS_PER_RUNTIME_LIMIT + 1)),
    ]),
    workOrderIds.length === 0
      ? Promise.resolve([])
      : Promise.all(workOrderIds.map((workOrderId) => db
        .select({
          id: evidenceRecord.id,
          userId: evidenceRecord.userId,
          ref: evidenceRecord.ref,
          workOrderId: evidenceRecord.workOrderId,
          result: evidenceRecord.result,
          repo: evidenceRecord.repo,
          branch: evidenceRecord.branch,
          head: evidenceRecord.head,
          validators: evidenceRecord.validators,
          knownFailures: evidenceRecord.knownFailures,
          outOfScopeChanges: evidenceRecord.outOfScopeChanges,
          deferredItems: evidenceRecord.deferredItems,
          nextValidMove: evidenceRecord.nextValidMove,
          notes: evidenceRecord.notes,
          contentHash: evidenceRecord.contentHash,
          artifactPath: evidenceRecord.artifactPath,
          createdAt: evidenceRecord.createdAt,
        })
        .from(evidenceRecord)
        .where(and(
          eq(evidenceRecord.userId, userId),
          eq(evidenceRecord.workOrderId, workOrderId),
        ))
        .orderBy(desc(evidenceRecord.createdAt), desc(evidenceRecord.id))
        .limit(RELATED_RECORD_LIMIT + 1))),
    decisionIds.length === 0
      ? Promise.resolve([])
      : db
        .select({
          id: decision.id,
          userId: decision.userId,
          ref: decision.ref,
          title: decision.title,
          decision: decision.decision,
          rationale: decision.rationale,
          consequences: decision.consequences,
          status: decision.status,
          authority: decision.authority,
          scope: decision.scope,
          evidence: decision.evidence,
          decidedAt: decision.decidedAt,
          createdAt: decision.createdAt,
          updatedAt: decision.updatedAt,
        })
        .from(decision)
        .where(and(
          eq(decision.userId, userId),
          inArray(decision.id, decisionIds),
        ))
        .orderBy(desc(decision.updatedAt), desc(decision.id)),
    Promise.all(goals.map((record) => {
      const runtimeWorkOrder = workOrders
        .filter((candidate) => candidate.ref === `WO-HERMES-OUTCOME-${record.id}`)
        .sort((left, right) => (
          right.updatedAt.getTime() - left.updatedAt.getTime() || right.id - left.id
        ))[0]
      return db
        .select({
          id: eventLog.id,
          userId: eventLog.userId,
          type: eventLog.type,
          summary: eventLog.summary,
          register: eventLog.register,
          refId: eventLog.refId,
          metadata: eventLog.metadata,
          createdAt: eventLog.createdAt,
        })
        .from(eventLog)
        .where(and(
          eq(eventLog.userId, userId),
          runtimeWorkOrder
            ? or(
                and(eq(eventLog.register, "goals"), eq(eventLog.refId, record.id)),
                and(eq(eventLog.register, "work-orders"), eq(eventLog.refId, runtimeWorkOrder.id)),
              )
            : and(eq(eventLog.register, "goals"), eq(eventLog.refId, record.id)),
        ))
        .orderBy(desc(eventLog.createdAt), desc(eventLog.id))
        .limit(RELATED_RECORD_LIMIT + 1)
    })),
  ])

  const runtimeEventGroups = eventGroups.slice(0, workOrderEntityIds.length)
  const goalEventGroups = eventGroups.slice(workOrderEntityIds.length)
  const truncatedRuntimeWorkOrderIds = runtimeEventGroups.flatMap((records, index) => (
    records.length > EVENTS_PER_RUNTIME_LIMIT ? [workOrderIds[index]] : []
  ))
  const truncatedGoalTerminalIds = goalEventGroups.flatMap((records, index) => (
    records.length > EVENTS_PER_RUNTIME_LIMIT ? [goals[index].id] : []
  ))
  const truncatedEvidenceWorkOrderIds = evidenceRecordGroups.flatMap((records, index) => (
    records.length > RELATED_RECORD_LIMIT ? [workOrderIds[index]] : []
  ))
  const truncatedAuditGoalIds = auditRecordGroups.flatMap((records, index) => (
    records.length > RELATED_RECORD_LIMIT ? [goals[index].id] : []
  ))

  return buildGoalTimelineReadModel({
    userId,
    goals: goals as GoalTimelineGoalRecord[],
    workOrders: workOrders as GoalTimelineWorkOrderRecord[],
    governanceEvents: [
      ...runtimeEventGroups.flatMap((records) => records.slice(0, EVENTS_PER_RUNTIME_LIMIT)),
      ...goalEventGroups.flatMap((records) => records.slice(0, EVENTS_PER_RUNTIME_LIMIT)),
    ] as RuntimeExecutionGovernanceEventRecord[],
    evidenceRecords: evidenceRecordGroups
      .flatMap((records) => records.slice(0, RELATED_RECORD_LIMIT)) as GoalTimelineEvidenceRecord[],
    decisions: decisions as GoalTimelineDecisionRecord[],
    auditRecords: auditRecordGroups
      .flatMap((records) => records.slice(0, RELATED_RECORD_LIMIT)) as GoalTimelineAuditRecord[],
    truncatedRuntimeWorkOrderIds,
    truncatedRuntimeGoalIds,
    truncatedEvidenceWorkOrderIds,
    truncatedAuditGoalIds,
    truncatedGoalTerminalIds,
    observedAt: new Date(),
  })
}

export async function getGoalTimelines(): Promise<GoalTimelineProjection[]> {
  return readGoalTimelines()
}

export async function getGoalTimeline(goalId: number): Promise<GoalTimelineProjection | null> {
  if (!Number.isSafeInteger(goalId) || goalId < 1) return null
  return (await readGoalTimelines([goalId]))[0] ?? null
}

export async function getGoalTimelinesByIds(
  goalIds: number[],
): Promise<GoalTimelineProjection[]> {
  if (goalIds.length > GOAL_TIMELINE_BATCH_LIMIT) {
    throw new Error("GOAL_TIMELINE_BATCH_LIMIT_EXCEEDED")
  }
  const validGoalIds = [...new Set(goalIds)].filter(
    (goalId) => Number.isSafeInteger(goalId) && goalId > 0,
  )
  if (validGoalIds.length === 0) return []
  return readGoalTimelines(validGoalIds)
}
