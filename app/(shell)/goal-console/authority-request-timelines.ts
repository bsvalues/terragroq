"use server"

import { createHash } from "node:crypto"

import { and, desc, eq, inArray, sql } from "drizzle-orm"

import { getGoalTimelinesByIds } from "@/app/actions/goal-timeline"
import {
  getActiveGoalAuthorityRequests,
  getUnresolvedAuthorityRequestGoalIds,
} from "@/components/goal-console/active-goal-authority-requests"
import {
  ownerDecisionReceiptValid,
  type GoalTimelineAuditRecord,
  type GoalTimelineDecisionRecord,
  type GoalTimelineEvidenceRecord,
  type GoalTimelineProjection,
  type GoalTimelineWorkOrderRecord,
} from "@/components/goal-console/goal-timeline-read-model"
import type { RuntimeExecutionGovernanceEventRecord } from "@/components/runtime/runtime-execution-model"
import { db } from "@/lib/db"
import {
  decision,
  eventLog,
  evidenceRecord,
  governanceEvent,
  workOrder,
} from "@/lib/db/schema"
import { getUserId } from "@/lib/session"

const AUTHORITY_REQUEST_PROJECTION_BATCH_SIZE = 25
const DUPLICATE_SENTINEL_LIMIT = 2
const WORK_ORDER_DUPLICATE_SENTINEL_LIMIT = 3
const HERMES_OUTCOME_WORK_ORDER_PREFIX = "WO-HERMES-OUTCOME-"

