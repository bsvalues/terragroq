import type { GoalTimelineProjection } from "@/components/goal-console/goal-timeline-read-model"
import type { RecentOutcomeCompletionTimeline } from "@/components/runtime/outcome-completion-timeline"
import type { EvidenceRecord } from "@/lib/db/schema"
import type {
  OutcomeQueueOperatorRow,
  OutcomeQueueOperatorSurface,
} from "@/lib/outcome-queue/operator-surface"

export type PrimaryHomeHealthState =
  | "ADVANCING"
  | "BLOCKED"
  | "AWAITING_REVIEW"
  | "COMPLETE"
  | "UNKNOWN"

export type PrimaryHomeHealth = Readonly<{
  state: PrimaryHomeHealthState
  label: string
  detail: string
}>

export type PrimaryHomeNextWithoutWilliam = Readonly<{
  mode: "CONTINUE_ACTIVE" | "ACTIVATE" | "RECOVER" | "NONE"
  outcomeKey: string | null
  outcome: string | null
  label: string
  reason: string
}>

export type PrimaryHomeDecision = Readonly<{
  timelineId: string
  question: string
  outcome: string
  project: string | null
  whyNow: string | null
  recommendation: Readonly<{
    choice: "APPROVE" | "DENY"
    statement: string
    evidenceRefs: readonly string[]
  }> | null
  choices: readonly Readonly<{
    choice: "APPROVE" | "DENY"
    label: string
    consequence: string | null
  }>[]
}>

export type PrimaryHomeRecentOutcome = Readonly<{
  outcomeKey: string
  title: string
  result: string | null
  completedAt: string | null
  evidenceState: "RECORDED" | "MISSING" | "CONFLICTING"
  technicalDetailHref: "/runtime"
}>

export type PrimaryHomeProject = Readonly<{
  repo: string
  currentOutcome: string | null
  health: PrimaryHomeHealth
  williamNeeded: boolean
  latestResult: Readonly<{
    result: string
    recordedAt: string
    evidenceRef: string
  }> | null
}>

export type PrimaryHomeArtifact = Readonly<{
  title: string
  phase: string
  status: string
  deliveryStatus: GoalTimelineProjection["delivery"]["status"]
  actor: string | null
  checkpoints: readonly Readonly<{
    state: string
    result: string | null
  }>[]
  detailHref: "/work-orders"
}>

export type PrimaryHomeModel = Readonly<{
  founderBriefing: Readonly<{
    outcome: string | null
    project: string | null
    actor: string | null
    health: PrimaryHomeHealth
    nextAutomaticStep: string
    summary: string
  }>
  activeArtifact: PrimaryHomeArtifact | null
  needsWilliam: PrimaryHomeDecision | null
  nextWithoutWilliam: PrimaryHomeNextWithoutWilliam
  recentOutcomes: readonly PrimaryHomeRecentOutcome[]
  projectHorizon: readonly PrimaryHomeProject[]
  technicalDetails: Readonly<{
    generatedAt: string
    queueState: OutcomeQueueOperatorSurface["state"]
    queueReason: OutcomeQueueOperatorSurface["reason"]
    currentGoalId: number | null
    currentWorkOrderId: number | null
    timelineTruth: GoalTimelineProjection["truth"]["state"] | "MISSING"
    timelineIssueCodes: readonly string[]
    decisionGoalId: number | null
    recentOutcomeIds: readonly string[]
  }>
}>

export type PrimaryHomeModelInput = Readonly<{
  queue: OutcomeQueueOperatorSurface
  currentTimeline: GoalTimelineProjection | null
  actionableTimelines: readonly GoalTimelineProjection[]
  recentCompletions: RecentOutcomeCompletionTimeline
  evidenceRecords: readonly EvidenceRecord[]
}>

const UNKNOWN_HEALTH: PrimaryHomeHealth = {
  state: "UNKNOWN",
  label: "Current health unavailable",
  detail: "Current runtime timeline truth is not available.",
}

function normalizeRepo(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  return normalized.length > 0 ? normalized : null
}

function evidenceRef(record: EvidenceRecord): string {
  return record.ref?.trim() || `EV-${record.id}`
}

