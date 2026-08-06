import { and, desc, eq } from "drizzle-orm"

import { normalizeDurableRecordReference } from "@/components/outcome-queue/supporting-record-links"
import { db } from "@/lib/db"
import { eventLog, evidenceRecord } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"

const DURABLE_RECORD_MATCH_LIMIT = 2

export async function getDurableEvidenceRecord(reference: string) {
  const normalized = normalizeDurableRecordReference("evidence", reference)
  if (!normalized) return null
  const userId = await getUserId()
  const idMatch = /^evidence:([1-9]\d*)$/.exec(normalized)
  const predicate = idMatch
    ? eq(evidenceRecord.id, Number(idMatch[1]))
    : eq(evidenceRecord.ref, normalized)
  const matches = await db
    .select({
      id: evidenceRecord.id,
      ref: evidenceRecord.ref,
      workOrderId: evidenceRecord.workOrderId,
      result: evidenceRecord.result,
      repo: evidenceRecord.repo,
      branch: evidenceRecord.branch,
      head: evidenceRecord.head,
      validators: evidenceRecord.validators,
      nextValidMove: evidenceRecord.nextValidMove,
      artifactPath: evidenceRecord.artifactPath,
      createdAt: evidenceRecord.createdAt,
    })
    .from(evidenceRecord)
    .where(and(eq(evidenceRecord.userId, userId), predicate))
    .orderBy(desc(evidenceRecord.id))
    .limit(DURABLE_RECORD_MATCH_LIMIT)

  return matches.length === 1 ? matches[0] : null
}

export async function getDurableAuditRecord(reference: string) {
  const normalized = normalizeDurableRecordReference("audit", reference)
  if (!normalized) return null
  const userId = await getUserId()
  const auditId = Number(normalized.slice("audit:".length))
  const matches = await db
    .select({
      id: eventLog.id,
      type: eventLog.type,
      summary: eventLog.summary,
      register: eventLog.register,
      refId: eventLog.refId,
      createdAt: eventLog.createdAt,
    })
    .from(eventLog)
    .where(and(
      eq(eventLog.userId, userId),
      eq(eventLog.id, auditId),
    ))
    .orderBy(desc(eventLog.id))
    .limit(DURABLE_RECORD_MATCH_LIMIT)

  return matches.length === 1 ? matches[0] : null
}
