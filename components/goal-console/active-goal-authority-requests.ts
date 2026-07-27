import type {
  GoalAuthorityDecisionChoice,
  GoalTimelineProjection,
} from "@/components/goal-console/goal-timeline-read-model"

export type GoalAuthorityDecisionHandler = (
  timeline: GoalTimelineProjection,
  choice: GoalAuthorityDecisionChoice,
) => void

const HERMES_OUTCOME_WORK_ORDER_PREFIX = "WO-HERMES-OUTCOME-"
const OUTCOME_COMPLETED_EVENT = "HERMES_OUTCOME_COMPLETED"
const OUTCOME_TERMINAL_EVENT = "HERMES_OUTCOME_TERMINAL"

function positiveGoalId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null
  const goalId = Number(value)
  return Number.isSafeInteger(goalId) ? goalId : null
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
    metadata?: unknown
    result?: string | null
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
    const result = eventMetadata(latestState.metadata)?.result ?? latestState.result
    if (result !== "OWNER_DECISION_REQUIRED") continue
    // Discovery is intentionally conservative. Only the full timeline projection
    // can validate the linked decision, evidence hash, receipt, and audit binding.
    unresolvedGoalIds.add(goalId)
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
    unresolvedGoalIds.add(goalId)
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
        label: choice === "APPROVE" ? "Approve and resume" : "Deny and keep blocked",
        consequence: choice === "APPROVE"
          ? request.consequences.approve
          : request.consequences.deny,
        select: () => onAuthorityDecision(timeline, choice),
      })),
    }
  })
}
