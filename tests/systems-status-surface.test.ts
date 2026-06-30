import { describe, expect, it } from "vitest"
import { getSystemsStatusSurface } from "@/components/systems/systems-status-surface"

describe("Systems status surface", () => {
  it("presents the unified WilliamOS system categories", () => {
    const surface = getSystemsStatusSurface()
    const labels = surface.categories.map((category) => category.label)

    expect(labels).toEqual([
      "WilliamOS Shell",
      "Auth / Readiness",
      "Work Orders",
      "Evidence",
      "Brain Council",
      "Hermes Preview / Worker Dock",
      "Agent Forge / Skills",
      "Deployment / Production Health",
      "TerraFusion OS Project",
    ])
  })

  it("keeps Brain Council and Hermes in non-runtime postures", () => {
    const surface = getSystemsStatusSurface()
    const statuses = new Map(surface.categories.map((category) => [category.label, category.status]))

    expect(statuses.get("Brain Council")).toBe("Read-only")
    expect(statuses.get("Hermes Preview / Worker Dock")).toBe("Preview-only")
  })

  it("recommends the next shell slice without granting authority", () => {
    const surface = getSystemsStatusSurface()

    expect(surface.nextRecommendedWo).toMatchObject({
      label: "WO-SHELL-008 - Brain Council Native Area Reframe",
    })
    expect(surface.nextRecommendedWo.reason).toContain("advisory-only")
  })

  it("does not execute, deploy, grant authority, write production, or activate runtimes", () => {
    const surface = getSystemsStatusSurface()

    expect(surface.safety).toEqual({
      readOnly: true,
      executesWork: false,
      deploys: false,
      grantsAuthority: false,
      writesProduction: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
    })
  })
})
