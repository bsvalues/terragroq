import type { WorkOrder } from "@/lib/db/schema"
import { WO_STATUSES, type WoStatus } from "@/lib/work-orders/lifecycle"

export const WORK_ORDER_BRIEFING_LIMIT = 4

type EvidenceState = "present" | "required"
type MovingStatus = "active" | "review"
type HermesNextStatus = "approved" | "active" | "blocked" | "review"

export type MovingWorkQueueItem = {
  ref: string
  title: string
  status: MovingStatus
  authority: string
  evidenceState: EvidenceState
  detail: string
}

export type FailedWorkQueueItem = {
  ref: string
  title: string
  status: WoStatus
  result: "FAIL"
  evidenceState: EvidenceState
  detail: string
}

export type HermesNextWorkQueueItem = {
  ref: string
  title: string
  status: HermesNextStatus
  action: string
  detail: string
  evidenceState: EvidenceState
}

type WorkQueueLane<Item> = {
  title: string
  description: string
  count: number
  items: Item[]
  emptyState: string
}

export type ActiveWorkQueueSurface = {
  eyebrow: "Hermes delivery radar"
  title: "Moving, failed, next"
  description: string
  sourceNote: string
  moving: WorkQueueLane<MovingWorkQueueItem>
  failed: WorkQueueLane<FailedWorkQueueItem>
  hermesNext: WorkQueueLane<HermesNextWorkQueueItem>
  safety: {
    readOnly: true
    startsLoop: false
    executesWork: false
    grantsAuthority: false
    startsScheduler: false
    startsBackgroundLoop: false
    writesProduction: false
    claimsLiveWorkerTelemetry: false
  }
}

type RecordedWorkOrder = {
  order: WorkOrder
  status: WoStatus
}

const HERMES_NEXT_STATUSES: HermesNextStatus[] = [
  "approved",
  "active",
  "blocked",
  "review",
]

function asWoStatus(status: string): WoStatus | null {
  return WO_STATUSES.includes(status as WoStatus) ? (status as WoStatus) : null
}

function isMovingStatus(status: WoStatus): status is MovingStatus {
  return status === "active" || status === "review"
}

function isHermesNextStatus(status: WoStatus): status is HermesNextStatus {
  return HERMES_NEXT_STATUSES.includes(status as HermesNextStatus)
}

function workOrderRef(order: WorkOrder): string {
  return order.ref ?? `WO-${order.id}`
}

function evidenceState(order: WorkOrder): EvidenceState {
  return order.evidence.length > 0 ? "present" : "required"
}

function isExplicitFailure(order: WorkOrder): boolean {
  return order.result?.trim().toUpperCase() === "FAIL"
}

function recordedAt(order: WorkOrder): number {
  return (
    order.completedAt
    ?? order.closedAt
    ?? order.updatedAt
  ).getTime()
}

function compareMostRecent(a: RecordedWorkOrder, b: RecordedWorkOrder): number {
  return recordedAt(b.order) - recordedAt(a.order) || b.order.id - a.order.id
}

function movingDetail(status: MovingStatus): string {
  if (status === "review") {
    return "Delivery reached independent review and is waiting for findings or clearance."
  }

  return "Delivery is active inside the recorded Work Order boundary."
}

function failureDetail(order: WorkOrder): string {
  const stopCondition = order.stopConditions[0]
  if (stopCondition) return `Recorded stop condition: ${stopCondition}`
  if (order.description) return `Recorded Work Order context: ${order.description}`

  if (order.evidence.length > 0) {
    return `Failure recorded with ${order.evidence.length} linked evidence ${
      order.evidence.length === 1 ? "item" : "items"
    }.`
  }

  return "Failure recorded without linked supporting evidence."
}