function workOrderRepos(
  workOrderId: number | null,
  evidenceRecords: readonly EvidenceRecord[],
): string[] {
  if (workOrderId === null) return []
  const repos = new Map<string, string>()
  for (const record of evidenceRecords) {
    if (record.workOrderId !== workOrderId) continue
    const repo = normalizeRepo(record.repo)
    if (repo === null) continue
    const key = repo.toLocaleLowerCase("en-US")
    const current = repos.get(key)
    if (current === undefined || repo.localeCompare(current) < 0) repos.set(key, repo)
  }
  return [...repos.values()].sort((left, right) => left.localeCompare(right))
}

function provenProject(
  timeline: GoalTimelineProjection | null,
  evidenceRecords: readonly EvidenceRecord[],
): string | null {
  const repos = workOrderRepos(timeline?.current.workOrder?.id ?? null, evidenceRecords)
  return repos.length === 1 ? repos[0] : null
}

function rowMatchesTimeline(
  row: OutcomeQueueOperatorRow,
  timeline: GoalTimelineProjection,
): boolean {
  return row.goalId === timeline.goal.id
    || row.goalRef === timeline.goal.ref
    || row.outcomeKey === timeline.goal.ref
    || row.outcomeKey === `goal:${timeline.goal.ref}`
}

function containsState(value: string | null | undefined, pattern: RegExp): boolean {
  return typeof value === "string" && pattern.test(value)
}

function projectHealth(
  timeline: GoalTimelineProjection | null,
  queue: OutcomeQueueOperatorSurface,
): PrimaryHomeHealth {
  const timelineRow = timeline === null
    ? null
    : queue.rows.find((row) => rowMatchesTimeline(row, timeline)) ?? null
  const blockedRow = timelineRow !== null
    && (
      timelineRow.lifecycleState === "blocked"
      || (timelineRow.lifecycleState !== "active" && queue.state === "BLOCKED" && timelineRow.blockerLabels.length > 0)
    )
    ? timelineRow
    : timeline === null && queue.state === "BLOCKED"
      ? queue.rows.find((row) => row.lifecycleState === "blocked" || row.blockerLabels.length > 0) ?? null
      : null

  if (blockedRow !== null) {
    return {
      state: "BLOCKED",
      label: "Blocked",
      detail: blockedRow.blockerLabels.length > 0
        ? blockedRow.blockerLabels.join(". ")
        : blockedRow.lifecycleReason ?? queue.reasonLabel,
    }
  }

  if (timeline === null || timeline.truth.state !== "CURRENT") {
    if (timeline === null) return UNKNOWN_HEALTH
    return {
      state: "UNKNOWN",
      label: "Current health unavailable",
      detail: timeline.truth.issues[0]?.detail
        ?? `Timeline truth is ${timeline.truth.state.toLowerCase()}.`,
    }
  }

  const stateText = [
    timeline.current.phase,
    timeline.current.workOrder?.status,
    timeline.current.runtime.checkpointState,
    timeline.terminal.state,
    timeline.terminal.result,
  ].filter((value): value is string => Boolean(value)).join(" ")

  if (timeline.terminal.state !== null
    && containsState(stateText, /(COMPLETE|COMPLETED|VERIFIED|MERGED)/i)) {
    return {
      state: "COMPLETE",
      label: "Complete",
      detail: timeline.terminal.result ?? timeline.current.workOrder?.result ?? "Completion is recorded.",
    }
  }

  if (timeline.decisionRequest.status === "ACTIONABLE"
    || containsState(stateText, /(BLOCKED|FAILED|OWNER_DECISION_REQUIRED|QUARANTINED)/i)) {
    return {
      state: "BLOCKED",
      label: "Blocked",
      detail: timeline.decisionRequest.blockedAction
        ?? timeline.current.runtime.checkpointDetail
        ?? timeline.terminal.result
        ?? "The current timeline records a blocker.",
    }
  }

  if (containsState(stateText, /(REVIEW|VALIDATING|VALIDATION|PR_OPEN|MERGE_ELIGIBLE)/i)
    || timeline.delivery.status === "IN_PROGRESS") {
    return {
      state: "AWAITING_REVIEW",
      label: "Awaiting review",
      detail: timeline.current.runtime.checkpointDetail
        ?? timeline.current.phase
        ?? "Review or validation is in progress.",
    }
  }

  if (queue.activeItem
    && rowMatchesTimeline(queue.activeItem, timeline)
    && timeline.current.runtime.worker
    && timeline.current.runtime.recordedAt
    && timeline.current.runtime.leaseStatus === "ACTIVE") {
    return {
      state: "ADVANCING",
      label: "Advancing",
      detail: timeline.current.runtime.checkpointDetail
        ?? timeline.current.phase
        ?? "The active runtime lease is advancing the outcome.",
    }
  }

  return {
    state: "UNKNOWN",
    label: "Current health unavailable",
    detail: "The current timeline does not prove active, blocked, review, or complete health.",
  }
}

