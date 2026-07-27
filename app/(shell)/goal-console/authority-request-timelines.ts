"use server"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import { getGoalTimeline } from "@/app/actions/goal-timeline"
import {
  getActiveGoalAuthorityRequests,
  getUnresolvedAuthorityRequestGoalIds,
} from "@/components/goal-console/active-goal-authority-requests"
import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import { db } from "@/lib/db"
import { governanceEvent, workOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"

const AUTHORITY_REQUEST_PROJECTION_BATCH_SIZE = 25

export async function getActiveGoalAuthorityRequestTimelines() {
  const userId = await getUserId()
  const [candidateWorkOrders, lifecycleEvents] = await Promise.all([
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
        isNull(workOrder.linkedDecisionId),
      ))
      .orderBy(desc(workOrder.updatedAt), desc(workOrder.id)),
    db
      .select({
        id: governanceEvent.id,
        eventType: governanceEvent.eventType,
        entityId: governanceEvent.entityId,
        metadata: governanceEvent.metadata,
      })
      .from(governanceEvent)
      .where(and(
        eq(governanceEvent.userId, userId),
        eq(governanceEvent.entityType, "goal"),
        inArray(governanceEvent.eventType, [
          "HERMES_OUTCOME_TERMINAL",
          "HERMES_OWNER_AUTHORITY_DECISION",
          "HERMES_OUTCOME_COMPLETED",
        ]),
      ))
      .orderBy(desc(governanceEvent.id)),
  ])
  const goalIds = getUnresolvedAuthorityRequestGoalIds(
    candidateWorkOrders,
    lifecycleEvents,
  )
  const candidates: GoalTimelineProjection[] = []

  for (
    let index = 0;
    index < goalIds.length;
    index += AUTHORITY_REQUEST_PROJECTION_BATCH_SIZE
  ) {
    const batch = await Promise.all(
      goalIds
        .slice(index, index + AUTHORITY_REQUEST_PROJECTION_BATCH_SIZE)
        .map((goalId) => getGoalTimeline(goalId)),
    )
    for (const timeline of batch) {
      if (timeline) candidates.push(timeline)
    }
  }

  return getActiveGoalAuthorityRequests(candidates)
}
