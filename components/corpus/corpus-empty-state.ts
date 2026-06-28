export type CorpusEmptyStateStep = {
  id: string
  title: string
  description: string
}

export const CORPUS_EMPTY_STATE_STEPS: CorpusEmptyStateStep[] = [
  {
    id: "source",
    title: "Choose safe source text",
    description: "Use documents intended for retrieval; do not paste secrets or private credentials.",
  },
  {
    id: "citations",
    title: "Preserve source labels",
    description: "Add a title and source so future answers can cite where the information came from.",
  },
  {
    id: "indexing",
    title: "Understand the write",
    description: "Ingestion chunks, embeds, and stores content; review the text before indexing it.",
  },
]

export function getCorpusEmptyStateSteps(): CorpusEmptyStateStep[] {
  return CORPUS_EMPTY_STATE_STEPS.map((step) => ({ ...step }))
}
