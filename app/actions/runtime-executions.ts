"use server"

import { and, desc, eq, inArray, like } from "drizzle-orm"

import {
  buildRuntimeExecutionTruth,
  projectRuntimeExecutionQuery,
} from "@/components/runtime/runtime-execution-model"
import type {
  RuntimeExecutionGovernanceEventRecord,
  RuntimeExecutionQueryResult,
  RuntimeExecutionTruth,
  RuntimeExecutionWorkOrderRecord,
} from "@/components/runtime/runtime-execution-model"
import { db } from "@/lib/db"
import { governanceEvent, workOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"

const RUNTIME_EXECUTION_LIMIT = 50
const RUNTIME_EVENTS_PER_EXECUTION_LIMIT = 500

async function readRuntimeExecutionTruth(): Promise<RuntimeExecutionQueryResult> {
  const userId = await getUserId()
  const workOrders = await db
    .select({
      id: workOrder.id,
      userId: workOrder.userId,
      ref: workOrder.ref,
      title: workOrder.title,
      goal: workOrder.goal,
      lane: workOrder.lane,
      status: workOrder.status,
      result: workOrder.result,
      commitRef: workOrder.commitRef,
      evidence: workOrder.evidence,
      createdAt: workOrder.createdAt,
      updatedAt: workOrder.updatedAt,
      closedAt: workOrder.closedAt,
      completedAt: workOrder.completedAt,
    })
    .from(workOrder)
    .where(and(
      eq(workOrder.userId, userId),
      like(workOrder.ref, "WO-HERMES-OUTCOME-%"),
    ))
    .orderBy(desc(workOrder.updatedAt), desc(workOrder.id))
    .limit(RUNTIME_EXECUTION_LIMIT)

  if (workOrders.length === 0) return projectRuntimeExecutionQuery([])

  const workOrderIds = workOrders.map((row) => String(row.id))
  const eventGroups = await Promise.all(workOrderIds.map((workOrderId) => (
    db
      .select({
        id: governanceEvent.id,
        userId: governanceEvent.userId,
        eventType: governanceEvent.eventType,
        entityType: governanceEvent.entityType,
        entityId: governanceEvent.entityId,
        actor: governanceEvent.actor,
        reason: governanceEvent.reason,
        metadata: governanceEvent.metadata,
        createdAt: governanceEvent.createdAt,
      })
      .from(governanceEvent)
      .where(and(
        eq(governanceEvent.userId, userId),
        eq(governanceEvent.entityType, "work_order"),
        eq(governanceEvent.entityId, workOrderId),
        inArray(governanceEvent.eventType, [
          "HERMES_RUNTIME_CHECKPOINT",
          "HERMES_RUNTIME_FAILURE_EVAL",
          "HERMES_RUNTIME_LEASE",
        ]),
      ))
      .orderBy(desc(governanceEvent.createdAt), desc(governanceEvent.id))
      .limit(RUNTIME_EVENTS_PER_EXECUTION_LIMIT)
  )))
  const events = eventGroups.flat()

  return projectRuntimeExecutionQuery(
    buildRuntimeExecutionTruth(
      userId,
      workOrders as RuntimeExecutionWorkOrderRecord[],
      events as RuntimeExecutionGovernanceEventRecord[],
    ),
  )
}

export async function getRuntimeExecutions(): Promise<RuntimeExecutionTruth[]> {
  return (await readRuntimeExecutionTruth()).executions
}

export async function getRuntimeExecutionQuery(): Promise<RuntimeExecutionQueryResult> {
  return readRuntimeExecutionTruth()
}
