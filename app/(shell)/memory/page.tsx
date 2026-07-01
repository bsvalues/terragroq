import { getMemoryFacts } from "@/app/actions/memory"
import { PageHeader } from "@/components/shell/page-header"
import { MemoryView } from "@/components/memory/memory-view"
import { MemoryNativeAreaPanel } from "@/components/memory/memory-native-area-panel"
import { TrainingCandidateQueuePanel } from "@/components/dogfood/training-candidate-queue-panel"

export default async function MemoryPage() {
  const facts = await getMemoryFacts()
  return (
    <>
      <PageHeader
        title="Memory"
        description="WilliamOS continuity layer for facts, decisions, procedures, patterns, contradictions, stale items, and review queues. Evidence-linked, correctable, and authority-aware."
      />
      <div className="p-6 pb-0">
        <div className="flex flex-col gap-4">
          <TrainingCandidateQueuePanel />
          <MemoryNativeAreaPanel />
        </div>
      </div>
      <MemoryView initial={facts} />
    </>
  )
}
