export const HISTORICAL_PROJECT_CONTEXT_STATE = "private_project_context" as const
export const HISTORICAL_PROJECT_CONTEXT_ARCHIVED_STATE = "archived_private_project_context" as const
export const HISTORICAL_PROJECT_CONTEXT_PRIVACY = "private" as const
export const HISTORICAL_PROJECT_CONTEXT_AUTHORITY = "historical_non_authoritative" as const
export const HISTORICAL_PROJECT_CONTEXT_EXECUTION_MODE = "non_executing" as const

export type HistoricalProjectContextProvenance = {
  sourceCommit: string
  sourceTree: string
  provenanceCommits: string[]
  rawSha256: string
  blobId: string
  disposition: "PROMOTE_AS_PROPOSED"
  privacy: typeof HISTORICAL_PROJECT_CONTEXT_PRIVACY
  authority: typeof HISTORICAL_PROJECT_CONTEXT_AUTHORITY
  executionMode: typeof HISTORICAL_PROJECT_CONTEXT_EXECUTION_MODE
}

export type HistoricalProjectContextCandidate = {
  candidateId: string
  claimId: string
  title: string
  content: string
  targetProjectKey: "terrafusion" | "williamos"
  provenance: HistoricalProjectContextProvenance
}

export type HistoricalProjectContextStoredRow = {
  userId?: string
  projectId: number | null
  threadId: string | null
  title?: string
  source?: string | null
  mimeType?: string
  content?: string
  chunkCount: number
  status: string
  historicalCandidateId: string | null
  historicalClaimId?: string | null
  historicalProvenance?: Record<string, unknown> | HistoricalProjectContextProvenance | null
  privacy?: string | null
  authority?: string | null
  executionMode?: string | null
  archivedAt?: Date | null
}

const SHARED_PROVENANCE = {
  sourceCommit: "7664e589bddbe35ea4b9f8b72fad2cfbb9ffe7f7",
  sourceTree: "de4bdd48108d12c35ea3f53e3f8b7d032cf2b674",
  provenanceCommits: [
    "d45981428d30b1c35714ea12b886720deb766419",
    "a1a9cc2d7f37b4311aea698a86314c27f85e340e",
  ],
  disposition: "PROMOTE_AS_PROPOSED",
  privacy: HISTORICAL_PROJECT_CONTEXT_PRIVACY,
  authority: HISTORICAL_PROJECT_CONTEXT_AUTHORITY,
  executionMode: HISTORICAL_PROJECT_CONTEXT_EXECUTION_MODE,
} as const

const HISTORICAL_PROJECT_CONTEXT_PROVENANCE_KEYS = [
  "authority",
  "blobId",
  "disposition",
  "executionMode",
  "privacy",
  "provenanceCommits",
  "rawSha256",
  "sourceCommit",
  "sourceTree",
] as const

