import {
  LEGAL_OUTCOME_TRANSITIONS as SHARED_LEGAL_OUTCOME_TRANSITIONS,
  mapLegacyLifecycleState,
  mapLegacyRiskClass,
  OUTCOME_LIFECYCLE_STATES as SHARED_OUTCOME_LIFECYCLE_STATES,
  TERMINAL_OUTCOME_STATES as SHARED_TERMINAL_OUTCOME_STATES,
} from "./contract.mjs"

export const OUTCOME_LIFECYCLE_STATES = SHARED_OUTCOME_LIFECYCLE_STATES as readonly [
  "suggested",
  "approved",
  "blocked",
  "active",
  "completed",
  "declined",
  "superseded",
]

export type OutcomeLifecycleState = (typeof OUTCOME_LIFECYCLE_STATES)[number]
export type OutcomeApprovalState = "unapproved" | "approved" | "revoked"
export type OutcomeAuthorityState = "unverified" | "matched" | "denied" | "expired" | "revoked"
export type OutcomeTime = Date | string | null

export interface OutcomeQueueRecord {
  id?: number
  userId: string
  outcomeKey: string
  goalId: number | null
  goalRef: string | null
  title: string
  objective: string | null
  queueOrder: number
  dependencyKeys: readonly string[]
  riskClass: string
  approvalState: OutcomeApprovalState
  approvedBy: string | null
  approvedAt: OutcomeTime
  approvalDecisionId: number | null
  authorityState: OutcomeAuthorityState
  authorityLevel: string
  authorityGrantRef: string | null
  authoritySubject: string
  authorityAction: string
  lifecycleState: OutcomeLifecycleState
  lifecycleReason: string | null
  activeWorkOrderId: number | null
  executionBinding: string | null
  leaseHolder: string | null
  leaseToken: string | null
  leaseExpiresAt: OutcomeTime
  fencingToken: number
  version: number
  acquisitionKey: string | null
  terminalResult: string | null
  terminalEvidenceId: number | null
  terminalEvidenceRefs: readonly string[]
  terminalKey: string | null
  suggestedAt: OutcomeTime
  activatedAt: OutcomeTime
  terminalAt: OutcomeTime
  createdAt: OutcomeTime
  updatedAt: OutcomeTime
}

export const LEGAL_OUTCOME_TRANSITIONS = SHARED_LEGAL_OUTCOME_TRANSITIONS as Readonly<
  Record<OutcomeLifecycleState, readonly OutcomeLifecycleState[]>
>

export const TERMINAL_OUTCOME_STATES = SHARED_TERMINAL_OUTCOME_STATES as readonly [
  "completed",
  "declined",
  "superseded",
]

export type NoSelectionReason =
  | "EMPTY_QUEUE"
  | "ACTIVE_LEASE_HELD"
  | "DEPENDENCIES_UNSATISFIED"
  | "AUTHORITY_INELIGIBLE"
  | "AWAITING_APPROVAL"
  | "RISK_INELIGIBLE"
  | "ONLY_BLOCKED_OUTCOMES"
  | "ALL_OUTCOMES_TERMINAL"
  | "NO_ELIGIBLE_OUTCOME"

export type OutcomeIneligibilityReason =
  | "LIFECYCLE_INELIGIBLE"
  | "APPROVAL_REQUIRED"
  | "AUTHORITY_NOT_MATCHED"
  | "DEPENDENCY_NOT_COMPLETED"
  | "RISK_NOT_ALLOWED"
  | "LEASE_NOT_STALE"

export interface OutcomeSelectionBlocker {
  outcomeKey: string
  reasons: readonly OutcomeIneligibilityReason[]
  dependencyKeys: readonly string[]
}

export type OutcomeSelection =
  | {
      selected: true
      mode: "ACTIVATE" | "RECOVER_STALE_LEASE"
      item: OutcomeQueueRecord
      staleLease: boolean
    }
  | {
      selected: false
      reason: NoSelectionReason
      blockers: readonly OutcomeSelectionBlocker[]
    }

