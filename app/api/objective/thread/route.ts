import { pool } from "@/lib/db"
import { getSession } from "@/lib/session"
import { buildThreadItems, summariseThread, type VerificationSummary } from "@/lib/objective/thread"
import { threadBindings, threadForWorkOrder } from "@/lib/objective/thread-binding"
import { assertOperationAllowed, type OpenConflict } from "@/lib/resource/completion"
import { reconcileResource } from "@/lib/resource/reconcile"
import { shapeResourceRecord, type ResourceRow } from "@/lib/resource/resolve"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Return the answer to the thread that asked (#884, #871 boundary 6).
 *
 * Everything here is re-derived from its source at read time. Nothing was copied into the thread when
 * it was written, because a copied verdict is stale the moment its source moves -- and this whole
 * outcome exists because stale copies were trusted.
 *
 * It does not re-run probes. The verification item comes from the observation event that was recorded
 * when the probe ran, carrying the time it was observed, so a reader can see how old the looking is.
 * A thread read is a read.
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session?.user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  const url = new URL(request.url)
  const requestedThread = url.searchParams.get("thread")?.trim()
  let workOrderRef = url.searchParams.get("workOrder")?.trim()
  const identity = url.searchParams.get("identity")?.trim() ?? "PACS"

  // A thread can be addressed by its own id now that it is durable. The work order remains accepted so
  // an objective can still find its thread from the reference it was handed at admission.
  let bindings: Awaited<ReturnType<typeof threadBindings>> = []
  if (requestedThread) {
    bindings = await threadBindings(session.user.id, requestedThread)
    if (bindings.length === 0) return Response.json({ error: "THREAD_UNKNOWN", thread: requestedThread }, { status: 404 })
    workOrderRef = bindings.find((binding) => binding.role === "root" && binding.sourceType === "work_order")?.sourceId ?? workOrderRef
  }
  if (!workOrderRef) return Response.json({ error: "WORK_ORDER_OR_THREAD_REQUIRED" }, { status: 400 })

  try {
    const objective = await pool.query(
      `SELECT "ref", "title", "description" FROM work_order WHERE "userId" = $1 AND "ref" = $2 LIMIT 1`,
      [session.user.id, workOrderRef],
    )
    if (objective.rowCount === 0) {
      return Response.json({ error: "OBJECTIVE_UNKNOWN", workOrder: workOrderRef }, { status: 404 })
    }

    const resourceRows = await pool.query(
      `SELECT r."type", r."canonicalIdentity", r."label", r."relationship",
              r."allowedOperations", r."ratifiedAt", r."ratifiedBy",
              p."key" AS "projectKey", p."name" AS "projectName"
         FROM project_resource r
         JOIN project p ON p.id = r."projectId"
        WHERE lower(r."resourceKey") = lower($1) OR lower(r."canonicalIdentity") = lower($1)`,
      [identity],
    )
    const record = shapeResourceRecord(identity, resourceRows.rows as ResourceRow[])

    const conflictRows = await pool.query(
      `SELECT "ref", "severity", "description" FROM conflict_record
        WHERE "status" = 'open' AND "detectedBetween" LIKE $1`,
      [`resource:${identity}%`],
    )
    const openConflicts = conflictRows.rows as OpenConflict[]

    // The most recent observation, if anyone has looked. Not re-run here.
    const observed = await pool.query(
      `SELECT "metadata", "createdAt" FROM governance_event
        WHERE "entityType" = 'resource_verification' AND "entityId" = $1
        ORDER BY "createdAt" DESC LIMIT 1`,
      [identity],
    )
    const verification: VerificationSummary | null = observed.rows[0]
      ? { ...(observed.rows[0].metadata as Omit<VerificationSummary, "observedAt">), observedAt: new Date(observed.rows[0].createdAt).toISOString() }
      : null

    const reconciliation = record ? reconcileResource(record) : null
    const refusalVerdict = record
      ? assertOperationAllowed({ record, operation: "restore", openConflicts })
      : null
    const refusal =
      refusalVerdict && !refusalVerdict.allowed
        ? { operation: "restore", refusal: refusalVerdict.refusal ?? "REFUSED", detail: refusalVerdict.detail }
        : null

    const items = buildThreadItems({
      workOrderRef,
      objective: objective.rows[0].description ?? objective.rows[0].title,
      record,
      reconciliation,
      refusal,
      verification,
    })

    const threadId = requestedThread ?? (await threadForWorkOrder(session.user.id, workOrderRef))
    return Response.json(
      {
        thread: threadId,
        workOrder: workOrderRef,
        identity,
        // Bindings are shown so a reader can see what the thread is built FROM, not just what it says.
        boundSources: bindings.length > 0 ? bindings : undefined,
        summary: summariseThread(items),
        items,
      },
      { headers: { "cache-control": "no-store" } },
    )
  } catch {
    return Response.json({ error: "THREAD_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } })
  }
}
