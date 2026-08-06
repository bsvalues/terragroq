import { and, desc, eq, inArray } from "drizzle-orm"

import { normalizeDurableRecordReference } from "@/components/outcome-queue/supporting-record-links"
import {
  RUNTIME_CHECKPOINT_EVENT,
  RUNTIME_FAILURE_EVENT,
} from "@/components/runtime/runtime-execution-model"
import { db } from "@/lib/db"
import { governanceEvent } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"

const DURABLE_TRACE_MATCH_LIMIT = 2

export async function getDurableTraceRecord(reference: string) {
  const normalized = normalizeDurableRecordReference("trace", reference)
  if (!normalized) return null
  const userId = await getUserId()
  const traceId = Number(normalized.slice("trace:".length))
  const matches = await db
    .select({
      id: governanceEvent.id,
      eventType: governanceEvent.eventType,
      entityType: governanceEvent.entityType,
      entityId: governanceEvent.entityId,
      actor: governanceEvent.actor,
      createdAt: governanceEvent.createdAt,
    })
    .from(governanceEvent)
    .where(and(
      eq(governanceEvent.userId, userId),
      eq(governanceEvent.id, traceId),
      inArray(governanceEvent.eventType, [
        RUNTIME_CHECKPOINT_EVENT,
        RUNTIME_FAILURE_EVENT,
      ]),
    ))
    .orderBy(desc(governanceEvent.id))
    .limit(DURABLE_TRACE_MATCH_LIMIT)

  return matches.length === 1 ? matches[0] : null
}
