import { getDecisions } from "@/app/actions/decisions"
import { BlockedDecisionQueuePanel } from "@/components/decisions/blocked-decision-queue-panel"
import { OwnerDecisionQueuePanel } from "@/components/decisions/owner-decision-queue-panel"
import { DecisionCorrectionCapturePanel } from "@/components/dogfood/decision-correction-capture-panel"
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
        <div className="flex flex-col gap-4">
          <DecisionCorrectionCapturePanel />
          <OwnerDecisionQueuePanel />
          <BlockedDecisionQueuePanel decisions={decisions} />
        </div>
      </div>
      <DecisionsView initial={decisions} />
    </>
  )
}