function hermesNextFor(
  order: WorkOrder,
  status: HermesNextStatus,
): Pick<HermesNextWorkQueueItem, "action" | "detail"> {
  if (isExplicitFailure(order)) {
    return {
      action: "Route bounded recovery",
      detail:
        "Hermes will preserve the failure record and route remediation, reroute, or a typed terminal result inside existing authority.",
    }
  }

  if (status === "blocked") {
    const stopCondition = order.stopConditions[0]
    return {
      action: "Recover or keep held",
      detail: stopCondition
        ? `Hermes will not cross the recorded stop condition: ${stopCondition}`
        : "Hermes will recover, reroute, or keep this lane held without turning an operational wall into owner work.",
    }
  }

  if (status === "review") {
    return {
      action: "Complete independent review",
      detail:
        "Hermes will route actionable findings back for bounded remediation before the delivery can advance.",
    }
  }

  if (status === "active") {
    return {
      action: "Continue bounded delivery",
      detail:
        "Hermes will keep work inside the recorded reservation and advance it to file handoff and host validation.",
    }
  }

  return {
    action: "Dispatch authorized work",
    detail:
      "Hermes will start this approved Work Order only after dependencies and reservations are clear.",
  }
}

function hermesNextPriority(item: RecordedWorkOrder): number {
  if (isExplicitFailure(item.order)) return 0
  if (item.status === "blocked") return 1
  if (item.status === "review") return 2
  if (item.status === "active") return 3
  return 4
}

export function getActiveWorkQueueSurface(orders: WorkOrder[]): ActiveWorkQueueSurface {
  const recordedOrders = orders
    .map((order): RecordedWorkOrder | null => {
      const status = asWoStatus(order.status)
      return status === null ? null : { order, status }
    })
    .filter((item): item is RecordedWorkOrder => item !== null)

  const moving = recordedOrders
    .filter(
      (item): item is RecordedWorkOrder & { status: MovingStatus } =>
        isMovingStatus(item.status) && !isExplicitFailure(item.order),
    )
    .sort(compareMostRecent)

  const failed = recordedOrders
    .filter((item) => isExplicitFailure(item.order))
    .sort(compareMostRecent)

  const hermesNext = recordedOrders
    .filter(
      (item): item is RecordedWorkOrder & { status: HermesNextStatus } =>
        isHermesNextStatus(item.status),
    )
    .sort(
      (a, b) =>
        hermesNextPriority(a) - hermesNextPriority(b)
        || compareMostRecent(a, b),
    )

  return {
    eyebrow: "Hermes delivery radar",
    title: "Moving, failed, next",
    description:
      "See current delivery motion, explicit recorded failures, and the next governed action Hermes is expected to take.",
    sourceNote:
      "Hermes-next guidance is derived from recorded Work Order status and result. It is not live worker telemetry.",
    moving: {
      title: "Currently moving",
      description: "Active and review-state Work Orders progressing through the governed delivery loop.",
      count: moving.length,
      items: moving.slice(0, WORK_ORDER_BRIEFING_LIMIT).map(({ order, status }) => ({
        ref: workOrderRef(order),
        title: order.title,
        status,
        authority: order.authorityLevel,
        evidenceState: evidenceState(order),
        detail: movingDetail(status),
      })),
      emptyState: "No Work Order is active or in review.",
    },
    failed: {
      title: "Recorded failures",
      description:
        "Only Work Orders with an explicit FAIL result appear here; blocked or aborted work is not relabeled as failed.",
      count: failed.length,
      items: failed.slice(0, WORK_ORDER_BRIEFING_LIMIT).map(({ order, status }) => ({
        ref: workOrderRef(order),
        title: order.title,
        status,
        result: "FAIL",
        evidenceState: evidenceState(order),
        detail: failureDetail(order),
      })),
      emptyState: "No explicit Work Order failure is recorded.",
    },
    hermesNext: {
      title: "Hermes next",
      description:
        "Expected continuation from open, authorized Work Order state, ordered by recovery and delivery priority.",
      count: hermesNext.length,
      items: hermesNext
        .slice(0, WORK_ORDER_BRIEFING_LIMIT)
        .map(({ order, status }) => ({
          ref: workOrderRef(order),
          title: order.title,
          status,
          ...hermesNextFor(order, status),
          evidenceState: evidenceState(order),
        })),
      emptyState:
        "Hermes has no authorized Work Order to advance and will not invent or launch work.",
    },
    safety: {
      readOnly: true,
      startsLoop: false,
      executesWork: false,
      grantsAuthority: false,
      startsScheduler: false,
      startsBackgroundLoop: false,
      writesProduction: false,
      claimsLiveWorkerTelemetry: false,
    },
  }
}
