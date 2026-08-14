export type WorkbenchExecutionTruthState = "persisted" | "unknown"
export type WorkbenchExecutionAvailability = "available" | "unavailable" | "degraded"
export type WorkbenchExecutionFreshnessState = "fresh" | "stale" | "unknown"

export type ExecutionDrilldown = Readonly<{
  mode: "EXACT" | "REGISTER" | "UNAVAILABLE"
  href: string | null
}>

export type ExecutionFacet = Readonly<{
  id: string
  state: string
  summary: string | null
  occurredAt: string
  truthState: WorkbenchExecutionTruthState
  drilldown: ExecutionDrilldown
}>

export type ExecutionAgent = Readonly<{
  id: string
  kind: "assignment" | "lease" | "claim" | "acquisition"
  agent: string | null
  state: string
  summary: string | null
  occurredAt: string
  truthState: WorkbenchExecutionTruthState
  drilldown: ExecutionDrilldown
}>

export type ExecutionCheckpoint = Readonly<{
  eventId: number
  sequence: number
  state: string
  detail: string | null
  recordedAt: string
  drilldown: ExecutionDrilldown
}>

export type ExecutionAttempt = Readonly<{
  attempt: number
  checkpoints: ExecutionCheckpoint[]
  currentState: string | null
  updatedAt: string | null
}>

export type WorkbenchExecutionProjection = Readonly<{
  availability: WorkbenchExecutionAvailability
  scope: Readonly<{ projectId: number; threadId: string }>
  truthState: WorkbenchExecutionTruthState
  observedAt: string | null
  latestPersistedAt: string | null
  freshness: Readonly<{ state: WorkbenchExecutionFreshnessState; detail: string | null }>
  work: Readonly<{
    outcomes: ReadonlyArray<Readonly<{
      id: string; title: string; state: string; drilldown: ExecutionDrilldown
      /** Fixture compatibility only; the server projection intentionally omits this field. */
      updatedAt?: string
    }>>
    workOrders: ReadonlyArray<Readonly<{
      id: number; ref: string | null; state: string; drilldown: ExecutionDrilldown
      /** Fixture compatibility only; the server projection intentionally omits these fields. */
      title?: string; result?: string | null; updatedAt?: string
    }>>
  }>
  agents: ExecutionAgent[]
  attempts: ExecutionAttempt[]
  validations: ExecutionFacet[]
  reviews: ExecutionFacet[]
  remediations: ExecutionFacet[]
  deliveries: ExecutionFacet[]
  events: ExecutionFacet[]
  evidence: ExecutionFacet[]
  recoveries: ExecutionFacet[]
  coverage: Readonly<{ truncated: boolean; truncatedKinds: string[]; missing: string[]; conflicts: string[] }>
  controls: Readonly<{ terminal: false; steer: false; pause: false; stop: false }>
}>

export type ExecutionBindingRow = { threadId: string; userId: string; sourceType: "goal" | "outcome"; sourceId: string; role: "root" | "member" }
export type ExecutionGoalRow = { id: number; userId: string; linkedWorkOrderId: number | null; updatedAt: Date }
export type ExecutionOutcomeRow = {
  id: number; userId: string; outcomeKey: string; goalId: number | null; title: string; lifecycleState: string
  activeWorkOrderId: number | null; leaseHolder: string | null; leaseExpiresAt: Date | null
  terminalEvidenceId: number | null; updatedAt: Date
}
export type ExecutionWorkOrderRow = {
  id: number; userId: string; ref: string | null; status: string
  assignee: string | null; agent: string | null; updatedAt: Date
}
export type ExecutionClaimRow = {
  id: number; userId: string; workOrderId: number | null
  agent: string; classification: string; createdAt: Date
}
export type ExecutionLoopRow = {
  id: number; userId: string; workOrderId: number | null; loopType: string; iteration: number
  status: string; createdAt: Date
}
export type ExecutionEvidenceRow = {
  id: number; userId: string; workOrderId: number; result: string; validators: string[]
  notes: string | null; createdAt: Date
}
export type ExecutionGovernanceRow = {
  id: number; userId: string; entityType: string | null; entityId: string | null; eventType: string
  reason: string | null; metadata: unknown; createdAt: Date
}
export type ExecutionAuditRow = {
  id: number; userId: string; type: string; summary: string; register: string | null; refId: number | null
  metadata: unknown; createdAt: Date
}
export type ExecutionAcquisitionRow = {
  id: number; userId: string; outcomeKey: string | null; activeWorkOrderId: number | null; processIdentity: string
  leaseHolder: string; checkpointSequence: number; checkpointState: string; disposition: string; reason: string | null
  attemptedAt: Date
}

