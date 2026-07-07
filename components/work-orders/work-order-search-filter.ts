import type { WorkOrder } from "@/lib/db/schema"
import { WO_STATUSES, type WoStatus } from "@/lib/work-orders/lifecycle"

export type WorkOrderFilter = {
  query: string
  status: "all" | WoStatus
  goal?: string
  loop?: string
  lane?: string
  authority?: string
  ownerDecision?: "all" | "required" | "not-required"
  safetyPosture?: "all" | "read-only" | "elevated"
  completionState?: "all" | "open" | "complete"
}

function matchesQuery(order: WorkOrder, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true

  return [
    order.ref,
    order.title,
    order.goal,
    order.scope,
    order.lane,
    order.phase,
    order.priority,
    order.authorityLevel,
    order.result,
    ...order.evidence,
    ...order.validators,
    ...order.stopConditions,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q))
}

export function filterWorkOrders(orders: WorkOrder[], filter: WorkOrderFilter): WorkOrder[] {
  return orders.filter((order) => {
    const statusOk = filter.status === "all" || order.status === filter.status
    const goalOk = matchesOptionalField(order.goal, filter.goal)
    const loopOk = matchesOptionalField(order.loop, filter.loop)
    const laneOk = matchesOptionalField(order.lane, filter.lane)
    const authorityOk = matchesOptionalField(order.authorityLevel, filter.authority)
    const ownerDecisionOk = matchesOwnerDecision(order, filter.ownerDecision ?? "all")
    const safetyOk = matchesSafetyPosture(order, filter.safetyPosture ?? "all")
    const completionOk = matchesCompletionState(order, filter.completionState ?? "all")

    return (
      statusOk &&
      goalOk &&
      loopOk &&
      laneOk &&
      authorityOk &&
      ownerDecisionOk &&
      safetyOk &&
      completionOk &&
      matchesQuery(order, filter.query)
    )
  })
}

export function getWorkOrderFilterOptions() {
  return ["all", ...WO_STATUSES] as const
}

function matchesOptionalField(value: string | null, filter?: string) {
  if (!filter || filter === "all") return true
  return value === filter
}

function matchesOwnerDecision(order: WorkOrder, filter: NonNullable<WorkOrderFilter["ownerDecision"]>) {
  if (filter === "all") return true
  const required = Boolean(order.linkedDecisionId) || order.stopConditions.some((condition) =>
    condition.toLowerCase().includes("owner decision"),
  )

  return filter === "required" ? required : !required
}

function matchesSafetyPosture(order: WorkOrder, filter: NonNullable<WorkOrderFilter["safetyPosture"]>) {
  if (filter === "all") return true
  const readOnly = order.authorityLevel === "A0_READ_ONLY" || order.authorityLevel.toLowerCase().includes("read")

  return filter === "read-only" ? readOnly : !readOnly
}

function matchesCompletionState(order: WorkOrder, filter: NonNullable<WorkOrderFilter["completionState"]>) {
  if (filter === "all") return true
  const complete = order.status === "closed" || order.status === "aborted" || Boolean(order.completedAt)

  return filter === "complete" ? complete : !complete
}

export function getDistinctWorkOrderFilterValues(orders: WorkOrder[]) {
  return {
    goals: uniqueValues(orders.map((order) => order.goal)),
    loops: uniqueValues(orders.map((order) => order.loop)),
    lanes: uniqueValues(orders.map((order) => order.lane)),
    authorities: uniqueValues(orders.map((order) => order.authorityLevel)),
  }
}

function uniqueValues(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a.localeCompare(b),
  )
}
