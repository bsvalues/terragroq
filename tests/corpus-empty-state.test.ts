import { describe, expect, it } from "vitest"
import {
  CORPUS_EMPTY_STATE_DESCRIPTION,
  CORPUS_EMPTY_STATE_STEPS,
  CORPUS_EMPTY_STATE_TITLE,
  getCorpusEmptyStateSteps,
} from "@/components/corpus/corpus-empty-state"

describe("corpus empty state", () => {
  it("describes safe source, citation, and indexing expectations", () => {
    const steps = getCorpusEmptyStateSteps()

    expect(steps.map((step) => step.id)).toEqual(["source", "citations", "indexing"])
    expect(steps.map((step) => step.title)).toEqual([
      "Choose reviewed source text",
      "Preserve source labels",
      "Understand the write",
    ])
    expect(steps.some((step) => step.description.includes("secrets"))).toBe(true)
    expect(steps.some((step) => step.description.includes("chunks, embeds, and stores"))).toBe(true)
    expect(CORPUS_EMPTY_STATE_TITLE).toBe("Corpus is empty")
    expect(CORPUS_EMPTY_STATE_DESCRIPTION).toContain("deliberate write")
  })

  it("returns a copy so callers cannot mutate shared state", () => {
    const steps = getCorpusEmptyStateSteps()
    steps.pop()

    expect(getCorpusEmptyStateSteps()).toHaveLength(3)
  })

  it("exports immutable canonical steps", () => {
    expect(Object.isFrozen(CORPUS_EMPTY_STATE_STEPS)).toBe(true)
    expect(CORPUS_EMPTY_STATE_STEPS.every((step) => Object.isFrozen(step))).toBe(true)
  })
})
