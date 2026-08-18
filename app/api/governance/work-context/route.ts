import { getSession } from "@/lib/session"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { pool } from "@/lib/db"
import { issueWorkContextReceipt, type WorkContextFacts } from "@/lib/governance/work-context-receipt"
import { measureLiveWorkContext } from "@/lib/governance/work-context-live"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Issue a work-context receipt, or refuse and say which premise is missing.
 *
 * A lane calls this before its first mutation. It supplies what only it knows -- the Work Order it is
 * executing, the paths it reserved, what its subsystem search found, what the parent still needs --
 * and the server measures what the lane must not be trusted to assert: current origin/main and the
 * content of the controlling instruction chain.
 *
 * The receipt is recorded as a governance event, so the claims are attributable. That matters more
 * than it sounds: the machine cannot check "I searched for an existing subsystem", but it can make
 * the claim permanent, hashed, and attached to the mutations that followed it.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let claims: Partial<WorkContextFacts>
  try {
    claims = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }

  const live = await measureLiveWorkContext()
  if (!live) {
    // Cannot prove current main -> cannot issue. Refusing is correct: the alternative is a receipt
    // that certifies a premise nobody established.
    return Response.json(
      { ok: false, failure: "FAILED_STALE_MAIN", detail: "current origin/main could not be measured" },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

  const facts: WorkContextFacts = {
    ...(claims as WorkContextFacts),
    // Measured values overwrite claimed ones rather than merging under them.
    mainSha: live.mainSha,
    doctrineDigest: live.doctrineDigest,
  }

  const verdict = issueWorkContextReceipt(facts)
  if (!verdict.ok || !verdict.receipt) {
    return Response.json(
      { ok: false, failure: verdict.failure, detail: verdict.detail },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

  await appendGovernanceEvent({
    userId: session.user.id,
    eventType: "EVIDENCE_RECORDED",
    entityType: "work_context_receipt",
    entityId: verdict.receipt,
    actor: "lane",
    reason: `work context proven for ${facts.workOrderRef}`,
    after: facts,
    metadata: { ...facts, missingDoctrine: live.missingDoctrine },
  })

  return Response.json(
    { ok: true, receipt: verdict.receipt, mainSha: live.mainSha, missingDoctrine: live.missingDoctrine },
    { headers: { "cache-control": "no-store" } },
  )
}

/** Look up a previously issued receipt, used by the mutation gate. */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  const token = new URL(request.url).searchParams.get("receipt")?.trim()
  if (!token) return Response.json({ error: "RECEIPT_REQUIRED" }, { status: 400 })

  const result = await pool.query(
    `SELECT "metadata" FROM "governance_event"
      WHERE "entityType" = 'work_context_receipt' AND "entityId" = $1
      ORDER BY "createdAt" DESC LIMIT 1`,
    [token],
  )
  if (result.rowCount === 0) {
    return Response.json({ ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN" }, { status: 404 })
  }
  return Response.json({ ok: true, facts: result.rows[0].metadata }, { headers: { "cache-control": "no-store" } })
}
