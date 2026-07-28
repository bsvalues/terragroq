import {
  isLeaseStale,
  selectNextOutcome,
  type NoSelectionReason,
  type OutcomeIneligibilityReason,
  type OutcomeLifecycleState,
  type OutcomeQueueRecord,
  type OutcomeTime,
  type SelectOutcomeOptions,
} from "./engine"

export type OutcomeQueueSurfaceState =
  | "EMPTY"
  | "READY"
  | "ACTIVE"
  | "RECOVERY_READY"
  | "BLOCKED"
  | "ALL_TERMINAL"

export type OutcomeQueueSurfaceReason =
  | NoSelectionReason
  | "NEXT_OUTCOME_ELIGIBLE"
  | "STALE_LEASE_RECOVERY_ELIGIBLE"

export interface OutcomeQueueLifecycleCounts {
  suggested: number
  approved: number
  blocked: number
  active: number
  completed: number
  declined: number
  superseded: number
}

export interface OutcomeQueueOperatorRow {
  id: number | null
  userId: string
  outcomeKey: string
  goalId: number | null
  goalRef: string | null
  title: string
  objective: string | null
  queueOrder: number
  dependencyKeys: readonly string[]
  dependencyGaps: readonly string[]
  riskClass: string
  riskLabel: string
  approvalState: OutcomeQueueRecord["approvalState"]
  approvalLabel: string
  approvedBy: string | null
  approvedAt: string | null
  approvalDecisionId: number | null
  availableApprovalDecisionId: number | null
  authorityState: OutcomeQueueRecord["authorityState"]
  authorityLabel: string
  authorityLevel: string
  authorityGrantRef: string | null
  availableAuthorityGrantRef: string | null
  authoritySubject: string
  authorityAction: string
  lifecycleState: OutcomeLifecycleState
  lifecycleLabel: string
  lifecycleReason: string | null
  activeWorkOrderId: number | null
  leaseHolder: string | null
  leaseExpiresAt: string | null
  staleLease: boolean
  version: number
  terminalResult: string | null
  terminalEvidenceId: number | null
  terminalEvidenceRefs: readonly string[]
  suggestedAt: string | null
  activatedAt: string | null
  terminalAt: string | null
  createdAt: string | null
  updatedAt: string | null
  isActive: boolean
  isNextEligible: boolean
  nextMode: "ACTIVATE" | "RECOVER_STALE_LEASE" | null
  blockerReasons: readonly OutcomeIneligibilityReason[]
  blockerLabels: readonly string[]
}

export interface OutcomeQueueOperatorSurface {
  generatedAt: string
  state: OutcomeQueueSurfaceState
  stateLabel: string
  reason: OutcomeQueueSurfaceReason
  reasonLabel: string
  rows: readonly OutcomeQueueOperatorRow[]
  activeItem: OutcomeQueueOperatorRow | null
  nextEligibleItem: OutcomeQueueOperatorRow | null
  nextEligibleMode: "ACTIVATE" | "RECOVER_STALE_LEASE" | null
  nextEligibleModeLabel: string | null
  countsByLifecycle: OutcomeQueueLifecycleCounts
  counts: {
    total: number
    nonTerminal: number
    terminal: number
  }
}

export interface OutcomeQueueOperatorSurfaceInput extends SelectOutcomeOptions {
  queue: readonly OutcomeQueueRecord[]
  availableApprovalDecisionIdsByOutcomeKey?: Readonly<Record<string, readonly number[]>>
  availableAuthorityGrantRefsByOutcomeKey?: Readonly<Record<string, readonly string[]>>
}

const LIFECYCLE_LABELS: Readonly<Record<OutcomeLifecycleState, string>> = {
  suggested: "Suggested",
  approved: "Approved",
  blocked: "Blocked",
  active: "Active",
  completed: "Completed",
  declined: "Declined",
  superseded: "Superseded",
}

const APPROVAL_LABELS: Readonly<Record<OutcomeQueueRecord["approvalState"], string>> = {
  unapproved: "Awaiting approval",
  approved: "Approved",
  revoked: "Approval revoked",
}

const AUTHORITY_LABELS: Readonly<Record<OutcomeQueueRecord["authorityState"], string>> = {
  unverified: "Authority unverified",
  matched: "Authority matched",
  denied: "Authority denied",
  expired: "Authority expired",
  revoked: "Authority revoked",
}

const BLOCKER_LABELS: Readonly<Record<OutcomeIneligibilityReason, string>> = {
  LIFECYCLE_INELIGIBLE: "Lifecycle is not eligible",
  APPROVAL_REQUIRED: "Accepted approval is required",
  AUTHORITY_NOT_MATCHED: "Live authority is not matched",
  DEPENDENCY_NOT_COMPLETED: "Dependencies are not completed",
  RISK_NOT_ALLOWED: "Risk class is not allowed",
  LEASE_NOT_STALE: "An active lease is still held",
}

