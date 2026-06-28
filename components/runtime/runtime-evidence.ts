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
  passCount: number
  partialCount: number
  failCount: number
  validatorCount: number
  changedFileCount: number
}

export function summarizeRuntimeEvidence(records: RuntimeEvidence[]): RuntimeEvidenceSummary {
  const latest = records[0]

  return records.reduce<RuntimeEvidenceSummary>(
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
      total: records.length,
      latest,
      passCount: 0,
      partialCount: 0,
      failCount: 0,
      validatorCount: 0,
      changedFileCount: 0,
    },
  )
}
