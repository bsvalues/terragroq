import { describe, expect, it } from "vitest"
import { getCorpusEmptyStateSteps } from "@/components/corpus/corpus-empty-state"

describe("corpus empty state", () => {
  it("describes safe source, citation, and indexing expectations", () => {
    const steps = getCorpusEmptyStateSteps()

    expect(steps.map((step) => step.id)).toEqual(["source", "citations", "indexing"])
    expect(steps.map((step) => step.title)).toEqual([
      "Choose safe source text",
      "Preserve source labels",
      "Understand the write",
    ])
    expect(steps.some((step) => step.description.includes("secrets"))).toBe(true)
    expect(steps.some((step) => step.description.includes("chunks, embeds, and stores"))).toBe(true)
  })

  it("returns a copy so callers cannot mutate shared state", () => {
    const steps = getCorpusEmptyStateSteps()
    steps.pop()

    expect(getCorpusEmptyStateSteps()).toHaveLength(3)
  })
})
