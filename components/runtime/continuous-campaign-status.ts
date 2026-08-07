import type { RecentOutcomeCompletionTimeline } from "@/components/runtime/outcome-completion-timeline"

export const CONTINUOUS_CAMPAIGN_OUTCOME_KEYS = [
  "campaign:v1-2:queue-evidence-drilldown",
  "campaign:v1-2:runtime-continuity-status",
] as const

export type ContinuousCampaignEvidenceStatus =
  | "RECORDED"
  | "PENDING"
  | "MISSING"
  | "CONFLICTING"

export type ContinuousCampaignQueueRow = Readonly<{
  outcomeKey: string
  goalRef: string | null
  title: string
  dependencyKeys: readonly string[]
  lifecycleState: string
  lifecycleLabel: string
  activatedAt: string | null
  terminalAt: string | null
  terminalResult: string | null
  terminalEvidenceId: number | null
  terminalEvidenceRefs: readonly string[]
}>

export type ContinuousCampaignQueueSurface = Readonly<{
  generatedAt: string
  rows: readonly ContinuousCampaignQueueRow[]
}>

export type ContinuousCampaignGap = Readonly<{
  code: string
  status: "MISSING" | "CONFLICTING"
  detail: string
}>

export type ContinuousCampaignStatus = Readonly<{
  phase: Readonly<{
    state: "NOT_RECORDED" | "QUEUED" | "LIVE" | "SETTLED"
    label: string
  }>
  window: Readonly<{
    status: ContinuousCampaignEvidenceStatus
    startedAt: string | null
    observedAt: string
    settledAt: string | null
  }>
  steps: readonly Readonly<{
    id:
      | "first-acquisition"
      | "first-settlement"
      | "successor-acquisition"
      | "successor-settlement"
    label: string
    outcomeKey: string
    title: string
    status: ContinuousCampaignEvidenceStatus
    at: string | null
    detail: string
  }>[]
  handoff: Readonly<{
    acquisitionStatus: ContinuousCampaignEvidenceStatus
    automationStatus: ContinuousCampaignEvidenceStatus
    receiptId: string | null
    acquiredAt: string | null
    fencingTokenRange: Readonly<{
      first: number
      latest: number
    }> | null
    detail: string
  }>
  evidenceStatus: "RECORDED" | "MISSING" | "CONFLICTING"
  gaps: readonly ContinuousCampaignGap[]
}>

type CampaignStep = ContinuousCampaignStatus["steps"][number]
type CampaignHandoff = ContinuousCampaignStatus["handoff"]

const PHASE_LABELS: Readonly<Record<ContinuousCampaignStatus["phase"]["state"], string>> = {
  NOT_RECORDED: "Not recorded",
  QUEUED: "Queued",
  LIVE: "Live",
  SETTLED: "Settled",
}

const CROSS_SOURCE_TIMESTAMP_TOLERANCE_MS = 5_000

