import { describe, expect, it } from "vitest"
import { buildCorpusSafetyPreview } from "@/components/corpus/corpus-safety-preview"

describe("corpus safety preview", () => {
  it("summarizes indexing impact for ordinary source text", () => {
    const preview = buildCorpusSafetyPreview("Project doctrine\n".repeat(100))

    expect(preview.characterCount).toBeGreaterThan(0)
    expect(preview.estimatedChunks).toBeGreaterThan(0)
    expect(preview.secretSignals).toEqual([])
    expect(preview.safeToReview).toBe(true)
    expect(preview.guidance).toContain("Review title, source, and content")
  })

  it("flags obvious secret-like content before indexing", () => {
    const preview = buildCorpusSafetyPreview("DATABASE_URL=postgres://user:pass@example/db")

    expect(preview.secretSignals).toContain("DATABASE_URL")
    expect(preview.safeToReview).toBe(false)
    expect(preview.guidance).toContain("Potential secret-like content")
  })

  it("scans title and source labels as part of the ingest payload", () => {
    const preview = buildCorpusSafetyPreview({
      title: "BETTER_AUTH_SECRET=do-not-index",
      source: "operator note",
      content: "ordinary body",
    })

    expect(preview.secretSignals).toContain("BETTER_AUTH_SECRET")
    expect(preview.safeToReview).toBe(false)
  })

  it("keeps empty content as a preview-only state", () => {
    const preview = buildCorpusSafetyPreview("")

    expect(preview.characterCount).toBe(0)
    expect(preview.estimatedChunks).toBe(0)
    expect(preview.safeToReview).toBe(false)
  })
})
