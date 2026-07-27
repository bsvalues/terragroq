import type {
  GoalAuthorityDecisionChoice,
  GoalTimelineProjection,
} from "@/components/goal-console/goal-timeline-read-model"

export type GoalAuthorityDecisionHandler = (
  timeline: GoalTimelineProjection,
  choice: GoalAuthorityDecisionChoice,
) => void

const HERMES_OUTCOME_WORK_ORDER_PREFIX = "WO-HERMES-OUTCOME-"
const AUTHORITY_DECISION_EVENT = "HERMES_OWNER_AUTHORITY_DECISION"
const OUTCOME_COMPLETED_EVENT = "HERMES_OUTCOME_COMPLETED"
const OUTCOME_TERMINAL_EVENT = "HERMES_OUTCOME_TERMINAL"

function positiveGoalId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null
  const goalId = Number(value)
  return Number.isSafeInteger(goalId) ? goalId : null
}

function positiveMetadataId(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  return typeof value === "string" ? positiveGoalId(value) : null
}

function eventMetadata(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function goalIdFromWorkOrderRef(ref: string | null) {
  if (!ref?.startsWith(HERMES_OUTCOME_WORK_ORDER_PREFIX)) return null
  return positiveGoalId(ref.slice(HERMES_OUTCOME_WORK_ORDER_PREFIX.length))
}

function receiptResolves(
  event: {
    id: number
    eventType: string
    entityId: string | null
    metadata: unknown
  },
  goalId: number,
  binding: { terminalEventId?: number; workOrderId?: number },
) {
  if (event.eventType !== AUTHORITY_DECISION_EVENT
    || event.entityId !== String(goalId)) return false
  const metadata = eventMetadata(event.metadata)
  const terminalEventId = positiveMetadataId(metadata?.terminalEventId)
  const workOrderId = positiveMetadataId(metadata?.workOrderId)
  if (!metadata
    || positiveMetadataId(metadata.outcomeId) !== goalId
    || positiveMetadataId(metadata.decisionId) === null
    || terminalEventId === null
    || workOrderId === null
    || typeof metadata.ownerUserId !== "string"
    || metadata.ownerUserId.length === 0
    || typeof metadata.expectedNextState !== "string"
    || !/^[A-Z][A-Z0-9_]{1,79}$/.test(metadata.expectedNextState)
    || !["APPROVE", "DENY"].includes(String(metadata.choice))) return false
  if (binding.terminalEventId !== undefined
    && terminalEventId !== binding.terminalEventId) return false
  if (binding.workOrderId !== undefined
    && workOrderId !== binding.workOrderId) return false
  return true
}

export function getUnresolvedAuthorityRequestGoalIds(
  workOrders: Iterable<{
    id: number
    ref: string | null
    updatedAt: Date
  }>,
  lifecycleEvents: Iterable<{
    id: number
    eventType: string
    entityId: string | null
    metadata: unknown
  }>,
) {
  const newestEvents = Array.from(lifecycleEvents)
    .sort((left, right) => right.id - left.id)
  const eventsByGoal = new Map<number, typeof newestEvents>()
  for (const event of newestEvents) {
    const goalId = event.entityId === null ? null : positiveGoalId(event.entityId)
    if (goalId === null) continue
    const goalEvents = eventsByGoal.get(goalId) ?? []
    goalEvents.push(event)
    eventsByGoal.set(goalId, goalEvents)
  }

  const goalIdsWithPersistedState = new Set<number>()
  const unresolvedGoalIds = new Set<number>()
  for (const [goalId, goalEvents] of eventsByGoal) {
    const latestState = goalEvents.find((event) => (
      event.eventType === OUTCOME_TERMINAL_EVENT
      || event.eventType === OUTCOME_COMPLETED_EVENT
    ))
    if (!latestState) continue
    goalIdsWithPersistedState.add(goalId)
    if (latestState.eventType === OUTCOME_COMPLETED_EVENT) continue
    if (eventMetadata(latestState.metadata)?.result !== "OWNER_DECISION_REQUIRED") continue
    const resolved = goalEvents.some((event) => (
      event.id > latestState.id
      && receiptResolves(event, goalId, { terminalEventId: latestState.id })
    ))
    if (!resolved) unresolvedGoalIds.add(goalId)
  }

  const newestWorkOrders = Array.from(workOrders).sort((left, right) => (
    right.updatedAt.getTime() - left.updatedAt.getTime() || right.id - left.id
  ))
  const seenFallbackGoalIds = new Set<number>()
  for (const workOrder of newestWorkOrders) {
    const goalId = goalIdFromWorkOrderRef(workOrder.ref)
    if (goalId === null
      || goalIdsWithPersistedState.has(goalId)
      || seenFallbackGoalIds.has(goalId)) continue
    seenFallbackGoalIds.add(goalId)
    const resolved = eventsByGoal.get(goalId)?.some((event) => (
      receiptResolves(event, goalId, { workOrderId: workOrder.id })
    )) ?? false
    if (!resolved) {
      unresolvedGoalIds.add(goalId)
    }
  }

  return Array.from(unresolvedGoalIds)
}

export function getActiveGoalAuthorityRequests(
  timelines: Iterable<GoalTimelineProjection>,
) {
  return Array.from(timelines).filter(
    (timeline) => timeline.decisionRequest.status === "ACTIONABLE",
  )
}

export function buildNeedsMyDecisionView(
  timelines: Iterable<GoalTimelineProjection>,
  onAuthorityDecision: GoalAuthorityDecisionHandler,
) {
  return getActiveGoalAuthorityRequests(timelines).map((timeline) => {
    const request = timeline.decisionRequest

    return {
      id: timeline.id,
      title: timeline.goal.outcome,
      whyNeeded: request.authorityBoundary,
      blockedAction: request.blockedAction,
      goalRef: request.goalRef,
      outcomeRef: request.outcomeRef,
      workOrderRef: request.workOrderRef,
      expectedNextState: request.expectedNextState,
      choices: request.choices.map((choice) => ({
        choice,
        label: choice === "APPROVE" ? "Approve resume" : "Deny keep blocked",
        consequence: choice === "APPROVE"
          ? request.consequences.approve
          : request.consequences.deny,
        select: () => onAuthorityDecision(timeline, choice),
      })),
    }
  })
}
