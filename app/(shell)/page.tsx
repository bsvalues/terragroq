import { getOperatorState } from "@/lib/operator/operator-state"
import { OperatorHome } from "@/components/home/operator-home"
import { PageHeader } from "@/components/shell/page-header"

export default async function HomePage() {
  const state = await getOperatorState()

  return (
    <>
      <PageHeader
        title="Home"
        description="Your operator briefing, projected from current system state — grounded where live, marked where inferred."
      />
      <OperatorHome state={state} />
    </>
  )
}
