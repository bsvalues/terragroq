"use server"

import { db } from "@/lib/db"
import { conflictRecord, type ConflictRecord } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { writeArtifact } from "@/lib/governance/artifacts"
import { nextRef } from "@/lib/governance/refs"
import { isBlockingSeverity, type ConflictSeverity } from "@/lib/governance/conflicts"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getConflicts(limit = 50): Promise<ConflictRecord[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(conflictRecord)
    .where(eq(conflictRecord.userId, userId))
    .orderBy(desc(conflictRecord.createdAt))
    .limit(limit)
}

// The first open, high-risk conflict touching a work order (used by the loop
// engine to block execution). Returns null when none blocks.
export async function getBlockingConflictForWorkOrder(woId: number): Promise<ConflictRecord | null> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(conflictRecord)
    .where(
      and(
        eq(conflictRecord.userId, userId),
        eq(conflictRecord.workOrderId, woId),
        eq(conflictRecord.status, "open"),
      ),
    )
  return rows.find((c) => isBlockingSeverity(c.severity)) ?? null
}

/* ------------------------------------------------------------------ */
/* Writes                                                            */
/* ------------------------------------------------------------------ */

export interface RecordConflictInput {
  detectedBetween: string
  severity: ConflictSeverity
  description?: string
  system?: string
  workOrderId?: number
  doctrineRule?: string
}

export async function recordConflict(input: RecordConflictInput): Promise<ConflictRecord> {
  const userId = await getUserId()
  const ref = await nextRef(conflictRecord as never, "CONFLICT", userId)
  const [row] = await db
    .insert(conflictRecord)
    .values({
      userId,
      ref,
      detectedBetween: input.detectedBetween,
      severity: input.severity,
      description: input.description ?? null,
      system: input.system ?? null,
      workOrderId: input.workOrderId ?? null,
      doctrineRule: input.doctrineRule ?? null,
      status: "open",
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: "CONFLICT_DETECTED",
    entityType: "conflict_record",
    entityId: row.id,
    reason: input.detectedBetween,
    after: { severity: input.severity, status: "open" },
    metadata: { severity: input.severity },
  })
  await logEvent({
    userId,
    type: "conflict.detected",
    summary: `${ref} [${input.severity}]: ${input.detectedBetween}`,
    register: "conflicts",
    refId: row.id,
  })

  if (isBlockingSeverity(input.severity)) {
    await writeArtifact({
      id: ref,
      category: "conflicts",
      title: `Conflict ${ref} — ${input.severity}`,
      sections: [
        { heading: "Detected between", body: input.detectedBetween },
        { heading: "Description", body: input.description ?? "(none)" },
        { heading: "Doctrine rule", body: input.doctrineRule ?? "(none)" },
      ],
      record: { ref, ...input, status: "open" },
    })
  }

  revalidatePath("/goal-console")
  return row
}

// Resolve (or accept the risk of) a conflict. Requires an explicit resolution.
export async function resolveConflict(
  id: number,
  resolution: string,
  outcome: "resolved" | "accepted_risk" = "resolved",
): Promise<void> {
  const userId = await getUserId()
  const [conflict] = await db
    .select()
    .from(conflictRecord)
    .where(and(eq(conflictRecord.id, id), eq(conflictRecord.userId, userId)))
    .limit(1)
  if (!conflict) throw new Error("Conflict not found")
  if (!resolution.trim()) throw new Error("A resolution is required to close a conflict")

  await db
    .update(conflictRecord)
    .set({ status: outcome, resolution, resolvedBy: userId, resolvedAt: new Date() })
    .where(and(eq(conflictRecord.id, id), eq(conflictRecord.userId, userId)))

  await appendGovernanceEvent({
    userId,
    eventType: "CONFLICT_RESOLVED",
    entityType: "conflict_record",
    entityId: id,
    reason: resolution,
    before: { status: conflict.status },
    after: { status: outcome, resolution },
  })
  await logEvent({
    userId,
    type: "conflict.resolved",
    summary: `${conflict.ref ?? `#${id}`}: ${outcome} — ${resolution}`,
    register: "conflicts",
    refId: id,
  })
  revalidatePath("/goal-console")
}