const HISTORICAL_PROJECT_CONTEXT_CATALOG: readonly HistoricalProjectContextCandidate[] = [
  {
    candidateId: "HKR-eabf2e0c67a8a0f4",
    claimId: "HKR004-C029",
    title: "Defensible professional inquiry",
    content: "Professional inquiry should unite defensible reasoning, persuasive communication, quantitative practice, and explanatory narrative.",
    targetProjectKey: "terrafusion",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "e48c899f0451267a595f383da66fcce1412fd03b0bea46161222b87fbddf6aec",
      blobId: "22b22c9be307b13a7a89d74b2c78a65f72cd72b5",
    },
  },
  {
    candidateId: "HKR-f2ae70ee3f7b4bda",
    claimId: "HKR004-C030",
    title: "Public confidence through evidence",
    content: "Public confidence depends on reducing operational friction and presenting evidence whose quality can be examined.",
    targetProjectKey: "terrafusion",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "a978afe01df7aff2bd37d59be9e739dc606dd39d96d35cb06f78eba21865cccd",
      blobId: "f1350719730e8f7dd6176fba8c5d8221f404cb51",
    },
  },
  {
    candidateId: "HKR-0cd458c5fd967816",
    claimId: "HKR004-C031",
    title: "Teachable understanding before tool dependence",
    content: "Use AI and other tools to deepen teachable understanding, not to replace examination of the underlying reasoning.",
    targetProjectKey: "williamos",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "72133eae13c712f7527e6e729907ac868972471fed4ac15d07f28fd9fe416ecb",
      blobId: "8ff2013f573555997beb6aeece4369dece00a669",
    },
  },
  {
    candidateId: "HKR-ae689745256df0d2",
    claimId: "HKR004-C019",
    title: "Professional practice that earns trust",
    content: "Professional practice should connect public explanation and deliberate strategy in ways that earn and preserve trust.",
    targetProjectKey: "terrafusion",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "465b6d49a039bcfbd88a65dff5e8228228d44753b1655000785e920c8677a46b",
      blobId: "d7be14c0b244641e9b35fda7d32f6a224c3c97ab",
    },
  },
  {
    candidateId: "HKR-c823a84feb4a7e52",
    claimId: "HKR004-C032",
    title: "Domain-grounded differentiation",
    content: "Durable differentiation comes from domain knowledge, disciplined workflow, and public trust rather than tool novelty alone.",
    targetProjectKey: "terrafusion",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "c0abbb79a062a7a77f99c2604512a4edfd922dc1f0e2fa9079e8f9d5304fcabf",
      blobId: "33e38ed61972a8f999c1740cf002e8d62c585da7",
    },
  },
  {
    candidateId: "HKR-31831586c5a2811b",
    claimId: "HKR004-C020",
    title: "Privacy-safe cross-domain inquiry",
    content: "Cross-domain inquiry should use privacy-safe prompts that invite comparison without exposing private source material.",
    targetProjectKey: "williamos",
    provenance: {
      ...SHARED_PROVENANCE,
      provenanceCommits: [...SHARED_PROVENANCE.provenanceCommits],
      rawSha256: "2c9f6dc7ce58c03114b84b97ca368a691a6caf7d11f65c5e321979970f5db0b5",
      blobId: "d1113123c9331d6693ddd437fada53cd57272604",
    },
  },
]

function cloneCandidate(candidate: HistoricalProjectContextCandidate): HistoricalProjectContextCandidate {
  return {
    ...candidate,
    provenance: {
      ...candidate.provenance,
      provenanceCommits: [...candidate.provenance.provenanceCommits],
    },
  }
}

export function getHistoricalProjectContextCatalog(): HistoricalProjectContextCandidate[] {
  return HISTORICAL_PROJECT_CONTEXT_CATALOG.map(cloneCandidate)
}

export function getHistoricalProjectContextCandidate(candidateId: string): HistoricalProjectContextCandidate {
  const candidate = HISTORICAL_PROJECT_CONTEXT_CATALOG.find((entry) => entry.candidateId === candidateId)
  if (!candidate) throw new Error(`HISTORICAL_PROJECT_CONTEXT_CANDIDATE_NOT_APPROVED:${candidateId}`)
  return cloneCandidate(candidate)
}

export function buildHistoricalProjectContextInsert(
  userId: string,
  projectId: number,
  candidate: HistoricalProjectContextCandidate,
  threadId: string | null,
) {
  return {
    userId,
    projectId,
    threadId,
    title: candidate.title,
    source: "historical/private-project-context",
    mimeType: "text/plain",
    content: candidate.content,
    chunkCount: 0,
    status: HISTORICAL_PROJECT_CONTEXT_STATE,
    historicalCandidateId: candidate.candidateId,
    historicalClaimId: candidate.claimId,
    historicalProvenance: {
      ...candidate.provenance,
      provenanceCommits: [...candidate.provenance.provenanceCommits],
    },
    privacy: HISTORICAL_PROJECT_CONTEXT_PRIVACY,
    authority: HISTORICAL_PROJECT_CONTEXT_AUTHORITY,
    executionMode: HISTORICAL_PROJECT_CONTEXT_EXECUTION_MODE,
    archivedAt: null,
  }
}

