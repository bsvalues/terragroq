import { describe, expect, it } from "vitest"
import { getBrainCouncilNativeArea } from "@/components/brain-council/brain-council-native-area"

describe("Brain Council native area", () => {
  it("frames Brain Council as a native WilliamOS advisory area", () => {
    const area = getBrainCouncilNativeArea()

    expect(area.eyebrow).toBe("WilliamOS Advisory Layer")
    expect(area.description).toContain("native WilliamOS area")
    expect(area.description).toContain("advises the Primary Operator")
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
  })

  it("does not use legacy Groq or xAI runtime claims", () => {
    const area = getBrainCouncilNativeArea()
    const text = [
      area.title,
      area.eyebrow,
      area.description,
      ...area.links.flatMap((link) => [link.label, link.description]),
      ...area.blockedActions,
    ].join(" ")

    expect(text).not.toMatch(/Groq|xAI|AI-powered/)
  })
})
