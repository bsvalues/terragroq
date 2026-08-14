import { getOperatorState } from "@/lib/operator/operator-state"
import { OperatorHome } from "@/components/home/operator-home"
import { PageHeader } from "@/components/shell/page-header"

export default async function HomePage() {
  const state = await getOperatorState()

  return (
    <>
      <PageHeader
        title="Home"
        description="Your operator briefing, projected from live system state — what is running, what was delivered, what needs you."
      />
      <OperatorHome state={state} />
    </>
  )
}