function provenanceMatches(
  actual: HistoricalProjectContextStoredRow["historicalProvenance"],
  expected: HistoricalProjectContextProvenance,
) {
  if (!actual || Array.isArray(actual)) return false
  const actualKeys = Object.keys(actual).sort()
  if (actualKeys.length !== HISTORICAL_PROJECT_CONTEXT_PROVENANCE_KEYS.length
    || actualKeys.some((key, index) => key !== HISTORICAL_PROJECT_CONTEXT_PROVENANCE_KEYS[index])) {
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
    && actual.privacy === expected.privacy
    && actual.authority === expected.authority
    && actual.executionMode === expected.executionMode
}

export function assertHistoricalProjectContextReplay<T extends HistoricalProjectContextStoredRow>(
  row: T,
  candidate: HistoricalProjectContextCandidate,
  scope: { userId: string; projectId: number; threadId: string | null },
): T {
  const expected = buildHistoricalProjectContextInsert(
    scope.userId,
    scope.projectId,
    candidate,
    scope.threadId,
  )
  const active = row.status === HISTORICAL_PROJECT_CONTEXT_STATE && row.archivedAt == null
  const archived = row.status === HISTORICAL_PROJECT_CONTEXT_ARCHIVED_STATE
    && row.archivedAt instanceof Date
  const matches = row.userId === expected.userId
    && row.projectId === expected.projectId
    && row.threadId === expected.threadId
    && row.title === expected.title
    && row.source === expected.source
    && row.mimeType === expected.mimeType
    && row.content === expected.content
    && row.chunkCount === expected.chunkCount
    && (active || archived)
    && row.historicalCandidateId === expected.historicalCandidateId
    && row.historicalClaimId === expected.historicalClaimId
    && provenanceMatches(row.historicalProvenance, candidate.provenance)
    && row.privacy === expected.privacy
    && row.authority === expected.authority
    && row.executionMode === expected.executionMode

  if (!matches) throw new Error(`HISTORICAL_PROJECT_CONTEXT_COLLISION:${candidate.candidateId}`)
  return row
}

export function assertGenericDocumentDeletionAllowed(row: Pick<
  HistoricalProjectContextStoredRow,
  "historicalCandidateId" | "status"
>): void {
  if (row.historicalCandidateId !== null
    || row.status === HISTORICAL_PROJECT_CONTEXT_STATE
    || row.status === HISTORICAL_PROJECT_CONTEXT_ARCHIVED_STATE) {
    throw new Error("HISTORICAL_PROJECT_CONTEXT_GENERIC_DELETE_FORBIDDEN")
  }
}

export function buildHistoricalProjectContextArchiveUpdate(
  row: HistoricalProjectContextStoredRow,
  archivedAt = new Date(),
): {
  status: typeof HISTORICAL_PROJECT_CONTEXT_ARCHIVED_STATE
  archivedAt: Date
} | null {
  if (row.historicalCandidateId === null) {
    throw new Error("HISTORICAL_PROJECT_CONTEXT_ARCHIVE_REQUIRES_HISTORICAL_CONTEXT")
  }
  if (row.status === HISTORICAL_PROJECT_CONTEXT_ARCHIVED_STATE) {
    if (!(row.archivedAt instanceof Date)) {
      throw new Error("HISTORICAL_PROJECT_CONTEXT_ARCHIVE_STATE_INVALID")
    }
    return null
  }
  if (row.status !== HISTORICAL_PROJECT_CONTEXT_STATE || row.archivedAt != null) {
    throw new Error("HISTORICAL_PROJECT_CONTEXT_ARCHIVE_STATE_INVALID")
  }
  return { status: HISTORICAL_PROJECT_CONTEXT_ARCHIVED_STATE, archivedAt }
}
