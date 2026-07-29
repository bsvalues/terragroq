export const RECENT_OUTCOME_COMPLETION_LIMIT = 5

export type OutcomeCompletionEvidenceStatus =
  | "RECORDED"
  | "MISSING"
  | "CONFLICTING"

export type OutcomeCompletionQueueRecord = Readonly<{
  id: string
  userId: string
  outcomeKey: string
  title: string
  queueOrder: number
  dependencyKeys: readonly string[]
  lifecycleState: string
  terminalResult: string | null
  terminalEvidenceRefs: readonly string[]
  terminalAt: string | null
  updatedAt: string
}>

export type OutcomeCompletionAcquisitionReceipt = Readonly<{
  id: string
  userId: string
  outcomeKey: string
  firstFencingToken: number
  latestFencingToken: number
  createdAt: string
  updatedAt: string
}>

export type RecentOutcomeCompletionTimelineRow = Readonly<{
  outcomeId: string
  outcomeKey: string
  title: string
  terminalResult: string | null
  completedAt: string | null
  mergeEvidence: Readonly<{
    status: OutcomeCompletionEvidenceStatus
    sha: string | null
    prNumber: number | null
  }>
  successorEvidence: Readonly<{
    status: OutcomeCompletionEvidenceStatus
    outcomeKey: string | null
    title: string | null
    receiptId: string | null
    acquiredAt: string | null
    fencingTokenRange: Readonly<{
      first: number
      latest: number
    }> | null
  }>
}>

export type RecentOutcomeCompletionTimeline = Readonly<{
  rows: readonly RecentOutcomeCompletionTimelineRow[]
  truncated: boolean
}>

const MERGE_REF = /^merge:([0-9a-f]{40})$/i
const PR_REF = /^pr:([1-9][0-9]*)$/
const NUMERIC_ID = /^[0-9]+$/

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareIdsDescending(left: string, right: string): number {
  if (NUMERIC_ID.test(left) && NUMERIC_ID.test(right)) {
    const leftNumeric = left.replace(/^0+(?=[0-9])/, "")
    const rightNumeric = right.replace(/^0+(?=[0-9])/, "")

    if (leftNumeric.length !== rightNumeric.length) {
      return rightNumeric.length - leftNumeric.length
    }

    const numericOrder = compareText(rightNumeric, leftNumeric)
    if (numericOrder !== 0) return numericOrder
  }

  return compareText(right, left)
}