function projectNextWithoutWilliam(
  queue: OutcomeQueueOperatorSurface,
): PrimaryHomeNextWithoutWilliam {
  if (queue.state === "ACTIVE" && queue.activeItem !== null) {
    return {
      mode: "CONTINUE_ACTIVE",
      outcomeKey: queue.activeItem.outcomeKey,
      outcome: queue.activeItem.title,
      label: `Continue ${queue.activeItem.title}`,
      reason: queue.reasonLabel,
    }
  }

  if (queue.nextEligibleMode === "RECOVER_STALE_LEASE" && queue.nextEligibleItem !== null) {
    return {
      mode: "RECOVER",
      outcomeKey: queue.nextEligibleItem.outcomeKey,
      outcome: queue.nextEligibleItem.title,
      label: `Recover ${queue.nextEligibleItem.title}`,
      reason: queue.reasonLabel,
    }
  }

  if (queue.nextEligibleMode === "ACTIVATE" && queue.nextEligibleItem !== null) {
    return {
      mode: "ACTIVATE",
      outcomeKey: queue.nextEligibleItem.outcomeKey,
      outcome: queue.nextEligibleItem.title,
      label: `Activate ${queue.nextEligibleItem.title}`,
      reason: queue.reasonLabel,
    }
  }

  return {
    mode: "NONE",
    outcomeKey: null,
    outcome: null,
    label: queue.reasonLabel,
    reason: queue.reasonLabel,
  }
}

function oldestTimelineTimestamp(timeline: GoalTimelineProjection): number {
  const entryTimes = timeline.entries
    .map((entry) => entry.occurredAt.getTime())
    .filter(Number.isFinite)
  return entryTimes.length > 0
    ? Math.min(...entryTimes)
    : timeline.truth.latestPersistedAt.getTime()
}

function actionablePriority(
  timeline: GoalTimelineProjection,
  currentTimeline: GoalTimelineProjection | null,
  queue: OutcomeQueueOperatorSurface,
): readonly [number, number, number, number] {
  const isCurrent = currentTimeline !== null && (
    timeline.id === currentTimeline.id || timeline.goal.id === currentTimeline.goal.id
  )
  const queueRow = queue.rows.find((row) => rowMatchesTimeline(row, timeline))
  return [
    isCurrent ? 0 : 1,
    queueRow?.queueOrder ?? Number.MAX_SAFE_INTEGER,
    oldestTimelineTimestamp(timeline),
    timeline.goal.id,
  ]
}

