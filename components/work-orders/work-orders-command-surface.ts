import type { WorkOrder } from "@/lib/db/schema"
import type { WoStatus } from "@/lib/work-orders/lifecycle"

export type WorkOrderSurfaceCard = {
  label: string
  value: string
  description: string
}

export type WorkOrdersCommandSurface = {
  title: "Work Orders"
  eyebrow: "Primary Operator Work Queue"
  description: string
  cards: WorkOrderSurfaceCard[]
  nextRecommendedWo: {
    label: "WO-SHELL-006 - Evidence Surface"
    reason: string
  }
  safety: {
    readOnly: true
    executesWork: false
    startsLoop: false
    grantsAuthority: false
    writesProduction: false
  }
}

const ACTIVE_STATUSES: WoStatus[] = ["approved", "active", "review"]
const READY_STATUSES: WoStatus[] = ["draft", "proposed"]
const COMPLETED_STATUSES: WoStatus[] = ["closed", "aborted"]

function countByStatus(orders: WorkOrder[], statuses: WoStatus[]) {
  return orders.filter((order) => statuses.includes(order.status as WoStatus)).length
}

function countEvidenceRequired(orders: WorkOrder[]) {
  return orders.filter((order) => {
    const status = order.status as WoStatus
    return !COMPLETED_STATUSES.includes(status) && order.evidence.length === 0
  }).length
}

export function getWorkOrdersCommandSurface(
  orders: WorkOrder[],
): WorkOrdersCommandSurface {
  const active = countByStatus(orders, ACTIVE_STATUSES)
  const ready = countByStatus(orders, READY_STATUSES)
  const blocked = countByStatus(orders, ["blocked"])
  const completed = countByStatus(orders, COMPLETED_STATUSES)
  const evidenceRequired = countEvidenceRequired(orders)

  return {
    title: "Work Orders",
    eyebrow: "Primary Operator Work Queue",
    description:
      "Governed work is visible here before authority, execution, or completion. Work Orders control mutation; Evidence proves reality.",
    cards: [
      {
        label: "Active Work",
        value: String(active),
        description: "Approved, active, or review-state work currently under attention.",
      },
      {
        label: "Ready Next",
        value: String(ready),
        description: "Draft or proposed work that still needs review before action.",
      },
      {
        label: "Blocked Decisions",
        value: String(blocked),
        description: "Work waiting on an explicit gate, approval, or missing proof.",
      },
      {
        label: "Completed Recently",
        value: String(completed),
        description: "Closed or aborted work retained for evidence and continuity.",
      },
      {
        label: "Evidence Required",
        value: String(evidenceRequired),
        description: "Open work that still needs validation or closure evidence.",
      },
    ],
    nextRecommendedWo: {
      label: "WO-SHELL-006 - Evidence Surface",
      reason:
        "The next shell slice should make validation, PR outcomes, production checks, and safety posture easier to inspect.",
    },
    safety: {
      readOnly: true,
      executesWork: false,
      startsLoop: false,
      grantsAuthority: false,
      writesProduction: false,
    },
  }
}
