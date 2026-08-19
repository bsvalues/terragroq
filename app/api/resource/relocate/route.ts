import { brokeredExec } from "@/lib/fabric/broker.mjs"
import { pool } from "@/lib/db"
import { getSession } from "@/lib/session"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { planRelocation, relocationCommand } from "@/lib/resource/mutation"
import { shapeResourceRecord, type ResourceRow } from "@/lib/resource/resolve"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Perform the one governed mutating operation (#887).
 *
 * `lib/governance/execute-guard.ts` locked the execute loop to a non-mutating surface, and said a
 * future expansion must be deliberate rather than a developer quietly wiring it to a shell. This is
 * that expansion: one named operation, planned entirely from the resource record, requiring a recorded
 * authority grant that names this work order.
 *
 * The request carries an identity. It cannot carry a command, a path, or a node, because none of those
 * are parameters. What moves and where it goes is whatever the ratified record says, and nothing else.
 *
 * The transfer runs detached: 100 GB does not fit in a request, and holding one open would turn a
 * network hiccup into a lost operation. Completion is not reported by this route -- it is observed
 * later by /api/resource/verify, which is the same evidence any other claim would need.
 */
const RELOCATION_WORK_ORDER = "#887"

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

  // A recorded grant, naming this work order, that permits mutation. Approval is not authority, and an
  // instruction in a conversation is not a grant.
  let grantRef: string | null = null
  try {
    const grants = await pool.query(
      `SELECT "ref" FROM authority_grant
        WHERE "status" = 'active'
          AND ("expiresAt" IS NULL OR "expiresAt" > timezone('UTC', now()))
          AND "revokedAt" IS NULL
          AND "scope" = $1
          AND $2 = ANY("allowedActions")
        ORDER BY "id" DESC LIMIT 1`,
      [RELOCATION_WORK_ORDER, "relocate-source"],
    )
    grantRef = grants.rows[0]?.ref ?? null
  } catch {
    // An unreadable grant registry is not permission.
    return Response.json({ error: "AUTHORITY_UNREADABLE" }, { status: 503, headers: { "cache-control": "no-store" } })
  }
  if (!grantRef) {
    return Response.json(
      {
        error: "AUTHORITY_NOT_GRANTED",
        detail: `no active authority grant scoped to ${RELOCATION_WORK_ORDER} permits relocate-source`,
        remedy: "Record an owner authority grant for this work order before retrying. Admission is not authorisation.",
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

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
  if (!record) return Response.json({ error: "RESOURCE_UNKNOWN", identity }, { status: 404 })

  // An unratified record must not drive a mutation. Moving 100 GB on the strength of an agent's draft
  // is exactly the confident wrong action this whole outcome exists to prevent.
  if (!record.ratified) {
    return Response.json(
      { error: "RECORD_NOT_RATIFIED", detail: "the record is a draft; a mutation may not be planned from one" },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

  const plan = planRelocation(record)
  if (!plan.ok) {
    return Response.json({ error: plan.refusal, detail: plan.detail }, { status: 409, headers: { "cache-control": "no-store" } })
  }

  const started: Array<{ identity: string; from: string; to: string; log: string }> = []
  for (const item of plan.plans) {
    const command = relocationCommand(item)
    const log = `/tmp/relocate-${item.destinationPath.split("/").pop()}.log`
    // Detached, so the transfer outlives this request. Progress is not reported here; it is observed.
    await brokeredExec(item.destinationNode, `nohup sh -c ${JSON.stringify(command)} > ${log} 2>&1 & echo started`, {
      action: "resource-relocate",
      timeout: 30_000,
    })
    started.push({ identity: item.identity, from: item.sourceNode, to: `${item.destinationNode}:${item.destinationPath}`, log })
  }

  await appendGovernanceEvent({
    userId: session.user.id,
    eventType: "EVIDENCE_RECORDED",
    entityType: "resource_relocation",
    entityId: record.identity,
    actor: "williamos",
    reason: `relocation of ${record.identity} sources to ${record.workloadOwner?.identity} under ${grantRef}`,
    after: { started, grant: grantRef, workOrder: RELOCATION_WORK_ORDER },
    metadata: { started, grant: grantRef, workOrder: RELOCATION_WORK_ORDER, deletesNothing: true },
  })

  return Response.json(
    {
      accepted: true,
      identity: record.identity,
      grant: grantRef,
      started,
      note: "copies only; nothing is deleted at the origin. Completion is observed via /api/resource/verify, not claimed here.",
    },
    { status: 202, headers: { "cache-control": "no-store" } },
  )
}