export type WorkbenchExecutionProjectionInput = {
  userId: string
  projectId: number
  threadId: string
  observedAt: Date
  staleAfterMs?: number
  bindings: ExecutionBindingRow[]
  goals: ExecutionGoalRow[]
  outcomes: ExecutionOutcomeRow[]
  workOrders: ExecutionWorkOrderRow[]
  claims: ExecutionClaimRow[]
  loops: ExecutionLoopRow[]
  evidence: ExecutionEvidenceRow[]
  governanceEvents: ExecutionGovernanceRow[]
  auditEvents: ExecutionAuditRow[]
  acquisitionAttempts: ExecutionAcquisitionRow[]
  truncatedKinds: string[]
  degraded?: boolean
}

const VALIDATION_STATES = new Set(["VALIDATING", "VALIDATION_PASSED", "VALIDATION_FAILED", "HOST_VALIDATION_STARTED", "HOST_VALIDATION_PASSED", "CI_RUNNING", "CI_PASSED", "CI_FAILED"])
const REVIEW_STATES = new Set(["INDEPENDENT_REVIEW", "REVIEW_PENDING", "REVIEW_APPROVED", "REVIEW_CHANGES_REQUESTED", "PR_REVIEW_REQUESTED"])
const REMEDIATION_STATES = new Set(["REMEDIATING", "REVIEW_REMEDIATION_REQUIRED", "VALIDATION_REMEDIATION_REQUIRED"])
const DELIVERY_STATES = new Set(["COMMIT_CREATED", "PR_OPEN", "PR_MERGED", "MERGED", "DELIVERED", "DEPENDENTS_RELEASED", "COMPLETE"])
const RECOVERY_STATES = new Set(["REVIEW_REMEDIATION_RECOVERED", "VALIDATION_INFRASTRUCTURE_RECOVERED", "POST_MERGE_CLEANUP_RECOVERED", "EXTERNAL_TOOL_WALL_RECOVERED", "PROVIDER_RECOVERED"])
const RECOVERY_EVENT_TYPES = new Set(["HERMES_OUTCOME_PROVIDER_RECOVERED", "HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED", "HERMES_OUTCOME_REVIEW_RECOVERED", "HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED"])
const RUNTIME_EVENT_TYPES = new Set(["HERMES_RUNTIME_CHECKPOINT", "HERMES_RUNTIME_FAILURE_EVAL", "HERMES_RUNTIME_LEASE"])

const unavailableDrilldown: ExecutionDrilldown = { mode: "UNAVAILABLE", href: null }

function traceDrilldown(id: number): ExecutionDrilldown {
  const reference = `trace:${id}`
  return { mode: "EXACT", href: `/trace?trace=${encodeURIComponent(reference)}#trace-record-trace-${id}` }
}

function evidenceDrilldown(id: number): ExecutionDrilldown {
  const reference = `evidence:${id}`
  return { mode: "EXACT", href: `/audit?evidence=${encodeURIComponent(reference)}#evidence-record-evidence-${id}` }
}

function auditDrilldown(id: number): ExecutionDrilldown {
  const reference = `audit:${id}`
  return { mode: "EXACT", href: `/audit?audit=${encodeURIComponent(reference)}#audit-record-audit-${id}` }
}

function workOrderDrilldown(id: number): ExecutionDrilldown {
  return { mode: "EXACT", href: `/work-orders#work-order-${id}` }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const MAX_CLIENT_TEXT_LENGTH = 500

function safeText(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null
  return value
    .replace(/authorization\s*:\s*bearer\s+[^\s,;]+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[JWT REDACTED]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[PEM REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[GITHUB KEY REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[AWS KEY REDACTED]")
    .replace(/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, "[PROVIDER KEY REDACTED]")
    .replace(/\b(?:cookie|set-cookie|session|sessionid|connect\.sid)\s*[:=]\s*[^\s,;]+/gi, "[SESSION REDACTED]")
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|mssql):\/\/[^\s]+/gi, "[CONNECTION REDACTED]")
    .replace(/\b(?:token|password|secret|leaseToken|acquisitionKey|executionBinding|idempotencyKey)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]")
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s,;]+/g, "[PATH REDACTED]")
    .slice(0, MAX_CLIENT_TEXT_LENGTH)
}

