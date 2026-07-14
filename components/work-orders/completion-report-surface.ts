import type { WorkOrder } from "@/lib/db/schema"
import {
  createOwnerOperationEvidencePlaceholder,
  evaluateOwnerOperationEvidence,
  type OwnerOperationCounters,
  type OwnerOperationEvidenceModel,
} from "@/lib/governance/owner-operation-evidence"
import { buildClosureReport } from "@/lib/work-orders/lifecycle"

export type CompletionOwnerOperationInput = {
  countersByWorkOrder: Readonly<Record<string, OwnerOperationCounters>>
}

export type CompletionReportItem = {
  ref: string
  title: string
  status: string
  result: string
  report: string
  ownerOperationEvidence: OwnerOperationEvidenceModel
}

export type CompletionReportSurface = {
  title: string
  description: string
  items: CompletionReportItem[]
  emptyState: {
    title: string
    description: string
  }
  safety: {
    readOnly: true
    recordsResult: false
    changesGates: false
    closesWorkOrder: false
    writesProduction: false
  }
}

export function getCompletionReportSurface(
  orders: WorkOrder[],
  ownerOperations?: CompletionOwnerOperationInput,
): CompletionReportSurface {
  const items = orders
    .filter((order) => order.status === "closed" || order.status === "aborted")
    .map((order): CompletionReportItem => {
      const ref = order.ref ?? `WO-${order.id}`
      const counters = ownerOperations?.countersByWorkOrder[ref]
      return {
        ref,
        title: order.title,
        status: order.status,
        result: order.result ?? "PENDING",
        report: buildClosureReport(order),
        ownerOperationEvidence: counters
          ? evaluateOwnerOperationEvidence(counters, {
              surface: "completion-report",
              programId: null,
              goalId: null,
              loopId: null,
              workOrderId: ref,
              decisionId: null,
              action: "close-work-order",
            })
          : createOwnerOperationEvidencePlaceholder({
              surface: "completion-report",
              programId: null,
              goalId: null,
              loopId: null,
              workOrderId: ref,
              decisionId: null,
              action: "close-work-order",
            }),
      }
    })

  return {
    title: "Completion Reports",
    description:
      "Completion reports turn closed Work Orders into proof packets: result, validators, stop conditions, evidence, boundaries, and closure state.",
    items,
    emptyState: {
      title: "No completion reports yet",
      description:
        "When Work Orders close or abort, WilliamOS renders their result and evidence here before the next governed move.",
    },
    safety: {
      readOnly: true,
      recordsResult: false,
      changesGates: false,
      closesWorkOrder: false,
      writesProduction: false,
    },
  }
}
