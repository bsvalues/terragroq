import { describe, expect, it } from "vitest"
import { getEvidenceCommandSurface } from "@/components/evidence/evidence-command-surface"

describe("Evidence command surface", () => {
  it("presents the required evidence categories", () => {
    const surface = getEvidenceCommandSurface()
    const labels = surface.categories.map((category) => category.label)

    expect(labels).toEqual([
      "Latest Production Verification",
      "PR / Check / Build / Test Evidence",
      "Work Order Completion Evidence",
      "Blocked Decision Evidence",
      "Safety Posture Evidence",
    ])
  })

  it("links evidence categories to existing WilliamOS surfaces", () => {
    const surface = getEvidenceCommandSurface()
    const links = new Map(surface.categories.map((category) => [category.label, category.href]))

    expect(links.get("Latest Production Verification")).toBe("/runtime")
    expect(links.get("Work Order Completion Evidence")).toBe("/work-orders")
    expect(links.get("Blocked Decision Evidence")).toBe("/governance")
    expect(links.get("Safety Posture Evidence")).toBe("/brain-council")
  })

  it("keeps the next recommended work order focused on Systems visibility", () => {
    const surface = getEvidenceCommandSurface()

    expect(surface.nextRecommendedWo).toMatchObject({
      label: "WO-SHELL-007 - Systems Status Surface",
    })
    expect(surface.nextRecommendedWo.reason).toContain("runtime")
  })

  it("does not execute, deploy, grant authority, or write production", () => {
    const surface = getEvidenceCommandSurface()

    expect(surface.safety).toEqual({
      readOnly: true,
      executesWork: false,
      deploys: false,
      grantsAuthority: false,
      writesProduction: false,
    })
  })
})