function requiredText(value: unknown): string {
  return safeText(value) ?? "[UNAVAILABLE]"
}

function safeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function iso(value: Date): string {
  return value.toISOString()
}

function isoOrNull(value: Date): string | null {
  return Number.isFinite(value.getTime()) ? iso(value) : null
}

function newest<T extends { updatedAt: Date; id: string | number }>(left: T, right: T): number {
  return right.updatedAt.getTime() - left.updatedAt.getTime() || String(right.id).localeCompare(String(left.id))
}

function chronological(left: ExecutionFacet, right: ExecutionFacet): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id, undefined, { numeric: true })
}

function emptyProjection(input: WorkbenchExecutionProjectionInput, conflicts: string[]): WorkbenchExecutionProjection {
  return {
    availability: input.degraded ? "degraded" : "unavailable",
    scope: { projectId: input.projectId, threadId: requiredText(input.threadId) },
    truthState: "unknown",
    observedAt: isoOrNull(input.observedAt),
    latestPersistedAt: null,
    freshness: { state: "unknown", detail: "No exact persisted execution membership is available." },
    work: { outcomes: [], workOrders: [] },
    agents: [], attempts: [], validations: [], reviews: [], remediations: [], deliveries: [], events: [], evidence: [], recoveries: [],
    coverage: { truncated: input.truncatedKinds.length > 0, truncatedKinds: [...new Set(input.truncatedKinds)].sort(), missing: [], conflicts },
    controls: { terminal: false, steer: false, pause: false, stop: false },
  }
}

