import { and, desc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { evidenceRecord, outcomeQueueItem, workOrder } from "@/lib/db/schema"
import { loadOwnedWorkingWorld } from "@/lib/environment/space-persistence"
import { getUserId } from "@/lib/session"
import {
  projectWorldExecution,
  projectWorldWorkerSession,
  type CanonicalExecution,
} from "@/lib/environment/world-execution"
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

  const worldId = new URL(request.url).searchParams.get("worldId")
  if (!worldId) return Response.json({ error: "WORLD_ID_REQUIRED" }, { status: 400 })
  if (!/^[A-Za-z0-9:_.-]{1,200}$/.test(worldId)) {
    return Response.json({ error: "WORLD_ID_MALFORMED" }, { status: 400 })
  }

  let world
  try {
    world = await loadOwnedWorkingWorld(userId, worldId)
  } catch {
    return Response.json({ error: "WORLD_PERSISTENCE_UNAVAILABLE" }, { status: 503 })
  }
  if (!world) return Response.json({ error: "WORLD_ABSENT" }, { status: 404 })
  const outcomeKey = world.spine.outcomeKey
  const worldWorkOrderId = world.spine.workOrderId
  if (!outcomeKey || worldWorkOrderId === null) {
    return Response.json({ error: "SPACE_EXECUTION_BINDING_MISSING" }, { status: 409 })
  }

  const rows = await db
    .select({
      lifecycleState: outcomeQueueItem.lifecycleState,
      activeWorkOrderId: outcomeQueueItem.activeWorkOrderId,
      outcomeTitle: outcomeQueueItem.title,
    })
    .from(outcomeQueueItem)
    .where(and(eq(outcomeQueueItem.userId, userId), eq(outcomeQueueItem.outcomeKey, outcomeKey)))
    .limit(1)

  const outcome = rows[0]
  if (!outcome || outcome.activeWorkOrderId !== worldWorkOrderId) {
    return Response.json({ error: "SPACE_EXECUTION_BINDING_MISMATCH" }, { status: 409 })
  }

  let workOrderStatus: string | null = null
  let workOrderLane: string | null = null
  let boundWorkOrder: Readonly<{
    id: number
    ref: string | null
    title: string
    assignee: string | null
    agent: string | null
    lane: string | null
  }> | null = null
  let evidence: WorldEvidence[] = []
  if (outcome.activeWorkOrderId !== null) {
    const [bound] = await db
      .select({
        id: workOrder.id,
        ref: workOrder.ref,
        title: workOrder.title,
        status: workOrder.status,
        lane: workOrder.lane,
        assignee: workOrder.assignee,
        agent: workOrder.agent,
      })
      .from(workOrder)
      .where(and(eq(workOrder.userId, userId), eq(workOrder.id, outcome.activeWorkOrderId)))
      .limit(1)
    if (!bound || bound.id !== worldWorkOrderId) {
      return Response.json({ error: "SPACE_EXECUTION_BINDING_MISMATCH" }, { status: 409 })
    }
    boundWorkOrder = bound
    workOrderStatus = bound?.status ?? null
    workOrderLane = bound?.lane ?? null

    const records = await db
      .select({
        result: evidenceRecord.result,
        notes: evidenceRecord.notes,
        createdAt: evidenceRecord.createdAt,
      })
      .from(evidenceRecord)
      .where(and(eq(evidenceRecord.userId, userId), eq(evidenceRecord.workOrderId, outcome.activeWorkOrderId)))
      .orderBy(desc(evidenceRecord.createdAt))
      .limit(50)
    evidence = [...records].reverse().map((record) => ({
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
    lane: workOrderLane,
    evidence,
    observedAt: new Date().toISOString(),
  }

  const projected = projectWorldExecution(canonical)
  const observedAt = canonical.observedAt
  const session = boundWorkOrder
    ? projectWorldWorkerSession({
        worldId,
        outcome: { key: outcomeKey, title: outcome.outcomeTitle },
        workOrder: boundWorkOrder,
        status: projected.execution,
        evidence: projected.evidence,
        observedAt,
      })
    : null

  return Response.json({ worldId, outcomeKey, workOrderId: worldWorkOrderId, ...projected, session })
}
