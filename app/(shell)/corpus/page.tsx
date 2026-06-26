import { getDocuments } from "@/app/actions/documents"
import { PageHeader } from "@/components/shell/page-header"
import { CorpusView } from "@/components/corpus/corpus-view"

export default async function CorpusPage() {
  const docs = await getDocuments()
  return (
    <>
      <PageHeader
        title="Corpus"
        description="Your retrieval-augmented knowledge base. Documents are chunked and embedded so the operator can cite them."
      />
      <CorpusView initial={docs} />
    </>
  )
}
