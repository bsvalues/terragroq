import { describe, expect, it } from "vitest"
import { getAgentForgeSurface } from "@/components/agent-forge/agent-forge-surface"

describe("Agent Forge surface", () => {
  it("frames Agent Forge as capability preparation inside WilliamOS", () => {
    const forge = getAgentForgeSurface()

    expect(forge.title).toBe("Agent Forge")
    expect(forge.eyebrow).toBe("Capability Preparation Layer")
    expect(forge.description).toContain("preparing skill definitions")
    expect(forge.description).toContain("before any authority is requested")
  })

  it("shows skill registry, packet builder, evidence contracts, and execution proposals", () => {
    const forge = getAgentForgeSurface()
    const labels = forge.areas.map((area) => area.label)

    expect(labels).toEqual([
      "Skill Registry",
      "Work Order Packet Builder",
      "Evidence Contract Surface",
      "Execution Proposal Area",
    ])
  })

  it("connects Agent Forge to Work Orders, Evidence, Brain Council, and Hermes", () => {
    const forge = getAgentForgeSurface()
    const links = new Map(forge.links.map((link) => [link.label, link.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Brain Council")).toBe("/brain-council")
    expect(links.get("Hermes Worker Dock")).toBe("/brain-council")
  })

  it("does not execute skills, grant authority, self-activate, or enable runtimes", () => {
    const forge = getAgentForgeSurface()

    expect(forge.safety).toEqual({
      readOnly: true,
      executesSkills: false,
      grantsAuthority: false,
      selfActivates: false,
      writesProduction: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
    })
  })
})
