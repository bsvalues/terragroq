import { BrainCouncilReasoningView } from "@/components/brain-council/brain-council-reasoning-view"
import { PageHeader } from "@/components/shell/page-header"

export default function BrainCouncilPage() {
  return (
    <>
      <PageHeader
        title="Brain Council"
        description="WilliamOS advisory and governance layer for reasoning, evidence synthesis, hypotheses, confidence, and decision packets. Read-only — no agents are executed."
      />
      <BrainCouncilReasoningView />
    </>
  )
}
