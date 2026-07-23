export const RUNTIME_CHECKPOINT_EVENT = "HERMES_RUNTIME_CHECKPOINT"
export const RUNTIME_FAILURE_EVENT = "HERMES_RUNTIME_FAILURE_EVAL"
export const RUNTIME_LEASE_EVENT = "HERMES_RUNTIME_LEASE"

export type RuntimeLeaseStatus =
  | "ACTIVE"
  | "ABANDONED"
  | "DEFERRED"
  | "RELEASED"
  | "RELEASE_PENDING"
  | "ABANDON_PENDING"
  | "UNKNOWN"

export type RuntimeExecutionWorkOrderRecord = {
  id: number
  userId: string
  ref: string | null
  title: string
  goal: string | null
  lane: string | null
  status: string
  result: string | null
  commitRef: string | null
  evidence: string[]
  createdAt: Date
  updatedAt: Date
  closedAt: Date | null
  completedAt: Date | null
}

export type RuntimeExecutionGovernanceEventRecord = {
  id: number
  userId: string
  eventType: string
  entityType: string | null
  entityId: string | null
  actor: string | null
  reason: string | null
  metadata: unknown
  createdAt: Date
}

export type RuntimeCheckpointEvidence = {
  prNumber: number | null
  commit: string | null
  priorHeadRefOid: string | null
  headRefOid: string | null
  mergeSha: string | null
}

export type RuntimeExecutionCheckpoint = {
  eventId: number
  idempotencyKey: string
  attempt: number
  sequence: number
  state: string
  detail: string | null
  leaseStatus: RuntimeLeaseStatus
  evidence: RuntimeCheckpointEvidence
  payloadDigest?: string | null
  recordedAt: Date
}

export type RuntimeFailureEvaluation = {
  eventId: number
  sourceCheckpointId: number | null
  sourceCheckpointKey: string | null
  attempt: number
  sequence: number
  checkpointState: string
  failureClass: string
  disposition: string
  detail: string | null
  evidenceDigest?: string | null
  recordedAt: Date
}

export type RuntimeLeaseEvent = {
  eventId: number
  idempotencyKey: string
  attempt: number
  checkpointSequence: number
  status: RuntimeLeaseStatus
  expiresAt: Date
  recordedAt: Date
}

export type RuntimeExecutionAttempt = {
  attempt: number
  checkpoints: RuntimeExecutionCheckpoint[]
  failureEvaluations: RuntimeFailureEvaluation[]
  leaseEvents: RuntimeLeaseEvent[]
  currentCheckpoint: RuntimeExecutionCheckpoint | null
  currentLease: RuntimeLeaseEvent | null
  leaseStatus: RuntimeLeaseStatus
  startedAt: Date | null
  updatedAt: Date | null
}

export type RuntimeExecutionTraceEntry =
  | {
      kind: "CHECKPOINT"
      eventId: number
      attempt: number
      sequence: number
      state: string
      detail: string | null
      leaseStatus: RuntimeLeaseStatus
      evidence: RuntimeCheckpointEvidence
      payloadDigest: string | null
      recordedAt: Date
    }
  | {
      kind: "FAILURE_EVALUATION"
      eventId: number
      attempt: number
      sequence: number
      state: string
      detail: string | null
      failureClass: string
      disposition: string
      evidenceDigest: string | null
      recordedAt: Date
    }

export type RuntimeExecutionTimestamps = {
  createdAt: Date
  updatedAt: Date
  closedAt: Date | null
  completedAt: Date | null
  firstCheckpointAt: Date | null
  lastCheckpointAt: Date | null
}

export type RuntimeExecutionTruth = {
  workOrderId: number
  workOrderRef: string
  title: string
  goal: string | null
  lane: string | null
  status: string
  result: string | null
  commitRef: string | null
  evidence: string[]
  attempts: RuntimeExecutionAttempt[]
  currentAttempt: RuntimeExecutionAttempt | null
  currentCheckpoint: RuntimeExecutionCheckpoint | null
  currentLeaseStatus: RuntimeLeaseStatus
  terminalFailureEvaluation: RuntimeFailureEvaluation | null
  timestamps: RuntimeExecutionTimestamps
  trace: RuntimeExecutionTraceEntry[]
}

