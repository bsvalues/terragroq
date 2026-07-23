import { getWorkOrders } from "@/app/actions/work-orders"
import { PageHeader } from "@/components/shell/page-header"
import { ActiveWorkQueuePanel } from "@/components/work-orders/active-work-queue-panel"
import { CompletionReportPanel } from "@/components/work-orders/completion-report-panel"
import { WorkOrdersCommandPanel } from "@/components/work-orders/work-orders-command-panel"
import { WoeDetailSurfacePanel } from "@/components/work-orders/woe-detail-surface-panel"
import { WorkOrdersView } from "@/components/work-orders/work-orders-view"

export default async function WorkOrdersPage() {
  const orders = await getWorkOrders()
  return (
    <>
      <PageHeader
        title="Work Orders"
        description="See what is moving, what explicitly failed, and the next governed action Hermes is expected to take from recorded Work Order state."
      />
      <div className="flex flex-col gap-6 p-6">
        <ActiveWorkQueuePanel orders={orders} />
        <WorkOrdersCommandPanel orders={orders} />
        <WoeDetailSurfacePanel />
        <CompletionReportPanel orders={orders} />
        <WorkOrdersView initial={orders} />
      </div>
    </>
  )
}
