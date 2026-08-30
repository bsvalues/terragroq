import {
  getHistoricalDoctrineCatalog,
  type HistoricalDoctrineCandidate,
} from "./historical-doctrine.ts"
import {
  getHistoricalProjectContextCatalog,
  type HistoricalProjectContextCandidate,
} from "./historical-project-context.ts"

export const W24_REJECTION = Object.freeze({
  candidateId: "HKR-ae7e0a5220b153cf",
  claimId: "HKR004-C027",
  rawSha256: "29d58c61dd04eb4e5297e34f05bb9e2ae7d673f682aea712378386634e4769cb",
  blobId: "97c8d8ee09ee0b3455f23cfef7196d6284a882d5",
  verdict: "REJECT_NO_CANONICAL_OWNER",
  owner: "NONE",
  state: "FROZEN_EXTERNAL_HISTORICAL_EVIDENCE_NO_CURRENT_MUTATION",
} as const)

type Catalogs = {
  doctrine: HistoricalDoctrineCandidate[]
  projectContext: HistoricalProjectContextCandidate[]
}

export type HistoricalPromotionRecord =
  | { owner: "doctrine"; candidate: HistoricalDoctrineCandidate }
  | { owner: "private_project_context"; candidate: HistoricalProjectContextCandidate }

export type HistoricalPromotionStatusRow = {
  candidateId: string
  claimId: string
  owner: HistoricalPromotionRecord["owner"]
  status: string
}

export function buildHistoricalPromotionPlan(catalogs?: Partial<Catalogs>) {
  const doctrine = catalogs?.doctrine ?? getHistoricalDoctrineCatalog()
  const projectContext = catalogs?.projectContext ?? getHistoricalProjectContextCatalog()
  if (doctrine.length !== 3 || projectContext.length !== 6) {
    throw new Error(`HISTORICAL_PROMOTION_COUNT_INVALID:${doctrine.length}+${projectContext.length}`)
  }

  const records: HistoricalPromotionRecord[] = [
    ...doctrine.map((candidate) => ({ owner: "doctrine" as const, candidate })),
    ...projectContext.map((candidate) => ({ owner: "private_project_context" as const, candidate })),
  ]
  const candidateIds = new Set<string>()
  const claimIds = new Set<string>()
  for (const record of records) {
    const { candidate } = record
    if (candidateIds.has(candidate.candidateId)) {
      throw new Error(`HISTORICAL_PROMOTION_DUPLICATE_CANDIDATE:${candidate.candidateId}`)
    }
    if (claimIds.has(candidate.claimId)) {
      throw new Error(`HISTORICAL_PROMOTION_DUPLICATE_CLAIM:${candidate.claimId}`)
    }
    candidateIds.add(candidate.candidateId)
    claimIds.add(candidate.claimId)
  }
  if (candidateIds.has(W24_REJECTION.candidateId)
    || claimIds.has(W24_REJECTION.claimId)
    || records.some((record) => record.candidate.provenance.rawSha256 === W24_REJECTION.rawSha256)) {
    throw new Error("HISTORICAL_PROMOTION_W24_CATALOG_FORBIDDEN")
  }

  return {
    doctrine,
    projectContext,
    records,
    counts: { doctrine: 3, projectContext: 6, total: 9 },
    rejection: W24_REJECTION,
  }
}

export function validateHistoricalPromotionStatus(input: {
  rows: HistoricalPromotionStatusRow[]
  w24CanonicalHits: number
  w24EventHits: number
}) {
  if (input.w24CanonicalHits !== 0 || input.w24EventHits !== 0) {
    throw new Error(`HISTORICAL_PROMOTION_W24_PRESENT:${input.w24CanonicalHits}:${input.w24EventHits}`)
  }
  const plan = buildHistoricalPromotionPlan()
  const byCandidateId = new Map(input.rows.map((row) => [row.candidateId, row]))
  for (const record of plan.records) {
    const row = byCandidateId.get(record.candidate.candidateId)
    if (!row) throw new Error(`HISTORICAL_PROMOTION_STATUS_MISSING:${record.candidate.candidateId}`)
    const expectedStatus = record.owner === "doctrine" ? "historical_input" : "private_project_context"
    if (row.claimId !== record.candidate.claimId
      || row.owner !== record.owner
      || row.status !== expectedStatus) {
      throw new Error(`HISTORICAL_PROMOTION_STATUS_INVALID:${record.candidate.candidateId}`)
    }
  }
  if (input.rows.length !== plan.records.length) {
    throw new Error(`HISTORICAL_PROMOTION_STATUS_COUNT_INVALID:${input.rows.length}`)
  }
  return { doctrine: 3, projectContext: 6, total: 9, w24Absent: true as const }
}
