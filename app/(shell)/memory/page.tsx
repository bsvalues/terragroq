import { getMemoryFacts } from "@/app/actions/memory"
import { PageHeader } from "@/components/shell/page-header"
import { MemoryView } from "@/components/memory/memory-view"

export default async function MemoryPage() {
  const facts = await getMemoryFacts()
  return (
    <>
      <PageHeader
        title="Memory"
        description="Durable, embedded facts about you and your world. Pinned facts are prioritized; all are searchable by meaning."
      />
      <MemoryView initial={facts} />
    </>
  )
}
