"use server"

import { db } from "@/lib/db"
import { lockRecord, type LockRecord } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { writeArtifact } from "@/lib/governance/artifacts"
import { nextRef } from "@/lib/governance/refs"
import { validateRelease, type LockKind } from "@/lib/governance/locks"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getLocks(limit = 50): Promise<LockRecord[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(lockRecord)
    .where(eq(lockRecord.userId, userId))
    .orderBy(desc(lockRecord.createdAt))
    .limit(limit)
}

export async function getActiveLocks(): Promise<LockRecord[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(lockRecord)
    .where(and(eq(lockRecord.userId, userId), eq(lockRecord.status, "active")))
    .orderBy(desc(lockRecord.createdAt))
}

/* ------------------------------------------------------------------ */
/* Writes                                                            */
/* ------------------------------------------------------------------ */

export interface CreateLockInput {
  kind: LockKind
  title: string
  scope?: string
  posture?: string
  reason?: string
  blockedActions?: string[]
  allowedActions?: string[]
}

export async function createLock(input: CreateLockInput): Promise<LockRecord> {
  const userId = await getUserId()
  const ref = await nextRef(lockRecord as never, "LOCK", userId)
  const [row] = await db
    .insert(lockRecord)
    .values({
      userId,
      ref,
      kind: input.kind,
      title: input.title,
      scope: input.scope ?? null,
      posture: input.posture ?? null,
      reason: input.reason ?? null,
      blockedActions: input.blockedActions ?? [],
      allowedActions: input.allowedActions ?? [],
      status: "active",
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: "LOCK_CREATED",
    entityType: "lock_record",
    entityId: row.id,
    reason: input.reason,
    after: { kind: input.kind, status: "active" },
  })
  await logEvent({
    userId,
    type: "lock.created",
    summary: `${ref} ${input.kind}: ${input.title}`,
    register: "locks",
    refId: row.id,
  })
  revalidatePath("/goal-console")
  return row
}

// Release a lock via the explicit protocol. Vague language is rejected; a
// concrete reason + new posture are mandatory. The release is exported to the
// Git-backed ledger as durable audit history.
export async function releaseLock(
  id: number,
  input: { reason: string; newPosture: string; allowedActions?: string[] },
): Promise<{ ok: boolean; reason: string }> {
  const userId = await getUserId()
  const [lock] = await db
    .select()
    .from(lockRecord)
    .where(and(eq(lockRecord.id, id), eq(lockRecord.userId, userId)))
    .limit(1)
  if (!lock) throw new Error("Lock not found")
  if (lock.status !== "active") return { ok: false, reason: `Lock is already ${lock.status}.` }

  const valid = validateRelease(input)
  if (!valid.ok) return { ok: false, reason: valid.reason }

  await db
    .update(lockRecord)
    .set({
      status: "released",
      newPosture: input.newPosture,
      allowedActions: input.allowedActions ?? lock.allowedActions,
      releasedBy: userId,
      releaseReason: input.reason,
      releasedAt: new Date(),
    })
    .where(and(eq(lockRecord.id, id), eq(lockRecord.userId, userId)))

  await appendGovernanceEvent({
    userId,
    eventType: "LOCK_RELEASED",
    entityType: "lock_record",
    entityId: id,
    reason: input.reason,
    before: { status: "active", posture: lock.posture },
    after: { status: "released", newPosture: input.newPosture },
  })
  await logEvent({
    userId,
    type: "lock.released",
    summary: `${lock.ref ?? `#${id}`} ${lock.kind} RELEASED → ${input.newPosture}`,
    register: "locks",
    refId: id,
  })
  await writeArtifact({
    id: `${lock.ref ?? `LOCK-${id}`}-RELEASE`,
    category: "decisions",
    title: `Lock release — ${lock.ref ?? `#${id}`} (${lock.kind})`,
    sections: [
      { heading: "Reason", body: input.reason },
      { heading: "New posture", body: input.newPosture },
      { heading: "Allowed actions", body: (input.allowedActions ?? []).join("\n") || "(unchanged)" },
    ],
    record: { lockId: id, kind: lock.kind, reason: input.reason, newPosture: input.newPosture },
  })

  revalidatePath("/goal-console")
  return { ok: true, reason: "Lock released." }
}
