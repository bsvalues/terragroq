import { getSession } from "@/lib/session"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { pool } from "@/lib/db"
import { assertAuthorityGranted, issueWorkContextReceipt, type WorkContextFacts } from "@/lib/governance/work-context-receipt"
import { authorityGrantFactsFromRow, grantCovers, type AuthorityGrantFacts } from "@/lib/governance/authority"
import { bindAuthoritySubject, workOrderRefsInScope } from "@/lib/governance/authority-subject"
import { resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
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

  // The claimed authority is checked against grant rows before a receipt is issued. Taking it as a
  // claim made it decoration: a lane could write its own authority level into its own premise.
  let grants: Array<AuthorityGrantFacts & { scope: string | null }> = []
  const bindings: Array<{ ref: string | null; basis: string; declaredSubject: string | null; provenance: readonly string[] }> = []
  const rejectedSubjects: string[] = []
  try {
    // BOTH namespaces are read, and neither is trusted on arrival. Reading only the acting identity's
    // namespace is what made the synthetic operator uncoverable; reading the owner's without binding
    // would hand every session the owner's authority. The rows are candidates; `bindAuthoritySubject`
    // decides which of them were issued for THIS session, and on what proof.
    const ownerUserId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
    const rows = await pool.query(
      `SELECT "id", "ref", "scope", "authorityLevel", "status", "expiresAt", "allowedActions", "blockedActions", "revokeReason", "userId", "grantedTo"
         FROM "authority_grant" WHERE "userId" = $1 OR "userId" = $2`,
      [session.user.id, ownerUserId ?? session.user.id],
    )

    // Ownership of every work order any candidate scope names. One read, then a pure decision -- the
    // binding rule stays testable without a database.
    const scopedRefs = [...new Set(rows.rows.flatMap((row) => workOrderRefsInScope(row.scope as string | null)))]
    const scopeWorkOrderOwners = new Map<string, string>()
    if (scopedRefs.length > 0) {
      const owners = await pool.query(
        `SELECT "ref", "userId" FROM "work_order" WHERE "ref" = ANY($1::text[])`,
        [scopedRefs],
      )
      for (const row of owners.rows) scopeWorkOrderOwners.set(String(row.ref), String(row.userId))
    }

    const bound = rows.rows.filter((row) => {
      const binding = bindAuthoritySubject({
        grant: {
          ref: (row.ref as string | null) ?? null,
          userId: (row.userId as string | null) ?? null,
          grantedTo: (row.grantedTo as string | null) ?? null,
          scope: (row.scope as string | null) ?? null,
        },
        actingUserId: session.user.id,
        ownerUserId,
        scopeWorkOrderOwners,
      })
      if (!binding.ok) {
        rejectedSubjects.push(`${row.ref ?? `#${row.id}`}: ${binding.failure}`)
        return false
      }
      bindings.push({
        ref: (row.ref as string | null) ?? null,
        basis: binding.basis,
        declaredSubject: binding.declaredSubject,
        provenance: binding.provenance,
      })
      return true
    })
    rows.rows = bound
    // The raw rows were previously handed to `grantCovers` as-is. Two things were wrong with that and
    // both widened authority: node-pg reads these UTC wall-clock timestamps as LOCAL time, so an
    // expired grant still covered west of UTC (`CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW`), and a `null` action
    // array threw inside the checker rather than reading as "not narrowed". `scope` is carried
    // alongside because `assertAuthorityGranted`, not `grantCovers`, is what checks it.
    grants = rows.rows.map((row) => ({
      ...authorityGrantFactsFromRow(row),
      scope: (row.scope as string | null) ?? null,
    }))
  } catch {
    // An unreadable grant registry is not permission. Refusing is the only safe reading.
    return Response.json(
      { ok: false, failure: "FAILED_AUTHORITY_NOT_GRANTED", detail: "the authority registry could not be read" },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

  const authority = assertAuthorityGranted(
    facts.authorityLevel,
    [facts.workOrderRef, facts.parentOutcome],
    grants,
    (grant, required) => grantCovers(grant as AuthorityGrantFacts, required as never),
  )
  if (!authority.ok) {
    return Response.json(
      {
        ok: false,
        failure: authority.failure,
        detail: authority.detail,
        // Which grants existed but were not issued to this session, and why. Without it, "no grant
        // covers you" reads identically whether none exists or one exists for somebody else -- the
        // ambiguity that made this defect take three sessions to name.
        unboundSubjects: rejectedSubjects,
        remedy: "An owner-recorded authority grant covering this work order or outcome must exist before a lane may mutate. Approval is not authority.",
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
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
    // The receipt stays attributed to the ACTING session -- a delegated grant does not turn an agent's
    // work into the owner's. `authorityBinding` records how coverage was established, so the audit
    // trail says "bound via WO-0027, which this session owns" rather than merely "allowed". Recorded
    // in metadata rather than in `facts` deliberately: `receiptToken` hashes an enumerated field set,
    // so provenance stays auditable without moving the token.
    metadata: { ...facts, missingDoctrine: live.missingDoctrine, authorityBinding: bindings },
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
