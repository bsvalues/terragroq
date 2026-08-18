import { brokeredExec } from "@/lib/fabric/broker.mjs"
import { pool } from "@/lib/db"
import { getSession } from "@/lib/session"
import { assertOperationAllowed, type OpenConflict } from "@/lib/resource/completion"
import { probeCommand, probeSkips, probeTargetsFor, readObservation } from "@/lib/resource/probe"
import { shapeResourceRecord, type ResourceRow } from "@/lib/resource/resolve"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PROBE_TIMEOUT_MS = 30_000

/**
 * Check whether a resource record still holds, by looking (#882, #871 boundary 5).
 *
 * Everything before this answered from what was written down. This is the first step that goes and
 * looks -- and it is deliberately the narrowest possible version of that: a fixed catalogue of
 * read-only probes, chosen by KIND, targeted by paths the resource record declares, dispatched to the
 * node the record names, through the broker that already audits every action.
 *
 * The request carries an identity and nothing else. No caller text reaches a command line, because
 * there is no parameter that could. A dispatch surface that accepted a command would be the shell the
 * agent was told not to use, relocated inside the product.
 *
 * Verification is permitted while a conflict is open. That is the corrected rule from #881: refusing to
 * look at the thing a contradiction is about makes the contradiction permanent.
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
    return Response.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } })
  }

  const record = shapeResourceRecord(identity, rows)
  if (!record) {
    return Response.json({ error: "RESOURCE_UNKNOWN", identity }, { status: 404, headers: { "cache-control": "no-store" } })
  }

  const permitted = assertOperationAllowed({ record, operation: "verify", openConflicts })
  if (!permitted.allowed) {
    return Response.json({ ...permitted, identity, operation: "verify" }, { status: 409, headers: { "cache-control": "no-store" } })
  }

  const targets = probeTargetsFor(record)
  const skipped = probeSkips(record)
  const observations = []
  for (const target of targets) {
    try {
      // `action` is what the fabric ledger records, so a verification probe reads differently from a
      // mutation when someone audits the trail later.
      const result = await brokeredExec(target.node, probeCommand(target), {
        action: "resource-verify",
        timeout: PROBE_TIMEOUT_MS,
      })
      observations.push(readObservation(target, String(result.stdout ?? "")))
    } catch (error) {
      // A node that cannot be reached is not an absent artefact. Reporting it as missing would
      // manufacture a contradiction out of a network problem.
      observations.push({
        identity: target.identity,
        node: target.node,
        path: target.path,
        exists: null,
        observedBytes: null,
        recordedBytes: target.recordedBytes,
        agrees: null,
        detail: `${target.node} could not be reached: ${(error as Error)?.message ?? "unknown error"}`,
      })
    }
  }

  const contradicted = observations.filter((observation) => observation.agrees === false)
  const confirmed = observations.filter((observation) => observation.agrees === true)
  const unreachable = observations.filter((observation) => observation.exists === null)

  return Response.json(
    {
      identity: record.identity,
      probed: observations.length,
      skipped,
      confirmed: confirmed.length,
      contradicted: contradicted.length,
      unreachable: unreachable.length,
      observations,
      recordRatified: record.ratified,
      summary:
        contradicted.length > 0
          ? `${contradicted.length} recorded artefact(s) do not match what is on the node`
          : unreachable.length > 0
            ? `${confirmed.length} confirmed; ${unreachable.length} could not be checked`
            : `all ${confirmed.length} checked artefact(s) match the record`,
    },
    { headers: { "cache-control": "no-store" } },
  )
}
