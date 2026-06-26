import { getDecisions } from "@/app/actions/decisions"
import { PageHeader } from "@/components/shell/page-header"
import { DecisionsView } from "@/components/decisions/decisions-view"

export default async function DecisionsPage() {
  const decisions = await getDecisions()
  return (
    <>
      <PageHeader
        title="Decisions"
        description="An append-only register of consequential calls. Capture context, rationale, and consequences so intent is never lost."
      />
      <DecisionsView initial={decisions} />
    </>
  )
}