export type RuntimeExecutionPanelAttempt = {
  workOrderId: number
  workOrderRef: string
  attempt: number
  status: string
  result: string | null
  checkpointSequence: number | null
  checkpointState: string | null
  checkpointDetail: string | null
  leaseStatus: RuntimeLeaseStatus
  failureEvaluation: RuntimeFailureEvaluation | null
  commitRef: string | null
  evidence: string[]
  recordedAt: Date | null
}

export type RuntimeExecutionTraceEvent = {
  id: number
  eventType: typeof RUNTIME_CHECKPOINT_EVENT | typeof RUNTIME_FAILURE_EVENT
  entityType: "work_order"
  entityId: string
  actor: "hermes-codex-bridge"
  createdAt: Date
  metadata: {
    attempt: number
    checkpointSequence: number
    checkpointState: string
    payloadDigest?: string
    evidenceDigest?: string
    failureClass?: string
    disposition?: string
    sourceCheckpointId?: number
    sourceCheckpointKey?: string
  }
}

export type RuntimeExecutionQueryResult = {
  executions: RuntimeExecutionTruth[]
  attempts: RuntimeExecutionPanelAttempt[]
  activeAttempts: RuntimeExecutionPanelAttempt[]
  terminalAttempts: RuntimeExecutionPanelAttempt[]
  completedAttempts: RuntimeExecutionPanelAttempt[]
  events: RuntimeExecutionTraceEvent[]
}

type Metadata = Record<string, unknown>

function metadata(value: unknown): Metadata | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Metadata
    : null
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function evidence(value: Metadata): RuntimeCheckpointEvidence {
  return {
    prNumber: integer(value.prNumber),
    commit: text(value.commit),
    priorHeadRefOid: text(value.priorHeadRefOid),
    headRefOid: text(value.headRefOid),
    mergeSha: text(value.mergeSha),
  }
}

export function runtimeLeaseStatusForCheckpoint(state: string): RuntimeLeaseStatus {
  if (state === "COMPLETE" || state === "FAILED_TERMINAL") return "RELEASE_PENDING"
  if (
    state === "PROVIDER_UNAVAILABLE"
    || state === "RETRYABLE_WALL"
    || state.startsWith("DEFERRED_")
    || state.endsWith("_RETRY")
    || state.endsWith("_RECOVERED")
  ) {
    return "ABANDON_PENDING"
  }
  if (/^[A-Z][A-Z0-9_]+$/.test(state)) return "ACTIVE"
  return "UNKNOWN"
}

function checkpointFromEvent(
  event: RuntimeExecutionGovernanceEventRecord,
): RuntimeExecutionCheckpoint | null {
  const value = metadata(event.metadata)
  if (!value) return null
  const attempt = integer(value.attempt)
  const sequence = integer(value.checkpointSequence)
  const state = text(value.checkpointState)
  const idempotencyKey = text(value.idempotencyKey)
  if (attempt === null || attempt < 1 || sequence === null || state === null || idempotencyKey === null) {
    return null
  }
  return {
    eventId: event.id,
    idempotencyKey,
    attempt,
    sequence,
    state,
    detail: text(value.checkpointDetail),
    leaseStatus: runtimeLeaseStatusForCheckpoint(state),
    evidence: evidence(value),
    payloadDigest: text(value.payloadDigest),
    recordedAt: event.createdAt,
  }
}

