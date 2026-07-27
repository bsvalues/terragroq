import type {
  GoalAuthorityDecisionChoice,
  GoalTimelineProjection,
} from "@/components/goal-console/goal-timeline-read-model"

export type GoalAuthorityDecisionHandler = (
  timeline: GoalTimelineProjection,
  choice: GoalAuthorityDecisionChoice,
) => void

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
