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

const GOAL_TIMELINE_BATCH_SIZE = 25

function requestedGoalId(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate) return null
  const parsed = Number(candidate)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

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
  const queueGoalIds = [...new Set(outcomeQueue.rows.flatMap((row) => (
    row.goalId === null ? [] : [row.goalId]
  )))]
  const knownGoalIds = new Set(timelines.map((timeline) => timeline.goal.id))
  const missingGoalIds = queueGoalIds.filter((goalId) => !knownGoalIds.has(goalId))
  const missingTimelineBatches = Array.from(
    { length: Math.ceil(missingGoalIds.length / GOAL_TIMELINE_BATCH_SIZE) },
    (_, index) => missingGoalIds.slice(
      index * GOAL_TIMELINE_BATCH_SIZE,
      (index + 1) * GOAL_TIMELINE_BATCH_SIZE,
    ),
  )
  const supportingTimelines = [
    ...timelines,
    ...(await Promise.all(
      missingTimelineBatches.map((goalIds) => getGoalTimelinesByIds(goalIds)),
    )).flat(),
  ]

  return (
    <>
      <PageHeader
        title="Goal Console"
        description="State the outcome once, then follow persisted Hermes and Codex delivery truth through completion or a genuine authority wall."
      />
      <div className="flex flex-col gap-4 px-6 pb-2">
        <OperatorOutcomeQueuePanel surface={outcomeQueue} timelines={supportingTimelines} />
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