const STATE_LABELS: Readonly<Record<OutcomeQueueSurfaceState, string>> = {
  EMPTY: "Queue empty",
  READY: "Next outcome ready",
  ACTIVE: "Outcome active",
  RECOVERY_READY: "Stale lease recovery ready",
  BLOCKED: "Queue blocked",
  ALL_TERMINAL: "All outcomes terminal",
}

const REASON_LABELS: Readonly<Record<OutcomeQueueSurfaceReason, string>> = {
  EMPTY_QUEUE: "No outcomes are queued",
  ACTIVE_LEASE_HELD: "The active outcome holds a live lease",
  DEPENDENCIES_UNSATISFIED: "Queued outcomes are waiting on dependencies",
  AUTHORITY_INELIGIBLE: "Queued outcomes do not have live matched authority",
  AWAITING_APPROVAL: "Queued outcomes are awaiting accepted approval",
  RISK_INELIGIBLE: "Queued outcomes exceed the allowed risk classes",
  ONLY_BLOCKED_OUTCOMES: "Only blocked outcomes remain",
  ALL_OUTCOMES_TERMINAL: "Every queued outcome is terminal",
  NO_ELIGIBLE_OUTCOME: "No queued outcome is currently eligible",
  NEXT_OUTCOME_ELIGIBLE: "The next outcome is eligible for activation",
  STALE_LEASE_RECOVERY_ELIGIBLE: "The stale active outcome is eligible for recovery",
}

