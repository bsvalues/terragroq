import { getActiveGoalAuthorityRequestTimelines } from "@/app/(shell)/goal-console/authority-request-timelines"
import {
  getEvidenceForWorkOrders,
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
  resolvePrimaryHomeGoalId,
  type PrimaryHomeModel,
} from "@/components/primary-home/primary-home-model"

export type PrimaryHomeReadModel = Readonly<{
  model: PrimaryHomeModel
  decisionRequest: GoalTimelineDecisionRequest | null
}>

const TERMINAL_OUTCOME_STATES = new Set(["completed", "declined", "superseded"])
const PERSISTED_EVIDENCE_RECORD_LIMIT = 100

export async function getPrimaryHomeReadModel(): Promise<PrimaryHomeReadModel> {
  // Each read action resolves the authenticated Primary session. Keep these
  // reads ordered so Home does not create a burst of duplicate auth/database
  // lookups while the shell layout is resolving the same session.
  const queue = await getOutcomeQueueSurface()
  const actionableTimelines = await getActiveGoalAuthorityRequestTimelines()
  const recentCompletions = await getRecentOutcomeCompletionTimeline()
  const currentRow = queue.activeItem
    ?? queue.nextEligibleItem
    ?? queue.rows.find((row) => !TERMINAL_OUTCOME_STATES.has(row.lifecycleState))
    ?? null
  const currentGoalId = resolvePrimaryHomeGoalId(currentRow)
  const currentTimeline = currentGoalId === null
    ? null
    : await getGoalTimeline(currentGoalId)
  const evidenceTruth = await getPersistedEvidenceTruth(PERSISTED_EVIDENCE_RECORD_LIMIT)
  const relevantWorkOrderIds = new Set<number>()
  for (const row of queue.rows) {
    if (!TERMINAL_OUTCOME_STATES.has(row.lifecycleState)
      && row.activeWorkOrderId !== null) {
      relevantWorkOrderIds.add(row.activeWorkOrderId)
    }
  }
  if (currentTimeline?.current.workOrder?.id !== undefined) {
    relevantWorkOrderIds.add(currentTimeline.current.workOrder.id)
  }
  for (const timeline of actionableTimelines) {
    if (timeline.truth.state !== "CURRENT") continue
    if (timeline.current.workOrder !== null) {
      relevantWorkOrderIds.add(timeline.current.workOrder.id)
    }
    if (timeline.decisionRequest.status === "ACTIONABLE"
      && timeline.decisionRequest.workOrderId !== null) {
      relevantWorkOrderIds.add(timeline.decisionRequest.workOrderId)
    }
  }
  const exactEvidence = await getEvidenceForWorkOrders([...relevantWorkOrderIds])
  const evidenceRecords = [...new Map(
    [...evidenceTruth.records, ...exactEvidence].map((record) => [record.id, record]),
  ).values()]
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