export function projectWorkbenchExecution(input: WorkbenchExecutionProjectionInput): WorkbenchExecutionProjection {
  const roots = input.bindings.filter((binding) => binding.userId === input.userId && binding.threadId === input.threadId && binding.role === "root")
  if (roots.length !== 1) {
    const safeThreadId = requiredText(input.threadId)
    return emptyProjection(input, [roots.length === 0 ? `ROOT_BINDING_MISSING:${safeThreadId}` : `ROOT_BINDING_AMBIGUOUS:${safeThreadId}`])
  }

  const selectedBindings = input.bindings.filter((row) => row.userId === input.userId && row.threadId === input.threadId)
  const directlyBoundGoalIds = selectedBindings
    .filter((row) => row.sourceType === "goal")
    .map((row) => Number(row.sourceId))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  const directlyBoundOutcomeKeys = new Set(selectedBindings.filter((row) => row.sourceType === "outcome").map((row) => row.sourceId))
  const outcomes = input.outcomes.filter((row) => row.userId === input.userId && (
    directlyBoundOutcomeKeys.has(row.outcomeKey)
    || (row.goalId !== null && directlyBoundGoalIds.includes(row.goalId))
  ))
  const goalIds = new Set([...directlyBoundGoalIds, ...outcomes.flatMap((row) => row.goalId === null ? [] : [row.goalId])])
  const goals = input.goals.filter((row) => row.userId === input.userId && goalIds.has(row.id))
  const selectedGoalIds = new Set(goals.map((row) => row.id))
  const targetWorkOrderIds = new Set([
    ...goals.flatMap((row) => row.linkedWorkOrderId === null ? [] : [row.linkedWorkOrderId]),
    ...outcomes.flatMap((row) => row.activeWorkOrderId === null ? [] : [row.activeWorkOrderId]),
  ])
  const workOrders = input.workOrders.filter((row) => row.userId === input.userId && targetWorkOrderIds.has(row.id))
  const workOrderIds = new Set(workOrders.map((row) => row.id))
  const outcomeKeys = new Set(outcomes.map((row) => row.outcomeKey))
  const missing: string[] = []
  const conflicts: string[] = []
  for (const workOrderId of targetWorkOrderIds) {
    if (!workOrderIds.has(workOrderId)) missing.push(`work_order:${workOrderId}`)
  }
  for (const binding of selectedBindings) {
    const exists = binding.sourceType === "goal"
      ? goals.some((row) => String(row.id) === binding.sourceId)
      : outcomes.some((row) => row.outcomeKey === binding.sourceId)
    if (!exists) missing.push(`${binding.sourceType}:${requiredText(binding.sourceId)}`)
  }
  for (const goalId of directlyBoundGoalIds) {
    if (outcomes.filter((row) => row.goalId === goalId).length > 1) {
      conflicts.push(`AMBIGUOUS_GOAL_OUTCOMES:${goalId}`)
    }
  }

  const facets: ExecutionFacet[] = []
  const checkpointRows: Array<{ attempt: number; checkpoint: ExecutionCheckpoint }> = []
  const allowedGovernance = input.governanceEvents.filter((row) => {
    if (row.userId !== input.userId || row.entityId === null) return false
    const linked = (row.entityType === "work_order" && workOrderIds.has(Number(row.entityId)))
      || (row.entityType === "goal" && selectedGoalIds.has(Number(row.entityId)))
      || (row.entityType === "outcome_queue_item" && outcomeKeys.has(row.entityId))
    if (!linked) return false
    const metadata = record(row.metadata)
    const state = safeText(metadata.checkpointState)
    if (RUNTIME_EVENT_TYPES.has(row.eventType)) {
      const attempt = safeInteger(metadata.attempt)
      const sequence = safeInteger(metadata.checkpointSequence)
      if (attempt === null || attempt < 1 || sequence === null || sequence < 0 || state === null) return false
    }
    return RUNTIME_EVENT_TYPES.has(row.eventType) || RECOVERY_EVENT_TYPES.has(row.eventType)
      || (state !== null && [VALIDATION_STATES, REVIEW_STATES, REMEDIATION_STATES, DELIVERY_STATES, RECOVERY_STATES].some((states) => states.has(state)))
      || [VALIDATION_STATES, REVIEW_STATES, REMEDIATION_STATES, DELIVERY_STATES, RECOVERY_STATES].some((states) => states.has(row.eventType))
  })

  for (const row of allowedGovernance) {
    const metadata = record(row.metadata)
    const state = safeText(metadata.checkpointState) ?? requiredText(row.eventType)
    const facet: ExecutionFacet = {
      id: `governance:${row.id}`,
      state,
      summary: safeText(metadata.checkpointDetail) ?? safeText(metadata.detail) ?? safeText(row.reason),
      occurredAt: iso(row.createdAt),
      truthState: "persisted",
      drilldown: traceDrilldown(row.id),
    }
    facets.push(facet)
    if (row.eventType === "HERMES_RUNTIME_CHECKPOINT") {
      const attempt = safeInteger(metadata.attempt)
      const sequence = safeInteger(metadata.checkpointSequence)
      if (attempt !== null && attempt > 0 && sequence !== null && state !== row.eventType) {
        checkpointRows.push({
          attempt,
          checkpoint: { eventId: row.id, sequence, state, detail: facet.summary, recordedAt: facet.occurredAt, drilldown: facet.drilldown },
        })
      }
    }
  }

  for (const row of input.auditEvents.filter((candidate) => candidate.userId === input.userId)) {
    const linked = (row.register === "work-orders" && row.refId !== null && workOrderIds.has(row.refId))
      || (row.register === "goals" && row.refId !== null && selectedGoalIds.has(row.refId))
    if (!linked) continue
    const governanceId = safeInteger(record(row.metadata).governanceEventId)
    const mirrored = governanceId === null ? undefined : allowedGovernance.find((event) => event.id === governanceId)
    if (mirrored) {
      const auditState = safeText(record(row.metadata).checkpointState)
      const governanceState = safeText(record(mirrored.metadata).checkpointState) ?? mirrored.eventType
      if (auditState !== null && auditState !== governanceState) {
        conflicts.push(`MIRROR_CONFLICT:governance:${governanceId}`)
      }
      continue
    }
    facets.push({ id: `audit:${row.id}`, state: requiredText(row.type), summary: safeText(row.summary), occurredAt: iso(row.createdAt), truthState: "persisted", drilldown: auditDrilldown(row.id) })
  }
  for (const row of input.loops.filter((candidate) => candidate.userId === input.userId && candidate.workOrderId !== null && workOrderIds.has(candidate.workOrderId))) {
    facets.push({
      id: `loop:${row.id}`,
      state: requiredText(row.status),
      summary: safeText(`Persisted ${row.loopType} loop iteration ${row.iteration}.`),
      occurredAt: iso(row.createdAt),
      truthState: "persisted",
      drilldown: workOrderDrilldown(row.workOrderId!),
    })
  }

  const attempts = [...new Set(checkpointRows.map((row) => row.attempt))].sort((left, right) => left - right).map((attempt): ExecutionAttempt => {
    const checkpoints = checkpointRows.filter((row) => row.attempt === attempt).map((row) => row.checkpoint)
      .sort((left, right) => left.sequence - right.sequence || left.eventId - right.eventId)
    return { attempt, checkpoints, currentState: checkpoints.at(-1)?.state ?? null, updatedAt: checkpoints.at(-1)?.recordedAt ?? null }
  })

  const terminalEvidenceIds = new Set(outcomes.flatMap((row) => row.terminalEvidenceId === null ? [] : [row.terminalEvidenceId]))
  const linkedEvidence = input.evidence.filter((row) => row.userId === input.userId && (workOrderIds.has(row.workOrderId) || terminalEvidenceIds.has(row.id)))
  const evidence = linkedEvidence.map((row): ExecutionFacet => ({
    id: `evidence:${row.id}`,
    state: requiredText(row.result),
    summary: safeText(row.notes) ?? `${row.validators.length} validator${row.validators.length === 1 ? "" : "s"} recorded`,
    occurredAt: iso(row.createdAt), truthState: "persisted", drilldown: evidenceDrilldown(row.id),
  })).sort(chronological)

  const validationEvidence = linkedEvidence.filter((row) => workOrderIds.has(row.workOrderId) && row.validators.length > 0).map((row): ExecutionFacet => ({
    id: `validation-evidence:${row.id}`, state: "VALIDATION_RECORDED", summary: safeText(`${row.result}: ${row.validators.length} validator${row.validators.length === 1 ? "" : "s"}`),
    occurredAt: iso(row.createdAt), truthState: "persisted", drilldown: evidenceDrilldown(row.id),
  }))

  const agents: ExecutionAgent[] = []
  for (const row of workOrders) {
    for (const [kind, agent] of [["assignee", row.assignee], ["agent", row.agent]] as const) {
      if (!agent) continue
      agents.push({ id: `assignment:${row.id}:${kind}`, kind: "assignment", agent: safeText(agent), state: "assigned", summary: "Persisted assignment; not live worker telemetry.", occurredAt: iso(row.updatedAt), truthState: "persisted", drilldown: workOrderDrilldown(row.id) })
    }
  }
  for (const row of outcomes) {
    if (!row.leaseHolder) continue
    agents.push({ id: `lease:${row.id}`, kind: "lease", agent: safeText(row.leaseHolder), state: row.leaseExpiresAt && Number.isFinite(input.observedAt.getTime()) && row.leaseExpiresAt.getTime() <= input.observedAt.getTime() ? "expired" : "recorded", summary: "Persisted lease posture; not a process-liveness probe.", occurredAt: iso(row.updatedAt), truthState: "persisted", drilldown: { mode: "REGISTER", href: "/goal-console" } })
  }
  for (const row of input.claims.filter((candidate) => candidate.userId === input.userId && candidate.workOrderId !== null && workOrderIds.has(candidate.workOrderId))) {
    agents.push({ id: `claim:${row.id}`, kind: "claim", agent: safeText(row.agent), state: requiredText(row.classification), summary: "Persisted agent claim; classification does not establish current ownership.", occurredAt: iso(row.createdAt), truthState: "persisted", drilldown: { mode: "REGISTER", href: "/goal-console" } })
  }
  for (const row of input.acquisitionAttempts.filter((candidate) => candidate.userId === input.userId && ((candidate.activeWorkOrderId !== null && workOrderIds.has(candidate.activeWorkOrderId)) || outcomes.some((outcome) => outcome.outcomeKey === candidate.outcomeKey)))) {
    agents.push({ id: `acquisition:${row.id}`, kind: "acquisition", agent: safeText(row.leaseHolder || row.processIdentity), state: requiredText(row.disposition), summary: row.reason ? safeText(row.reason) : safeText(`Checkpoint ${row.checkpointSequence}: ${row.checkpointState}`), occurredAt: iso(row.attemptedAt), truthState: "persisted", drilldown: unavailableDrilldown })
  }
  agents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id, undefined, { numeric: true }))

  const allDates = [
    ...goals.map((row) => row.updatedAt),
    ...outcomes.map((row) => row.updatedAt), ...workOrders.map((row) => row.updatedAt),
    ...agents.map((row) => new Date(row.occurredAt)),
    ...facets.map((row) => new Date(row.occurredAt)),
    ...linkedEvidence.map((row) => row.createdAt),
  ].filter((date) => Number.isFinite(date.getTime()))
  const latestPersisted = allDates.sort((left, right) => left.getTime() - right.getTime()).at(-1) ?? null
  const observedMs = input.observedAt.getTime()
  const validObservedClock = Number.isFinite(observedMs)
  const expiredLease = validObservedClock && outcomes.some((row) => row.lifecycleState === "active" && row.leaseExpiresAt !== null && Number.isFinite(row.leaseExpiresAt.getTime()) && row.leaseExpiresAt.getTime() <= observedMs)
  const currentCheckpoint = attempts.at(-1)?.checkpoints.at(-1) ?? null
  const staleAfterMs = input.staleAfterMs ?? 15 * 60 * 1000
  const checkpointMs = currentCheckpoint === null ? Number.NaN : Date.parse(currentCheckpoint.recordedAt)
  const staleCheckpoint = validObservedClock && Number.isFinite(checkpointMs) && observedMs - checkpointMs > staleAfterMs
  const latestPersistedMs = latestPersisted?.getTime() ?? Number.NaN
  const persistedAgeMs = validObservedClock && Number.isFinite(latestPersistedMs) ? observedMs - latestPersistedMs : Number.NaN
  const truthState: WorkbenchExecutionTruthState = latestPersisted ? "persisted" : "unknown"

  return {
    availability: input.degraded ? "degraded" : "available",
    scope: { projectId: input.projectId, threadId: requiredText(input.threadId) }, truthState, observedAt: isoOrNull(input.observedAt),
    latestPersistedAt: latestPersisted ? iso(latestPersisted) : null,
    freshness: expiredLease
      ? { state: "stale", detail: "The persisted active lease is expired." }
      : staleCheckpoint
        ? { state: "stale", detail: `The latest active checkpoint is older than ${staleAfterMs}ms.` }
        : !validObservedClock || (Number.isFinite(persistedAgeMs) && persistedAgeMs < 0)
          ? { state: "unknown", detail: "Persisted execution freshness cannot be determined because the observation clock is invalid or precedes the latest record." }
          : latestPersisted && persistedAgeMs > staleAfterMs
            ? { state: "stale", detail: `The latest persisted execution evidence is older than ${staleAfterMs}ms.` }
            : latestPersisted ? { state: "fresh", detail: "Persisted execution evidence is within the configured freshness window." }
          : { state: "unknown", detail: "No persisted execution evidence is available." },
    work: {
      outcomes: [...outcomes].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.outcomeKey.localeCompare(left.outcomeKey)).map((row) => ({ id: requiredText(row.outcomeKey), title: requiredText(row.title), state: requiredText(row.lifecycleState), drilldown: { mode: "REGISTER" as const, href: "/goal-console" } })),
      workOrders: [...workOrders].sort(newest).map((row) => ({ id: row.id, ref: safeText(row.ref), state: requiredText(row.status), drilldown: workOrderDrilldown(row.id) })),
    },
    agents, attempts,
    validations: [...facets.filter((row) => VALIDATION_STATES.has(row.state)), ...validationEvidence].sort(chronological),
    reviews: facets.filter((row) => REVIEW_STATES.has(row.state)).sort(chronological),
    remediations: facets.filter((row) => REMEDIATION_STATES.has(row.state)).sort(chronological),
    deliveries: facets.filter((row) => DELIVERY_STATES.has(row.state)).sort(chronological),
    events: facets.sort(chronological), evidence,
    recoveries: facets.filter((row) => RECOVERY_STATES.has(row.state) || RECOVERY_EVENT_TYPES.has(row.state)).sort(chronological),
    coverage: { truncated: input.truncatedKinds.length > 0, truncatedKinds: [...new Set(input.truncatedKinds)].sort(), missing: [...new Set(missing)].sort(), conflicts: [...new Set(conflicts)].sort() },
    controls: { terminal: false, steer: false, pause: false, stop: false },
  }
}
