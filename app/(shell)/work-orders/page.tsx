import { getWorkOrders } from "@/app/actions/work-orders"
import { PageHeader } from "@/components/shell/page-header"
import { WorkOrdersView } from "@/components/work-orders/work-orders-view"

export default async function WorkOrdersPage() {
  const orders = await getWorkOrders()
  return (
    <>
      <PageHeader
        title="Work Orders"
        description="Governed units of work tracked across a status board from backlog to done."
      />
      <WorkOrdersView initial={orders} />
    </>
  )
}
