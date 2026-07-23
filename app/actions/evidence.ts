"use server"

import { db } from "@/lib/db"
import { evidenceRecord, workOrder, type EvidenceRecord } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

const MAX_PERSISTED_EVIDENCE_RECORDS = 100

function splitList(v?: string | string[]): string[] {
  if (!v) return []
  const arr = Array.isArray(v) ? v : v.split(/[\n,]/)
  return arr.map((s) => s.trim()).filter(Boolean)
}

async function nextRef(userId: string): Promise<string> {
  const rows = await db
    .select({ ref: evidenceRecord.ref })
    .from(evidenceRecord)
    .where(eq(evidenceRecord.userId, userId))
  let max = 0
  for (const r of rows) {
    const m = r.ref?.match(/EV-(\d+)/)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return `EV-${String(max + 1).padStart(4, "0")}`
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getEvidenceForWorkOrder(workOrderId: number): Promise<EvidenceRecord[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(evidenceRecord)
    .where(and(eq(evidenceRecord.userId, userId), eq(evidenceRecord.workOrderId, workOrderId)))
    .orderBy(desc(evidenceRecord.createdAt))
}

export async function getRecentEvidence(limit = 25): Promise<EvidenceRecord[]> {
  return (await getPersistedEvidenceTruth(limit)).records
}

export type PersistedEvidenceTruth = {
  source: "evidence_record"
  scope: "CURRENT_USER"
  readOnly: true
  records: EvidenceRecord[]
}

export async function getPersistedEvidenceTruth(limit = 25): Promise<PersistedEvidenceTruth> {
  const userId = await getUserId()
  const boundedLimit = Math.min(
    MAX_PERSISTED_EVIDENCE_RECORDS,
    Math.max(0, Number.isSafeInteger(limit) ? limit : 25),
  )
  const records = await db
    .select()
    .from(evidenceRecord)
    .where(eq(evidenceRecord.userId, userId))
    .orderBy(desc(evidenceRecord.createdAt))
    .limit(boundedLimit)

  return {
    source: "evidence_record",
    scope: "CURRENT_USER",
    readOnly: true,
    records,
  }
}

/* ------------------------------------------------------------------ */
/* Record evidence (§11)                                              */
/* ------------------------------------------------------------------ */

export interface EvidenceInput {
  workOrderId: number
  result: "PASS" | "FAIL" | "PARTIAL"
  repo?: string
  branch?: string
  head?: string
  worktreeStatus?: string
  filesChanged?: string
  validators?: string
  knownFailures?: string
  outOfScopeChanges?: string
  deferredItems?: string
  nextValidMove?: string
  notes?: string
}

export async function recordEvidence(input: EvidenceInput): Promise<EvidenceRecord> {
  const userId = await getUserId()

  // The work order must exist and belong to the operator.
  const [wo] = await db
    .select()
    .from(workOrder)
    .where(and(eq(workOrder.id, input.workOrderId), eq(workOrder.userId, userId)))
    .limit(1)
  if (!wo) throw new Error("Work order not found.")

  const ref = await nextRef(userId)
  const [row] = await db
    .insert(evidenceRecord)
    .values({
      userId,
      ref,
      workOrderId: input.workOrderId,
      result: input.result,
      repo: input.repo ?? null,
      branch: input.branch ?? null,
      head: input.head ?? null,
      worktreeStatus: input.worktreeStatus ?? null,
      filesChanged: splitList(input.filesChanged),
      validators: splitList(input.validators),
      knownFailures: splitList(input.knownFailures),
      outOfScopeChanges: splitList(input.outOfScopeChanges),
      deferredItems: splitList(input.deferredItems),
      nextValidMove: input.nextValidMove ?? null,
      notes: input.notes ?? null,
    })
    .returning()

  await logEvent({
    userId,
    type: "work_order.evidence_record",
    summary: `${ref} recorded for ${wo.ref ?? `#${wo.id}`}: ${input.result}`,
    register: "work-orders",
    refId: wo.id,
    metadata: { evidenceRef: ref, result: input.result },
  })
  revalidatePath("/work-orders")
  return row
}