function failureFromEvent(
  event: RuntimeExecutionGovernanceEventRecord,
): RuntimeFailureEvaluation | null {
  const value = metadata(event.metadata)
  if (!value) return null
  const attempt = integer(value.attempt)
  const sequence = integer(value.checkpointSequence)
  const checkpointState = text(value.checkpointState)
  const failureClass = text(value.failureClass)
  const disposition = text(value.disposition)
  if (
    attempt === null
    || attempt < 1
    || sequence === null
    || checkpointState === null
    || failureClass === null
    || disposition === null
  ) {
    return null
  }
  return {
    eventId: event.id,
    sourceCheckpointId: integer(value.sourceCheckpointId),
    sourceCheckpointKey: text(value.sourceCheckpointKey),
    attempt,
    sequence,
    checkpointState,
    failureClass,
    disposition,
    detail: text(value.detail),
    evidenceDigest: text(value.evidenceDigest) ?? text(value.payloadDigest),
    recordedAt: event.createdAt,
  }
}

function leaseFromEvent(
  event: RuntimeExecutionGovernanceEventRecord,
): RuntimeLeaseEvent | null {
  const value = metadata(event.metadata)
  if (!value) return null
  const attempt = integer(value.attempt)
  const checkpointSequence = integer(value.checkpointSequence)
  const status = text(value.leaseStatus)
  const expiresAtValue = text(value.leaseExpiresAt)
  const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null
  const idempotencyKey = text(value.idempotencyKey)
  if (attempt === null || attempt < 1 || checkpointSequence === null
    || !["ACTIVE", "ABANDONED", "DEFERRED", "RELEASED"].includes(status ?? "")
    || !expiresAt || !Number.isFinite(expiresAt.getTime()) || !idempotencyKey) {
    return null
  }
  return {
    eventId: event.id,
    idempotencyKey,
    attempt,
    checkpointSequence,
    status: status as RuntimeLeaseStatus,
    expiresAt,
    recordedAt: event.createdAt,
  }
}

function byCheckpointPosition(
  left: RuntimeExecutionCheckpoint,
  right: RuntimeExecutionCheckpoint,
): number {
  return left.sequence - right.sequence || left.eventId - right.eventId
}

function byFailurePosition(
  left: RuntimeFailureEvaluation,
  right: RuntimeFailureEvaluation,
): number {
  return left.sequence - right.sequence || left.eventId - right.eventId
}

function byTraceTime(left: RuntimeExecutionTraceEntry, right: RuntimeExecutionTraceEntry): number {
  return left.recordedAt.getTime() - right.recordedAt.getTime() || left.eventId - right.eventId
}

