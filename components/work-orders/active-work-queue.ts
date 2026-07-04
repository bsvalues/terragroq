import type { WorkOrder } from "@/lib/db/schema"
import { WO_STATUSES, type WoStatus } from "@/lib/work-orders/lifecycle"
import {
  LOCAL_OMEN_PHASE_ROLLUP,
  SHELL_WOE_NEXT_BATCH,
} from "@/components/shell/shell-woe-resume-surface"

export type ActiveWorkQueueItem = {
  ref: string
  title: string
  status: WoStatus
  authority: string
  evidenceState: "present" | "required"
  nextMove: string
}

export type ActiveWorkQueueSurface = {
  title: string
  description: string
  items: ActiveWorkQueueItem[]
  emptyState: {
    title: string
    description: string
  }
  nextBatch: typeof SHELL_WOE_NEXT_BATCH
  completedPhase: typeof LOCAL_OMEN_PHASE_ROLLUP
  safety: {
    readOnly: true
    startsLoop: false
    executesWork: false
    grantsAuthority: false
    startsScheduler: false
    startsBackgroundLoop: false
    writesProduction: false
  }
}

const QUEUE_STATUSES: WoStatus[] = ["approved", "active", "review", "blocked"]

function asWoStatus(status: string): WoStatus | null {
  return WO_STATUSES.includes(status as WoStatus) ? (status as WoStatus) : null
}

function nextMoveFor(order: WorkOrder, status: WoStatus): string {
  if (status === "blocked") return "Resolve the authority gate or missing evidence before movement."
  if (status === "review") return "Review evidence, PR state, and production verification before closure."
  if (order.evidence.length === 0) return "Collect validation evidence before advancing."
  if (status === "approved") return "Confirm active grant and loop conditions before activation."
  return "Continue the current governed loop and report the transition."
}

export function getActiveWorkQueueSurface(orders: WorkOrder[]): ActiveWorkQueueSurface {
  const items = orders
    .map((order): ActiveWorkQueueItem | null => {
      const status = asWoStatus(order.status)
      if (status === null || !QUEUE_STATUSES.includes(status)) return null

      return {
        ref: order.ref ?? `WO-${order.id}`,
        title: order.title,
        status,
        authority: order.authorityLevel,
        evidenceState: order.evidence.length > 0 ? "present" : "required",
        nextMove: nextMoveFor(order, status),
      }
    })
    .filter((item): item is ActiveWorkQueueItem => item !== null)

  return {
    title: "Active Work Queue",
    description:
      "The active queue shows governed work already under motion or blocked at an authority boundary. It is a read-only operating view, not a launcher.",
    items,
    emptyState: {
      title: "No active governed work",
      description:
        "When a goal becomes an approved, active, blocked, or review-state Work Order, it appears here for Primary review. The current recommended lane is shown as read-only guidance.",
    },
    nextBatch: SHELL_WOE_NEXT_BATCH,
    completedPhase: LOCAL_OMEN_PHASE_ROLLUP,
    safety: {
      readOnly: true,
      startsLoop: false,
      executesWork: false,
      grantsAuthority: false,
      startsScheduler: false,
      startsBackgroundLoop: false,
      writesProduction: false,
    },
  }
}
