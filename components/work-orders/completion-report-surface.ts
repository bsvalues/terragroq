import type { WorkOrder } from "@/lib/db/schema"
import { buildClosureReport } from "@/lib/work-orders/lifecycle"

export type CompletionReportItem = {
  ref: string
  title: string
  status: string
  result: string
  report: string
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

export function getCompletionReportSurface(orders: WorkOrder[]): CompletionReportSurface {
  const items = orders
    .filter((order) => order.status === "closed" || order.status === "aborted")
    .map((order): CompletionReportItem => ({
      ref: order.ref ?? `WO-${order.id}`,
      title: order.title,
      status: order.status,
      result: order.result ?? "PENDING",
      report: buildClosureReport(order),
    }))

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