export interface SelectOutcomeOptions {
  now: Date | string
  allowedRiskClasses?: readonly string[]
  validApprovalDecisionIds?: readonly number[]
  validAuthorityGrantRefs?: readonly string[]
}

export type OutcomeMutationError =
  | "ILLEGAL_TRANSITION"
  | "ACQUISITION_REQUIRED"
  | "APPROVAL_EVIDENCE_REQUIRED"
  | "VERSION_CONFLICT"
  | "FENCE_MISMATCH"
  | "LEASE_NOT_STALE"
  | "LEASE_ALREADY_HELD"
  | "ACQUISITION_KEY_CONFLICT"
  | "ACQUISITION_INPUT_INVALID"
  | "OUTCOME_INELIGIBLE"
  | "TERMINAL_EVIDENCE_REQUIRED"
  | "TERMINAL_KEY_CONFLICT"

export type OutcomeMutationResult =
  | { ok: true; item: OutcomeQueueRecord; replayed: boolean }
  | { ok: false; reason: OutcomeMutationError; item: OutcomeQueueRecord }

export interface OutcomeFence {
  executionBinding: string
  leaseToken: string
  fencingToken: number
}

function milliseconds(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid outcome queue timestamp: ${String(value)}`)
  return parsed
}

function iso(value: Date | string): string {
  return new Date(milliseconds(value)).toISOString()
}

function isTerminal(state: OutcomeLifecycleState): boolean {
  return (TERMINAL_OUTCOME_STATES as readonly OutcomeLifecycleState[]).includes(state)
}

export function isLeaseStale(item: OutcomeQueueRecord, now: Date | string): boolean {
  return item.lifecycleState === "active"
    && item.leaseExpiresAt !== null
    && milliseconds(item.leaseExpiresAt) <= milliseconds(now)
}

export function canTransitionOutcome(
  from: OutcomeLifecycleState,
  to: OutcomeLifecycleState,
): boolean {
  return (LEGAL_OUTCOME_TRANSITIONS[from] as readonly OutcomeLifecycleState[]).includes(to)
}

function compareOutcomes(left: OutcomeQueueRecord, right: OutcomeQueueRecord): number {
  if (left.queueOrder !== right.queueOrder) return left.queueOrder - right.queueOrder
  const created = milliseconds(left.createdAt ?? left.suggestedAt ?? "1970-01-01T00:00:00.000Z")
    - milliseconds(right.createdAt ?? right.suggestedAt ?? "1970-01-01T00:00:00.000Z")
  if (created !== 0) return created
  return left.outcomeKey.localeCompare(right.outcomeKey)
}

function dependencyState(
  item: OutcomeQueueRecord,
  byKey: ReadonlyMap<string, OutcomeQueueRecord>,
): { satisfied: boolean; missing: string[] } {
  const missing = [...new Set(item.dependencyKeys)]
    .filter((key) => byKey.get(key)?.lifecycleState !== "completed")
    .sort()
  return { satisfied: missing.length === 0, missing }
}

function primaryNoSelectionReason(
  queue: readonly OutcomeQueueRecord[],
  blockers: readonly OutcomeSelectionBlocker[],
  allowedRisks: ReadonlySet<string>,
  validApprovalDecisionIds: ReadonlySet<number>,
  validAuthorityGrantRefs: ReadonlySet<string>,
): NoSelectionReason {
  if (queue.length === 0) return "EMPTY_QUEUE"
  if (queue.every((item) => isTerminal(item.lifecycleState))) return "ALL_OUTCOMES_TERMINAL"
  const nonterminal = queue.filter((item) => !isTerminal(item.lifecycleState))
  if (nonterminal.every((item) =>
    item.approvalState !== "approved"
    || item.approvalDecisionId === null
    || !validApprovalDecisionIds.has(item.approvalDecisionId)
  )) {
    return "AWAITING_APPROVAL"
  }
  const approved = nonterminal.filter((item) =>
    item.approvalState === "approved"
    && item.approvalDecisionId !== null
    && validApprovalDecisionIds.has(item.approvalDecisionId)
  )
  if (approved.every((item) =>
    item.authorityState !== "matched"
    || item.authorityGrantRef === null
    || !validAuthorityGrantRefs.has(item.authorityGrantRef)
  )) {
    return "AUTHORITY_INELIGIBLE"
  }
  const authorized = approved.filter((item) =>
    item.authorityState === "matched"
    && item.authorityGrantRef !== null
    && validAuthorityGrantRefs.has(item.authorityGrantRef)
  )
  if (authorized.every((item) => !allowedRisks.has(item.riskClass))) {
    return "RISK_INELIGIBLE"
  }
  const riskEligible = authorized.filter((item) => allowedRisks.has(item.riskClass))
  const blockersByKey = new Map(blockers.map((blocker) => [blocker.outcomeKey, blocker]))
  if (
    riskEligible.every((item) =>
      blockersByKey.get(item.outcomeKey)?.reasons.includes("DEPENDENCY_NOT_COMPLETED"))
  ) {
    return "DEPENDENCIES_UNSATISFIED"
  }
  if (blockers.some((blocker) => blocker.reasons.includes("LEASE_NOT_STALE"))) {
    return "ACTIVE_LEASE_HELD"
  }
  if (queue.some((item) => item.lifecycleState === "blocked")) return "ONLY_BLOCKED_OUTCOMES"
  return "NO_ELIGIBLE_OUTCOME"
}

export function selectNextOutcome(
  queue: readonly OutcomeQueueRecord[],
  options: SelectOutcomeOptions,
): OutcomeSelection {
  const ordered = [...queue].sort(compareOutcomes)
  const byKey = new Map(ordered.map((item) => [item.outcomeKey, item]))
  const allowedRisks = new Set(options.allowedRiskClasses ?? ["R0", "R1"])
  const validApprovalDecisionIds = new Set(options.validApprovalDecisionIds ?? [])
  const validAuthorityGrantRefs = new Set(options.validAuthorityGrantRefs ?? [])
  const blockers: OutcomeSelectionBlocker[] = []

  const liveActive = ordered.find(
    (item) => item.lifecycleState === "active" && !isLeaseStale(item, options.now),
  )

  for (const item of ordered) {
    const reasons: OutcomeIneligibilityReason[] = []
    const activationCandidate = item.lifecycleState === "approved"
    const recoveryCandidate = isLeaseStale(item, options.now)
    const dependencies = dependencyState(item, byKey)

    if (!activationCandidate && !recoveryCandidate) reasons.push("LIFECYCLE_INELIGIBLE")
    if (
      item.approvalState !== "approved"
      || item.approvalDecisionId === null
      || !validApprovalDecisionIds.has(item.approvalDecisionId)
    ) {
      reasons.push("APPROVAL_REQUIRED")
    }
    if (
      item.authorityState !== "matched"
      || item.authorityGrantRef === null
      || !validAuthorityGrantRefs.has(item.authorityGrantRef)
    ) {
      reasons.push("AUTHORITY_NOT_MATCHED")
    }
    if (!dependencies.satisfied) reasons.push("DEPENDENCY_NOT_COMPLETED")
    if (!allowedRisks.has(item.riskClass)) reasons.push("RISK_NOT_ALLOWED")
    if (liveActive) reasons.push("LEASE_NOT_STALE")

    if (reasons.length === 0) {
      return {
        selected: true,
        mode: recoveryCandidate ? "RECOVER_STALE_LEASE" : "ACTIVATE",
        item,
        staleLease: recoveryCandidate,
      }
    }
    blockers.push({
      outcomeKey: item.outcomeKey,
      reasons,
      dependencyKeys: dependencies.missing,
    })
  }

  return {
    selected: false,
    reason: primaryNoSelectionReason(
      ordered,
      blockers,
      allowedRisks,
      validApprovalDecisionIds,
      validAuthorityGrantRefs,
    ),
    blockers,
  }
}

export interface TransitionOutcomeInput {
  now: Date | string
  reason?: string
  approvedBy?: string
  approvalDecisionId?: number
  expectedVersion?: number
  fence?: OutcomeFence
}

export function fenceMatches(
  item: OutcomeQueueRecord,
  fence: OutcomeFence,
  now: Date | string,
): boolean {
  return item.lifecycleState === "active"
    && item.executionBinding === fence.executionBinding
    && item.leaseToken === fence.leaseToken
    && item.fencingToken === fence.fencingToken
    && item.leaseExpiresAt !== null
    && milliseconds(item.leaseExpiresAt) > milliseconds(now)
}

export function transitionOutcome(
  item: OutcomeQueueRecord,
  to: OutcomeLifecycleState,
  input: TransitionOutcomeInput,
): OutcomeMutationResult {
  if (input.expectedVersion !== undefined && input.expectedVersion !== item.version) {
    return { ok: false, reason: "VERSION_CONFLICT", item }
  }
  if (!canTransitionOutcome(item.lifecycleState, to)) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", item }
  }
  if (to === "active") return { ok: false, reason: "ACQUISITION_REQUIRED", item }
  if (to === "completed") return { ok: false, reason: "TERMINAL_EVIDENCE_REQUIRED", item }
  if (
    item.lifecycleState === "active"
    && (!input.fence || !fenceMatches(item, input.fence, input.now))
  ) {
    return { ok: false, reason: "FENCE_MISMATCH", item }
  }
  if (to === "approved" && (!input.approvedBy || input.approvedBy.trim() === "")) {
    return { ok: false, reason: "APPROVAL_EVIDENCE_REQUIRED", item }
  }
  if (
    to === "approved"
    && (!Number.isSafeInteger(input.approvalDecisionId) || input.approvalDecisionId! <= 0)
  ) {
    return { ok: false, reason: "APPROVAL_EVIDENCE_REQUIRED", item }
  }

  const now = iso(input.now)
  const approving = to === "approved"
  const terminal = isTerminal(to)
  const next: OutcomeQueueRecord = {
    ...item,
    lifecycleState: to,
    lifecycleReason: input.reason ?? null,
    approvalState: approving ? "approved" : item.approvalState,
    approvedBy: approving ? input.approvedBy!.trim() : item.approvedBy,
    approvedAt: approving ? now : item.approvedAt,
    approvalDecisionId: approving ? input.approvalDecisionId! : item.approvalDecisionId,
    leaseHolder: terminal || to === "blocked" ? null : item.leaseHolder,
    leaseToken: terminal || to === "blocked" ? null : item.leaseToken,
    leaseExpiresAt: terminal || to === "blocked" ? null : item.leaseExpiresAt,
    terminalAt: terminal ? now : item.terminalAt,
    version: item.version + 1,
    updatedAt: now,
  }
  return { ok: true, item: next, replayed: false }
}

export interface AcquireOutcomeInput {
  now: Date | string
  leaseDurationMs: number
  leaseHolder: string
  leaseToken: string
  executionBinding: string
  acquisitionKey: string
  expectedVersion: number
  activeWorkOrderId?: number | null
  queue: readonly OutcomeQueueRecord[]
  allowedRiskClasses?: readonly string[]
  validApprovalDecisionIds: readonly number[]
  validAuthorityGrantRefs: readonly string[]
}

export function acquireOutcome(
  item: OutcomeQueueRecord,
  input: AcquireOutcomeInput,
): OutcomeMutationResult {
  const requiredStrings = [
    input.leaseHolder,
    input.leaseToken,
    input.executionBinding,
    input.acquisitionKey,
  ]
  if (requiredStrings.some((value) => value.trim() === "")
    || !Number.isSafeInteger(input.leaseDurationMs)
    || input.leaseDurationMs <= 0) {
    return { ok: false, reason: "ACQUISITION_INPUT_INVALID", item }
  }
  if (item.acquisitionKey === input.acquisitionKey && !isLeaseStale(item, input.now)) {
    return item.leaseHolder === input.leaseHolder
      && item.leaseToken === input.leaseToken
      && item.executionBinding === input.executionBinding
      ? { ok: true, item, replayed: true }
      : { ok: false, reason: "ACQUISITION_KEY_CONFLICT", item }
  }
  if (input.expectedVersion !== item.version) {
    return { ok: false, reason: "VERSION_CONFLICT", item }
  }
  const selection = selectNextOutcome(input.queue, {
    now: input.now,
    allowedRiskClasses: input.allowedRiskClasses,
    validApprovalDecisionIds: input.validApprovalDecisionIds,
    validAuthorityGrantRefs: input.validAuthorityGrantRefs,
  })
  if (
    !selection.selected
    || selection.item.userId !== item.userId
    || selection.item.outcomeKey !== item.outcomeKey
    || selection.item.version !== item.version
  ) {
    return { ok: false, reason: "OUTCOME_INELIGIBLE", item }
  }

  const recovering = item.lifecycleState === "active"
  if (recovering && !isLeaseStale(item, input.now)) {
    return { ok: false, reason: "LEASE_ALREADY_HELD", item }
  }
  if (!recovering && item.lifecycleState !== "approved") {
    return { ok: false, reason: "ILLEGAL_TRANSITION", item }
  }
  if (item.approvalState !== "approved" || item.authorityState !== "matched") {
    return { ok: false, reason: "ILLEGAL_TRANSITION", item }
  }

  const nowMs = milliseconds(input.now)
  const now = new Date(nowMs).toISOString()
  const next: OutcomeQueueRecord = {
    ...item,
    lifecycleState: "active",
    lifecycleReason: recovering ? "STALE_LEASE_RECOVERED" : null,
    activeWorkOrderId: input.activeWorkOrderId ?? item.activeWorkOrderId,
    executionBinding: input.executionBinding,
    leaseHolder: input.leaseHolder,
    leaseToken: input.leaseToken,
    leaseExpiresAt: new Date(nowMs + input.leaseDurationMs).toISOString(),
    fencingToken: item.fencingToken + 1,
    version: item.version + 1,
    acquisitionKey: input.acquisitionKey,
    activatedAt: recovering ? item.activatedAt : now,
    updatedAt: now,
  }
  return { ok: true, item: next, replayed: false }
}

export interface CompleteOutcomeInput {
  now: Date | string
  fence: OutcomeFence
  expectedVersion: number
  terminalKey: string
  result: string
  evidenceId?: number | null
  evidenceRefs?: readonly string[]
}

export function completeOutcome(
  item: OutcomeQueueRecord,
  input: CompleteOutcomeInput,
): OutcomeMutationResult {
  if (item.lifecycleState === "completed") {
    const evidenceRefs = [...new Set(input.evidenceRefs ?? [])].sort()
    return item.terminalKey === input.terminalKey
      && item.terminalResult === input.result
      && item.terminalEvidenceId === (input.evidenceId ?? null)
      && JSON.stringify(item.terminalEvidenceRefs) === JSON.stringify(evidenceRefs)
      && item.executionBinding === input.fence.executionBinding
      && item.fencingToken === input.fence.fencingToken
      ? { ok: true, item, replayed: true }
      : { ok: false, reason: "TERMINAL_KEY_CONFLICT", item }
  }
  if (input.expectedVersion !== item.version) {
    return { ok: false, reason: "VERSION_CONFLICT", item }
  }
  if (!fenceMatches(item, input.fence, input.now)) {
    return { ok: false, reason: "FENCE_MISMATCH", item }
  }
  const evidenceRefs = [...new Set(input.evidenceRefs ?? [])].sort()
  if (input.terminalKey.trim() === ""
    || input.result.trim() === ""
    || (input.evidenceId == null && evidenceRefs.length === 0)) {
    return { ok: false, reason: "TERMINAL_EVIDENCE_REQUIRED", item }
  }

  const now = iso(input.now)
  return {
    ok: true,
    replayed: false,
    item: {
      ...item,
      lifecycleState: "completed",
      lifecycleReason: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: input.result,
      terminalEvidenceId: input.evidenceId ?? null,
      terminalEvidenceRefs: evidenceRefs,
      terminalKey: input.terminalKey,
      terminalAt: now,
      version: item.version + 1,
      updatedAt: now,
    },
  }
}

export interface LegacyGoalRecord {
  id: number
  userId: string
  ref: string | null
  command: string
  risk: string
  authority: string
  verdict: string
  requiresApproval: boolean
  status: string
  recommendedMove?: string | null
  linkedWorkOrderId?: number | null
  createdAt?: Date | string
  updatedAt?: Date | string
}

export interface LegacyGoalMappingOptions {
  queueOrder?: number
  dependencyKeys?: readonly string[]
  workOrderStatus?: string | null
  terminalResult?: string | null
  terminalEvidenceId?: number | null
  terminalEvidenceRefs?: readonly string[]
}

export function mapLegacyGoalToOutcome(
  goal: LegacyGoalRecord,
  options: LegacyGoalMappingOptions = {},
): OutcomeQueueRecord {
  const createdAt = iso(goal.createdAt ?? "1970-01-01T00:00:00.000Z")
  const updatedAt = iso(goal.updatedAt ?? goal.createdAt ?? "1970-01-01T00:00:00.000Z")
  const completed = goal.status === "converted"
    && (options.workOrderStatus === "closed" || options.terminalResult != null)
  const convertedWithoutTerminal = goal.status === "converted" && !completed
  const lifecycleState = mapLegacyLifecycleState(
    goal.status,
    completed,
  ) as OutcomeLifecycleState

  return {
    id: undefined,
    userId: goal.userId,
    outcomeKey: `goal:${goal.ref ?? goal.id}`,
    goalId: goal.id,
    goalRef: goal.ref,
    title: goal.command,
    objective: goal.command,
    queueOrder: options.queueOrder ?? goal.id,
    dependencyKeys: [...new Set(options.dependencyKeys ?? [])].sort(),
    riskClass: mapLegacyRiskClass(goal.risk),
    // Legacy verdicts and recommendations are classification, never approval.
    approvalState: "unapproved",
    approvedBy: null,
    approvedAt: null,
    approvalDecisionId: null,
    authorityState: "unverified",
    authorityLevel: goal.authority,
    authorityGrantRef: null,
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    lifecycleState,
    lifecycleReason: convertedWithoutTerminal
      ? "LEGACY_CONVERSION_REQUIRES_DURABLE_BINDING"
      : null,
    activeWorkOrderId: goal.linkedWorkOrderId ?? null,
    executionBinding: null,
    leaseHolder: null,
    leaseToken: null,
    leaseExpiresAt: null,
    fencingToken: 0,
    version: 0,
    acquisitionKey: null,
    terminalResult: completed ? options.terminalResult ?? "LEGACY_COMPLETED" : null,
    terminalEvidenceId: completed ? options.terminalEvidenceId ?? null : null,
    terminalEvidenceRefs: completed ? [...new Set(options.terminalEvidenceRefs ?? [])].sort() : [],
    terminalKey: completed ? `legacy-terminal:${goal.ref ?? goal.id}` : null,
    suggestedAt: createdAt,
    activatedAt: null,
    terminalAt: completed || lifecycleState === "declined" ? updatedAt : null,
    createdAt,
    updatedAt,
  }
}