export function buildRuntimeExecutionTruth(
  userId: string,
  workOrders: RuntimeExecutionWorkOrderRecord[],
  events: RuntimeExecutionGovernanceEventRecord[],
): RuntimeExecutionTruth[] {
  const ownedWorkOrders = workOrders.filter((row) => (
    row.userId === userId && row.ref?.startsWith("WO-HERMES-OUTCOME-")
  ))
  const ownedIds = new Set(ownedWorkOrders.map((row) => String(row.id)))
  const eventsByWorkOrder = new Map<string, RuntimeExecutionGovernanceEventRecord[]>()

  for (const event of events) {
    if (
      event.userId !== userId
      || event.entityType !== "work_order"
      || event.entityId === null
      || !ownedIds.has(event.entityId)
      || ![RUNTIME_CHECKPOINT_EVENT, RUNTIME_FAILURE_EVENT, RUNTIME_LEASE_EVENT].includes(event.eventType)
    ) {
      continue
    }
    const current = eventsByWorkOrder.get(event.entityId) ?? []
    current.push(event)
    eventsByWorkOrder.set(event.entityId, current)
  }

  return ownedWorkOrders.map((workOrder) => {
    const attemptMap = new Map<number, {
      checkpoints: RuntimeExecutionCheckpoint[]
      failureEvaluations: RuntimeFailureEvaluation[]
      leaseEvents: RuntimeLeaseEvent[]
    }>()
    const trace: RuntimeExecutionTraceEntry[] = []

    for (const event of eventsByWorkOrder.get(String(workOrder.id)) ?? []) {
      if (event.eventType === RUNTIME_CHECKPOINT_EVENT) {
        const checkpoint = checkpointFromEvent(event)
        if (!checkpoint) continue
        const attempt = attemptMap.get(checkpoint.attempt) ?? {
          checkpoints: [],
          failureEvaluations: [],
          leaseEvents: [],
        }
        attempt.checkpoints.push(checkpoint)
        attemptMap.set(checkpoint.attempt, attempt)
        trace.push({
          kind: "CHECKPOINT",
          eventId: checkpoint.eventId,
          attempt: checkpoint.attempt,
          sequence: checkpoint.sequence,
          state: checkpoint.state,
          detail: checkpoint.detail,
          leaseStatus: checkpoint.leaseStatus,
          evidence: checkpoint.evidence,
          payloadDigest: checkpoint.payloadDigest ?? null,
          recordedAt: checkpoint.recordedAt,
        })
      } else if (event.eventType === RUNTIME_FAILURE_EVENT) {
        const failure = failureFromEvent(event)
        if (!failure) continue
        const attempt = attemptMap.get(failure.attempt) ?? {
          checkpoints: [],
          failureEvaluations: [],
          leaseEvents: [],
        }
        attempt.failureEvaluations.push(failure)
        attemptMap.set(failure.attempt, attempt)
        trace.push({
          kind: "FAILURE_EVALUATION",
          eventId: failure.eventId,
          attempt: failure.attempt,
          sequence: failure.sequence,
          state: failure.checkpointState,
          detail: failure.detail,
          failureClass: failure.failureClass,
          disposition: failure.disposition,
          evidenceDigest: failure.evidenceDigest ?? null,
          recordedAt: failure.recordedAt,
        })
      } else {
        const lease = leaseFromEvent(event)
        if (!lease) continue
        const attempt = attemptMap.get(lease.attempt) ?? {
          checkpoints: [],
          failureEvaluations: [],
          leaseEvents: [],
        }
        attempt.leaseEvents.push(lease)
        attemptMap.set(lease.attempt, attempt)
      }
    }

    const attempts = [...attemptMap.entries()]
      .sort(([left], [right]) => left - right)
      .map<RuntimeExecutionAttempt>(([attemptNumber, value]) => {
        const checkpoints = value.checkpoints.sort(byCheckpointPosition)
        const failureEvaluations = value.failureEvaluations.sort(byFailurePosition)
        const leaseEvents = value.leaseEvents.sort((left, right) => (
          left.checkpointSequence - right.checkpointSequence
          || left.eventId - right.eventId
        ))
        const currentCheckpoint = checkpoints.at(-1) ?? null
        const currentLease = leaseEvents.at(-1) ?? null
        const times = [...checkpoints, ...failureEvaluations, ...leaseEvents]
          .map((entry) => entry.recordedAt)
          .sort((left, right) => left.getTime() - right.getTime())
        return {
          attempt: attemptNumber,
          checkpoints,
          failureEvaluations,
          leaseEvents,
          currentCheckpoint,
          currentLease,
          leaseStatus: currentLease?.status ?? currentCheckpoint?.leaseStatus ?? "UNKNOWN",
          startedAt: times[0] ?? null,
          updatedAt: times.at(-1) ?? null,
        }
      })
    const currentAttempt = attempts.at(-1) ?? null
    const checkpointTimes = attempts
      .flatMap((attempt) => attempt.checkpoints)
      .map((checkpoint) => checkpoint.recordedAt)
      .sort((left, right) => left.getTime() - right.getTime())
    const terminalFailureEvaluation = attempts
      .flatMap((attempt) => attempt.failureEvaluations)
      .filter((failure) => failure.failureClass === "TERMINAL_RUNTIME_FAILURE")
      .sort((left, right) => (
        left.recordedAt.getTime() - right.recordedAt.getTime() || left.eventId - right.eventId
      ))
      .at(-1) ?? null

    return {
      workOrderId: workOrder.id,
      workOrderRef: workOrder.ref!,
      title: workOrder.title,
      goal: workOrder.goal,
      lane: workOrder.lane,
      status: workOrder.status,
      result: workOrder.result,
      commitRef: workOrder.commitRef,
      evidence: [...workOrder.evidence],
      attempts,
      currentAttempt,
      currentCheckpoint: currentAttempt?.currentCheckpoint ?? null,
      currentLeaseStatus: currentAttempt?.leaseStatus ?? "UNKNOWN",
      terminalFailureEvaluation,
      timestamps: {
        createdAt: workOrder.createdAt,
        updatedAt: workOrder.updatedAt,
        closedAt: workOrder.closedAt,
        completedAt: workOrder.completedAt,
        firstCheckpointAt: checkpointTimes[0] ?? null,
        lastCheckpointAt: checkpointTimes.at(-1) ?? null,
      },
      trace: trace.sort(byTraceTime),
    }
  }).sort((left, right) => (
    right.timestamps.updatedAt.getTime() - left.timestamps.updatedAt.getTime()
    || right.workOrderId - left.workOrderId
  ))
}

