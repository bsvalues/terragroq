import type { WorkOrder } from "@/lib/db/schema"
import { WO_STATUSES, type WoStatus } from "@/lib/work-orders/lifecycle"

export type WorkOrderFilter = {
  query: string
  status: "all" | WoStatus
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
    return statusOk && matchesQuery(order, filter.query)
  })
}

export function getWorkOrderFilterOptions() {
  return ["all", ...WO_STATUSES] as const
}
