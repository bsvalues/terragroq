"use server"

import { db } from "@/lib/db"
import {
  authorityGrant,
  eventLog,
  governanceEvent,
  workOrder,
  type AuthorityGrant,
} from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { writeArtifact } from "@/lib/governance/artifacts"
import { hashRecord } from "@/lib/governance/hash"
import { isGrantActive, strongestActiveGrant } from "@/lib/governance/authority"
import { authorityRank } from "@/lib/goal/taxonomy"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { isProtectedV12AuthorityScope } from "@/lib/outcome-queue/v1-2-protected-authority"

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
  // Reuse one identical live grant while holding the shared allocation fence.
  reuseActiveScope?: boolean
}

function authorityGrantDraftFromRow(row: AuthorityGrant) {
  return {
    userId: row.userId,
    ref: row.ref!,
    workOrderId: row.workOrderId,
    grantedBy: row.grantedBy,
    grantedTo: row.grantedTo,
    authorityLevel: row.authorityLevel,
    scope: row.scope,
    allowedActions: row.allowedActions,
    blockedActions: row.blockedActions,
    reason: row.reason,
    status: "active" as const,
    expiresAt: row.expiresAt,
  }
}

// Create a durable authority grant. This is the ONLY way authority above A0 is
// conferred — approval alone never grants it. A2+ grants are also exported to
// the filesystem evidence ledger for Git-backed audit.
export async function createAuthorityGrantWithResult(
  input: CreateGrantInput,
): Promise<{ grant: AuthorityGrant; replayed: boolean }> {
  const userId = await getUserId()
  const expiresAt =
    input.expiresInHours && input.expiresInHours > 0
      ? new Date(Date.now() + input.expiresInHours * 3_600_000)
      : null
  const allowedActions = input.allowedActions ?? []
  const blockedActions = input.blockedActions ?? []
  const grantedTo = input.grantedTo ?? "operator"
  const scope = input.scope ?? null
  if (scope && isProtectedV12AuthorityScope(scope)) {
    throw new Error("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")
  }
  const workOrderId = input.workOrderId ?? null
  const created = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:authority-grant-allocation`}))`,
    )
    const ensureDbEvidence = async (
      row: AuthorityGrant,
      draft: ReturnType<typeof authorityGrantDraftFromRow>,
      contentHash: string,
    ) => {
      const afterHash = hashRecord({ ...draft, contentHash })
      const [governance] = await transaction
        .select({ id: governanceEvent.id })
        .from(governanceEvent)
        .where(and(
          eq(governanceEvent.userId, userId),
          eq(governanceEvent.eventType, "AUTHORITY_GRANTED"),
          eq(governanceEvent.entityType, "authority_grant"),
          eq(governanceEvent.entityId, String(row.id)),
          eq(governanceEvent.afterHash, afterHash),
        ))
        .limit(1)
      if (!governance) {
        await transaction.insert(governanceEvent).values({
          userId,
          eventType: "AUTHORITY_GRANTED",
          entityType: "authority_grant",
          entityId: String(row.id),
          actor: "operator",
          reason: draft.reason,
          afterHash,
          metadata: { authorityLevel: draft.authorityLevel, ref: draft.ref },
        })
      }
      const [register] = await transaction
        .select({ id: eventLog.id })
        .from(eventLog)
        .where(and(
          eq(eventLog.userId, userId),
          eq(eventLog.type, "authority.granted"),
          eq(eventLog.register, "authority"),
          eq(eventLog.refId, row.id),
        ))
        .limit(1)
      if (!register) {
        await transaction.insert(eventLog).values({
          userId,
          type: "authority.granted",
          summary: `${draft.ref}: granted ${draft.authorityLevel} to ${draft.grantedTo}${draft.workOrderId ? ` for WO #${draft.workOrderId}` : ""}`,
          register: "authority",
          refId: row.id,
        })
      }
    }
    if (input.reuseActiveScope) {
      const candidates = await transaction
        .select()
        .from(authorityGrant)
        .where(and(
          eq(authorityGrant.userId, userId),
          eq(authorityGrant.status, "active"),
          eq(authorityGrant.authorityLevel, input.authorityLevel),
          eq(authorityGrant.grantedTo, grantedTo),
          scope === null ? isNull(authorityGrant.scope) : eq(authorityGrant.scope, scope),
        ))
      const reusable = candidates.find((candidate) => (
        candidate.ref !== null
        && candidate.revokedAt === null
        && (candidate.expiresAt === null || candidate.expiresAt.getTime() > Date.now())
        && candidate.workOrderId === workOrderId
        && JSON.stringify(candidate.allowedActions) === JSON.stringify(allowedActions)
        && JSON.stringify(candidate.blockedActions) === JSON.stringify(blockedActions)
      ))
      if (reusable) {
        const draft = authorityGrantDraftFromRow(reusable)
        const contentHash = reusable.contentHash ?? hashRecord(draft)
        await ensureDbEvidence(reusable, draft, contentHash)
        return { row: reusable, draft, contentHash, replayed: true }
      }
    }

    const refs = await transaction
      .select({ ref: authorityGrant.ref })
      .from(authorityGrant)
      .where(eq(authorityGrant.userId, userId))
    const max = refs.reduce((current, candidate) => {
      const match = candidate.ref?.match(/^GRANT-(\d+)$/)
      return match ? Math.max(current, Number.parseInt(match[1], 10)) : current
    }, 0)
    const ref = `GRANT-${String(max + 1).padStart(4, "0")}`
    const draft = {
      userId,
      ref,
      workOrderId,
      grantedBy: userId,
      grantedTo,
      authorityLevel: input.authorityLevel,
      scope,
      allowedActions,
      blockedActions,
      reason: input.reason ?? null,
      status: "active" as const,
      expiresAt,
    }
    const contentHash = hashRecord(draft)
    const [row] = await transaction
      .insert(authorityGrant)
      .values({ ...draft, contentHash })
      .returning()

    if (workOrderId) {
      await transaction
        .update(workOrder)
        .set({ authorityGrantId: row.id, updatedAt: new Date() })
        .where(and(eq(workOrder.id, workOrderId), eq(workOrder.userId, userId)))
    }
    await ensureDbEvidence(row, draft, contentHash)
    return { row, draft, contentHash, replayed: false }
  })
  const { row, draft, contentHash } = created
  const ref = draft.ref

  // Tier-2/3 ledger for A2+ grants (durable, Git-committable evidence).
  if (authorityRank(draft.authorityLevel) >= authorityRank("A2_WRITE_OWN")) {
    await writeArtifact({
      id: ref,
      category: "authority",
      title: `Authority Grant ${ref} — ${draft.authorityLevel}`,
      sections: [
        { heading: "Granted to", body: draft.grantedTo },
        { heading: "Scope", body: draft.scope ?? "(unscoped)" },
        { heading: "Allowed actions", body: draft.allowedActions.join("\n") || "(none specified)" },
        { heading: "Blocked actions", body: draft.blockedActions.join("\n") || "(none specified)" },
        { heading: "Reason", body: draft.reason ?? "(none)" },
        { heading: "Expires", body: draft.expiresAt ? draft.expiresAt.toISOString() : "no expiry (review recommended)" },
      ],
      record: { ...draft, ref, contentHash },
    })
  }

  revalidatePath("/goal-console")
  revalidatePath("/work-orders")
  return { grant: row, replayed: created.replayed }
}

export async function createAuthorityGrant(input: CreateGrantInput): Promise<AuthorityGrant> {
  return (await createAuthorityGrantWithResult(input)).grant
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
  if (grant.scope && isProtectedV12AuthorityScope(grant.scope)) {
    throw new Error("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")
  }
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
