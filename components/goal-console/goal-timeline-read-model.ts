import {
  buildRuntimeExecutionTruth,
  type RuntimeExecutionGovernanceEventRecord,
  type RuntimeExecutionTruth,
  type RuntimeExecutionWorkOrderRecord,
  type RuntimeLeaseStatus,
} from "@/components/runtime/runtime-execution-model"

export const GOAL_TIMELINE_STALE_AFTER_MS = 15 * 60 * 1000

export type GoalTimelineTruthState = "CURRENT" | "MISSING" | "STALE" | "CONFLICTING"

export type GoalTimelineGoalRecord = {
  id: number
  userId: string
  ref: string | null
  command: string
  lane: string
  mode: string
  risk: string
  authority: string
  verdict: string
  rationale: string | null
  recommendedMove: string | null
  requiresApproval: boolean
  linkedWorkOrderId: number | null
  status: string
  createdAt: Date
  updatedAt: Date
}

export type GoalTimelineWorkOrderRecord = RuntimeExecutionWorkOrderRecord & {
  description: string | null
  phase: string | null
  assignee: string | null
  validators: string[]
  stopConditions: string[]
  linkedDecisionId: number | null
}

export type GoalTimelineEvidenceRecord = {
  id: number
  userId: string
  ref: string | null
  workOrderId: number
  result: string
  repo: string | null
  branch: string | null
  head: string | null
  validators: string[]
  knownFailures: string[]
  outOfScopeChanges: string[]
  deferredItems: string[]
  nextValidMove: string | null
  notes: string | null
  contentHash: string | null
  artifactPath: string | null
  createdAt: Date
}

