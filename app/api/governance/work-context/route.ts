import { pool } from "@/lib/db"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { resolveOwnerUserId } from "@/lib/governance/owner"
import { deriveWorkContextAuthority, validateWorkContextRequest, type WorkContextAuthorityGrantRow, type WorkContextWorkOrderRow } from "@/lib/governance/work-context-authority"
import { measureLiveWorkContext } from "@/lib/governance/work-context-live"
import { issueWorkContextReceipt, type WorkContextFacts } from "@/lib/governance/work-context-receipt"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Issue a v2 receipt from authority already recorded on the exact owner-owned Work Order. */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: "BAD_REQUEST" }, { status: 400 }) }
  const parsed = validateWorkContextRequest(body)
  if (!parsed.ok) return Response.json({ error: "BAD_REQUEST", detail: parsed.detail }, { status: 400 })

  const live = await measureLiveWorkContext()
  if (!live) return Response.json({ ok: false, failure: "FAILED_STALE_MAIN", detail: "current origin/main could not be measured" }, { status: 409, headers: { "cache-control": "no-store" } })

  try {
    const ownerUserId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
    if (!ownerUserId) throw new Error("owner identity unavailable")
    const workResult = await pool.query(
      `SELECT "id", "userId", "ref", "status", "goal", "authorityLevel", "authorityGrantId", "agent", "allowedFiles", "forbiddenFiles", "updatedAt"
         FROM "work_order" WHERE "userId" = $1 AND "ref" = $2`,
      [ownerUserId, parsed.request.workOrderRef.trim()],
    )
    const workOrder = workResult.rowCount === 1 ? workResult.rows[0] as WorkContextWorkOrderRow : undefined
    if (!workOrder?.authorityGrantId) throw new Error("one exact owner-owned active work order and its grant are required")
    const grantResult = await pool.query(
      `SELECT "id", "userId", "ref", "workOrderId", "grantedBy", "grantedTo", "authorityLevel", "scope", "allowedActions", "blockedActions", "reason", "status", "expiresAt", "revokedAt", "revokedBy", "revokeReason", "contentHash", "createdAt"
         FROM "authority_grant" WHERE "id" = $1 LIMIT 1`,
      [workOrder.authorityGrantId],
    )
    const grant = grantResult.rows[0] as WorkContextAuthorityGrantRow | undefined
    if (!grant) throw new Error("the work order's exact bound authority grant is missing")
    const binding = deriveWorkContextAuthority({ ownerUserId, workOrder, grant })
    if (!binding.ok || !binding.authority) throw new Error(binding.detail ?? "authority could not be derived")

    const facts: WorkContextFacts = {
      ...parsed.request,
      parentOutcome: binding.authority.parentOutcome,
      authorityLevel: binding.authority.authorityLevel,
      reservedPaths: binding.authority.reservedPaths,
      workOrderVersion: binding.authority.workOrderVersion,
      grantVersion: binding.authority.grantVersion,
      reservationVersion: binding.authority.reservationVersion,
      mainSha: live.mainSha,
      doctrineDigest: live.doctrineDigest,
    }
    const verdict = issueWorkContextReceipt(facts)
    if (!verdict.ok || !verdict.receipt) return Response.json({ ok: false, failure: verdict.failure, detail: verdict.detail }, { status: 409, headers: { "cache-control": "no-store" } })

    await appendGovernanceEvent({
      userId: session.user.id,
      eventType: "EVIDENCE_RECORDED",
      entityType: "work_context_receipt",
      entityId: verdict.receipt,
      actor: "lane",
      reason: `server-derived work context proven for ${facts.workOrderRef}`,
      after: facts,
      metadata: {
        ...facts,
        missingDoctrine: live.missingDoctrine,
        authorityBinding: {
          ownerUserId,
          workOrderId: workOrder.id,
          authorityGrantId: grant.id,
          grantRef: grant.ref,
          forbiddenPaths: binding.authority.forbiddenPaths,
          workOrderVersion: binding.authority.workOrderVersion,
          grantVersion: binding.authority.grantVersion,
          reservationVersion: binding.authority.reservationVersion,
        },
      },
    })
    return Response.json({ ok: true, receipt: verdict.receipt, facts, missingDoctrine: live.missingDoctrine }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return Response.json({ ok: false, failure: "FAILED_AUTHORITY_NOT_GRANTED", detail: error instanceof Error ? error.message : "server-derived authority could not be read" }, { status: 409, headers: { "cache-control": "no-store" } })
  }
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  const token = new URL(request.url).searchParams.get("receipt")?.trim()
  if (!token) return Response.json({ error: "RECEIPT_REQUIRED" }, { status: 400 })
  const result = await pool.query(`SELECT "metadata" FROM "governance_event" WHERE "entityType" = 'work_context_receipt' AND "entityId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [token])
  if (result.rowCount === 0) return Response.json({ ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN" }, { status: 404 })
  return Response.json({ ok: true, facts: result.rows[0].metadata }, { headers: { "cache-control": "no-store" } })
}
