import { and, eq } from "drizzle-orm"

import { createWorkOrder, transitionWorkOrder } from "@/app/actions/work-orders"
import { db } from "@/lib/db"
import { workOrder } from "@/lib/db/schema"
import { getSession, getUserId } from "@/lib/session"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { WORKROOM_ALLOWED_FILES, WORKROOM_FORBIDDEN_FILES } from "@/lib/governance/workroom-file-scope"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Authorize the workroom lane, and nothing else.
 *
 * Binding the work-context receipt to a real grant left the workroom read-only, correctly: no grant
 * covered it. In this system a grant is minted by AUTHORIZING a work order, which happens through
 * server actions behind the operator UI, so there was no path to it outside a browser session.
 *
 * The shortcut -- inserting an authority_grant row -- would skip the content hash, the
 * AUTHORITY_GRANTED event, the register entry, and the committable artifact the real path emits. A
 * grant existing without its evidence is precisely the quiet exception this gate exists to prevent,
 * so this calls the real actions and lets them do the recording.
 *
 * The envelope is FIXED IN CODE and nothing is read from the request. This route cannot mint a
 * different authority level, a wider scope, or another file reservation; it can only ever produce the
 * one grant the workroom needs. A request body would have made this a general self-authorization
 * hole instead of a narrow authorization path.
 */

const WORKROOM_TITLE = "Workroom lane: files, structured edits, and bounded cockpit operations"

const WORKROOM_ENVELOPE = {
  title: WORKROOM_TITLE,
  description: "Standing envelope for mutations made through the loom workroom under a proven work context.",
  goal: "OUTCOME-762",
  // The receipt scope-matches on the work order ref or the parent outcome; this is the outcome.
  scope: "OUTCOME-762",
  lane: "ui",
  agent: "claude",
  authorityLevel: "A2_WRITE_OWN",
  allowedFiles: WORKROOM_ALLOWED_FILES.join("\n"),
  // Approval readiness requires these to be non-empty, and they are the real boundary: the workroom
  // must never reach TLS material or environment secrets.
  forbiddenFiles: WORKROOM_FORBIDDEN_FILES.join("\n"),
  validators: ["pnpm exec vitest run", "pnpm exec next build"].join("\n"),
  acceptanceCriteria: [
    "Every mutation carries a valid work-context receipt",
    "Reads remain ungated",
    "No write escapes the declared file reservation",
  ].join("\n"),
}

export async function POST() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  const userId = await getUserId()

  // Only the owner may record authority. Without this the whole model is circular: any account could
  // mint itself this grant and then satisfy the work-context gate with the grant it had just issued.
  // Being signed in is not being the owner, and approval is not authority.
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(userId, ownerId)
  if (!owner.ok) {
    return Response.json({ error: owner.failure, detail: owner.detail }, { status: owner.failure === "NOT_OWNER" ? 403 : 409, headers: { "cache-control": "no-store" } })
  }

  const existing = await db
    .select()
    .from(workOrder)
    .where(and(eq(workOrder.userId, userId), eq(workOrder.title, WORKROOM_TITLE)))
    .limit(1)

  let id: number
  let ref: string | null
  if (existing.length > 0) {
    id = existing[0].id
    ref = existing[0].ref
    if (existing[0].status === "approved" || existing[0].status === "active") {
      // Already authorized. Say so rather than minting a second grant for one envelope.
      return Response.json(
        { ok: true, workOrder: ref, status: `already-${existing[0].status}`, scope: WORKROOM_ENVELOPE.scope },
        { headers: { "cache-control": "no-store" } },
      )
    }
  } else {
    const created = await createWorkOrder(WORKROOM_ENVELOPE)
    id = created.id
    ref = created.ref
  }

  // draft -> proposed -> approved. Approval is the step that mints the durable grant, and
  // grantAuthority is required explicitly because A2 is above the level that may be granted
  // implicitly -- the lifecycle refuses to infer it, which is the behaviour worth keeping.
  const proposed = await transitionWorkOrder(id, "proposed")
  if (!proposed.ok) {
    return Response.json({ ok: false, stage: "proposed", reason: proposed.reason, missing: proposed.missing }, { status: 409 })
  }
  const approved = await transitionWorkOrder(id, "approved", { grantAuthority: true, approveDoctrine: true })
  if (!approved.ok) {
    return Response.json({ ok: false, stage: "approved", reason: approved.reason, missing: approved.missing }, { status: 409 })
  }

  return Response.json(
    { ok: true, workOrder: ref, status: "authorized", scope: WORKROOM_ENVELOPE.scope, authorityLevel: WORKROOM_ENVELOPE.authorityLevel },
    { headers: { "cache-control": "no-store" } },
  )
}
