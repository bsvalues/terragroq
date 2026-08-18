import { pool } from "@/lib/db"
import { getSession } from "@/lib/session"
import { assertOperationAllowed, type OpenConflict } from "@/lib/resource/completion"
import { shapeResourceRecord, type ResourceRow } from "@/lib/resource/resolve"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Decide whether an operation against a resource may proceed (#880, #871 boundary 4).
 *
 * This is the gate that was missing when a completed 738 GB restore did not stop a proposed 102 GB
 * re-import. It answers from recorded evidence and open conflicts, contacts no node, and performs
 * nothing itself -- a permitted verdict is not an authorisation to act, which still requires a recorded
 * grant.
 *
 * The conflict lookup is resource-scoped on purpose. `getBlockingConflictForWorkOrder` already blocks
 * loops, but only for conflicts attached to a work order; the contradiction about PACS belongs to the
 * resource and would otherwise be invisible to every guard in the system.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let body: { identity?: unknown; operation?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }
  const identity = typeof body.identity === "string" ? body.identity.trim() : ""
  const operation = typeof body.operation === "string" ? body.operation.trim() : ""
  if (!identity || !operation) {
    return Response.json({ error: "IDENTITY_AND_OPERATION_REQUIRED" }, { status: 400 })
  }

  let rows: ResourceRow[]
  let openConflicts: OpenConflict[]
  try {
    const result = await pool.query(
      `SELECT r."type", r."canonicalIdentity", r."label", r."relationship",
              r."allowedOperations", r."ratifiedAt", r."ratifiedBy",
              p."key" AS "projectKey", p."name" AS "projectName"
         FROM project_resource r
         JOIN project p ON p.id = r."projectId"
        WHERE lower(r."resourceKey") = lower($1) OR lower(r."canonicalIdentity") = lower($1)`,
      [identity],
    )
    rows = result.rows as ResourceRow[]

    const conflicts = await pool.query(
      `SELECT "ref", "severity", "description" FROM conflict_record
        WHERE "status" = 'open' AND "detectedBetween" LIKE $1`,
      [`resource:${identity}%`],
    )
    openConflicts = conflicts.rows as OpenConflict[]
  } catch {
    // An unreadable registry must not read as "nothing stands in the way".
    return Response.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } })
  }

  const record = shapeResourceRecord(identity, rows)
  if (!record) {
    return Response.json(
      {
        error: "RESOURCE_UNKNOWN",
        identity,
        detail: "nothing is declared about that resource, so no operation against it can be judged",
      },
      { status: 404, headers: { "cache-control": "no-store" } },
    )
  }

  const verdict = assertOperationAllowed({ record, operation, openConflicts })
  return Response.json(
    { ...verdict, identity: record.identity, operation, recordRatified: record.ratified },
    // A refusal is a 409: the request is well formed, the state of the world declines it.
    { status: verdict.allowed ? 200 : 409, headers: { "cache-control": "no-store" } },
  )
}
