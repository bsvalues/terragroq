export type CorpusEmptyStateStep = {
  id: string
  title: string
  description: string
}

export const CORPUS_EMPTY_STATE_TITLE = "Corpus is empty"

export const CORPUS_EMPTY_STATE_DESCRIPTION =
  "Ingest documents so Operator Chat can answer from your knowledge with citations. Ingestion is a deliberate indexing write: review content before storing it."

export const CORPUS_EMPTY_STATE_STEPS: readonly Readonly<CorpusEmptyStateStep>[] = Object.freeze([
  Object.freeze({
    id: "source",
    title: "Choose safe source text",
    description: "Use documents intended for retrieval; do not paste secrets or private credentials.",
  }),
  Object.freeze({
    id: "citations",
    title: "Preserve source labels",
    description: "Add a title and source so future answers can cite where the information came from.",
  }),
  Object.freeze({
    id: "indexing",
    title: "Understand the write",
    description: "Ingestion chunks, embeds, and stores content; review the text before indexing it.",
  }),
])

export function getCorpusEmptyStateSteps(): CorpusEmptyStateStep[] {
  return CORPUS_EMPTY_STATE_STEPS.map((step) => ({ ...step }))
}