function timestamp(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function compareCompletions(
  left: OutcomeCompletionQueueRecord,
  right: OutcomeCompletionQueueRecord,
): number {
  const leftAt = timestamp(left.terminalAt)
  const rightAt = timestamp(right.terminalAt)

  if (leftAt !== rightAt) {
    if (leftAt === null) return 1
    if (rightAt === null) return -1
    return rightAt - leftAt
  }

  return compareIdsDescending(left.id, right.id)
}

function projectMergeEvidence(
  refs: readonly string[],
): RecentOutcomeCompletionTimelineRow["mergeEvidence"] {
  const mergeShas = new Set<string>()
  const prNumbers = new Set<number>()

  for (const ref of refs) {
    const mergeMatch = MERGE_REF.exec(ref)
    if (mergeMatch) {
      mergeShas.add(mergeMatch[1].toLowerCase())
      continue
    }

    const prMatch = PR_REF.exec(ref)
    if (!prMatch) continue
    const prNumber = Number(prMatch[1])
    if (Number.isSafeInteger(prNumber)) prNumbers.add(prNumber)
  }

  const prNumber = prNumbers.size === 1
    ? prNumbers.values().next().value ?? null
    : null
  const sha = mergeShas.size === 1
    ? mergeShas.values().next().value ?? null
    : null

  if (mergeShas.size > 1 || prNumbers.size > 1) {
    return { status: "CONFLICTING", sha, prNumber }
  }

  if (sha === null) {
    return { status: "MISSING", sha: null, prNumber }
  }

  return {
    status: "RECORDED",
    sha,
    prNumber,
  }
}

function emptySuccessorEvidence(
  status: "MISSING" | "CONFLICTING",
): RecentOutcomeCompletionTimelineRow["successorEvidence"] {
  return {
    status,
    outcomeKey: null,
    title: null,
    receiptId: null,
    acquiredAt: null,
    fencingTokenRange: null,
  }
}

function compareReceipts(
  left: OutcomeCompletionAcquisitionReceipt,
  right: OutcomeCompletionAcquisitionReceipt,
): number {
  const leftAt = timestamp(left.createdAt)
  const rightAt = timestamp(right.createdAt)

  if (leftAt !== rightAt) {
    if (leftAt === null) return 1
    if (rightAt === null) return -1
    return leftAt - rightAt
  }

  return compareText(left.id, right.id)
}

function projectSuccessorEvidence(
  userId: string,
  predecessor: OutcomeCompletionQueueRecord,
  outcomes: readonly OutcomeCompletionQueueRecord[],
  receipts: readonly OutcomeCompletionAcquisitionReceipt[],
): RecentOutcomeCompletionTimelineRow["successorEvidence"] {
  const completedAt = timestamp(predecessor.terminalAt)
  if (completedAt === null) return emptySuccessorEvidence("MISSING")

  const acquisitions = outcomes
    .filter((candidate) => (
      candidate.userId === userId
      && candidate.id !== predecessor.id
      && candidate.dependencyKeys.includes(predecessor.outcomeKey)
    ))
    .map((candidate) => {
      const earliestReceipt = receipts
        .filter((receipt) => (
          receipt.userId === userId
          && receipt.outcomeKey === candidate.outcomeKey
        ))
        .sort(compareReceipts)[0]

      return earliestReceipt
        ? {
            outcome: candidate,
            receipt: earliestReceipt,
            acquiredAt: timestamp(earliestReceipt.createdAt),
          }
        : null
    })
    .filter((acquisition): acquisition is NonNullable<typeof acquisition> => acquisition !== null)

  if (acquisitions.some(({ acquiredAt }) => (
    acquiredAt !== null && acquiredAt < completedAt
  ))) {
    return emptySuccessorEvidence("CONFLICTING")
  }

  const successor = acquisitions
    .filter((acquisition) => (
      acquisition.acquiredAt !== null && acquisition.acquiredAt >= completedAt
    ))
    .sort((left, right) => (
      left.acquiredAt! - right.acquiredAt!
      || compareText(left.outcome.id, right.outcome.id)
      || compareText(left.receipt.id, right.receipt.id)
    ))[0]

  if (!successor) return emptySuccessorEvidence("MISSING")

  return {
    status: "RECORDED",
    outcomeKey: successor.outcome.outcomeKey,
    title: successor.outcome.title,
    receiptId: successor.receipt.id,
    acquiredAt: successor.receipt.createdAt,
    fencingTokenRange: {
      first: successor.receipt.firstFencingToken,
      latest: successor.receipt.latestFencingToken,
    },
  }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return RECENT_OUTCOME_COMPLETION_LIMIT
  return Math.max(0, Math.floor(limit))
}

export function projectRecentOutcomeCompletionTimeline(
  userId: string,
  outcomes: readonly OutcomeCompletionQueueRecord[],
  receipts: readonly OutcomeCompletionAcquisitionReceipt[],
  limit = RECENT_OUTCOME_COMPLETION_LIMIT,
): RecentOutcomeCompletionTimeline {
  const rowLimit = normalizeLimit(limit)
  const completionWindow = outcomes
    .filter((outcome) => (
      outcome.userId === userId && outcome.lifecycleState === "completed"
    ))
    .sort(compareCompletions)
    .slice(0, rowLimit + 1)
  const truncated = completionWindow.length > rowLimit

  return {
    rows: completionWindow.slice(0, rowLimit).map((outcome) => ({
      outcomeId: outcome.id,
      outcomeKey: outcome.outcomeKey,
      title: outcome.title,
      terminalResult: outcome.terminalResult,
      completedAt: outcome.terminalAt,
      mergeEvidence: projectMergeEvidence(outcome.terminalEvidenceRefs),
      successorEvidence: projectSuccessorEvidence(
        userId,
        outcome,
        outcomes,
        receipts,
      ),
    })),
    truncated,
  }
}
