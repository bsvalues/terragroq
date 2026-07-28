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

export interface HomeQueueContinuity {
  state: OutcomeQueueOperatorSurface["state"]
  stateLabel: string
  active: HomeQueueContinuityActiveItem | null
  next: HomeQueueContinuityNextItem | null
  blockerReason: string | null
  links: typeof HOME_QUEUE_CONTINUITY_LINKS
}

function identity(row: OutcomeQueueOperatorRow): string {
  return row.goalRef ?? row.outcomeKey
}

export function projectHomeQueueContinuity(
  surface: OutcomeQueueOperatorSurface,
): HomeQueueContinuity {
  const active = surface.activeItem
  const next = surface.nextEligibleItem

  return {
    state: surface.state,
    stateLabel: surface.stateLabel,
    active: active
      ? {
          outcomeKey: active.outcomeKey,
          identity: identity(active),
          title: active.title,
          status: active.lifecycleLabel,
          context: active.lifecycleReason,
          staleLease: active.staleLease,
        }
      : null,
    next: next
      ? {
          outcomeKey: next.outcomeKey,
          identity: identity(next),
          title: next.title,
          mode: surface.nextEligibleModeLabel ?? "Mode not recorded",
          context: next.lifecycleReason,
        }
      : null,
    blockerReason: surface.state === "ACTIVE" || surface.state === "BLOCKED"
      ? surface.reasonLabel
      : null,
    links: HOME_QUEUE_CONTINUITY_LINKS,
  }
}
