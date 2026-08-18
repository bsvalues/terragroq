import { recordConflict } from "@/app/actions/conflicts"
import { pool } from "@/lib/db"
import { getSession } from "@/lib/session"
import { reconcileResource } from "@/lib/resource/reconcile"
import { shapeResourceRecord, type ResourceRow } from "@/lib/resource/resolve"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Reconcile a resource record against what we already recorded (#878, #871 boundary 3).
 *
 * It answers the question the PACS objective actually turns on: does what we believe match what we
 * wrote down. It contacts no node and reads no filesystem -- that is boundary 5, and inferring
 * architecture from a directory listing is the original defect.
 *
 * A disagreement is registered in the existing conflict register rather than returned and forgotten,
 * because a contradiction nobody records is one the next agent rediscovers from scratch. It is recorded
 * once: re-running this must not pile up duplicates of the same standing disagreement.
 *
 * No work-context receipt is required, for the same reason objective intake needs none. This mutates
 * nothing outside the governance record and grants nothing; acting on a finding is separate work that
 * still needs its own authority. Finding a discrepancy has never been a licence to fix it.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let body: { identity?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }
  const identity = typeof body.identity === "string" ? body.identity.trim() : ""
  if (!identity) return Response.json({ error: "IDENTITY_REQUIRED" }, { status: 400 })

  let rows: ResourceRow[]
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
  } catch {
    return Response.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503 })
  }

  const record = shapeResourceRecord(identity, rows)
  if (!record) {
    return Response.json(
      { error: "RESOURCE_UNKNOWN", identity, detail: "nothing is declared about that resource, so there is nothing to reconcile" },
      { status: 404, headers: { "cache-control": "no-store" } },
    )
  }

  const verdict = reconcileResource(record)

  let conflictRef: string | null = null
  if (verdict.classification === "CONFLICTING") {
    const detectedBetween = `resource:${record.identity} declared-owner vs recorded-evidence`
    const existing = await pool.query(
      `SELECT "ref" FROM conflict_record
        WHERE "userId" = $1 AND "detectedBetween" = $2 AND "status" = 'open' LIMIT 1`,
      [session.user.id, detectedBetween],
    )
    if (existing.rows[0]) {
      conflictRef = existing.rows[0].ref
    } else {
      const recorded = await recordConflict({
        detectedBetween,
        severity: verdict.severity,
        description: verdict.summary,
        system: record.project.key ?? undefined,
      })
      conflictRef = recorded.ref
    }
  }

  return Response.json(
    { ...verdict, conflict: conflictRef, recordRatified: record.ratified },
    { headers: { "cache-control": "no-store" } },
  )
}
