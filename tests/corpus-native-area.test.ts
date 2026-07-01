import { describe, expect, it } from "vitest"
import { getCorpusNativeArea } from "@/components/corpus/corpus-native-area"

describe("Corpus native area", () => {
  it("frames Corpus as the native WilliamOS source body", () => {
    const area = getCorpusNativeArea()

    expect(area.title).toBe("Corpus")
    expect(area.eyebrow).toBe("WilliamOS Source Body")
    expect(area.description).toContain("native WilliamOS source body")
    expect(area.description).toContain("governed knowledge")
    expect(area.description).toContain("provenance")
    expect(area.postureSummary).toEqual([
      expect.objectContaining({
        label: "Source body",
        value: "governed knowledge",
      }),
      expect.objectContaining({
        label: "Provenance",
        value: "required",
      }),
      expect.objectContaining({
        label: "Retrieval",
        value: "unchanged",
      }),
    ])
  })

  it("shows source, evidence, doctrine, memory, citation, stale, and contradiction sections", () => {
    const area = getCorpusNativeArea()
    const labels = area.sections.map((section) => section.label)

    expect(labels).toEqual([
      "Reviewed Sources",
      "Evidence Inputs",
      "Doctrine Inputs",
      "Memory Inputs",
      "Citations",
      "Stale Sources",
      "Contradictions",
    ])
    expect(area.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Reviewed Sources",
        posture: "Inspectable",
      }),
      expect.objectContaining({
        label: "Citations",
        posture: "Traceable",
      }),
      expect.objectContaining({
        label: "Contradictions",
        posture: "Resolve before trust",
      }),
    ]))
  })

  it("connects Corpus to Evidence, Memory, Doctrine, and Work Orders", () => {
    const area = getCorpusNativeArea()
    const links = new Map(area.links.map((link) => [link.label, link.href]))

    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Memory")).toBe("/memory")
    expect(links.get("Doctrine")).toBe("/doctrine")
    expect(links.get("Work Orders")).toBe("/work-orders")
  })

  it("does not change ingestion, RAG, connectors, access, runtime, or production behavior", () => {
    const area = getCorpusNativeArea()

    expect(area.safety).toEqual({
      nativeToWilliamOS: true,
      changesIngestion: false,
      changesUploadBehavior: false,
      changesEmbeddingBehavior: false,
      changesVectorRetrieval: false,
      activatesExternalConnectors: false,
      addsCorpusMutation: false,
      changesAuthBehavior: false,
      activatesAccessGrants: false,
      changesTokenHandling: false,
      addsAuditWriter: false,
      addsDurableLimiter: false,
      changesRuntimeValidation: false,
      changesPermissionModel: false,
      executesApprovals: false,
      mutatesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
    expect(area.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Ingestion",
        state: "Existing controls only",
      }),
      expect.objectContaining({
        label: "Retrieval",
        state: "Unchanged",
      }),
      expect.objectContaining({
        label: "Connectors",
        state: "Not activated",
      }),
    ])
  })

  it("avoids generic file-library, RAG dashboard, and AI upload copy", () => {
    const area = getCorpusNativeArea()
    const text = [
      area.title,
      area.eyebrow,
      area.description,
      ...area.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...area.sections.flatMap((section) => [
        section.label,
        section.posture,
        section.purpose,
        section.provenance,
        section.authorityRequirement,
        section.evidenceLinkage,
        section.nextSafeStep,
      ]),
      ...area.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...area.links.flatMap((link) => [link.label, link.description]),
    ].join(" ")

    expect(text).not.toMatch(
      /generic file library|upload your docs|AI knowledge base|RAG dashboard|chat with your files|team document workspace|productivity|unleash|boost|collaborate|autonomous ingestion|magic search/i,
    )
  })
})
