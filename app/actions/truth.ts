"use server"

import { db } from "@/lib/db"
import { truthClaim, type TruthClaim } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { nextRef } from "@/lib/governance/refs"
import {
  computeFreshness,
  defaultVerificationGates,
  requiresRecheck,
  type MutationGate,
} from "@/lib/governance/truth"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export interface TruthClaimView extends TruthClaim {
  computedFreshness: "fresh" | "aging" | "stale"
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getTruthClaims(limit = 50): Promise<TruthClaimView[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(truthClaim)
    .where(and(eq(truthClaim.userId, userId), eq(truthClaim.status, "active")))
    .orderBy(desc(truthClaim.capturedAt))
    .limit(limit)
  const now = new Date()
  return rows.map((r) => ({ ...r, computedFreshness: computeFreshness(r.truthType, r.capturedAt, now) }))
}

// Pre-flight: which active claims must be rechecked before a mutating gate?
export async function getRecheckBlockers(gate: MutationGate): Promise<TruthClaimView[]> {
  const claims = await getTruthClaims(200)
  return claims.filter(
    (c) => requiresRecheck({ truthType: c.truthType, capturedAt: c.capturedAt, verificationRequiredBefore: c.verificationRequiredBefore }, gate).required,
  )
}

/* ------------------------------------------------------------------ */
/* Writes                                                            */
/* ------------------------------------------------------------------ */

export interface RecordTruthInput {
  claim: string
  truthType: string
  system?: string
  source?: string
  confidence?: string
  evidenceId?: number
  verificationRequiredBefore?: string[]
}

export async function recordTruthClaim(input: RecordTruthInput): Promise<TruthClaim> {
  const userId = await getUserId()
  const ref = await nextRef(truthClaim as never, "TRUTH", userId)
  const gates =
    input.verificationRequiredBefore && input.verificationRequiredBefore.length > 0
      ? input.verificationRequiredBefore
      : defaultVerificationGates(input.truthType)

  const [row] = await db
    .insert(truthClaim)
    .values({
      userId,
      ref,
      claim: input.claim,
      truthType: input.truthType,
      system: input.system ?? null,
      source: input.source ?? null,
      confidence: input.confidence ?? "medium",
      freshness: "fresh",
      evidenceId: input.evidenceId ?? null,
      verificationRequiredBefore: gates,
      capturedAt: new Date(),
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: "TRUTH_RECORDED",
    entityType: "truth_claim",
    entityId: row.id,
    reason: input.claim,
    after: { truthType: input.truthType, gates },
  })
  await logEvent({
    userId,
    type: "truth.recorded",
    summary: `${ref} [${input.truthType}]: ${input.claim}`,
    register: "truth",
    refId: row.id,
  })
  revalidatePath("/goal-console")
  return row
}

// Mark a claim explicitly stale (e.g. after a known change). It can no longer
// support mutating gates until re-recorded.
export async function markTruthStale(id: number, reason: string): Promise<void> {
  const userId = await getUserId()
  const [claim] = await db
    .select()
    .from(truthClaim)
    .where(and(eq(truthClaim.id, id), eq(truthClaim.userId, userId)))
    .limit(1)
  if (!claim) throw new Error("Truth claim not found")
  await db
    .update(truthClaim)
    .set({ truthType: "STALE", freshness: "stale" })
    .where(and(eq(truthClaim.id, id), eq(truthClaim.userId, userId)))
  await appendGovernanceEvent({
    userId,
    eventType: "TRUTH_STALE",
    entityType: "truth_claim",
    entityId: id,
    reason,
    before: { truthType: claim.truthType },
    after: { truthType: "STALE" },
  })
  revalidatePath("/goal-console")
}