function goalIdFromRuntimeRef(ref: string | null) {
  const match = /^WO-HERMES-OUTCOME-([1-9]\d*)$/.exec(ref ?? "")
  return match ? Number(match[1]) : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function canonicalAuditMetadata(
  goalId: number,
  workOrderId: number,
  terminalEvent: RuntimeExecutionGovernanceEventRecord,
  linkedDecision: GoalTimelineDecisionRecord,
  evidenceId: number,
) {
  const terminalMetadata = record(terminalEvent.metadata)
  const choice = linkedDecision.decision
  const nextState = terminalMetadata?.nextState
  const decisionPacket = terminalMetadata && {
    blockedAction: terminalMetadata.blockedAction,
    authorityBoundary: terminalMetadata.authorityBoundary,
    minimumChoice: terminalMetadata.minimumChoice,
    approveConsequence: terminalMetadata.approveConsequence,
    denyConsequence: terminalMetadata.denyConsequence,
  }
  if (!terminalMetadata
    || !decisionPacket
    || Object.values(decisionPacket).some((value) => typeof value !== "string")
    || decisionPacket.minimumChoice !== "APPROVE_OR_DENY"
    || !["APPROVE", "DENY"].includes(choice)
    || typeof nextState !== "string"
    || !/^[A-Z][A-Z0-9_]{1,79}$/.test(nextState)
    || !linkedDecision.decidedAt) return null
  const decisionRef = `OWNER-DECISION-${goalId}-${terminalEvent.id}`
  const requestKey = [
    "hermes-owner-decision",
    goalId,
    workOrderId,
    terminalEvent.id,
    linkedDecision.userId,
    choice,
    nextState,
  ].join(":")
  const decisionPacketDigest = createHash("sha256")
    .update(JSON.stringify(decisionPacket))
    .digest("hex")
  return {
    outcomeId: goalId,
    workOrderId,
    terminalEventId: terminalEvent.id,
    ownerUserId: linkedDecision.userId,
    choice,
    expectedNextState: nextState,
    decisionId: linkedDecision.id,
    decisionRef,
    requestKey,
    decisionPacket,
    decisionPacketDigest,
    status: choice === "APPROVE" ? "accepted" : "rejected",
    authority: "binding",
    evidenceId,
    recordedAt: linkedDecision.decidedAt.toISOString(),
  }
}

export async function getActiveGoalAuthorityRequestTimelines() {
  const userId = await getUserId()
  const [candidateWorkOrders, lifecycleStates] = await Promise.all([
    db
      .select({
        id: workOrder.id,
        ref: workOrder.ref,
        updatedAt: workOrder.updatedAt,
      })
      .from(workOrder)
      .where(and(
        eq(workOrder.userId, userId),
        eq(workOrder.result, "OWNER_DECISION_REQUIRED"),
      ))
      .orderBy(desc(workOrder.updatedAt), desc(workOrder.id)),
    db
      .select({
        id: governanceEvent.id,
        eventType: governanceEvent.eventType,
        entityId: governanceEvent.entityId,
        result: sql<string | null>`${governanceEvent.metadata}->>'result'`,
      })
      .from(governanceEvent)
      .where(and(
        eq(governanceEvent.userId, userId),
        eq(governanceEvent.entityType, "goal"),
        inArray(governanceEvent.eventType, [
          "HERMES_OUTCOME_TERMINAL",
          "HERMES_OUTCOME_COMPLETED",
        ]),
      ))
      .orderBy(desc(governanceEvent.id)),
  ])
  const goalIds = getUnresolvedAuthorityRequestGoalIds(
    candidateWorkOrders,
    lifecycleStates,
  )
  const candidates: GoalTimelineProjection[] = []

  for (
    let index = 0;
    index < goalIds.length;
    index += AUTHORITY_REQUEST_PROJECTION_BATCH_SIZE
  ) {
    const batchGoalIds = goalIds.slice(
      index,
      index + AUTHORITY_REQUEST_PROJECTION_BATCH_SIZE,
    )
    const runtimeRefs = batchGoalIds.map(
      (goalId) => `${HERMES_OUTCOME_WORK_ORDER_PREFIX}${goalId}`,
    )
    const [workOrderGroups, goalEventGroups] = await Promise.all([
      Promise.all(runtimeRefs.map((runtimeRef) => db
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
        .limit(WORK_ORDER_DUPLICATE_SENTINEL_LIMIT))),
      Promise.all(batchGoalIds.map((goalId) => db
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
          eq(governanceEvent.entityId, String(goalId)),
          eq(governanceEvent.eventType, "HERMES_OUTCOME_TERMINAL"),
        ))
        .orderBy(desc(governanceEvent.id))
        .limit(1))),
    ])
    const exactWorkOrders = new Map<number, GoalTimelineWorkOrderRecord>()
    for (const records of workOrderGroups) {
      if (records.length !== 1) continue
      const goalId = goalIdFromRuntimeRef(records[0].ref)
      if (goalId !== null) {
        exactWorkOrders.set(goalId, records[0] as GoalTimelineWorkOrderRecord)
      }
    }
    const decisionIds = [...new Set(Array.from(exactWorkOrders.values())
      .flatMap((record) => record.linkedDecisionId ? [record.linkedDecisionId] : []))]
    const linkedDecisions = decisionIds.length === 0
      ? []
      : await db
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

    const unresolvedBatchGoalIds: number[] = []
    for (let batchIndex = 0; batchIndex < batchGoalIds.length; batchIndex += 1) {
      const goalId = batchGoalIds[batchIndex]
      const currentWorkOrder = exactWorkOrders.get(goalId)
      const goalEvents = goalEventGroups[batchIndex]
      const terminalEvent = goalEvents.find((event) => (
        event.eventType === "HERMES_OUTCOME_TERMINAL"
      )) ?? null
      const linkedDecision = currentWorkOrder?.linkedDecisionId
        ? linkedDecisions.find(
            (record) => record.id === currentWorkOrder.linkedDecisionId,
          ) ?? null
        : null
      if (!currentWorkOrder || !terminalEvent || !linkedDecision) {
        unresolvedBatchGoalIds.push(goalId)
        continue
      }
      const evidenceRef = `EV-OWNER-DECISION-${goalId}-${terminalEvent.id}`
      const receiptEvidence = await db
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
          eq(evidenceRecord.workOrderId, currentWorkOrder.id),
          eq(evidenceRecord.ref, evidenceRef),
        ))
        .orderBy(desc(evidenceRecord.id))
        .limit(DUPLICATE_SENTINEL_LIMIT)
      const expectedAudits = receiptEvidence.flatMap((evidence) => {
        const metadata = canonicalAuditMetadata(
          goalId,
          currentWorkOrder.id,
          terminalEvent as RuntimeExecutionGovernanceEventRecord,
          linkedDecision as GoalTimelineDecisionRecord,
          evidence.id,
        )
        return metadata ? [{ evidenceId: evidence.id, metadata }] : []
      })
      if (expectedAudits.length === 0) {
        unresolvedBatchGoalIds.push(goalId)
        continue
      }
      const [receiptGroups, auditGroups] = await Promise.all([
        Promise.all(expectedAudits.map((expected) => db
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
            eq(governanceEvent.eventType, "HERMES_OWNER_AUTHORITY_DECISION"),
            eq(governanceEvent.entityType, "goal"),
            eq(governanceEvent.entityId, String(goalId)),
            eq(governanceEvent.evidenceId, expected.evidenceId),
            eq(governanceEvent.metadata, expected.metadata),
          ))
          .orderBy(desc(governanceEvent.id))
          .limit(DUPLICATE_SENTINEL_LIMIT))),
        Promise.all(expectedAudits.map((expected) => db
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
            eq(eventLog.type, "owner.decision.recorded"),
            eq(eventLog.register, "goals"),
            eq(eventLog.refId, goalId),
            eq(eventLog.metadata, expected.metadata),
          ))
          .orderBy(desc(eventLog.id))
          .limit(DUPLICATE_SENTINEL_LIMIT))),
      ])
      const receiptEvents = receiptGroups.flat()
      const decisionAudits = auditGroups.flat()
      const resolved = ownerDecisionReceiptValid(
        goalId,
        linkedDecision as GoalTimelineDecisionRecord,
        currentWorkOrder,
        terminalEvent as RuntimeExecutionGovernanceEventRecord,
        receiptEvidence as GoalTimelineEvidenceRecord[],
        [
          ...goalEvents,
          ...receiptEvents,
        ] as RuntimeExecutionGovernanceEventRecord[],
        decisionAudits as GoalTimelineAuditRecord[],
      )
      if (!resolved) unresolvedBatchGoalIds.push(goalId)
    }

    candidates.push(...await getGoalTimelinesByIds(unresolvedBatchGoalIds))
  }

  return getActiveGoalAuthorityRequests(candidates)
}
