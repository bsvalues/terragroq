import "server-only"

import { db } from "@/lib/db"
import { workOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import {
  HOME_RADAR_LIMIT,
  type HomeWorkRadarSource,
} from "@/components/dashboard/home-command-center"
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm"

const ACTIVE_WORK_STATUSES = ["approved", "active", "review"]
const RECENT_OUTCOME_STATUSES = ["closed", "aborted"]

async function countMatchingWorkOrders(userId: string, predicate: SQL) {
  const [row] = await db
    .select({ value: count() })
    .from(workOrder)
    .where(and(eq(workOrder.userId, userId), predicate))

  return row?.value ?? 0
}

export async function getHomeWorkRadarSource(): Promise<HomeWorkRadarSource> {
  const userId = await getUserId()
  const ownedByUser = eq(workOrder.userId, userId)
  const activeWork = inArray(workOrder.status, ACTIVE_WORK_STATUSES)
  const blockedWork = eq(workOrder.status, "blocked")
  const recentOutcome = inArray(workOrder.status, RECENT_OUTCOME_STATUSES)

  const [
    activeWorkCount,
    activeWorkItems,
    blockerCount,
    blockerItems,
    recentOutcomeCount,
    recentOutcomeItems,
  ] = await Promise.all([
    countMatchingWorkOrders(userId, activeWork),
    db
      .select({
        id: workOrder.id,
        ref: workOrder.ref,
        title: workOrder.title,
        status: workOrder.status,
        updatedAt: workOrder.updatedAt,
      })
      .from(workOrder)
      .where(and(ownedByUser, activeWork))
      .orderBy(
        sql<number>`case ${workOrder.status}
          when 'active' then 0
          when 'review' then 1
          when 'approved' then 2
          else 3
        end`,
        desc(workOrder.updatedAt),
        desc(workOrder.id),
      )
      .limit(HOME_RADAR_LIMIT),
    countMatchingWorkOrders(userId, blockedWork),
    db
      .select({
        id: workOrder.id,
        ref: workOrder.ref,
        title: workOrder.title,
        status: workOrder.status,
        description: workOrder.description,
        stopConditions: workOrder.stopConditions,
      })
      .from(workOrder)
      .where(and(ownedByUser, blockedWork))
      .orderBy(desc(workOrder.updatedAt), desc(workOrder.id))
      .limit(HOME_RADAR_LIMIT),
    countMatchingWorkOrders(userId, recentOutcome),
    db
      .select({
        id: workOrder.id,
        ref: workOrder.ref,
        title: workOrder.title,
        status: workOrder.status,
        result: workOrder.result,
        closedAt: workOrder.closedAt,
        completedAt: workOrder.completedAt,
        updatedAt: workOrder.updatedAt,
      })
      .from(workOrder)
      .where(and(ownedByUser, recentOutcome))
      .orderBy(
        desc(
          sql<Date>`coalesce(
            ${workOrder.completedAt},
            ${workOrder.closedAt},
            ${workOrder.updatedAt}
          )`,
        ),
        desc(workOrder.id),
      )
      .limit(HOME_RADAR_LIMIT),
  ])

  return {
    activeWork: {
      count: activeWorkCount,
      items: activeWorkItems,
    },
    blockers: {
      count: blockerCount,
      items: blockerItems,
    },
    recentOutcomes: {
      count: recentOutcomeCount,
      items: recentOutcomeItems,
    },
  }
}
