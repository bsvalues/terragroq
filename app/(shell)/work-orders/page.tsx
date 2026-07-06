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
        description="Primary Operator work control. /goal defines intent, /loop governs progress, Work Orders hold authority boundaries, and Evidence proves reality."
      />
      <div className="flex flex-col gap-6 p-6">
        <WorkOrdersCommandPanel orders={orders} />
        <ActiveWorkQueuePanel orders={orders} />
        <WoeDetailSurfacePanel />
        <CompletionReportPanel orders={orders} />
        <WorkOrdersView initial={orders} />
      </div>
    </>
  )
}
