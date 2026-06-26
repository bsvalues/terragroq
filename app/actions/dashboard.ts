"use server"

import { db } from "@/lib/db"
import { memoryFact, decision, doctrine, workOrder, document } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { getRecentEvents } from "@/lib/registers/events"
import { and, count, eq } from "drizzle-orm"

export async function getDashboard() {
  const userId = await getUserId()

  const [
    memoryCount,
    decisionCount,
    openDecisions,
    doctrineCount,
    activeDoctrine,
    workOrderCount,
    openWorkOrders,
    documentCount,
    events,
  ] = await Promise.all([
    db.select({ c: count() }).from(memoryFact).where(eq(memoryFact.userId, userId)),
    db.select({ c: count() }).from(decision).where(eq(decision.userId, userId)),
    db.select({ c: count() }).from(decision).where(and(eq(decision.userId, userId), eq(decision.status, "proposed"))),
    db.select({ c: count() }).from(doctrine).where(eq(doctrine.userId, userId)),
    db.select({ c: count() }).from(doctrine).where(and(eq(doctrine.userId, userId), eq(doctrine.active, true))),
    db.select({ c: count() }).from(workOrder).where(eq(workOrder.userId, userId)),
    db
      .select({ c: count() })
      .from(workOrder)
      .where(and(eq(workOrder.userId, userId), eq(workOrder.status, "in_progress"))),
    db.select({ c: count() }).from(document).where(eq(document.userId, userId)),
    getRecentEvents(userId, 12),
  ])

  return {
    memory: memoryCount[0].c,
    decisions: decisionCount[0].c,
    openDecisions: openDecisions[0].c,
    doctrine: doctrineCount[0].c,
    activeDoctrine: activeDoctrine[0].c,
    workOrders: workOrderCount[0].c,
    openWorkOrders: openWorkOrders[0].c,
    documents: documentCount[0].c,
    events,
  }
}
