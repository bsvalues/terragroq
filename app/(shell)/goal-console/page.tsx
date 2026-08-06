import { PageHeader } from "@/components/shell/page-header"
import { GoalConsoleView } from "@/components/goal-console/goal-console-view"
import { GoalNativeConceptPanel } from "@/components/goal-console/goal-native-concept-panel"
import { LoopNativeConceptPanel } from "@/components/goal-console/loop-native-concept-panel"
import { ProductionOperatingModePanel } from "@/components/dogfood/production-operating-mode-panel"
import { WorkTrainingCapturePanel } from "@/components/dogfood/work-training-capture-panel"
import { CodexOperatorPanel } from "@/components/operator/codex-operator-panel"
import { PortfolioOperatorPanel } from "@/components/operator/portfolio-operator-panel"
import { getGoals, getCurrentTruth } from "@/app/actions/goals"
import { getGoalTimelines, getGoalTimelinesByIds } from "@/app/actions/goal-timeline"
import { getActiveGoalAuthorityRequestTimelines } from "@/app/(shell)/goal-console/authority-request-timelines"
import { getOutcomeQueueSurface } from "@/app/actions/outcome-queue"
import { OperatorOutcomeQueuePanel } from "@/components/outcome-queue/operator-outcome-queue-panel"
import { requestedGoalId } from "@/components/goal-console/requested-goal-id"
import {
  loadGoalTimelineBatches,
  planMissingGoalTimelines,
  prioritizeQueueGoalIds,
  unavailableGoalTimelineIds,
} from "@/components/outcome-queue/supporting-timeline-loader"

export default async function GoalConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ goal?: string | string[] }>
}) {
  const initialGoalId = requestedGoalId((await searchParams).goal)
  const [goals, truth, timelines, authorityRequests, outcomeQueue] = await Promise.all([
    getGoals(),
    getCurrentTruth(),
    getGoalTimelines(),
    getActiveGoalAuthorityRequestTimelines(),
    getOutcomeQueueSurface(),
  ])
  const queueGoalIds = prioritizeQueueGoalIds(outcomeQueue.rows)
  const knownGoalIds = new Set(timelines.map((timeline) => timeline.goal.id))
  const requestedGoalIds = initialGoalId !== null
    && goals.some((goal) => goal.id === initialGoalId)
    ? [initialGoalId]
    : []
  const missingTimelinePlan = planMissingGoalTimelines(
    queueGoalIds,
    knownGoalIds,
    requestedGoalIds,
  )
  const additionalTimelineLoad = await loadGoalTimelineBatches(
    missingTimelinePlan.batches,
    getGoalTimelinesByIds,
  )
  const additionalTimelines = additionalTimelineLoad.records
  const supportingTimelines = [...timelines, ...additionalTimelines]
  const returnedAdditionalGoalIds = new Set(
    additionalTimelines.map((timeline) => timeline.goal.id),
  )
  const supportingTimelineCoverage = {
    coveredGoalIds: [...knownGoalIds, ...missingTimelinePlan.selectedGoalIds],
    unavailableGoalIds: unavailableGoalTimelineIds(
      missingTimelinePlan.selectedGoalIds,
      returnedAdditionalGoalIds,
      additionalTimelineLoad.failedGoalIds,
    ),
    truncated: missingTimelinePlan.truncated,
  }

  return (
    <>
      <PageHeader
        title="Goal Console"
        description="State the outcome once, then follow persisted Hermes and Codex delivery truth through completion or a genuine authority wall."
      />
      <div className="flex flex-col gap-4 px-6 pb-2">
        <OperatorOutcomeQueuePanel
          surface={outcomeQueue}
          timelines={supportingTimelines}
          supportingTimelineCoverage={supportingTimelineCoverage}
        />
        <PortfolioOperatorPanel outcomes={goals} />
        <CodexOperatorPanel />
        <ProductionOperatingModePanel />
        <WorkTrainingCapturePanel />
        <GoalNativeConceptPanel />
        <LoopNativeConceptPanel />
      </div>
      <GoalConsoleView
        initialGoals={goals}
        truth={truth}
        timelines={supportingTimelines}
        initialAuthorityRequests={authorityRequests}
        initialGoalId={initialGoalId}
      />
    </>
  )
}
