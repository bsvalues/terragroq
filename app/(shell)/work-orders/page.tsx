import { getWorkOrders } from "@/app/actions/work-orders"
import { PageHeader } from "@/components/shell/page-header"
import { WorkOrdersView } from "@/components/work-orders/work-orders-view"

export default async function WorkOrdersPage() {
  const orders = await getWorkOrders()
  return (
    <>
      <PageHeader
        title="Work Orders"
        description="Governed units of work — each a contract run through the draft → proposed → approved → active → review → closed lifecycle. Authority-scoped, doctrine-gated, agent-executed, and closed only against acceptance evidence."
      />
      <WorkOrdersView initial={orders} />
    </>
  )
}
