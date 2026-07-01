import { getDecisions } from "@/app/actions/decisions"
import { BlockedDecisionQueuePanel } from "@/components/decisions/blocked-decision-queue-panel"
import { PageHeader } from "@/components/shell/page-header"
import { DecisionsView } from "@/components/decisions/decisions-view"

export default async function DecisionsPage() {
  const decisions = await getDecisions()
  return (
    <>
      <PageHeader
        title="Decisions"
        description="Structured ADR-style register. Decisions carry authority, evidence, and supersession lineage — binding decisions are injected into the agent's context."
      />
      <div className="px-6 pb-2">
        <BlockedDecisionQueuePanel decisions={decisions} />
      </div>
      <DecisionsView initial={decisions} />
    </>
  )
}
