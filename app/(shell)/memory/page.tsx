import { getMemoryFacts } from "@/app/actions/memory"
import { PageHeader } from "@/components/shell/page-header"
import { MemoryView } from "@/components/memory/memory-view"
import { MemoryGovernancePanel } from "@/components/memory/memory-governance-panel"
import { MemoryNativeAreaPanel } from "@/components/memory/memory-native-area-panel"
import { TrainingCandidateQueuePanel } from "@/components/dogfood/training-candidate-queue-panel"

export default async function MemoryPage() {
  const facts = await getMemoryFacts()
  return (
    <>
      <PageHeader
        title="Memory"
        description="Primary Operator continuity layer for evidence-linked context, review queues, stale or contradicted memory, and authority-aware recall."
      />
      <div className="p-6 pb-0">
        <div className="flex flex-col gap-4">
          <MemoryNativeAreaPanel />
          <MemoryGovernancePanel />
          <TrainingCandidateQueuePanel />
        </div>
      </div>
      <MemoryView initial={facts} />
    </>
  )
}
