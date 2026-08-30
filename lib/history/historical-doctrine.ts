export const HISTORICAL_DOCTRINE_AUTHORITY = "historical_non_authoritative" as const
export const HISTORICAL_DOCTRINE_INPUT_STATE = "historical_input" as const
export const HISTORICAL_DOCTRINE_ARCHIVED_STATE = "historical_archived" as const

export type HistoricalDoctrineProvenance = {
  sourceCommit: string
  sourceTree: string
  provenanceCommits: string[]
  rawSha256: string
  blobId: string
  disposition: "PROMOTE_AS_PROPOSED"
  authority: typeof HISTORICAL_DOCTRINE_AUTHORITY
}

export type HistoricalDoctrineCandidate = {
  candidateId: string
  claimId: string
  title: string
  statement: string
  provenance: HistoricalDoctrineProvenance
}

export type HistoricalDoctrineStoredRow = {
  userId?: string
  ref?: string | null
  title?: string
  statement?: string
  category?: string
  scope?: string | null
  status: string
  priority?: number
  active?: boolean
  allowed?: string[]
  forbidden?: string[]
  requiresApproval?: string[]
  evidence?: string[]
  owner?: string
  locked?: boolean
  supersedesId?: number | null
  supersededById?: number | null
  historicalCandidateId: string | null
  historicalClaimId?: string | null
  historicalProvenance?: Record<string, unknown> | HistoricalDoctrineProvenance | null
}

const SHARED_PROVENANCE = {
  sourceCommit: "7664e589bddbe35ea4b9f8b72fad2cfbb9ffe7f7",
  sourceTree: "de4bdd48108d12c35ea3f53e3f8b7d032cf2b674",
  provenanceCommits: [
    "d45981428d30b1c35714ea12b886720deb766419",
    "a1a9cc2d7f37b4311aea698a86314c27f85e340e",
  ],
  disposition: "PROMOTE_AS_PROPOSED",
  authority: HISTORICAL_DOCTRINE_AUTHORITY,
} as const

const HISTORICAL_DOCTRINE_PROVENANCE_KEYS = [
  "authority",
  "blobId",
  "disposition",
  "provenanceCommits",
  "rawSha256",
  "sourceCommit",
  "sourceTree",
] as const

const HISTORICAL_DOCTRINE_CATALOG: readonly HistoricalDoctrineCandidate[] = [
  {
    candidateId: "HKR-32a0add1327ffadd",
    claimId: "HKR004-C001",
    title: "Keep evidence-chain claims distinguishable",
    statement: "Evidence chains must distinguish direct proof from inference, assumption, and unresolved uncertainty.",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "6bbc9a2050221db1e54d41d38566bd45fc7a0a003ba7187b364b480fb4c2c064",
      blobId: "8e700caeeb06b826d5de852dd2f935ecaa90da66",
    },
  },
  {
    candidateId: "HKR-ada454f7cb889228",
    claimId: "HKR004-C002",
    title: "Finish bounded work before adjacent expansion",
    statement: "Complete and review the bounded authorized objective before expanding into adjacent work.",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "3aa279c9d57695c03fea2bdcdc8c3a89c831c0115e4fde8a3f0baad0186e7c5f",
      blobId: "3ec6e91f3c55d08fd01c959c4576eecddb440cf0",
    },
  },
  {
    candidateId: "HKR-d200030578f50efe",
    claimId: "HKR004-C003",
    title: "Frame public work for trust",
    statement: "Public-facing work must be explainable, defensible, and worthy of trust.",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "993febf0f8641f0835775cc4bac4e3d5f5a43c069f22da1d3a94432b1e292abd",
      blobId: "b7557aaade3e08f32948f8e7734798ebbabce678",
    },
  },
]

function cloneCandidate(candidate: HistoricalDoctrineCandidate): HistoricalDoctrineCandidate {
  return {
    ...candidate,
    provenance: {
      ...candidate.provenance,
      provenanceCommits: [...candidate.provenance.provenanceCommits],
    },
  }
}

export function getHistoricalDoctrineCatalog(): HistoricalDoctrineCandidate[] {
  return HISTORICAL_DOCTRINE_CATALOG.map(cloneCandidate)
}

export function getHistoricalDoctrineCandidate(candidateId: string): HistoricalDoctrineCandidate {
  const candidate = HISTORICAL_DOCTRINE_CATALOG.find((entry) => entry.candidateId === candidateId)
  if (!candidate) throw new Error(`HISTORICAL_DOCTRINE_CANDIDATE_NOT_APPROVED:${candidateId}`)
  return cloneCandidate(candidate)
}