export type GoalTimelineDecisionRecord = {
  id: number
  userId: string
  ref: string | null
  title: string
  decision: string
  rationale: string | null
  consequences: string | null
  status: string
  authority: string
  scope: string | null
  evidence: string[]
  decidedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type GoalTimelineAuditRecord = {
  id: number
  userId: string
  type: string
  summary: string
  register: string | null
  refId: number | null
  metadata: unknown
  createdAt: Date
}

export type GoalTimelineTruthIssue = {
  code: string
  state: Exclude<GoalTimelineTruthState, "CURRENT">
  detail: string
  references: string[]
}

export type GoalTimelineEntry = {
  id: string
  kind: "GOAL" | "WORK_ORDER" | "CHECKPOINT" | "LEASE" | "EVIDENCE" | "DECISION" | "AUDIT"
  state: string
  label: string
  detail: string | null
  occurredAt: Date
  references: string[]
}

export type GoalTimelineValidationCheckpoint = {
  id: string
  source: "RUNTIME" | "EVIDENCE"
  state: string
  detail: string | null
  result: string | null
  validators: string[]
  recordedAt: Date
  references: string[]
}

export type GoalTimelineProjection = {
  id: string
  goal: {
    id: number
    ref: string
    outcome: string
    lane: string
    mode: string
    status: string
    verdict: string
    authority: string
    risk: string
  }
  truth: {
    state: GoalTimelineTruthState
    issues: GoalTimelineTruthIssue[]
    observedAt: Date
    latestPersistedAt: Date
  }
  current: {
    phase: string
    workOrder: {
      id: number
      ref: string
      title: string
      status: string
      result: string | null
    } | null
    runtime: {
      attempt: number | null
      worker: string | null
      leaseStatus: RuntimeLeaseStatus
      leaseExpiresAt: Date | null
      checkpointId: string | null
      checkpointSequence: number | null
      checkpointState: string | null
      checkpointDetail: string | null
      recordedAt: Date | null
    }
  }
  validationCheckpoints: GoalTimelineValidationCheckpoint[]
  delivery: {
    prNumber: number | null
    finalRevision: string | null
    status: "MISSING" | "IN_PROGRESS" | "DELIVERED" | "CONFLICTING"
  }
  references: {
    evidence: Array<{
      id: string
      ref: string
      result: string
      artifactPath: string | null
      contentHash: string | null
    }>
    trace: Array<{ id: string; eventType: string; eventId: number }>
    audit: Array<{ id: string; type: string; summary: string }>
    decisions: Array<{
      id: string
      ref: string
      title: string
      status: string
      authority: string
    }>
  }
  terminal: {
    state: string | null
    result: string | null
    limitations: string[]
    ownerAction: string | null
  }
  resume: {
    state:
      | "NOT_REQUIRED"
      | "AWAITING_OWNER_DECISION"
      | "MISSING_DECISION_RECORD"
      | "DECISION_REJECTED"
      | "DECISION_CONFLICT"
      | "AUTHORIZED_TO_RESUME"
    decisionId: number | null
    decisionRef: string | null
    governedNextState: string | null
  }
  entries: GoalTimelineEntry[]
}

export type GoalTimelineReadModelInput = {
  userId: string
  goals: GoalTimelineGoalRecord[]
  workOrders: GoalTimelineWorkOrderRecord[]
  governanceEvents: RuntimeExecutionGovernanceEventRecord[]
  evidenceRecords: GoalTimelineEvidenceRecord[]
  decisions: GoalTimelineDecisionRecord[]
  auditRecords: GoalTimelineAuditRecord[]
  truncatedRuntimeWorkOrderIds?: number[]
  truncatedRuntimeGoalIds?: number[]
  truncatedEvidenceWorkOrderIds?: number[]
  truncatedAuditGoalIds?: number[]
  truncatedGoalTerminalIds?: number[]
  observedAt: Date
  staleAfterMs?: number
}

type Metadata = Record<string, unknown>

function metadata(value: unknown): Metadata | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Metadata
    : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function goalRef(goal: GoalTimelineGoalRecord): string {
  return goal.ref ?? `GOAL-${goal.id}`
}

function runtimeRef(goal: GoalTimelineGoalRecord): string {
  return `WO-HERMES-OUTCOME-${goal.id}`
}

function eventWorker(
  currentEventId: number | null,
  events: RuntimeExecutionGovernanceEventRecord[],
): string | null {
  if (currentEventId === null) return null
  return events.find((event) => event.id === currentEventId)?.actor ?? null
}

function currentPhase(
  workOrder: GoalTimelineWorkOrderRecord | null,
  execution: RuntimeExecutionTruth | null,
): string {
  if (workOrder?.phase) return workOrder.phase
  const state = execution?.currentCheckpoint?.state
  if (!state) return workOrder ? "WORK_ORDER_RECORDED" : "GOAL_RECORDED"
  if (state === "OWNER_DECISION_REQUIRED") return "OWNER_DECISION"
  if (state === "COMPLETE" || state === "FAILED_TERMINAL") return "TERMINAL"
  if (/VALIDAT|TEST|CI|REVIEW/.test(state)) return "VALIDATION"
  if (/PR_|MERGE|DELIVER|RELEASE/.test(state)) return "DELIVERY"
  return "EXECUTION"
}

function decisionAuthorizesResume(
  record: GoalTimelineDecisionRecord,
  workOrder: GoalTimelineWorkOrderRecord | null,
  terminalEvent: RuntimeExecutionGovernanceEventRecord | null,
  noLaterThan?: Date,
): boolean {
  if (!workOrder?.ref || !terminalEvent || !record.decidedAt) return false
  const decidedAt = record.decidedAt.getTime()
  const nextState = text(metadata(terminalEvent.metadata)?.nextState)
  const terminalBinding = record.evidence.includes(`trace:${terminalEvent.id}`)
  const nextStateBinding = nextState !== null && (
    record.evidence.includes(nextState)
    || record.evidence.includes(`next-state:${nextState}`)
  )
  return record.status === "accepted"
    && record.authority === "binding"
    && record.scope === workOrder.ref
    && terminalBinding
    && nextStateBinding
    && decidedAt > terminalEvent.createdAt.getTime()
    && (noLaterThan === undefined || decidedAt <= noLaterThan.getTime())
}

function recoveryMatchesTerminal(
  event: RuntimeExecutionGovernanceEventRecord,
  terminalEvent: RuntimeExecutionGovernanceEventRecord,
  workOrder: GoalTimelineWorkOrderRecord | null,
): boolean {
  const terminalMetadata = metadata(terminalEvent.metadata)
  const recoveryMetadata = metadata(event.metadata)
  const nextState = text(terminalMetadata?.nextState)
  if (text(terminalMetadata?.result) !== "FAILED_TERMINAL" || !nextState) {
    return false
  }
  if (event.eventType === "HERMES_OUTCOME_PROVIDER_RECOVERED") {
    return text(recoveryMetadata?.priorResult) === "FAILED_TERMINAL"
      && text(recoveryMetadata?.retryState) === nextState
  }
  if (event.eventType === "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED") {
    return text(recoveryMetadata?.priorResult) === "FAILED_TERMINAL"
      && text(recoveryMetadata?.retryState) === nextState
      && /^[a-f0-9]{64}$/i.test(text(recoveryMetadata?.proofDigest) ?? "")
  }
  if (event.eventType === "HERMES_OUTCOME_REVIEW_RECOVERED") {
    const prNumber = recoveryMetadata?.prNumber
    return nextState === "REVIEW_REMEDIATION_EXHAUSTED"
      && text(recoveryMetadata?.workOrderRef) === workOrder?.ref
      && typeof prNumber === "number"
      && Number.isSafeInteger(prNumber)
      && prNumber > 0
      && /^[a-f0-9]{40}$/i.test(text(recoveryMetadata?.reviewedHeadSha) ?? "")
      && /^[a-f0-9]{40}$/i.test(text(recoveryMetadata?.mergeSha) ?? "")
  }
  return false
}

function terminalState(
  workOrder: GoalTimelineWorkOrderRecord | null,
  execution: RuntimeExecutionTruth | null,
  goalTerminalEvent: RuntimeExecutionGovernanceEventRecord | null,
  terminalRecoveryProven: boolean,
  linkedDecisions: GoalTimelineDecisionRecord[],
): string | null {
  const checkpointState = execution?.currentCheckpoint?.state ?? null
  const persistedGoalResult = text(metadata(goalTerminalEvent?.metadata)?.result)
  let terminalSuperseded = false
  if (
    execution?.currentCheckpoint
    && goalTerminalEvent
    && execution.currentCheckpoint.eventId > goalTerminalEvent.id
  ) {
    const ownerResumeAuthorized = persistedGoalResult === "OWNER_DECISION_REQUIRED"
      && linkedDecisions.some((record) => (
        decisionAuthorizesResume(
          record,
          workOrder,
          goalTerminalEvent,
          execution.currentCheckpoint!.recordedAt,
        )
      ))
    if (!ownerResumeAuthorized && !terminalRecoveryProven) return persistedGoalResult
    terminalSuperseded = true
  }
  if (checkpointState && (
    checkpointState === "COMPLETE"
    || checkpointState === "FAILED_TERMINAL"
    || checkpointState === "OWNER_DECISION_REQUIRED"
  )) {
    return checkpointState
  }
  if (terminalSuperseded) return null
  if (persistedGoalResult === "OWNER_DECISION_REQUIRED" || persistedGoalResult === "FAILED_TERMINAL") {
    return persistedGoalResult
  }
  return null
}

function byDateAndId(
  left: { occurredAt: Date; id: string },
  right: { occurredAt: Date; id: string },
): number {
  return left.occurredAt.getTime() - right.occurredAt.getTime()
    || left.id.localeCompare(right.id)
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function terminalEvidenceAttempt(
  record: GoalTimelineEvidenceRecord,
  outcomeId: number,
): number | null {
  const match = record.ref?.match(new RegExp(`^EV-HERMES-${outcomeId}-(\\d+)-\\d+$`))
  if (!match) return null
  const attempt = Number(match[1])
  return Number.isSafeInteger(attempt) && attempt > 0 ? attempt : null
}

function latestDelivery(execution: RuntimeExecutionTruth | null): {
  prNumber: number | null
  finalRevision: string | null
} {
  let prNumber: number | null = null
  let finalRevision: string | null = null
  for (const checkpoint of execution?.currentAttempt?.checkpoints ?? []) {
    prNumber = checkpoint.evidence.prNumber ?? prNumber
    finalRevision = checkpoint.evidence.mergeSha
      ?? checkpoint.evidence.commit
      ?? checkpoint.evidence.headRefOid
      ?? finalRevision
  }
  return { prNumber, finalRevision }
}

function validationCheckpoints(
  execution: RuntimeExecutionTruth | null,
  evidence: GoalTimelineEvidenceRecord[],
): GoalTimelineValidationCheckpoint[] {
  const runtime = (execution?.attempts.flatMap((attempt) => attempt.checkpoints) ?? [])
    .filter((checkpoint) => /VALIDAT|TEST|CI|REVIEW/.test(checkpoint.state))
    .map<GoalTimelineValidationCheckpoint>((checkpoint) => ({
      id: `trace:${checkpoint.eventId}`,
      source: "RUNTIME",
      state: checkpoint.state,
      detail: checkpoint.detail,
      result: null,
      validators: [],
      recordedAt: checkpoint.recordedAt,
      references: [`trace:${checkpoint.eventId}`],
    }))
  const persistedEvidence = evidence
    .filter((record) => record.validators.length > 0)
    .map<GoalTimelineValidationCheckpoint>((record) => ({
      id: `evidence:${record.id}`,
      source: "EVIDENCE",
      state: "VALIDATION_RECORDED",
      detail: record.notes,
      result: record.result,
      validators: [...record.validators],
      recordedAt: record.createdAt,
      references: [`evidence:${record.id}`],
    }))
  return [...runtime, ...persistedEvidence].sort((left, right) => (
    left.recordedAt.getTime() - right.recordedAt.getTime() || left.id.localeCompare(right.id)
  ))
}

function resumeProjection(
  terminal: string | null,
  workOrder: GoalTimelineWorkOrderRecord | null,
  linkedDecisions: GoalTimelineDecisionRecord[],
  terminalEvent: RuntimeExecutionGovernanceEventRecord | null,
): GoalTimelineProjection["resume"] {
  if (terminal !== "OWNER_DECISION_REQUIRED") {
    return {
      state: "NOT_REQUIRED",
      decisionId: null,
      decisionRef: null,
      governedNextState: null,
    }
  }
  const nextState = text(metadata(terminalEvent?.metadata)?.nextState)
  if (workOrder?.linkedDecisionId === null || workOrder?.linkedDecisionId === undefined) {
    return {
      state: "MISSING_DECISION_RECORD",
      decisionId: null,
      decisionRef: null,
      governedNextState: nextState,
    }
  }
  if (linkedDecisions.length !== 1) {
    return {
      state: "DECISION_CONFLICT",
      decisionId: workOrder.linkedDecisionId,
      decisionRef: null,
      governedNextState: nextState,
    }
  }
  const linked = linkedDecisions[0]
  const state = linked.status === "rejected"
    ? "DECISION_REJECTED"
    : decisionAuthorizesResume(linked, workOrder, terminalEvent)
      ? "AUTHORIZED_TO_RESUME"
      : "AWAITING_OWNER_DECISION"
  return {
    state,
    decisionId: linked.id,
    decisionRef: linked.ref,
    governedNextState: nextState,
  }
}

export function buildGoalTimelineReadModel(
  input: GoalTimelineReadModelInput,
): GoalTimelineProjection[] {
  const staleAfterMs = input.staleAfterMs ?? GOAL_TIMELINE_STALE_AFTER_MS
  const goals = input.goals.filter((record) => record.userId === input.userId)
  const workOrders = input.workOrders.filter((record) => record.userId === input.userId)
  const events = input.governanceEvents.filter((record) => record.userId === input.userId)
  const evidence = input.evidenceRecords.filter((record) => record.userId === input.userId)
  const decisions = input.decisions.filter((record) => record.userId === input.userId)
  const audits = input.auditRecords.filter((record) => record.userId === input.userId)
  const executionByWorkOrderId = new Map(
    buildRuntimeExecutionTruth(input.userId, workOrders, events)
      .map((execution) => [execution.workOrderId, execution]),
  )

  return goals.map<GoalTimelineProjection>((goal) => {
    const expectedRuntimeRef = runtimeRef(goal)
    const candidates = workOrders
      .filter((record) => record.ref === expectedRuntimeRef)
      .sort((left, right) => (
        right.updatedAt.getTime() - left.updatedAt.getTime() || right.id - left.id
      ))
    const currentWorkOrder = candidates[0] ?? null
    const execution = currentWorkOrder
      ? executionByWorkOrderId.get(currentWorkOrder.id) ?? null
      : null
    const currentCheckpoint = execution?.currentCheckpoint ?? null
    const currentEvent = currentCheckpoint
      ? events.find((event) => event.id === currentCheckpoint.eventId) ?? null
      : null
    const goalTerminalEvent = events
      .filter((event) => (
        event.entityType === "goal"
        && event.entityId === String(goal.id)
        && event.eventType === "HERMES_OUTCOME_TERMINAL"
      ))
      .sort((left, right) => left.id - right.id)
      .at(-1) ?? null
    const goalRecoveryEvents = events
      .filter((event) => (
        event.entityType === "goal"
        && event.entityId === String(goal.id)
        && [
          "HERMES_OUTCOME_PROVIDER_RECOVERED",
          "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED",
          "HERMES_OUTCOME_REVIEW_RECOVERED",
        ].includes(event.eventType)
      ))
      .sort((left, right) => left.id - right.id)
    const recoveryCandidates = goalTerminalEvent && currentCheckpoint
      ? goalRecoveryEvents.filter((event) => (
        event.id > goalTerminalEvent.id && event.id < currentCheckpoint.eventId
      ))
      : []
    const terminalRecoveryProven = goalTerminalEvent !== null
      && recoveryCandidates.some((event) => (
        recoveryMatchesTerminal(event, goalTerminalEvent, currentWorkOrder)
      ))
    const currentLease = execution?.currentAttempt?.currentLease ?? null
    const workOrderEvidence = currentWorkOrder
      ? evidence
        .filter((record) => record.workOrderId === currentWorkOrder.id)
        .sort((left, right) => (
          left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id
        ))
      : []
    const linkedDecisions = currentWorkOrder?.linkedDecisionId
      ? decisions.filter((record) => record.id === currentWorkOrder.linkedDecisionId)
      : []
    const goalAudits = audits
      .filter((record) => (
        (record.register === "goals" && record.refId === goal.id)
        || (record.register === "work-orders" && record.refId === currentWorkOrder?.id)
      ))
      .sort((left, right) => (
        left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id
      ))
    const issues: GoalTimelineTruthIssue[] = []
    const terminal = terminalState(
      currentWorkOrder,
      execution,
      goalTerminalEvent,
      terminalRecoveryProven,
      linkedDecisions,
    )
    const delivery = latestDelivery(execution)
    // WorkOrder.commitRef is sticky across retries; once runtime attempts exist,
    // only the current attempt's checkpoint artifacts are current delivery truth.
    const finalRevision = delivery.finalRevision
      ?? (!execution?.currentAttempt ? currentWorkOrder?.commitRef ?? null : null)

    if (!currentWorkOrder) {
      issues.push({
        code: "RUNTIME_WORK_ORDER_MISSING",
        state: "MISSING",
        detail: `No persisted runtime Work Order matches ${expectedRuntimeRef}.`,
        references: [`goal:${goal.id}`],
      })
    }
    if (candidates.length > 1) {
      issues.push({
        code: "DUPLICATE_RUNTIME_WORK_ORDER",
        state: "CONFLICTING",
        detail: `${candidates.length} Work Orders match ${expectedRuntimeRef}.`,
        references: candidates.map((record) => `work-order:${record.id}`),
      })
    }
    if (input.truncatedRuntimeGoalIds?.includes(goal.id)) {
      issues.push({
        code: "RUNTIME_WORK_ORDER_CARDINALITY_TRUNCATED",
        state: "CONFLICTING",
        detail: `More than ${candidates.length} Work Orders match ${expectedRuntimeRef}.`,
        references: candidates.map((record) => `work-order:${record.id}`),
      })
    }
    if (currentWorkOrder?.goal && currentWorkOrder.goal !== goalRef(goal)) {
      issues.push({
        code: "GOAL_REFERENCE_CONFLICT",
        state: "CONFLICTING",
        detail: `Runtime Work Order goal ${currentWorkOrder.goal} does not match ${goalRef(goal)}.`,
        references: [`goal:${goal.id}`, `work-order:${currentWorkOrder.id}`],
      })
    }
    if (currentWorkOrder && !currentCheckpoint) {
      issues.push({
        code: "RUNTIME_CHECKPOINT_MISSING",
        state: "MISSING",
        detail: "The runtime Work Order has no persisted Hermes checkpoint.",
        references: [`work-order:${currentWorkOrder.id}`],
      })
    }
    if (currentWorkOrder && input.truncatedRuntimeWorkOrderIds?.includes(currentWorkOrder.id)) {
      issues.push({
        code: "RUNTIME_HISTORY_TRUNCATED",
        state: "MISSING",
        detail: "The persisted runtime history exceeded the bounded query window.",
        references: [`work-order:${currentWorkOrder.id}`],
      })
    }
    if (currentWorkOrder && input.truncatedEvidenceWorkOrderIds?.includes(currentWorkOrder.id)) {
      issues.push({
        code: "EVIDENCE_HISTORY_TRUNCATED",
        state: "MISSING",
        detail: "The persisted evidence history exceeded the bounded query window.",
        references: [`work-order:${currentWorkOrder.id}`],
      })
    }
    if (input.truncatedAuditGoalIds?.includes(goal.id)) {
      issues.push({
        code: "AUDIT_HISTORY_TRUNCATED",
        state: "MISSING",
        detail: "The persisted audit history exceeded the bounded query window.",
        references: [`goal:${goal.id}`],
      })
    }
    if (input.truncatedGoalTerminalIds?.includes(goal.id)) {
      issues.push({
        code: "GOAL_TERMINAL_HISTORY_TRUNCATED",
        state: "MISSING",
        detail: "The persisted Goal terminal history exceeded the bounded query window.",
        references: [`goal:${goal.id}`],
      })
    }
    if (
      text(metadata(goalTerminalEvent?.metadata)?.result) === "FAILED_TERMINAL"
      && recoveryCandidates.length > 0
      && !terminalRecoveryProven
    ) {
      issues.push({
        code: "RECOVERY_EVIDENCE_CONFLICT",
        state: "CONFLICTING",
        detail: "A later recovery event does not bind to the persisted terminal state.",
        references: [
          `trace:${goalTerminalEvent?.id}`,
          ...recoveryCandidates.map((event) => `trace:${event.id}`),
        ],
      })
    }
    const leaseExpired = currentLease?.status === "ACTIVE"
      && currentLease.expiresAt.getTime() <= input.observedAt.getTime()
    const checkpointStale = currentCheckpoint !== null
      && execution?.currentLeaseStatus === "ACTIVE"
      && input.observedAt.getTime() - currentCheckpoint.recordedAt.getTime() > staleAfterMs
    if (leaseExpired || checkpointStale) {
      issues.push({
        code: leaseExpired ? "ACTIVE_LEASE_EXPIRED" : "RUNTIME_CHECKPOINT_STALE",
        state: "STALE",
        detail: leaseExpired
          ? `The persisted ACTIVE lease expired at ${currentLease.expiresAt.toISOString()}.`
          : `The active runtime checkpoint is older than ${staleAfterMs}ms.`,
        references: currentLease
          ? [`trace:${currentLease.eventId}`]
          : currentCheckpoint ? [`trace:${currentCheckpoint.eventId}`] : [],
      })
    }
    if (terminal && currentLease?.status === "ACTIVE" && !leaseExpired) {
      issues.push({
        code: "TERMINAL_STATE_ACTIVE_LEASE_CONFLICT",
        state: "CONFLICTING",
        detail: `Terminal state ${terminal} conflicts with an unexpired ACTIVE lease.`,
        references: [`trace:${currentCheckpoint?.eventId}`, `trace:${currentLease.eventId}`],
      })
    }
    if (
      currentWorkOrder?.result === "PASS"
      && terminal !== null
      && terminal !== "COMPLETE"
      && terminal !== "CLOSED"
    ) {
      issues.push({
        code: "TERMINAL_RESULT_CONFLICT",
        state: "CONFLICTING",
        detail: `Persisted result PASS conflicts with terminal state ${terminal}.`,
        references: [`work-order:${currentWorkOrder.id}`],
      })
    }
    if (terminal === "COMPLETE" && currentWorkOrder?.result === null) {
      issues.push({
        code: "COMPLETION_RESULT_MISSING",
        state: "MISSING",
        detail: "COMPLETE checkpoint has no persisted Work Order result.",
        references: [`work-order:${currentWorkOrder?.id}`, `trace:${currentCheckpoint?.eventId}`],
      })
    } else if (terminal === "COMPLETE" && currentWorkOrder?.result !== "PASS") {
      issues.push({
        code: "COMPLETION_RESULT_CONFLICT",
        state: "CONFLICTING",
        detail: `COMPLETE checkpoint conflicts with persisted result ${currentWorkOrder?.result}.`,
        references: [`work-order:${currentWorkOrder?.id}`, `trace:${currentCheckpoint?.eventId}`],
      })
    }
    if (terminal === "COMPLETE" && currentWorkOrder?.result === "PASS" && !finalRevision) {
      issues.push({
        code: "DELIVERY_ARTIFACT_MISSING",
        state: "MISSING",
        detail: "The completed current attempt has no persisted delivery revision.",
        references: [`work-order:${currentWorkOrder.id}`, `trace:${currentCheckpoint?.eventId}`],
      })
    }
    const currentAttempt = execution?.currentAttempt?.attempt ?? null
    const evidenceResults = unique(workOrderEvidence
      .filter((record) => (
        currentAttempt !== null
        && terminalEvidenceAttempt(record, goal.id) === currentAttempt
      ))
      .map((record) => record.result))
    if (
      currentWorkOrder?.result
      && evidenceResults.length > 0
      && evidenceResults.some((result) => result !== currentWorkOrder.result)
    ) {
      issues.push({
        code: "EVIDENCE_RESULT_CONFLICT",
        state: "CONFLICTING",
        detail: `Work Order result ${currentWorkOrder.result} conflicts with evidence result ${evidenceResults.join(", ")}.`,
        references: [
          `work-order:${currentWorkOrder.id}`,
          ...workOrderEvidence.map((record) => `evidence:${record.id}`),
        ],
      })
    }
    if (
      currentWorkOrder?.commitRef
      && delivery.finalRevision
      && currentWorkOrder.commitRef !== delivery.finalRevision
    ) {
      issues.push({
        code: "FINAL_REVISION_CONFLICT",
        state: "CONFLICTING",
        detail: "Work Order commitRef differs from the latest persisted runtime delivery revision.",
        references: [`work-order:${currentWorkOrder.id}`, `trace:${currentCheckpoint?.eventId}`],
      })
    }

    const resume = resumeProjection(
      terminal,
      currentWorkOrder,
      linkedDecisions,
      goalTerminalEvent ?? currentEvent,
    )
    if (terminal === "OWNER_DECISION_REQUIRED" && (
      resume.state === "MISSING_DECISION_RECORD" || resume.state === "DECISION_CONFLICT"
    )) {
      issues.push({
        code: resume.state,
        state: resume.state === "DECISION_CONFLICT" ? "CONFLICTING" : "MISSING",
        detail: resume.state === "DECISION_CONFLICT"
          ? "The linked owner decision does not resolve to one current-user decision record."
          : "OWNER_DECISION_REQUIRED has no linked persisted decision record.",
        references: currentWorkOrder ? [`work-order:${currentWorkOrder.id}`] : [],
      })
    }

    const truthState: GoalTimelineTruthState = issues.some((issue) => issue.state === "CONFLICTING")
      ? "CONFLICTING"
      : issues.some((issue) => issue.state === "MISSING")
        ? "MISSING"
        : issues.some((issue) => issue.state === "STALE")
          ? "STALE"
          : "CURRENT"
    const latestPersistedAt = [
      goal.updatedAt,
      currentWorkOrder?.updatedAt,
      currentCheckpoint?.recordedAt,
      currentLease?.recordedAt,
      goalTerminalEvent?.createdAt,
      ...workOrderEvidence.map((record) => record.createdAt),
      ...linkedDecisions.map((record) => record.updatedAt),
      ...goalAudits.map((record) => record.createdAt),
    ].filter((value): value is Date => value instanceof Date)
      .sort((left, right) => left.getTime() - right.getTime())
      .at(-1) ?? goal.updatedAt

    const entries: GoalTimelineEntry[] = [{
      id: `goal:${goal.id}`,
      kind: "GOAL",
      state: goal.status,
      label: goalRef(goal),
      detail: goal.command,
      occurredAt: goal.createdAt,
      references: [`goal:${goal.id}`],
    }]
    if (currentWorkOrder) {
      entries.push({
        id: `work-order:${currentWorkOrder.id}`,
        kind: "WORK_ORDER",
        state: currentWorkOrder.status,
        label: currentWorkOrder.ref ?? `Work Order #${currentWorkOrder.id}`,
        detail: currentWorkOrder.title,
        occurredAt: currentWorkOrder.createdAt,
        references: [`work-order:${currentWorkOrder.id}`],
      })
    }
    if (goalTerminalEvent) {
      const recordedTerminalResult = text(metadata(goalTerminalEvent.metadata)?.result)
      entries.push({
        id: `trace:${goalTerminalEvent.id}`,
        kind: "CHECKPOINT",
        state: recordedTerminalResult ?? "HERMES_OUTCOME_TERMINAL",
        label: "Hermes outcome terminal",
        detail: text(metadata(goalTerminalEvent.metadata)?.nextState),
        occurredAt: goalTerminalEvent.createdAt,
        references: [`trace:${goalTerminalEvent.id}`],
      })
    }
    for (const recoveryEvent of goalRecoveryEvents) {
      entries.push({
        id: `trace:${recoveryEvent.id}`,
        kind: "CHECKPOINT",
        state: recoveryEvent.eventType,
        label: "Hermes governed recovery",
        detail: recoveryEvent.reason,
        occurredAt: recoveryEvent.createdAt,
        references: [`trace:${recoveryEvent.id}`],
      })
    }
    for (const attempt of execution?.attempts ?? []) {
      for (const checkpoint of attempt.checkpoints) {
        entries.push({
          id: `trace:${checkpoint.eventId}`,
          kind: "CHECKPOINT",
          state: checkpoint.state,
          label: `Attempt ${checkpoint.attempt}, checkpoint ${checkpoint.sequence}`,
          detail: checkpoint.detail,
          occurredAt: checkpoint.recordedAt,
          references: [`trace:${checkpoint.eventId}`],
        })
      }
      for (const lease of attempt.leaseEvents) {
        entries.push({
          id: `trace:${lease.eventId}`,
          kind: "LEASE",
          state: lease.status,
          label: `Attempt ${lease.attempt} lease`,
          detail: `Expires ${lease.expiresAt.toISOString()}`,
          occurredAt: lease.recordedAt,
          references: [`trace:${lease.eventId}`],
        })
      }
      for (const failure of attempt.failureEvaluations) {
        entries.push({
          id: `trace:${failure.eventId}`,
          kind: "CHECKPOINT",
          state: failure.failureClass,
          label: `Attempt ${failure.attempt} failure evaluation`,
          detail: unique([failure.disposition, failure.detail]).join(" · ") || null,
          occurredAt: failure.recordedAt,
          references: [`trace:${failure.eventId}`],
        })
      }
    }
    for (const record of workOrderEvidence) {
      entries.push({
        id: `evidence:${record.id}`,
        kind: "EVIDENCE",
        state: record.result,
        label: record.ref ?? `Evidence #${record.id}`,
        detail: record.notes,
        occurredAt: record.createdAt,
        references: [`evidence:${record.id}`],
      })
    }
    for (const record of linkedDecisions) {
      entries.push({
        id: `decision:${record.id}`,
        kind: "DECISION",
        state: record.status,
        label: record.ref ?? `Decision #${record.id}`,
        detail: record.decision,
        occurredAt: record.decidedAt ?? record.createdAt,
        references: [`decision:${record.id}`],
      })
    }
    for (const record of goalAudits) {
      entries.push({
        id: `audit:${record.id}`,
        kind: "AUDIT",
        state: record.type,
        label: record.summary,
        detail: null,
        occurredAt: record.createdAt,
        references: [`audit:${record.id}`],
      })
    }

    const limitations = unique([
      ...workOrderEvidence.flatMap((record) => [
        ...record.knownFailures,
        ...record.outOfScopeChanges,
        ...record.deferredItems,
      ]),
      execution?.terminalFailureEvaluation?.detail,
      terminal === "OWNER_DECISION_REQUIRED" ? currentCheckpoint?.detail : null,
    ])
    const ownerAction = terminal === "OWNER_DECISION_REQUIRED"
      ? linkedDecisions[0]?.decision
        ?? currentCheckpoint?.detail
        ?? currentWorkOrder?.stopConditions[0]
        ?? "Record and link the required owner decision."
      : null
    const deliveryStatus = truthState === "CONFLICTING"
      ? "CONFLICTING"
      : terminal === "COMPLETE" && currentWorkOrder?.result === null
        ? "MISSING"
      : terminal === "COMPLETE" && currentWorkOrder?.result === "PASS" && finalRevision
        ? "DELIVERED"
        : delivery.prNumber || finalRevision
          ? "IN_PROGRESS"
          : "MISSING"

    return {
      id: `goal:${goal.id}`,
      goal: {
        id: goal.id,
        ref: goalRef(goal),
        outcome: goal.command,
        lane: goal.lane,
        mode: goal.mode,
        status: goal.status,
        verdict: goal.verdict,
        authority: goal.authority,
        risk: goal.risk,
      },
      truth: {
        state: truthState,
        issues,
        observedAt: input.observedAt,
        latestPersistedAt,
      },
      current: {
        phase: currentPhase(currentWorkOrder, execution),
        workOrder: currentWorkOrder ? {
          id: currentWorkOrder.id,
          ref: currentWorkOrder.ref!,
          title: currentWorkOrder.title,
          status: currentWorkOrder.status,
          result: currentWorkOrder.result,
        } : null,
        runtime: {
          attempt: execution?.currentAttempt?.attempt ?? null,
          worker: eventWorker(currentCheckpoint?.eventId ?? null, events)
            ?? currentWorkOrder?.assignee
            ?? null,
          leaseStatus: execution?.currentLeaseStatus ?? "UNKNOWN",
          leaseExpiresAt: currentLease?.expiresAt ?? null,
          checkpointId: currentCheckpoint ? `trace:${currentCheckpoint.eventId}` : null,
          checkpointSequence: currentCheckpoint?.sequence ?? null,
          checkpointState: currentCheckpoint?.state ?? null,
          checkpointDetail: currentCheckpoint?.detail ?? null,
          recordedAt: currentCheckpoint?.recordedAt ?? null,
        },
      },
      validationCheckpoints: validationCheckpoints(execution, workOrderEvidence),
      delivery: {
        ...delivery,
        finalRevision,
        status: deliveryStatus,
      },
      references: {
        evidence: workOrderEvidence.map((record) => ({
          id: `evidence:${record.id}`,
          ref: record.ref ?? `EV-${record.id}`,
          result: record.result,
          artifactPath: record.artifactPath,
          contentHash: record.contentHash,
        })),
        trace: (execution?.attempts.flatMap((attempt) => [
          ...attempt.checkpoints.map((checkpoint) => ({
            id: `trace:${checkpoint.eventId}`,
            eventType: "HERMES_RUNTIME_CHECKPOINT",
            eventId: checkpoint.eventId,
          })),
          ...attempt.leaseEvents.map((lease) => ({
            id: `trace:${lease.eventId}`,
            eventType: "HERMES_RUNTIME_LEASE",
            eventId: lease.eventId,
          })),
          ...attempt.failureEvaluations.map((failure) => ({
            id: `trace:${failure.eventId}`,
            eventType: "HERMES_RUNTIME_FAILURE_EVAL",
            eventId: failure.eventId,
          })),
        ]) ?? [])
          .concat(goalTerminalEvent ? [{
            id: `trace:${goalTerminalEvent.id}`,
            eventType: "HERMES_OUTCOME_TERMINAL",
            eventId: goalTerminalEvent.id,
          }] : [])
          .concat(goalRecoveryEvents.map((event) => ({
            id: `trace:${event.id}`,
            eventType: event.eventType,
            eventId: event.id,
          })))
          .sort((left, right) => left.eventId - right.eventId),
        audit: goalAudits.map((record) => ({
          id: `audit:${record.id}`,
          type: record.type,
          summary: record.summary,
        })),
        decisions: linkedDecisions.map((record) => ({
          id: `decision:${record.id}`,
          ref: record.ref ?? `ADR-${record.id}`,
          title: record.title,
          status: record.status,
          authority: record.authority,
        })),
      },
      terminal: {
        state: terminal,
        result: terminal ? currentWorkOrder?.result ?? null : null,
        limitations,
        ownerAction,
      },
      resume,
      entries: entries.sort(byDateAndId),
    }
  }).sort((left, right) => (
    right.truth.latestPersistedAt.getTime() - left.truth.latestPersistedAt.getTime()
    || right.goal.id - left.goal.id
  ))
}