function panelAttemptKind(
  attempt: RuntimeExecutionPanelAttempt,
): "active" | "terminal" | "completed" {
  if (attempt.checkpointState === "COMPLETE") return "completed"
  if (attempt.checkpointState === "FAILED_TERMINAL") return "terminal"
  if (attempt.checkpointState) return "active"
  if (attempt.status === "closed") return "completed"
  if (attempt.status === "aborted") return "terminal"
  return "active"
}

export function projectRuntimeExecutionQuery(
  executions: RuntimeExecutionTruth[],
): RuntimeExecutionQueryResult {
  const attempts = executions.flatMap<RuntimeExecutionPanelAttempt>((execution) => (
    execution.attempts.map((attempt) => {
      const current = attempt.currentCheckpoint
      return {
        workOrderId: execution.workOrderId,
        workOrderRef: execution.workOrderRef,
        attempt: attempt.attempt,
        status: execution.status,
        result: execution.result,
        checkpointSequence: current?.sequence ?? null,
        checkpointState: current?.state ?? null,
        checkpointDetail: current?.detail ?? null,
        leaseStatus: attempt.leaseStatus,
        failureEvaluation: attempt.failureEvaluations.at(-1) ?? null,
        commitRef: current?.evidence.mergeSha
          ?? current?.evidence.commit
          ?? current?.evidence.headRefOid
          ?? execution.commitRef,
        evidence: [...execution.evidence],
        recordedAt: attempt.updatedAt,
      }
    })
  ))

  const events = executions.flatMap<RuntimeExecutionTraceEvent>((execution) => (
    execution.trace.map((entry) => {
      if (entry.kind === "CHECKPOINT") {
        return {
          id: entry.eventId,
          eventType: RUNTIME_CHECKPOINT_EVENT,
          entityType: "work_order",
          entityId: execution.workOrderRef,
          actor: "hermes-codex-bridge",
          createdAt: entry.recordedAt,
          metadata: {
            attempt: entry.attempt,
            checkpointSequence: entry.sequence,
            checkpointState: entry.state,
            ...(entry.payloadDigest ? { payloadDigest: entry.payloadDigest } : {}),
          },
        }
      }
      return {
        id: entry.eventId,
        eventType: RUNTIME_FAILURE_EVENT,
        entityType: "work_order",
        entityId: execution.workOrderRef,
        actor: "hermes-codex-bridge",
        createdAt: entry.recordedAt,
        metadata: {
          attempt: entry.attempt,
          checkpointSequence: entry.sequence,
          checkpointState: entry.state,
          failureClass: entry.failureClass,
          disposition: entry.disposition,
          ...(entry.evidenceDigest ? { evidenceDigest: entry.evidenceDigest } : {}),
        },
      }
    })
  ))

  return {
    executions,
    attempts,
    activeAttempts: attempts.filter((attempt) => panelAttemptKind(attempt) === "active"),
    terminalAttempts: attempts.filter((attempt) => panelAttemptKind(attempt) === "terminal"),
    completedAttempts: attempts.filter((attempt) => panelAttemptKind(attempt) === "completed"),
    events,
  }
}
