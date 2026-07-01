import { describe, expect, it } from "vitest"
import { getBrainCouncilNativeArea } from "@/components/brain-council/brain-council-native-area"

describe("Brain Council native area", () => {
  it("frames Brain Council as a native WilliamOS advisory area", () => {
    const area = getBrainCouncilNativeArea()

    expect(area.eyebrow).toBe("WilliamOS Advisory Layer")
    expect(area.description).toContain("native WilliamOS advisory area")
    expect(area.description).toContain("Primary Operator")
    expect(area.postureSummary).toEqual([
      expect.objectContaining({
        label: "Native",
        value: "WilliamOS area",
      }),
      expect.objectContaining({
        label: "Evidence-bound",
        value: "claims need proof",
      }),
      expect.objectContaining({
        label: "Authority-gated",
        value: "Primary decides",
      }),
    ])
  })

  it("shows the advisory loop from question to governed work order", () => {
    const area = getBrainCouncilNativeArea()

    expect(area.advisoryLoop).toEqual([
      expect.objectContaining({ label: "Question" }),
      expect.objectContaining({ label: "Evidence" }),
      expect.objectContaining({ label: "Recommendation" }),
      expect.objectContaining({ label: "Work Order" }),
    ])
  })

  it("connects Brain Council to Work Orders, Evidence, Systems, and Governance", () => {
    const area = getBrainCouncilNativeArea()
    const links = new Map(area.links.map((link) => [link.label, link.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Systems")).toBe("/runtime")
    expect(links.get("Governance")).toBe("/governance")
  })

  it("keeps Brain Council advisory, read-only, and non-executing", () => {
    const area = getBrainCouncilNativeArea()

    expect(area.posture).toEqual({
      nativeToWilliamOS: true,
      advisoryOnly: true,
      readOnly: true,
      executes: false,
      deploys: false,
      grantsAuthority: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
    expect(area.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Execution",
        state: "Blocked",
      }),
      expect.objectContaining({
        label: "Production",
        state: "Observed only",
      }),
      expect.objectContaining({
        label: "Authority",
        state: "Owner-gated",
      }),
    ])
  })

  it("does not use legacy Groq or xAI runtime claims", () => {
    const area = getBrainCouncilNativeArea()
    const text = [
      area.title,
      area.eyebrow,
      area.description,
      ...area.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...area.advisoryLoop.flatMap((step) => [step.label, step.description]),
      ...area.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...area.links.flatMap((link) => [link.label, link.description]),
      ...area.blockedActions,
    ].join(" ")

    expect(text).not.toMatch(/Groq|xAI|AI-powered/)
  })
})
