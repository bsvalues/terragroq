import { describe, expect, it } from "vitest"
import { getAgentForgeSurface } from "@/components/agent-forge/agent-forge-surface"

describe("Agent Forge surface", () => {
  it("frames Agent Forge as capability preparation inside WilliamOS", () => {
    const forge = getAgentForgeSurface()

    expect(forge.title).toBe("Agent Forge")
    expect(forge.eyebrow).toBe("WilliamOS Capability Forge")
    expect(forge.description).toContain("preparing, reviewing, and quarantining")
    expect(forge.description).toContain("authorized worker skills")
    expect(forge.postureSummary).toEqual([
      expect.objectContaining({
        label: "Prepared",
        value: "not active",
      }),
      expect.objectContaining({
        label: "Quarantined",
        value: "review required",
      }),
      expect.objectContaining({
        label: "Authority",
        value: "Primary required",
      }),
    ])
  })

  it("shows capability proposals as quarantined until activation review", () => {
    const forge = getAgentForgeSurface()

    expect(forge.capabilityStates).toEqual([
      expect.objectContaining({
        label: "Proposal",
        state: "Draftable",
      }),
      expect.objectContaining({
        label: "Quarantine",
        state: "Held",
      }),
      expect.objectContaining({
        label: "Activation review",
        state: "Blocked",
      }),
    ])
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
    expect(forge.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Skill execution",
        state: "Disabled",
      }),
      expect.objectContaining({
        label: "Hermes",
        state: "Not activated",
      }),
      expect.objectContaining({
        label: "Production",
        state: "No write",
      }),
    ])
  })

  it("avoids activation, marketplace, and generic productivity language", () => {
    const forge = getAgentForgeSurface()
    const text = [
      forge.title,
      forge.eyebrow,
      forge.description,
      ...forge.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...forge.capabilityStates.flatMap((item) => [item.label, item.state, item.description]),
      ...forge.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...forge.areas.flatMap((area) => [area.label, area.description]),
      ...forge.links.flatMap((link) => [link.label, link.description]),
    ].join(" ")

    expect(text).not.toMatch(/install skill|run skill|execute now|auto-activate|plugin marketplace|app store|productivity bot/i)
  })
})
