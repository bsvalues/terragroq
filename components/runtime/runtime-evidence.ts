import type { EvidenceRecord } from "@/lib/db/schema"

export const RUNTIME_EVIDENCE_HISTORY_LIMIT = 5

export type RuntimeEvidence = Pick<
  EvidenceRecord,
  | "ref"
  | "result"
  | "branch"
  | "head"
  | "filesChanged"
  | "validators"
  | "nextValidMove"
  | "createdAt"
>

export type RuntimeEvidenceHistoryProjection = {
  records: RuntimeEvidence[]
  limit: number
  truncated: boolean
}

export type RuntimeEvidenceSummary = {
  total: number
  latest?: RuntimeEvidence
  timeline: RuntimeEvidence[]
  passCount: number
  partialCount: number
  failCount: number
  validatorCount: number
  changedFileCount: number
}

export function projectRuntimeEvidenceHistory(
  records: RuntimeEvidence[],
  limit = RUNTIME_EVIDENCE_HISTORY_LIMIT,
): RuntimeEvidenceHistoryProjection {
  const configuredLimit = Number.isFinite(limit)
    ? Math.max(0, Math.trunc(limit))
    : RUNTIME_EVIDENCE_HISTORY_LIMIT
  const timeline = [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return {
    records: timeline.slice(0, configuredLimit),
    limit: configuredLimit,
    truncated: timeline.length > configuredLimit,
  }
}

export function summarizeRuntimeEvidence(records: RuntimeEvidence[]): RuntimeEvidenceSummary {
  const timeline = [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const latest = timeline[0]

  return timeline.reduce<RuntimeEvidenceSummary>(
    (summary, record) => {
      const result = record.result.toUpperCase()
      return {
        ...summary,
        passCount: summary.passCount + (result === "PASS" ? 1 : 0),
        partialCount: summary.partialCount + (result === "PARTIAL" ? 1 : 0),
        failCount: summary.failCount + (result === "FAIL" ? 1 : 0),
        validatorCount: summary.validatorCount + record.validators.length,
        changedFileCount: summary.changedFileCount + record.filesChanged.length,
      }
    },
    {
      total: timeline.length,
      latest,
      timeline,
      passCount: 0,
      partialCount: 0,
      failCount: 0,
      validatorCount: 0,
      changedFileCount: 0,
    },
  )
}