function milliseconds(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid outcome queue timestamp: ${String(value)}`)
  return parsed
}

function timestamp(value: OutcomeTime): string | null {
  return value === null ? null : new Date(milliseconds(value)).toISOString()
}

function compareOutcomes(left: OutcomeQueueRecord, right: OutcomeQueueRecord): number {
  if (left.queueOrder !== right.queueOrder) return left.queueOrder - right.queueOrder
  const created = milliseconds(left.createdAt ?? left.suggestedAt ?? "1970-01-01T00:00:00.000Z")
    - milliseconds(right.createdAt ?? right.suggestedAt ?? "1970-01-01T00:00:00.000Z")
  if (created !== 0) return created
  return left.outcomeKey.localeCompare(right.outcomeKey)
}

function blockersFor(
  item: OutcomeQueueRecord,
  byKey: ReadonlyMap<string, OutcomeQueueRecord>,
  liveActive: OutcomeQueueRecord | undefined,
  options: SelectOutcomeOptions,
): { reasons: OutcomeIneligibilityReason[]; dependencyGaps: string[] } {
  const allowedRisks = new Set(options.allowedRiskClasses ?? ["R0", "R1"])
  const validApprovals = new Set(options.validApprovalDecisionIds ?? [])
  const validGrants = new Set(options.validAuthorityGrantRefs ?? [])
  const reasons: OutcomeIneligibilityReason[] = []
  const dependencyGaps = [...new Set(item.dependencyKeys)]
    .filter((key) => byKey.get(key)?.lifecycleState !== "completed")
    .sort()

  if (item.lifecycleState !== "approved" && !isLeaseStale(item, options.now)) {
    reasons.push("LIFECYCLE_INELIGIBLE")
  }
  if (
    item.approvalState !== "approved"
    || item.approvalDecisionId === null
    || !validApprovals.has(item.approvalDecisionId)
  ) {
    reasons.push("APPROVAL_REQUIRED")
  }
  if (
    item.authorityState !== "matched"
    || item.authorityGrantRef === null
    || !validGrants.has(item.authorityGrantRef)
  ) {
    reasons.push("AUTHORITY_NOT_MATCHED")
  }
  if (dependencyGaps.length > 0) reasons.push("DEPENDENCY_NOT_COMPLETED")
  if (!allowedRisks.has(item.riskClass)) reasons.push("RISK_NOT_ALLOWED")
  if (liveActive) reasons.push("LEASE_NOT_STALE")

  return { reasons, dependencyGaps }
}

function lifecycleCounts(queue: readonly OutcomeQueueRecord[]): OutcomeQueueLifecycleCounts {
  const counts: OutcomeQueueLifecycleCounts = {
    suggested: 0,
    approved: 0,
    blocked: 0,
    active: 0,
    completed: 0,
    declined: 0,
    superseded: 0,
  }
  for (const item of queue) counts[item.lifecycleState] += 1
  return counts
}

function queueState(
  selection: ReturnType<typeof selectNextOutcome>,
  hasLiveActive: boolean,
): {
  state: OutcomeQueueSurfaceState
  reason: OutcomeQueueSurfaceReason
} {
  if (selection.selected) {
    return selection.mode === "RECOVER_STALE_LEASE"
      ? { state: "RECOVERY_READY", reason: "STALE_LEASE_RECOVERY_ELIGIBLE" }
      : { state: "READY", reason: "NEXT_OUTCOME_ELIGIBLE" }
  }
  if (selection.reason === "EMPTY_QUEUE") return { state: "EMPTY", reason: selection.reason }
  if (selection.reason === "ALL_OUTCOMES_TERMINAL") {
    return { state: "ALL_TERMINAL", reason: selection.reason }
  }
  if (hasLiveActive) return { state: "ACTIVE", reason: selection.reason }
  return { state: "BLOCKED", reason: selection.reason }
}

export function projectOutcomeQueueOperatorSurface(
  input: OutcomeQueueOperatorSurfaceInput,
): OutcomeQueueOperatorSurface {
  const generatedAt = timestamp(input.now)
  if (generatedAt === null) throw new Error("Outcome queue projection requires a current timestamp")

  const ordered = [...input.queue].sort(compareOutcomes)
  const byKey = new Map(ordered.map((item) => [item.outcomeKey, item]))
  const liveActive = ordered.find(
    (item) => item.lifecycleState === "active" && !isLeaseStale(item, input.now),
  )
  const selection = selectNextOutcome(ordered, input)
  const nextItem = selection.selected ? selection.item : null
  const nextMode = selection.selected ? selection.mode : null

  const rows = ordered.map((item): OutcomeQueueOperatorRow => {
    const { reasons, dependencyGaps } = blockersFor(item, byKey, liveActive, input)
    const isNextEligible = nextItem === item
    const staleLease = isLeaseStale(item, input.now)

    return {
      id: item.id ?? null,
      userId: item.userId,
      outcomeKey: item.outcomeKey,
      goalId: item.goalId,
      goalRef: item.goalRef,
      title: item.title,
      objective: item.objective,
      queueOrder: item.queueOrder,
      dependencyKeys: [...item.dependencyKeys],
      dependencyGaps,
      riskClass: item.riskClass,
      riskLabel: item.riskClass,
      approvalState: item.approvalState,
      approvalLabel: APPROVAL_LABELS[item.approvalState],
      approvedBy: item.approvedBy,
      approvedAt: timestamp(item.approvedAt),
      approvalDecisionId: item.approvalDecisionId,
      availableApprovalDecisionId:
        input.availableApprovalDecisionIdsByOutcomeKey?.[item.outcomeKey]?.[0] ?? null,
      authorityState: item.authorityState,
      authorityLabel: AUTHORITY_LABELS[item.authorityState],
      authorityLevel: item.authorityLevel,
      authorityGrantRef: item.authorityGrantRef,
      availableAuthorityGrantRef:
        input.availableAuthorityGrantRefsByOutcomeKey?.[item.outcomeKey]?.[0] ?? null,
      authoritySubject: item.authoritySubject,
      authorityAction: item.authorityAction,
      lifecycleState: item.lifecycleState,
      lifecycleLabel: LIFECYCLE_LABELS[item.lifecycleState],
      lifecycleReason: item.lifecycleReason,
      activeWorkOrderId: item.activeWorkOrderId,
      leaseHolder: item.leaseHolder,
      leaseExpiresAt: timestamp(item.leaseExpiresAt),
      staleLease,
      version: item.version,
      terminalResult: item.terminalResult,
      terminalEvidenceId: item.terminalEvidenceId,
      terminalEvidenceRefs: [...item.terminalEvidenceRefs],
      suggestedAt: timestamp(item.suggestedAt),
      activatedAt: timestamp(item.activatedAt),
      terminalAt: timestamp(item.terminalAt),
      createdAt: timestamp(item.createdAt),
      updatedAt: timestamp(item.updatedAt),
      isActive: item.lifecycleState === "active",
      isNextEligible,
      nextMode: isNextEligible ? nextMode : null,
      blockerReasons: isNextEligible ? [] : reasons,
      blockerLabels: isNextEligible ? [] : reasons.map((reason) => BLOCKER_LABELS[reason]),
    }
  })

  const activeItem = rows.find((row) => row.isActive) ?? null
  const nextEligibleItem = rows.find((row) => row.isNextEligible) ?? null
  const countsByLifecycle = lifecycleCounts(ordered)
  const terminal = countsByLifecycle.completed
    + countsByLifecycle.declined
    + countsByLifecycle.superseded
  const status = queueState(selection, liveActive !== undefined)

  return {
    generatedAt,
    state: status.state,
    stateLabel: STATE_LABELS[status.state],
    reason: status.reason,
    reasonLabel: REASON_LABELS[status.reason],
    rows,
    activeItem,
    nextEligibleItem,
    nextEligibleMode: nextMode,
    nextEligibleModeLabel: nextMode === "ACTIVATE"
      ? "Activate next outcome"
      : nextMode === "RECOVER_STALE_LEASE"
        ? "Recover stale lease"
        : null,
    countsByLifecycle,
    counts: {
      total: ordered.length,
      nonTerminal: ordered.length - terminal,
      terminal,
    },
  }
}

export const buildOutcomeQueueOperatorSurface = projectOutcomeQueueOperatorSurface
