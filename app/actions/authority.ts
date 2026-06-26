"use server"

import { db } from "@/lib/db"
import { authorityGrant, workOrder, type AuthorityGrant } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { writeArtifact } from "@/lib/governance/artifacts"
import { hashRecord } from "@/lib/governance/hash"
import { nextRef } from "@/lib/governance/refs"
import { isGrantActive, strongestActiveGrant } from "@/lib/governance/authority"
import { authorityRank } from "@/lib/goal/taxonomy"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getAuthorityGrants(limit = 50): Promise<AuthorityGrant[]> {
  const userId = await getUserId()
  await expireStaleGrants(userId)
  return db
    .select()
    .from(authorityGrant)
    .where(eq(authorityGrant.userId, userId))
    .orderBy(desc(authorityGrant.createdAt))
    .limit(limit)
}

// Lazily flip any active-but-past-expiry grants to "expired" and log the event.
async function expireStaleGrants(userId: string): Promise<void> {
  const rows = await db
    .select()
    .from(authorityGrant)
    .where(and(eq(authorityGrant.userId, userId), eq(authorityGrant.status, "active")))
  const now = Date.now()
  for (const g of rows) {
    if (g.expiresAt && g.expiresAt.getTime() <= now) {
      await db
        .update(authorityGrant)
        .set({ status: "expired" })
        .where(eq(authorityGrant.id, g.id))
      await appendGovernanceEvent({
        userId,
        eventType: "AUTHORITY_EXPIRED",
        entityType: "authority_grant",
        entityId: g.id,
        reason: "Grant passed its expiry time",
        before: { status: "active" },
        after: { status: "expired" },
      })
    }
  }
}

// Resolve the strongest active grant covering a work order (used by the loop
// engine). Returns null when none is live.
export async function getActiveGrantForWorkOrder(woId: number): Promise<AuthorityGrant | null> {
  const userId = await getUserId()
  await expireStaleGrants(userId)
  const rows = await db
    .select()
    .from(authorityGrant)
    .where(and(eq(authorityGrant.userId, userId), eq(authorityGrant.workOrderId, woId)))
  return strongestActiveGrant(rows)
}

/* ------------------------------------------------------------------ */
/* Writes                                                            */
/* ------------------------------------------------------------------ */

export interface CreateGrantInput {
  workOrderId?: number
  grantedTo?: string // operator | codex | claude | ...
  authorityLevel: string // A0..A9
  scope?: string
  allowedActions?: string[]
  blockedActions?: string[]
  reason?: string
  // Hours until expiry. Omit for a non-expiring grant (discouraged for A5+).
  expiresInHours?: number
}

// Create a durable authority grant. This is the ONLY way authority above A0 is
// conferred — approval alone never grants it. A2+ grants are also exported to
// the filesystem evidence ledger for Git-backed audit.
export async function createAuthorityGrant(input: CreateGrantInput): Promise<AuthorityGrant> {
  const userId = await getUserId()
  const ref = await nextRef(authorityGrant as never, "GRANT", userId)
  const expiresAt =
    input.expiresInHours && input.expiresInHours > 0
      ? new Date(Date.now() + input.expiresInHours * 3_600_000)
      : null

  const draft = {
    userId,
    ref,
    workOrderId: input.workOrderId ?? null,
    grantedBy: userId,
    grantedTo: input.grantedTo ?? "operator",
    authorityLevel: input.authorityLevel,
    scope: input.scope ?? null,
    allowedActions: input.allowedActions ?? [],
    blockedActions: input.blockedActions ?? [],
    reason: input.reason ?? null,
    status: "active" as const,
    expiresAt,
  }
  const contentHash = hashRecord(draft)

  const [row] = await db
    .insert(authorityGrant)
    .values({ ...draft, contentHash })
    .returning()

  // Link the grant back to the work order so the UI can surface its source.
  if (input.workOrderId) {
    await db
      .update(workOrder)
      .set({ authorityGrantId: row.id, updatedAt: new Date() })
      .where(and(eq(workOrder.id, input.workOrderId), eq(workOrder.userId, userId)))
  }

  await appendGovernanceEvent({
    userId,
    eventType: "AUTHORITY_GRANTED",
    entityType: "authority_grant",
    entityId: row.id,
    reason: input.reason,
    after: { ...draft, contentHash },
    metadata: { authorityLevel: input.authorityLevel, ref },
  })
  await logEvent({
    userId,
    type: "authority.granted",
    summary: `${ref}: granted ${input.authorityLevel} to ${draft.grantedTo}${input.workOrderId ? ` for WO #${input.workOrderId}` : ""}`,
    register: "authority",
    refId: row.id,
  })

  // Tier-2/3 ledger for A2+ grants (durable, Git-committable evidence).
  if (authorityRank(input.authorityLevel) >= authorityRank("A2_WRITE_OWN")) {
    await writeArtifact({
      id: ref,
      category: "authority",
      title: `Authority Grant ${ref} — ${input.authorityLevel}`,
      sections: [
        { heading: "Granted to", body: draft.grantedTo },
        { heading: "Scope", body: draft.scope ?? "(unscoped)" },
        { heading: "Allowed actions", body: draft.allowedActions.join("\n") || "(none specified)" },
        { heading: "Blocked actions", body: draft.blockedActions.join("\n") || "(none specified)" },
        { heading: "Reason", body: draft.reason ?? "(none)" },
        { heading: "Expires", body: expiresAt ? expiresAt.toISOString() : "no expiry (review recommended)" },
      ],
      record: { ...draft, ref, contentHash },
    })
  }

  revalidatePath("/goal-console")
  revalidatePath("/work-orders")
  return row
}

// Revoke a grant immediately. Any loop relying on it is blocked from the next
// evaluation onward.
export async function revokeAuthorityGrant(id: number, reason: string): Promise<void> {
  const userId = await getUserId()
  const [grant] = await db
    .select()
    .from(authorityGrant)
    .where(and(eq(authorityGrant.id, id), eq(authorityGrant.userId, userId)))
    .limit(1)
  if (!grant) throw new Error("Authority grant not found")
  const active = isGrantActive(grant)
  if (!active.ok) throw new Error(`Cannot revoke: ${active.reason}`)

  await db
    .update(authorityGrant)
    .set({ status: "revoked", revokedAt: new Date(), revokedBy: userId, revokeReason: reason })
    .where(and(eq(authorityGrant.id, id), eq(authorityGrant.userId, userId)))

  await appendGovernanceEvent({
    userId,
    eventType: "AUTHORITY_REVOKED",
    entityType: "authority_grant",
    entityId: id,
    reason,
    before: { status: grant.status },
    after: { status: "revoked", revokeReason: reason },
  })
  await logEvent({
    userId,
    type: "authority.revoked",
    summary: `${grant.ref ?? `#${id}`}: REVOKED — ${reason}`,
    register: "authority",
    refId: id,
  })
  revalidatePath("/goal-console")
  revalidatePath("/work-orders")
}
