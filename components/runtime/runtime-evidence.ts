import type { EvidenceRecord } from "@/lib/db/schema"

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
