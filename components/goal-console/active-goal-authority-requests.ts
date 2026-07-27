import type {
  GoalAuthorityDecisionChoice,
  GoalTimelineProjection,
} from "@/components/goal-console/goal-timeline-read-model"

export type GoalAuthorityDecisionHandler = (
  timeline: GoalTimelineProjection,
  choice: GoalAuthorityDecisionChoice,
) => void

const HERMES_OUTCOME_WORK_ORDER_PREFIX = "WO-HERMES-OUTCOME-"

function positiveGoalId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null
  const goalId = Number(value)
  return Number.isSafeInteger(goalId) ? goalId : null
}

export function getAuthorityRequestGoalIds(
  workOrders: Iterable<{ ref: string | null }>,
) {
  const goalIds = new Set<number>()

  for (const workOrder of workOrders) {
    if (!workOrder.ref?.startsWith(HERMES_OUTCOME_WORK_ORDER_PREFIX)) continue
    const suffix = workOrder.ref.slice(HERMES_OUTCOME_WORK_ORDER_PREFIX.length)
    const goalId = positiveGoalId(suffix)
    if (goalId !== null) goalIds.add(goalId)
  }

  return Array.from(goalIds)
}

export function getLatestOwnerDecisionGoalIds(
  terminalEvents: Iterable<{
    id: number
    entityId: string | null
    metadata: unknown
  }>,
) {
  const seenGoalIds = new Set<number>()
  const ownerDecisionGoalIds: number[] = []

  const newestFirst = Array.from(terminalEvents)
    .sort((left, right) => right.id - left.id)
  for (const event of newestFirst) {
    const goalId = event.entityId === null ? null : positiveGoalId(event.entityId)
    if (goalId === null || seenGoalIds.has(goalId)) continue
    seenGoalIds.add(goalId)
    const result = event.metadata !== null
      && typeof event.metadata === "object"
      && !Array.isArray(event.metadata)
      ? (event.metadata as { result?: unknown }).result
      : null
    if (result === "OWNER_DECISION_REQUIRED") {
      ownerDecisionGoalIds.push(goalId)
    }
  }

  return ownerDecisionGoalIds
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
