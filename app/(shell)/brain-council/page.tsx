import { BrainCouncilReasoningView } from "@/components/brain-council/brain-council-reasoning-view"
import { PageHeader } from "@/components/shell/page-header"

export default function BrainCouncilPage() {
  return (
    <>
      <PageHeader
        title="Brain Council"
        description="Reasoning workspace for questions, evidence, hypotheses, confidence, and decision packets. Preview-only — no agents are executed."
      />
      <BrainCouncilReasoningView />
    </>
  )
}
