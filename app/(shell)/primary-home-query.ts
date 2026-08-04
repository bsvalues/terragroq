import { getActiveGoalAuthorityRequestTimelines } from "@/app/(shell)/goal-console/authority-request-timelines"
import {
  getEvidenceForWorkOrder,
  getPersistedEvidenceTruth,
} from "@/app/actions/evidence"
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
  // Each read action resolves the authenticated Primary session. Keep these
  // reads ordered so Home does not create a burst of duplicate auth/database
  // lookups while the shell layout is resolving the same session.
  const queue = await getOutcomeQueueSurface()
  const actionableTimelines = await getActiveGoalAuthorityRequestTimelines()
  const recentCompletions = await getRecentOutcomeCompletionTimeline()
  const evidenceTruth = await getPersistedEvidenceTruth(100)
  const decisionWorkOrderIds = [...new Set(actionableTimelines
    .filter((timeline) => (
      timeline.truth.state === "CURRENT"
      && timeline.decisionRequest.status === "ACTIONABLE"
      && timeline.decisionRequest.workOrderId !== null
    ))
    .map((timeline) => timeline.decisionRequest.workOrderId as number))]
  const decisionEvidence: typeof evidenceTruth.records = []
  for (const workOrderId of decisionWorkOrderIds) {
    decisionEvidence.push(...await getEvidenceForWorkOrder(workOrderId))
  }
  const evidenceRecords = [...new Map(
    [...evidenceTruth.records, ...decisionEvidence].map((record) => [record.id, record]),
  ).values()]
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
    evidenceRecords,
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
