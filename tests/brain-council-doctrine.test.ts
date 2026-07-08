import { describe, expect, it } from "vitest"
import { getBrainCouncilDoctrine } from "@/components/brain-council/brain-council-doctrine"

describe("Brain Council doctrine", () => {
  it("defines Brain Council as advisory operating law", () => {
    const doctrine = getBrainCouncilDoctrine()

    expect(doctrine.eyebrow).toBe("Advisory operating law")
    expect(doctrine.summary).toContain("Primary Operator")
    expect(doctrine.summary).toContain("cannot execute")
    expect(doctrine.principles.map((principle) => principle.label)).toEqual([
      "Question first",
      "Evidence before confidence",
      "Recommendations are not authority",
      "Unknowns stay visible",
    ])
  })

  it("keeps runtime, production, and authority boundaries explicit", () => {
    const doctrine = getBrainCouncilDoctrine()

    expect(doctrine.boundaries).toEqual([
      expect.objectContaining({ label: "Runtime orchestration", state: "blocked" }),
      expect.objectContaining({ label: "Production mutation", state: "blocked" }),
      expect.objectContaining({ label: "Authority transfer", state: "owner-gated" }),
      expect.objectContaining({ label: "Decision packet", state: "read-only" }),
    ])
    expect(doctrine.relationships.map((relationship) => relationship.label)).toEqual([
      "Primary authority",
      "Work Orders",
      "Evidence",
      "Hermes boundary",
      "Academy and Wiki",
      "Memory and Trace",
    ])
    expect(doctrine.relationships.map((relationship) => relationship.description).join(" ")).toContain(
      "not runtime Council memory",
    )
  })

  it("does not grant execution, MCP, Hermes, production, or authority powers", () => {
    const doctrine = getBrainCouncilDoctrine()

    expect(doctrine.safety).toEqual({
      advisoryOnly: true,
      evidenceRequired: true,
      confidenceAware: true,
      executesWork: false,
      activatesHermes: false,
      activatesMcp: false,
      writesProduction: false,
      grantsAuthority: false,
    })
    expect(doctrine.operatingRule).toContain("Work Orders govern action")
    expect(doctrine.operatingRule).toContain("The Primary remains the authority")
  })
})
