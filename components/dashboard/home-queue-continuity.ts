import type {
  OutcomeQueueOperatorRow,
  OutcomeQueueOperatorSurface,
} from "@/lib/outcome-queue/operator-surface"

export const HOME_QUEUE_CONTINUITY_LINKS = [
  { label: "Goal Console", href: "/goal-console" },
  { label: "Work Orders", href: "/work-orders" },
] as const

export interface HomeQueueContinuityActiveItem {
  outcomeKey: string
  identity: string
  title: string
  status: string
  context: string | null
  staleLease: boolean
}

export interface HomeQueueContinuityNextItem {
  outcomeKey: string
  identity: string
  title: string
  mode: string
  context: string | null
}

export interface HomeQueueContinuityParentMission {
  missionKey: string
  externalRef: string
  goalRef: string
  worldId: string
  projectId: number
  repository: string
}

export interface HomeQueueContinuity {
  state: OutcomeQueueOperatorSurface["state"]
  stateLabel: string
  active: HomeQueueContinuityActiveItem | null
  next: HomeQueueContinuityNextItem | null
  unresolvedParentMissions: readonly HomeQueueContinuityParentMission[]
  blockerReason: string | null
  links: typeof HOME_QUEUE_CONTINUITY_LINKS
}

function identity(row: OutcomeQueueOperatorRow): string {
  return row.goalRef ?? row.outcomeKey
}

function joinContext(current: string | null, parentMissionContext: string): string | null {
  if (!parentMissionContext) return current
  return current ? `${current} ${parentMissionContext}` : parentMissionContext
}

export function projectHomeQueueContinuity(
  surface: OutcomeQueueOperatorSurface,
): HomeQueueContinuity {
  const active = surface.activeItem
  const next = surface.nextEligibleItem
  const unresolvedParentMissions = surface.unresolvedParentMissions
    .map((mission) => ({ ...mission }))
  const unresolvedMissionIdentity = unresolvedParentMissions
    .map((mission) => (
      `${mission.goalRef} (${mission.externalRef}; Space ${mission.worldId}; `
      + `project ${mission.projectId}; ${mission.repository}; ${mission.missionKey})`
    ))
    .join(", ")
  const parentMissionContext = unresolvedMissionIdentity
    ? `Active parent mission: ${unresolvedMissionIdentity}.`
    : ""

  return {
    state: surface.state,
    stateLabel: surface.stateLabel,
    active: active
      ? {
          outcomeKey: active.outcomeKey,
          identity: identity(active),
          title: active.title,
          status: active.lifecycleLabel,
          context: joinContext(active.lifecycleReason, parentMissionContext),
          staleLease: active.staleLease,
        }
      : null,
    next: next
      ? {
          outcomeKey: next.outcomeKey,
          identity: identity(next),
          title: next.title,
          mode: surface.nextEligibleModeLabel ?? "Mode not recorded",
          context: joinContext(next.lifecycleReason, parentMissionContext),
        }
      : null,
    unresolvedParentMissions,
    blockerReason: surface.state === "ACTIVE" || surface.state === "BLOCKED"
      ? surface.reason === "ORPHANED_ACTIVE_MISSION" && unresolvedMissionIdentity
        ? `${surface.reasonLabel}: ${unresolvedMissionIdentity}`
        : surface.state === "BLOCKED" && parentMissionContext
          ? `${surface.reasonLabel}. ${parentMissionContext}`
        : surface.reasonLabel
      : null,
    links: HOME_QUEUE_CONTINUITY_LINKS,
  }
}