function comparePriority(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function recommendationFor(
  timeline: GoalTimelineProjection,
  evidenceRecords: readonly EvidenceRecord[],
): PrimaryHomeDecision["recommendation"] {
  const workOrderId = timeline.decisionRequest.workOrderId
  if (workOrderId === null) return null

  const recommendations = evidenceRecords
    .filter((record) => record.workOrderId === workOrderId && record.result === "PASS")
    .map((record) => {
      const statement = record.nextValidMove?.trim() ?? ""
      const match = /^(APPROVE|DENY)(?:\s*[:\-]\s*|\s+)/i.exec(statement)
      return match ? {
        choice: match[1].toUpperCase() as "APPROVE" | "DENY",
        statement,
        evidenceRef: evidenceRef(record),
        createdAt: record.createdAt,
        id: record.id,
      } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const choices = new Set(recommendations.map((item) => item.choice))
  if (recommendations.length === 0 || choices.size !== 1) return null

  const newest = recommendations
    .sort((left, right) => (
      right.createdAt.getTime() - left.createdAt.getTime()
      || right.id - left.id
      || left.evidenceRef.localeCompare(right.evidenceRef)
    ))[0]
  return {
    choice: newest.choice,
    statement: newest.statement,
    evidenceRefs: [...new Set(recommendations.map((item) => item.evidenceRef))].sort(),
  }
}

function sentenceAction(action: string): string {
  const trimmed = action.trim().replace(/[?.!]+$/, "")
  return trimmed.length === 0 ? "allow the blocked outcome to proceed" : trimmed
}

function projectNeedsWilliam(
  input: PrimaryHomeModelInput,
): { decision: PrimaryHomeDecision | null; timeline: GoalTimelineProjection | null } {
  const timeline = input.actionableTimelines
    .filter((candidate) => (
      candidate.decisionRequest.status === "ACTIONABLE"
      && candidate.truth.state === "CURRENT"
    ))
    .sort((left, right) => comparePriority(
      actionablePriority(left, input.currentTimeline, input.queue),
      actionablePriority(right, input.currentTimeline, input.queue),
    ))[0] ?? null

  if (timeline === null) return { decision: null, timeline: null }
  const request = timeline.decisionRequest
  const action = sentenceAction(request.blockedAction ?? timeline.goal.outcome)
  return {
    timeline,
    decision: {
      timelineId: timeline.id,
      question: `Should WilliamOS ${action}?`,
      outcome: timeline.goal.outcome,
      project: provenProject(timeline, input.evidenceRecords),
      whyNow: request.authorityBoundary,
      recommendation: recommendationFor(timeline, input.evidenceRecords),
      choices: request.choices.map((choice) => ({
        choice,
        label: choice === "APPROVE"
          ? `Allow ${action}`
          : `Keep ${timeline.goal.outcome} blocked`,
        consequence: choice === "APPROVE"
          ? request.consequences.approve
          : request.consequences.deny,
      })),
    },
  }
}

function projectRecentOutcomes(
  timeline: RecentOutcomeCompletionTimeline,
): PrimaryHomeRecentOutcome[] {
  const seen = new Set<string>()
  const outcomes: PrimaryHomeRecentOutcome[] = []
  for (const row of timeline.rows) {
    const title = row.title.trim()
    if (title.length === 0 || seen.has(row.outcomeKey)) continue
    seen.add(row.outcomeKey)
    const evidenceState = row.mergeEvidence.status === "CONFLICTING"
      || row.successorEvidence.status === "CONFLICTING"
      ? "CONFLICTING"
      : row.mergeEvidence.status === "RECORDED"
        ? "RECORDED"
        : "MISSING"
    outcomes.push({
      outcomeKey: row.outcomeKey,
      title,
      result: row.terminalResult,
      completedAt: row.completedAt,
      evidenceState,
      technicalDetailHref: "/runtime",
    })
  }
  return outcomes
}

function latestEvidence(records: readonly EvidenceRecord[]): EvidenceRecord | null {
  return [...records].sort((left, right) => (
    right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id
  ))[0] ?? null
}

function projectHorizon(
  input: PrimaryHomeModelInput,
  health: PrimaryHomeHealth,
  decisionTimeline: GoalTimelineProjection | null,
): PrimaryHomeProject[] {
  const relevantWorkOrderIds = new Set(input.queue.rows
    .filter((row) => !["completed", "declined", "superseded"].includes(row.lifecycleState))
    .flatMap((row) => row.activeWorkOrderId === null ? [] : [row.activeWorkOrderId]))
  if (decisionTimeline?.decisionRequest.workOrderId !== null
    && decisionTimeline?.decisionRequest.workOrderId !== undefined) {
    relevantWorkOrderIds.add(decisionTimeline.decisionRequest.workOrderId)
  }
  const groups = new Map<string, { repo: string; records: EvidenceRecord[] }>()
  for (const record of input.evidenceRecords) {
    if (record.workOrderId === null || !relevantWorkOrderIds.has(record.workOrderId)) continue
    const repo = normalizeRepo(record.repo)
    if (repo === null) continue
    const key = repo.toLocaleLowerCase("en-US")
    const group = groups.get(key) ?? { repo, records: [] }
    group.records.push(record)
    if (repo.localeCompare(group.repo) < 0) group.repo = repo
    groups.set(key, group)
  }

  const currentWorkOrderId = input.currentTimeline?.current.workOrder?.id ?? null
  const decisionWorkOrderId = decisionTimeline?.decisionRequest.workOrderId ?? null
  return [...groups.values()].map((group): PrimaryHomeProject => {
    const hasCurrent = currentWorkOrderId !== null
      && group.records.some((record) => record.workOrderId === currentWorkOrderId)
    const williamNeeded = decisionWorkOrderId !== null
      && group.records.some((record) => record.workOrderId === decisionWorkOrderId)
    const latest = latestEvidence(group.records)
    const queueRow = input.queue.rows.find((row) => (
      row.activeWorkOrderId !== null
      && group.records.some((record) => record.workOrderId === row.activeWorkOrderId)
    ))
    const projectHealth = hasCurrent
      ? health
      : queueRow?.lifecycleState === "blocked" || (queueRow?.blockerLabels.length ?? 0) > 0
        ? {
            state: "BLOCKED" as const,
            label: "Blocked",
            detail: queueRow?.lifecycleReason
              ?? queueRow?.blockerLabels.join(". ")
              ?? "The project queue records a blocker.",
          }
        : UNKNOWN_HEALTH
    return {
      repo: group.repo,
      currentOutcome: hasCurrent
        ? input.currentTimeline?.goal.outcome ?? null
        : williamNeeded
          ? decisionTimeline?.goal.outcome ?? null
          : queueRow?.title ?? null,
      health: projectHealth,
      williamNeeded,
      latestResult: latest ? {
        result: latest.result,
        recordedAt: latest.createdAt.toISOString(),
        evidenceRef: evidenceRef(latest),
      } : null,
    }
  }).sort((left, right) => (
    Number(right.repo === provenProject(input.currentTimeline, input.evidenceRecords))
      - Number(left.repo === provenProject(input.currentTimeline, input.evidenceRecords))
    || Number(right.williamNeeded) - Number(left.williamNeeded)
    || left.repo.localeCompare(right.repo)
  ))
}

function briefingSummary(
  outcome: string | null,
  project: string | null,
  actor: string | null,
  health: PrimaryHomeHealth,
  next: PrimaryHomeNextWithoutWilliam,
): string {
  if (outcome === null) return `${health.label}. ${next.label}.`
  const projectText = project ? ` in ${project}` : ""
  const actorText = actor ? `${actor} is working on` : "WilliamOS is tracking"
  return `${actorText} ${outcome}${projectText}. ${health.label}. Next: ${next.label}.`
}

export function projectPrimaryHomeModel(input: PrimaryHomeModelInput): PrimaryHomeModel {
  const nextWithoutWilliam = projectNextWithoutWilliam(input.queue)
  const health = projectHealth(input.currentTimeline, input.queue)
  const project = provenProject(input.currentTimeline, input.evidenceRecords)
  const outcome = input.queue.activeItem?.title
    ?? input.queue.nextEligibleItem?.title
    ?? input.currentTimeline?.goal.outcome
    ?? null
  const actor = input.currentTimeline?.truth.state === "CURRENT"
    && input.queue.activeItem !== null
    && rowMatchesTimeline(input.queue.activeItem, input.currentTimeline)
    && input.currentTimeline.current.runtime.recordedAt !== null
    && input.currentTimeline.current.runtime.leaseStatus === "ACTIVE"
    ? input.currentTimeline.current.runtime.worker
    : null
  const { decision: needsWilliam, timeline: decisionTimeline } = projectNeedsWilliam(input)
  const recentOutcomes = projectRecentOutcomes(input.recentCompletions)
  const activeArtifact = input.currentTimeline?.truth.state === "CURRENT"
    && input.currentTimeline.current.workOrder !== null
    ? {
        title: input.currentTimeline.current.workOrder.title,
        phase: input.currentTimeline.current.phase,
        status: input.currentTimeline.current.workOrder.status,
        deliveryStatus: input.currentTimeline.delivery.status,
        actor,
        checkpoints: input.currentTimeline.validationCheckpoints.slice(0, 4).map((checkpoint) => ({
          state: checkpoint.state,
          result: checkpoint.result,
        })),
        detailHref: "/work-orders" as const,
      }
    : null

  return {
    founderBriefing: {
      outcome,
      project,
      actor,
      health,
      nextAutomaticStep: nextWithoutWilliam.label,
      summary: briefingSummary(outcome, project, actor, health, nextWithoutWilliam),
    },
    activeArtifact,
    needsWilliam,
    nextWithoutWilliam,
    recentOutcomes,
    projectHorizon: projectHorizon(input, health, decisionTimeline),
    technicalDetails: {
      generatedAt: input.queue.generatedAt,
      queueState: input.queue.state,
      queueReason: input.queue.reason,
      currentGoalId: input.currentTimeline?.goal.id ?? null,
      currentWorkOrderId: input.currentTimeline?.current.workOrder?.id ?? null,
      timelineTruth: input.currentTimeline?.truth.state ?? "MISSING",
      timelineIssueCodes: input.currentTimeline?.truth.issues.map((issue) => issue.code) ?? [],
      decisionGoalId: decisionTimeline?.goal.id ?? null,
      recentOutcomeIds: input.recentCompletions.rows.map((row) => row.outcomeId),
    },
  }
}

export const buildPrimaryHomeModel = projectPrimaryHomeModel
