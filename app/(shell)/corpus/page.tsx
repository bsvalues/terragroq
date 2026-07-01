import { getDocuments } from "@/app/actions/documents"
import { PageHeader } from "@/components/shell/page-header"
import { CorpusNativeAreaPanel } from "@/components/corpus/corpus-native-area-panel"
import { CorpusView } from "@/components/corpus/corpus-view"

export default async function CorpusPage() {
  const docs = await getDocuments()
  return (
    <>
      <PageHeader
        title="Corpus"
        description="WilliamOS source body for governed knowledge, reviewed sources, provenance, citations, and evidence-linked context."
      />
      <div className="p-6 pb-0">
        <CorpusNativeAreaPanel />
      </div>
      <CorpusView initial={docs} />
    </>
  )
}
