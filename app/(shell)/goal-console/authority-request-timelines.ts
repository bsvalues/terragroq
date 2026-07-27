"use server"

import { and, desc, eq } from "drizzle-orm"

import { getGoalTimeline } from "@/app/actions/goal-timeline"
import {
  getActiveGoalAuthorityRequests,
  getAuthorityRequestGoalIds,
  getLatestOwnerDecisionGoalIds,
} from "@/components/goal-console/active-goal-authority-requests"
import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import { db } from "@/lib/db"
import { governanceEvent, workOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"

const AUTHORITY_REQUEST_PROJECTION_BATCH_SIZE = 25

export async function getActiveGoalAuthorityRequestTimelines() {
  const userId = await getUserId()
  const [candidateWorkOrders, terminalEvents] = await Promise.all([
    db
      .select({ ref: workOrder.ref })
      .from(workOrder)
      .where(and(
        eq(workOrder.userId, userId),
        eq(workOrder.result, "OWNER_DECISION_REQUIRED"),
      ))
      .orderBy(desc(workOrder.updatedAt), desc(workOrder.id)),
    db
      .select({
        id: governanceEvent.id,
        entityId: governanceEvent.entityId,
        metadata: governanceEvent.metadata,
      })
      .from(governanceEvent)
      .where(and(
        eq(governanceEvent.userId, userId),
        eq(governanceEvent.entityType, "goal"),
        eq(governanceEvent.eventType, "HERMES_OUTCOME_TERMINAL"),
      ))
      .orderBy(desc(governanceEvent.id)),
  ])
  const goalIds = Array.from(new Set([
    ...getLatestOwnerDecisionGoalIds(terminalEvents),
    ...getAuthorityRequestGoalIds(candidateWorkOrders),
  ]))
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