export function buildHistoricalDoctrineInsert(
  userId: string,
  candidate: HistoricalDoctrineCandidate,
) {
  return {
    userId,
    ref: candidate.claimId,
    title: candidate.title,
    statement: candidate.statement,
    category: "principle",
    scope: "historical/doctrine-input",
    status: HISTORICAL_DOCTRINE_INPUT_STATE,
    priority: 0,
    active: false,
    allowed: [] as string[],
    forbidden: [] as string[],
    requiresApproval: [] as string[],
    evidence: [] as string[],
    owner: "historical-record",
    locked: false,
    supersedesId: null,
    supersededById: null,
    historicalCandidateId: candidate.candidateId,
    historicalClaimId: candidate.claimId,
    historicalProvenance: {
      ...candidate.provenance,
      provenanceCommits: [...candidate.provenance.provenanceCommits],
    },
  }
}

function provenanceMatches(
  actual: HistoricalDoctrineStoredRow["historicalProvenance"],
  expected: HistoricalDoctrineProvenance,
) {
  if (!actual || Array.isArray(actual)) return false
  const actualKeys = Object.keys(actual).sort()
  if (actualKeys.length !== HISTORICAL_DOCTRINE_PROVENANCE_KEYS.length
    || actualKeys.some((key, index) => key !== HISTORICAL_DOCTRINE_PROVENANCE_KEYS[index])) {
    return false
  }
  return actual.sourceCommit === expected.sourceCommit
    && actual.sourceTree === expected.sourceTree
    && Array.isArray(actual.provenanceCommits)
    && actual.provenanceCommits.length === expected.provenanceCommits.length
    && actual.provenanceCommits.every((commit, index) => commit === expected.provenanceCommits[index])
    && actual.rawSha256 === expected.rawSha256
    && actual.blobId === expected.blobId
    && actual.disposition === expected.disposition
    && actual.authority === expected.authority
}

function stringArraysMatch(actual: string[] | undefined, expected: string[]) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
}

export function assertHistoricalDoctrineReplay<T extends HistoricalDoctrineStoredRow>(
  row: T,
  candidate: HistoricalDoctrineCandidate,
): T {
  const expected = buildHistoricalDoctrineInsert(row.userId ?? "", candidate)
  const stateMatches = row.status === HISTORICAL_DOCTRINE_INPUT_STATE
    || row.status === HISTORICAL_DOCTRINE_ARCHIVED_STATE
  const matches = row.ref === expected.ref
    && row.title === expected.title
    && row.statement === expected.statement
    && row.category === expected.category
    && row.scope === expected.scope
    && stateMatches
    && row.priority === expected.priority
    && row.active === expected.active
    && stringArraysMatch(row.allowed, expected.allowed)
    && stringArraysMatch(row.forbidden, expected.forbidden)
    && stringArraysMatch(row.requiresApproval, expected.requiresApproval)
    && stringArraysMatch(row.evidence, expected.evidence)
    && row.owner === expected.owner
    && row.locked === expected.locked
    && row.supersedesId == null
    && row.supersededById == null
    && row.historicalCandidateId === expected.historicalCandidateId
    && row.historicalClaimId === expected.historicalClaimId
    && provenanceMatches(row.historicalProvenance, candidate.provenance)

  if (!matches) {
    throw new Error(`HISTORICAL_DOCTRINE_COLLISION:${candidate.candidateId}`)
  }
  return row
}

export function assertGenericDoctrineMutationAllowed(row: Pick<
  HistoricalDoctrineStoredRow,
  "historicalCandidateId" | "status"
>): void {
  if (row.historicalCandidateId !== null
    || row.status === HISTORICAL_DOCTRINE_INPUT_STATE
    || row.status === HISTORICAL_DOCTRINE_ARCHIVED_STATE) {
    throw new Error("HISTORICAL_DOCTRINE_GENERIC_MUTATION_FORBIDDEN")
  }
}

export function buildHistoricalDoctrineArchiveUpdate(
  row: HistoricalDoctrineStoredRow,
): { status: typeof HISTORICAL_DOCTRINE_ARCHIVED_STATE; active: false } | null {
  if (row.historicalCandidateId === null) {
    throw new Error("HISTORICAL_DOCTRINE_ARCHIVE_REQUIRES_HISTORICAL_INPUT")
  }
  if (row.status === HISTORICAL_DOCTRINE_ARCHIVED_STATE) return null
  if (row.status !== HISTORICAL_DOCTRINE_INPUT_STATE || row.active !== false) {
    throw new Error("HISTORICAL_DOCTRINE_ARCHIVE_STATE_INVALID")
  }
  return { status: HISTORICAL_DOCTRINE_ARCHIVED_STATE, active: false }
}
