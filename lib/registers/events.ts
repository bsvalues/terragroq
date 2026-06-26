import { db } from "@/lib/db"
import { eventLog } from "@/lib/db/schema"
import { desc, eq } from "drizzle-orm"

export async function logEvent(params: {
  userId: string
  type: string
  summary: string
  register?: string
  refId?: number
  metadata?: Record<string, unknown>
}) {
  await db.insert(eventLog).values({
    userId: params.userId,
    type: params.type,
    summary: params.summary,
    register: params.register,
    refId: params.refId,
    metadata: params.metadata ?? null,
  })
}

export async function getRecentEvents(userId: string, limit = 25) {
  return db
    .select()
    .from(eventLog)
    .where(eq(eventLog.userId, userId))
    .orderBy(desc(eventLog.createdAt))
    .limit(limit)
}
