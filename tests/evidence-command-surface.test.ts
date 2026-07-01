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
      label: "WO-SHELL-018 - Systems Native Area Reframe",
    })
    expect(surface.nextRecommendedWo.reason).toContain("one native WilliamOS area")
  })

  it("connects decision authority to work evidence and verified result", () => {
    const surface = getEvidenceCommandSurface()

    expect(surface.verificationFlow).toEqual([
      expect.objectContaining({
        label: "Decision",
        value: "Authority source",
        href: "/decisions",
      }),
      expect.objectContaining({
        label: "Work Order",
        value: "Scope record",
        href: "/work-orders",
      }),
      expect.objectContaining({
        label: "Evidence",
        value: "Proof layer",
        href: "/audit",
      }),
      expect.objectContaining({
        label: "Verified Result",
        value: "Reality confirmed",
        href: "/",
      }),
    ])
  })

  it("does not mutate evidence, auto-ingest, execute, deploy, grant authority, or write production", () => {
    const surface = getEvidenceCommandSurface()

    expect(surface.safety).toEqual({
      readOnly: true,
      mutatesEvidence: false,
      autoIngests: false,
      activatesExternalConnectors: false,
      executesWork: false,
      deploys: false,
      grantsAuthority: false,
      changesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
  })

  it("frames Evidence as proof and record of reality, not reporting or analytics", () => {
    const surface = getEvidenceCommandSurface()
    const text = [
      surface.title,
      surface.eyebrow,
      surface.description,
      ...surface.verificationFlow.flatMap((step) => [
        step.label,
        step.value,
        step.description,
      ]),
      ...surface.categories.flatMap((category) => [
        category.label,
        category.status,
        category.description,
      ]),
      surface.nextRecommendedWo.label,
      surface.nextRecommendedWo.reason,
    ].join(" ")

    expect(text).toContain("native WilliamOS proof layer")
    expect(text).toContain("record of reality")
    expect(text).toContain("production verification")
    expect(text).not.toMatch(
      /analytics dashboard|reporting center|team reports|activity feed|vanity metrics|auto-proof|magic validation/i,
    )
  })
})
