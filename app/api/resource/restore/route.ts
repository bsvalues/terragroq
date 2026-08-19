import fs from "node:fs/promises"
import path from "node:path"

import { brokeredExec } from "@/lib/fabric/broker.mjs"
import { pool } from "@/lib/db"
import { getSession } from "@/lib/session"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { planRestore } from "@/lib/resource/mutation"
import { shapeResourceRecord, type ResourceRow } from "@/lib/resource/resolve"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Restore the database onto the node that owns the workload (#887, GRANT-0011).
 *
 * The second governed mutating operation, under the same discipline as the first. The request carries
 * an identity; the backup, the node and the database all come from the ratified record. The work itself
 * is a script in version control -- a catalogue entry, not text an agent composed -- shipped to the node
 * and run there.
 *
 * It refuses to overwrite an existing database, and it does not report completion. Several hundred
 * gigabytes take hours; the route returns 202 and the outcome is observed afterwards, like every other
 * claim in this system.
 */
const RESTORE_WORK_ORDER = "#887"
const DATABASE = "pacs_oltp"

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

  let grantRef: string | null = null
  try {
    const grants = await pool.query(
      `SELECT "ref" FROM authority_grant
        WHERE "status" = 'active' AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > timezone('UTC', now()))
          AND "scope" = $1 AND $2 = ANY("allowedActions")
        ORDER BY "id" DESC LIMIT 1`,
      [RESTORE_WORK_ORDER, "restore-database"],
    )
    grantRef = grants.rows[0]?.ref ?? null
  } catch {
    return Response.json({ error: "AUTHORITY_UNREADABLE" }, { status: 503 })
  }
  if (!grantRef) {
    return Response.json(
      {
        error: "AUTHORITY_NOT_GRANTED",
        detail: `no active grant scoped to ${RESTORE_WORK_ORDER} permits restore-database`,
        remedy: "A grant permitting relocate-source does not permit a restore. Record one for this operation.",
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
         FROM project_resource r JOIN project p ON p.id = r."projectId"
        WHERE lower(r."resourceKey") = lower($1) OR lower(r."canonicalIdentity") = lower($1)`,
      [identity],
    )
    rows = result.rows as ResourceRow[]
  } catch {
    return Response.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503 })
  }

  const record = shapeResourceRecord(identity, rows)
  if (!record) return Response.json({ error: "RESOURCE_UNKNOWN", identity }, { status: 404 })

  const planned = planRestore(record, DATABASE)
  if (!planned.ok || !planned.plan) {
    return Response.json({ error: planned.refusal, detail: planned.detail }, { status: 409, headers: { "cache-control": "no-store" } })
  }

  // The script is a catalogue entry from version control, not composed text. It is shipped as-is and
  // invoked with two record-derived arguments.
  const script = await fs.readFile(
    path.join(process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd(), "scripts", "restore-sqlserver-database.sh"),
    "utf8",
  )
  const encoded = Buffer.from(script, "utf8").toString("base64")
  const remote = "/tmp/restore-sqlserver-database.sh"
  const log = `/tmp/restore-${planned.plan.database}.log`

  await brokeredExec(
    planned.plan.node,
    `echo ${encoded} | base64 -d > ${remote} && chmod +x ${remote} && ` +
      `nohup ${remote} '${planned.plan.backupPath}' '${planned.plan.database}' > ${log} 2>&1 & echo started`,
    { action: "resource-restore", timeout: 60_000 },
  )

  await appendGovernanceEvent({
    userId: session.user.id,
    eventType: "EVIDENCE_RECORDED",
    entityType: "resource_restore",
    entityId: record.identity,
    actor: "williamos",
    reason: `restore of ${planned.plan.database} on ${planned.plan.node} under ${grantRef}`,
    after: { ...planned.plan, grant: grantRef, log },
    metadata: { ...planned.plan, grant: grantRef, log, overwrites: false },
  })

  return Response.json(
    {
      accepted: true,
      grant: grantRef,
      node: planned.plan.node,
      database: planned.plan.database,
      from: planned.plan.backupPath,
      log,
      note: "hours of work; it refuses to overwrite an existing database and does not report its own completion",
    },
    { status: 202, headers: { "cache-control": "no-store" } },
  )
}
