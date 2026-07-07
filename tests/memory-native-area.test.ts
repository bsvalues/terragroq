import { describe, expect, it } from "vitest"
import { getMemoryNativeArea } from "@/components/memory/memory-native-area"

describe("Memory native area", () => {
  it("frames Memory as the native WilliamOS continuity layer", () => {
    const area = getMemoryNativeArea()

    expect(area.title).toBe("Memory")
    expect(area.eyebrow).toBe("Primary Continuity Layer")
    expect(area.description).toContain("Primary Operator continuity layer")
    expect(area.description).toContain("remembered context become authority")
    expect(area.shellPlacement).toEqual([
      expect.objectContaining({
        label: "Capture",
        value: "Review first",
      }),
      expect.objectContaining({
        label: "Connect",
        value: "Evidence-linked",
      }),
      expect.objectContaining({
        label: "Correct",
        value: "Stale visible",
      }),
      expect.objectContaining({
        label: "Constrain",
        value: "Not authority",
      }),
    ])
    expect(area.postureSummary).toEqual([
      expect.objectContaining({
        label: "Continuity",
        value: "evidence-linked",
      }),
      expect.objectContaining({
        label: "Review",
        value: "Primary aware",
      }),
      expect.objectContaining({
        label: "Learning",
        value: "not automatic",
      }),
    ])
  })

  it("shows governed memory categories for facts through review queues", () => {
    const area = getMemoryNativeArea()
    const labels = area.categories.map((category) => category.label)

    expect(labels).toEqual([
      "Facts",
      "Decisions",
      "Procedures",
      "Patterns",
      "Contradictions",
      "Stale / Needs Review",
      "Review Queue",
    ])
    expect(area.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Facts",
        authorityRequirement: "Review before canon",
      }),
      expect.objectContaining({
        label: "Decisions",
        posture: "Evidence-linked",
      }),
      expect.objectContaining({
        label: "Contradictions",
        posture: "Needs resolution",
      }),
      expect.objectContaining({
        label: "Review Queue",
        posture: "Primary review",
      }),
    ]))
  })

  it("connects Memory to Evidence, Decisions, Work Orders, and Systems", () => {
    const area = getMemoryNativeArea()
    const links = new Map(area.links.map((link) => [link.label, link.href]))

    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Decisions")).toBe("/decisions")
    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Systems")).toBe("/runtime")
  })

  it("keeps Memory behavior unchanged and blocks autonomous memory posture", () => {
    const area = getMemoryNativeArea()

    expect(area.safety).toEqual({
      nativeToWilliamOS: true,
      addsWriteBehavior: false,
      autoExtracts: false,
      autoPromotes: false,
      autoDeletesOrArchives: false,
      changesRetrieval: false,
      activatesBrainCouncilRuntimeReads: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      mutatesSchema: false,
    })
    expect(area.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Memory writes",
        state: "Existing controls only",
      }),
      expect.objectContaining({
        label: "Retrieval",
        state: "Unchanged",
      }),
      expect.objectContaining({
        label: "Promotion",
        state: "Not automatic",
      }),
    ])
  })

  it("avoids generic AI memory and surveillance language", () => {
    const area = getMemoryNativeArea()
    const text = [
      area.title,
      area.eyebrow,
      area.description,
      ...area.shellPlacement.flatMap((item) => [item.label, item.value, item.description]),
      ...area.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...area.categories.flatMap((category) => [
        category.label,
        category.posture,
        category.description,
        category.exampleRecordType,
        category.authorityRequirement,
        category.evidenceLinkage,
        category.nextSafeStep,
      ]),
      ...area.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...area.links.flatMap((link) => [link.label, link.description]),
    ].join(" ")

    expect(text).not.toMatch(
      /chat history|AI remembers everything|autonomous learning|self-improving memory|personalization magic|surveillance|black box memory|auto-train|always learning/i,
    )
    expect(text).not.toMatch(/\bteam members?\b|workspace|user onboarding|admin panel/i)
  })
})