function parsedTimestamp(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizedEvidenceReferences(references: readonly string[]): readonly string[] {
  return references.map((reference) => reference.trim()).filter(Boolean)
}

function uniqueRow(
  rows: readonly ContinuousCampaignQueueRow[],
  outcomeKey: string,
): { row: ContinuousCampaignQueueRow | null; duplicate: boolean } {
  const matches = rows.filter((row) => row.outcomeKey === outcomeKey)
  return {
    row: matches.length === 1 ? matches[0] : null,
    duplicate: matches.length > 1,
  }
}

function acquisitionStep(
  id: "first-acquisition" | "successor-acquisition",
  label: string,
  outcomeKey: string,
  row: ContinuousCampaignQueueRow | null,
  duplicate: boolean,
): CampaignStep {
  if (duplicate) {
    return {
      id,
      label,
      outcomeKey,
      title: "Conflicting campaign records",
      status: "CONFLICTING",
      at: null,
      detail: "Multiple queue records claim the same campaign outcome key.",
    }
  }
  if (row === null) {
    return {
      id,
      label,
      outcomeKey,
      title: "Campaign outcome not recorded",
      status: "MISSING",
      at: null,
      detail: "The fixed campaign outcome is absent from the persisted queue surface.",
    }
  }
  if (row.activatedAt === null) {
    const expected = row.lifecycleState === "active" || row.lifecycleState === "completed"
    return {
      id,
      label,
      outcomeKey,
      title: row.title,
      status: expected ? "MISSING" : "PENDING",
      at: null,
      detail: expected
        ? "The lifecycle requires an acquisition timestamp, but none is recorded."
        : `Acquisition is waiting while the outcome is ${row.lifecycleLabel.toLowerCase()}.`,
    }
  }
  if (parsedTimestamp(row.activatedAt) === null) {
    return {
      id,
      label,
      outcomeKey,
      title: row.title,
      status: "CONFLICTING",
      at: row.activatedAt,
      detail: "The recorded acquisition timestamp is invalid.",
    }
  }
  return {
    id,
    label,
    outcomeKey,
    title: row.title,
    status: "RECORDED",
    at: row.activatedAt,
    detail: "Persisted queue activation recorded.",
  }
}

function settlementStep(
  id: "first-settlement" | "successor-settlement",
  label: string,
  outcomeKey: string,
  row: ContinuousCampaignQueueRow | null,
  duplicate: boolean,
): CampaignStep {
  const evidenceReferences = row === null
    ? []
    : normalizedEvidenceReferences(row.terminalEvidenceRefs)
  const hasEvidenceId = row !== null
    && row.terminalEvidenceId !== null
    && Number.isSafeInteger(row.terminalEvidenceId)
    && row.terminalEvidenceId > 0

  if (duplicate) {
    return {
      id,
      label,
      outcomeKey,
      title: "Conflicting campaign records",
      status: "CONFLICTING",
      at: null,
      detail: "Multiple queue records prevent one settlement binding.",
    }
  }
  if (row === null) {
    return {
      id,
      label,
      outcomeKey,
      title: "Campaign outcome not recorded",
      status: "MISSING",
      at: null,
      detail: "Settlement cannot be evaluated without the fixed campaign outcome.",
    }
  }
  const terminalEvidenceCount = evidenceReferences.length
  if (row.lifecycleState !== "completed") {
    const hasTerminalState = row.terminalAt !== null
      || row.terminalResult !== null
      || row.terminalEvidenceId !== null
      || terminalEvidenceCount > 0
    return {
      id,
      label,
      outcomeKey,
      title: row.title,
      status: hasTerminalState ? "CONFLICTING" : "PENDING",
      at: row.terminalAt,
      detail: hasTerminalState
        ? "Terminal evidence exists while the queue lifecycle is not completed."
        : `Settlement is pending while the outcome is ${row.lifecycleLabel.toLowerCase()}.`,
    }
  }

  const terminalAt = parsedTimestamp(row.terminalAt)
  const activatedAt = parsedTimestamp(row.activatedAt)
  if (row.terminalAt !== null && terminalAt === null) {
    return {
      id,
      label,
      outcomeKey,
      title: row.title,
      status: "CONFLICTING",
      at: row.terminalAt,
      detail: "The recorded settlement timestamp is invalid.",
    }
  }
  if (terminalAt !== null && activatedAt !== null && terminalAt < activatedAt) {
    return {
      id,
      label,
      outcomeKey,
      title: row.title,
      status: "CONFLICTING",
      at: row.terminalAt,
      detail: "Settlement timing predates acquisition.",
    }
  }
  if (
    terminalAt === null
    || row.terminalResult?.trim() === ""
    || row.terminalResult === null
    || (!hasEvidenceId && evidenceReferences.length === 0)
  ) {
    return {
      id,
      label,
      outcomeKey,
      title: row.title,
      status: "MISSING",
      at: row.terminalAt,
      detail: "Completed lifecycle is missing a terminal time, result, or evidence reference.",
    }
  }
  return {
    id,
    label,
    outcomeKey,
    title: row.title,
    status: "RECORDED",
    at: row.terminalAt,
    detail: `${row.terminalResult} with ${evidenceReferences.length + (hasEvidenceId ? 1 : 0)} evidence reference${evidenceReferences.length + (hasEvidenceId ? 1 : 0) === 1 ? "" : "s"}.`,
  }
}

function projectHandoff(
  predecessor: ContinuousCampaignQueueRow | null,
  successor: ContinuousCampaignQueueRow | null,
  predecessorSettlement: CampaignStep,
  successorAcquisition: CampaignStep,
  timeline: RecentOutcomeCompletionTimeline,
): CampaignHandoff {
  if (predecessorSettlement.status === "CONFLICTING"
    || successorAcquisition.status === "CONFLICTING") {
    return {
      acquisitionStatus: "CONFLICTING",
      automationStatus: "CONFLICTING",
      receiptId: null,
      acquiredAt: successorAcquisition.at,
      fencingTokenRange: null,
      detail: "Successor dependency or timing conflicts with the predecessor settlement.",
    }
  }
  if (predecessorSettlement.status === "MISSING") {
    return {
      acquisitionStatus: "MISSING",
      automationStatus: "MISSING",
      receiptId: null,
      acquiredAt: successorAcquisition.at,
      fencingTokenRange: null,
      detail: "Predecessor settlement evidence is missing, so successor continuity cannot be proven.",
    }
  }
  if (predecessorSettlement.status === "PENDING") {
    return {
      acquisitionStatus: "PENDING",
      automationStatus: "PENDING",
      receiptId: null,
      acquiredAt: successorAcquisition.at,
      fencingTokenRange: null,
      detail: "Successor handoff is waiting for predecessor settlement.",
    }
  }

  const [predecessorKey, successorKey] = CONTINUOUS_CAMPAIGN_OUTCOME_KEYS
  const queueCompletedAt = parsedTimestamp(predecessor?.terminalAt ?? null)
  const queueAcquiredAt = parsedTimestamp(successor?.activatedAt ?? null)
  const dependencyStillDeclared = successor?.dependencyKeys.includes(predecessorKey) ?? false

  if (
    successorAcquisition.status === "RECORDED"
    && (!dependencyStillDeclared
      || queueCompletedAt === null
      || queueAcquiredAt === null
      || queueAcquiredAt < queueCompletedAt)
  ) {
    return {
      acquisitionStatus: "CONFLICTING",
      automationStatus: "CONFLICTING",
      receiptId: null,
      acquiredAt: successorAcquisition.at,
      fencingTokenRange: null,
      detail: "The persisted queue dependency or acquisition timing conflicts with predecessor settlement.",
    }
  }

  const matchingRows = timeline.rows.filter((row) => row.outcomeKey === predecessorKey)
  if (matchingRows.length > 1) {
    return {
      acquisitionStatus: "CONFLICTING",
      automationStatus: "CONFLICTING",
      receiptId: null,
      acquiredAt: successorAcquisition.at,
      fencingTokenRange: null,
      detail: "Multiple completion rows conflict for the predecessor campaign outcome.",
    }
  }

  const completionRow = matchingRows[0]
  if (!completionRow) {
    const status = successorAcquisition.status === "PENDING" ? "PENDING" : "MISSING"
    return {
      acquisitionStatus: status,
      automationStatus: status,
      receiptId: null,
      acquiredAt: successorAcquisition.at,
      fencingTokenRange: null,
      detail: timeline.truncated
        ? "The bounded completion timeline is truncated before the predecessor row, so qualifying acquisition receipt proof is not exposed; this does not show that no receipt exists."
        : "The completion timeline does not expose the predecessor row, so qualifying acquisition receipt proof cannot be evaluated.",
    }
  }

  const evidence = completionRow.successorEvidence
  if (evidence?.status === "CONFLICTING") {
    return {
      acquisitionStatus: "CONFLICTING",
      automationStatus: "CONFLICTING",
      receiptId: null,
      acquiredAt: successorAcquisition.at,
      fencingTokenRange: null,
      detail: "Acquisition-time dependency or predecessor timing evidence conflicts.",
    }
  }
  if (evidence?.status !== "RECORDED") {
    const status = successorAcquisition.status === "PENDING" ? "PENDING" : "MISSING"
    return {
      acquisitionStatus: status,
      automationStatus: status,
      receiptId: null,
      acquiredAt: successorAcquisition.at,
      fencingTokenRange: null,
      detail: status === "MISSING"
        ? successorAcquisition.status === "RECORDED"
          ? "Queue activation exists, but no qualifying acquisition receipt is recorded."
          : "The successor outcome or its qualifying acquisition receipt is missing."
        : "No qualifying successor acquisition is recorded yet.",
    }
  }

  const receiptAcquiredAt = parsedTimestamp(evidence.acquiredAt)
  const receiptId = evidence.receiptId?.trim() || null
  const fencingTokenRange = evidence.fencingTokenRange
  const validFencingTokenRange = fencingTokenRange !== null
    && Number.isSafeInteger(fencingTokenRange.first)
    && fencingTokenRange.first > 0
    && Number.isSafeInteger(fencingTokenRange.latest)
    && fencingTokenRange.latest >= fencingTokenRange.first
  const exactSuccessor = evidence.outcomeKey === successorKey
    && receiptId !== null
    && validFencingTokenRange
  const receiptOrdered = receiptAcquiredAt !== null
    && queueCompletedAt !== null
    && receiptAcquiredAt >= queueCompletedAt
  const observationsAgree = receiptAcquiredAt !== null
    && queueAcquiredAt !== null
    && Math.abs(receiptAcquiredAt - queueAcquiredAt) <= CROSS_SOURCE_TIMESTAMP_TOLERANCE_MS

  if (!exactSuccessor) {
    return {
      acquisitionStatus: "CONFLICTING",
      automationStatus: "CONFLICTING",
      receiptId,
      acquiredAt: evidence.acquiredAt,
      fencingTokenRange,
      detail: "The completion timeline binds the predecessor to a conflicting successor receipt.",
    }
  }

  if (!receiptOrdered || !observationsAgree) {
    return {
      acquisitionStatus: "MISSING",
      automationStatus: "MISSING",
      receiptId: evidence.receiptId,
      acquiredAt: evidence.acquiredAt,
      fencingTokenRange: evidence.fencingTokenRange,
      detail: "Queue and completion observations are not snapshot-bound, so cross-source continuity is not yet proven.",
    }
  }

  return {
    acquisitionStatus: "RECORDED",
    automationStatus: "MISSING",
    receiptId,
    acquiredAt: evidence.acquiredAt,
    fencingTokenRange,
    detail: "Successor acquisition is recorded; automatic-trigger and zero-owner-contact proof are not exposed.",
  }
}

function gapForStep(step: CampaignStep): ContinuousCampaignGap | null {
  if (step.status !== "MISSING" && step.status !== "CONFLICTING") return null
  return {
    code: `${step.id.replace(/-/g, "_").toUpperCase()}_${step.status}`,
    status: step.status,
    detail: step.detail,
  }
}

export function projectContinuousCampaignStatus(
  queueSurface: ContinuousCampaignQueueSurface,
  timeline: RecentOutcomeCompletionTimeline,
): ContinuousCampaignStatus {
  const [predecessorKey, successorKey] = CONTINUOUS_CAMPAIGN_OUTCOME_KEYS
  const predecessorMatch = uniqueRow(queueSurface.rows, predecessorKey)
  const successorMatch = uniqueRow(queueSurface.rows, successorKey)

  const firstAcquisition = acquisitionStep(
    "first-acquisition",
    "First outcome · Acquisition",
    predecessorKey,
    predecessorMatch.row,
    predecessorMatch.duplicate,
  )
  const firstSettlement = settlementStep(
    "first-settlement",
    "First outcome · Settlement",
    predecessorKey,
    predecessorMatch.row,
    predecessorMatch.duplicate,
  )
  const rawSuccessorAcquisition = acquisitionStep(
    "successor-acquisition",
    "Successor · Acquisition",
    successorKey,
    successorMatch.row,
    successorMatch.duplicate,
  )
  const successorSettlement = settlementStep(
    "successor-settlement",
    "Successor · Settlement",
    successorKey,
    successorMatch.row,
    successorMatch.duplicate,
  )
  const handoff = projectHandoff(
    predecessorMatch.row,
    successorMatch.row,
    firstSettlement,
    rawSuccessorAcquisition,
    timeline,
  )
  const successorAcquisition: CampaignStep = {
    ...rawSuccessorAcquisition,
    status: handoff.acquisitionStatus === "CONFLICTING"
      ? "CONFLICTING"
      : rawSuccessorAcquisition.status,
    detail: handoff.acquisitionStatus === "CONFLICTING"
      ? handoff.detail
      : rawSuccessorAcquisition.detail,
  }
  const steps = [
    firstAcquisition,
    firstSettlement,
    successorAcquisition,
    successorSettlement,
  ] as const

  const campaignRowsPresent = queueSurface.rows.some((row) => (
    row.outcomeKey === predecessorKey || row.outcomeKey === successorKey
  ))
  const settlementsRecorded = firstSettlement.status === "RECORDED"
    && successorSettlement.status === "RECORDED"
  const campaignHasActivity = predecessorMatch.row?.activatedAt != null
    || successorMatch.row?.activatedAt != null
    || predecessorMatch.row?.lifecycleState === "active"
    || successorMatch.row?.lifecycleState === "active"
    || predecessorMatch.row?.lifecycleState === "completed"
    || successorMatch.row?.lifecycleState === "completed"
  const phaseState: ContinuousCampaignStatus["phase"]["state"] = !campaignRowsPresent
    ? "NOT_RECORDED"
    : settlementsRecorded
      ? "SETTLED"
      : campaignHasActivity
        ? "LIVE"
        : "QUEUED"

  const gaps: ContinuousCampaignGap[] = []
  // Campaign identity is not exposed by this read path, so at least one
  // fail-closed evidence gap remains until that durable binding is available.
  if (campaignRowsPresent) {
    gaps.push({
      code: "CAMPAIGN_WINDOW_IDENTITY_MISSING",
      status: "MISSING",
      detail: "Campaign identity is missing because campaignWindowId is not exposed by this Runtime read path.",
    })
  } else {
    gaps.push({
      code: "CAMPAIGN_RECORDS_MISSING",
      status: "MISSING",
      detail: "Neither fixed campaign outcome is present in the persisted queue surface.",
    })
  }
  for (const step of steps) {
    const gap = gapForStep(step)
    if (gap) gaps.push(gap)
  }
  if (handoff.acquisitionStatus === "MISSING") {
    gaps.push({
      code: "SUCCESSOR_ACQUISITION_EVIDENCE_MISSING",
      status: "MISSING",
      detail: handoff.detail,
    })
  } else if (handoff.acquisitionStatus === "CONFLICTING") {
    gaps.push({
      code: "SUCCESSOR_ACQUISITION_EVIDENCE_CONFLICTING",
      status: "CONFLICTING",
      detail: handoff.detail,
    })
  }
  if (handoff.acquisitionStatus === "RECORDED") {
    gaps.push({
      code: "AUTOMATIC_HANDOFF_PROOF_MISSING",
      status: "MISSING",
      detail: "Automatic-trigger proof is missing, and zero-owner-contact proof is missing from this Runtime read path.",
    })
  }

  const hasConflict = gaps.some((gap) => gap.status === "CONFLICTING")
  const startedAt = firstAcquisition.status === "RECORDED" ? firstAcquisition.at : null
  const settledAt = successorSettlement.status === "RECORDED" ? successorSettlement.at : null

  return {
    phase: {
      state: phaseState,
      label: PHASE_LABELS[phaseState],
    },
    window: {
      status: hasConflict ? "CONFLICTING" : "MISSING",
      startedAt,
      observedAt: queueSurface.generatedAt,
      settledAt,
    },
    steps,
    handoff,
    evidenceStatus: hasConflict ? "CONFLICTING" : gaps.length > 0 ? "MISSING" : "RECORDED",
    gaps,
  }
}
