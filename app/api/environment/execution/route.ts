import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { evidenceRecord, outcomeQueueItem, workOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { projectWorldExecution, type CanonicalExecution } from "@/lib/environment/world-execution"
import type { WorldEvidence } from "@/lib/environment/working-world"

/**
 * Where real runtime execution reaches the mounted world (phase 2, criterion 6).
 *
 * The environment has no event bus of its own on purpose: the governed database is already the record
 * of what execution did, and a parallel event stream beside it would be a second truth free to
 * disagree with the first. So this reads canonical state for ONE bound outcome and projects it.
 *
 * It is read-only and outcome-scoped. It cannot start, advance, or settle anything — a surface that
 * can quietly move governed state is how an "observability endpoint" becomes an ungoverned control
 * plane. And it never invents: an outcome that is not this owner's, or not there at all, is reported
 * as absent rather than as an idle world that might later look like progress.
 */
export async function GET(request: Request) {
  let userId: string
  try {
    userId = await getUserId()
  } catch {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }
  if (!userId) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  const outcomeKey = new URL(request.url).searchParams.get("outcomeKey")?.trim()
  if (!outcomeKey) return Response.json({ error: "OUTCOME_KEY_REQUIRED" }, { status: 400 })
  // The queue's own key grammar. Anything else is refused rather than turned into a wildcard read.
  if (!/^[A-Za-z0-9:_.-]{1,200}$/.test(outcomeKey)) {
    return Response.json({ error: "OUTCOME_KEY_MALFORMED" }, { status: 400 })
  }

  const rows = await db
    .select({
      lifecycleState: outcomeQueueItem.lifecycleState,
      activeWorkOrderId: outcomeQueueItem.activeWorkOrderId,
    })
    .from(outcomeQueueItem)
    .where(and(eq(outcomeQueueItem.userId, userId), eq(outcomeQueueItem.outcomeKey, outcomeKey)))
    .limit(1)

  const outcome = rows[0]
  if (!outcome) return Response.json({ error: "OUTCOME_ABSENT" }, { status: 404 })

  let workOrderStatus: string | null = null
  let evidence: WorldEvidence[] = []
  if (outcome.activeWorkOrderId !== null) {
    const [bound] = await db
      .select({ status: workOrder.status })
      .from(workOrder)
      .where(and(eq(workOrder.userId, userId), eq(workOrder.id, outcome.activeWorkOrderId)))
      .limit(1)
    workOrderStatus = bound?.status ?? null

    const records = await db
      .select({
        result: evidenceRecord.result,
        notes: evidenceRecord.notes,
        createdAt: evidenceRecord.createdAt,
      })
      .from(evidenceRecord)
      .where(and(eq(evidenceRecord.userId, userId), eq(evidenceRecord.workOrderId, outcome.activeWorkOrderId)))
      .limit(50)
    evidence = records.map((record) => ({
      kind: "runtime",
      detail: record.notes ?? "",
      result: record.result ?? null,
      at: record.createdAt.toISOString(),
    }))
  }

  const canonical: CanonicalExecution = {
    lifecycleState: outcome.lifecycleState,
    activeWorkOrderId: outcome.activeWorkOrderId,
    workOrderStatus,
    // The executing lane is only reported when the runtime actually recorded one; this read does not
    // infer it from "something is running, so presumably the usual lane".
    lane: null,
    evidence,
    observedAt: new Date().toISOString(),
  }

  return Response.json({ outcomeKey, ...projectWorldExecution(canonical) })
}
