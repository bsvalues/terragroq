"use server"

import { db } from "@/lib/db"
import {
  memoryFact,
  decision,
  doctrine,
  workOrder,
  document,
} from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { getRecentEvents } from "@/lib/registers/events"
import { and, count, eq } from "drizzle-orm"

async function countWhere(table: any, userId: string, extra?: any) {
  const [row] = await db
    .select({ value: count() })
    .from(table)
    .where(extra ? and(eq(table.userId, userId), extra) : eq(table.userId, userId))
  return row?.value ?? 0
}

export async function getDashboardData() {
  const userId = await getUserId()

  const [memory, decisions, openDecisions, doctrines, work, openWork, docs, events] =
    await Promise.all([
      countWhere(memoryFact, userId),
      countWhere(decision, userId),
      countWhere(decision, userId, eq(decision.status, "proposed")),
      countWhere(doctrine, userId, eq(doctrine.active, true)),
      countWhere(workOrder, userId),
      countWhere(workOrder, userId, eq(workOrder.status, "in_progress")),
      countWhere(document, userId),
      getRecentEvents(userId, 8),
    ])

  return {
    stats: {
      memory,
      decisions,
      openDecisions,
      doctrines,
      work,
      openWork,
      docs,
    },
    events,
  }
}
