import { pool } from "@/lib/db"
import { getSession } from "@/lib/session"
import { shapeResourceRecord, type ResourceRow } from "@/lib/resource/resolve"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Resolve a named resource to its governed record (#876, #871 boundary 2).
 *
 * A read, and only a read. It answers what is declared about a resource -- who owns the workload, where
 * its sources and runtime are, what derives from it, what proves the last completed work, and what may
 * be done to it. It does not observe anything, does not contact a node, and grants nothing.
 *
 * An unknown resource answers 404 rather than an empty record, because "nothing is declared" and "I have
 * no idea" lead to opposite next actions, and conflating them is how an agent talks itself into
 * deciding an architecture from a directory listing.
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session?.user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  const identity = new URL(request.url).searchParams.get("identity")?.trim()
  if (!identity) return Response.json({ error: "IDENTITY_REQUIRED" }, { status: 400 })

  let rows: ResourceRow[]
  try {
    const result = await pool.query(
      `SELECT r."type", r."canonicalIdentity", r."label", r."relationship",
              r."allowedOperations", r."ratifiedAt", r."ratifiedBy",
              p."key" AS "projectKey", p."name" AS "projectName"
         FROM project_resource r
         JOIN project p ON p.id = r."projectId"
        WHERE lower(r."resourceKey") = lower($1)
           OR lower(r."canonicalIdentity") = lower($1)
        ORDER BY r."relationship", r."canonicalIdentity"`,
      [identity],
    )
    rows = result.rows as ResourceRow[]
  } catch {
    // An unreadable registry is not an absent resource. Saying "unknown" here would be a lie that the
    // caller acts on.
    return Response.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } })
  }

  const record = shapeResourceRecord(identity, rows)
  if (!record) {
    return Response.json(
      {
        error: "RESOURCE_UNKNOWN",
        identity,
        detail: "no governed record exists for that resource; it has not been declared, which is not the same as it not existing",
      },
      { status: 404, headers: { "cache-control": "no-store" } },
    )
  }

  return Response.json(record, { headers: { "cache-control": "no-store" } })
}
