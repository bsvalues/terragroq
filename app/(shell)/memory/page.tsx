import { getMemoryFacts } from "@/app/actions/memory"
import { PageHeader } from "@/components/shell/page-header"
import { MemoryView } from "@/components/memory/memory-view"

export default async function MemoryPage() {
  const facts = await getMemoryFacts()
  return (
    <>
      <PageHeader
        title="Memory"
        description="Governed second-brain memory. Facts move through review to canon; only trusted authority states feed recall, and provenance is never destroyed."
      />
      <MemoryView initial={facts} />
    </>
  )
}
