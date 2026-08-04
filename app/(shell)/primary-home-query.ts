import { getActiveGoalAuthorityRequestTimelines } from "@/app/(shell)/goal-console/authority-request-timelines"
import { getPersistedEvidenceTruth } from "@/app/actions/evidence"
import {
  getGoalTimeline,
  getRecentOutcomeCompletionTimeline,
} from "@/app/actions/goal-timeline"
import { getOutcomeQueueSurface } from "@/app/actions/outcome-queue"
import type { GoalTimelineDecisionRequest } from "@/components/goal-console/goal-timeline-read-model"
import {
  projectPrimaryHomeModel,
  type PrimaryHomeModel,
} from "@/components/primary-home/primary-home-model"

export type PrimaryHomeReadModel = Readonly<{
  model: PrimaryHomeModel
  decisionRequest: GoalTimelineDecisionRequest | null
}>

export async function getPrimaryHomeReadModel(): Promise<PrimaryHomeReadModel> {
  const [queue, actionableTimelines, recentCompletions, evidenceTruth] = await Promise.all([
    getOutcomeQueueSurface(),
    getActiveGoalAuthorityRequestTimelines(),
    getRecentOutcomeCompletionTimeline(),
    getPersistedEvidenceTruth(100),
  ])
  const currentRow = queue.activeItem
    ?? queue.nextEligibleItem
    ?? queue.rows.find((row) => ![
      "completed",
      "declined",
      "superseded",
    ].includes(row.lifecycleState))
    ?? null
  const currentGoalId = currentRow?.goalId
    ?? null
  const currentTimeline = currentGoalId === null
    ? null
    : await getGoalTimeline(currentGoalId)
  const model = projectPrimaryHomeModel({
    queue,
    currentTimeline,
    actionableTimelines,
    recentCompletions,
    evidenceRecords: evidenceTruth.records,
  })
  const decisionTimeline = model.needsWilliam === null
    ? null
    : actionableTimelines.find((timeline) => timeline.id === model.needsWilliam?.timelineId)
      ?? null

  return {
    model,
    decisionRequest: decisionTimeline?.decisionRequest ?? null,
  }
}
