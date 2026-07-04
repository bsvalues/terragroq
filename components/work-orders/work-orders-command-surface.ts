import type { WorkOrder } from "@/lib/db/schema"
import { WO_STATUSES, type WoStatus } from "@/lib/work-orders/lifecycle"
import type { VerificationFlowStep } from "@/components/shell/verification-flow-grid"
import {
  LOCAL_OMEN_PHASE_ROLLUP,
  SHELL_WOE_AUTHORITY_BLOCKERS,
  SHELL_WOE_NEXT_BATCH,
} from "@/components/shell/shell-woe-resume-surface"

export type WorkOrderSurfaceCard = {
  label: string
  value: string
  description: string
}

export type WorkOrdersCommandSurface = {
  title: string
  eyebrow: string
  description: string
  verificationFlow: VerificationFlowStep[]
  cards: WorkOrderSurfaceCard[]
  nextRecommendedWo: {
    label: string
    reason: string
  }
  completedPhase: typeof LOCAL_OMEN_PHASE_ROLLUP
  nextBatch: typeof SHELL_WOE_NEXT_BATCH
  blockedDecisions: typeof SHELL_WOE_AUTHORITY_BLOCKERS
  safety: {
    readOnly: true
    executesWork: false
    mutatesWorkOrders: false
    startsLoop: false
    startsScheduler: false
    grantsAuthority: false
    approvesWork: false
    changesSchema: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
}

const ACTIVE_STATUSES: WoStatus[] = ["approved", "active", "review"]
const READY_STATUSES: WoStatus[] = ["draft", "proposed"]
const COMPLETED_STATUSES: WoStatus[] = ["closed", "aborted"]

function asWoStatus(status: string): WoStatus | null {
  return WO_STATUSES.includes(status as WoStatus) ? (status as WoStatus) : null
}

function countByStatus(orders: WorkOrder[], statuses: WoStatus[]) {
  return orders.filter((order) => {
    const status = asWoStatus(order.status)
    return status !== null && statuses.includes(status)
  }).length
}

function countEvidenceRequired(orders: WorkOrder[]) {
  return orders.filter((order) => {
    const status = asWoStatus(order.status)
    return status !== null && !COMPLETED_STATUSES.includes(status) && order.evidence.length === 0
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
    eyebrow: "WilliamOS Mutation Control",
    description:
      "Work Orders are the native WilliamOS control primitive for governed change. They define scope, authority gates, blocked actions, validators, evidence, and safe next moves before any mutation is allowed.",
    verificationFlow: [
      {
        label: "Decision",
        value: "Authority call",
        description: "Resolve the Primary decision before scoped work can advance.",
        href: "/decisions",
      },
      {
        label: "Work Order",
        value: "Mutation contract",
        description: "Define allowed files, blocked actions, validators, evidence, and stop conditions.",
        href: "/work-orders",
      },
      {
        label: "Evidence",
        value: "Proof required",
        description: "Attach tests, build output, PR checks, and production verification.",
        href: "/audit",
      },
      {
        label: "Next Move",
        value: "Safe continuation",
        description: "After evidence is clear, Home chooses the next governed lane.",
        href: "/",
      },
    ],
    cards: [
      {
        label: "Active Work",
        value: String(active),
        description: "Approved, active, or review-state governed work currently under Primary attention.",
      },
      {
        label: "Ready Next",
        value: String(ready),
        description: "Draft or proposed work that still needs authority review before action.",
      },
      {
        label: "Blocked Decisions",
        value: String(blocked),
        description: "Work waiting on an authority gate, owner decision, or missing proof.",
      },
      {
        label: "Total Completed",
        value: String(completed),
        description: "Closed or aborted work retained for evidence, continuity, and review.",
      },
      {
        label: "Evidence Required",
        value: String(evidenceRequired),
        description: "Open governed work that still needs validation or closure evidence.",
      },
      {
        label: "Local Phase Complete",
        value: LOCAL_OMEN_PHASE_ROLLUP.value,
        description: "OMEN local status/refinement is complete and remains read-only.",
      },
      {
        label: "Next Batch",
        value: "Shell / WOE",
        description: "Resume native Work Order Engine surfaces before metadata expansion.",
      },
    ],
    nextRecommendedWo: {
      label: "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
      reason:
        "After Shell and WOE read models are resumed, the next useful lane is deeper Work Order detail surfaces, not local metadata expansion.",
    },
    completedPhase: LOCAL_OMEN_PHASE_ROLLUP,
    nextBatch: SHELL_WOE_NEXT_BATCH,
    blockedDecisions: SHELL_WOE_AUTHORITY_BLOCKERS,
    safety: {
      readOnly: true,
      executesWork: false,
      mutatesWorkOrders: false,
      startsLoop: false,
      startsScheduler: false,
      grantsAuthority: false,
      approvesWork: false,
      changesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
  }
}
