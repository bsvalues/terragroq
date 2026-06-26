import { db } from "@/lib/db"
import { eventLog } from "@/lib/db/schema"
import { desc, eq } from "drizzle-orm"

type LogInput = {
  userId: string
  type: string
  summary: string
  register?: string
  refId?: number
  metadata?: Record<string, unknown>
}

export async function logEvent(input: LogInput) {
  await db.insert(eventLog).values({
    userId: input.userId,
    type: input.type,
    summary: input.summary,
    register: input.register ?? null,
    refId: input.refId ?? null,
    metadata: input.metadata ?? null,
  })
}

export async function getRecentEvents(userId: string, limit = 50) {
  return db
    .select()
    .from(eventLog)
    .where(eq(eventLog.userId, userId))
    .orderBy(desc(eventLog.createdAt))
    .limit(limit)
}
