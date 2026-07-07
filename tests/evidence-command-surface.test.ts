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
      "Local OMEN Phase 1 Evidence",
      "Evidence Spine",
      "Blocked Decision Evidence",
      "Safety Posture Evidence",
    ])
  })

  it("links evidence categories to existing WilliamOS surfaces", () => {
    const surface = getEvidenceCommandSurface()
    const links = new Map(surface.categories.map((category) => [category.label, category.href]))

    expect(links.get("Latest Production Verification")).toBe("/runtime")
    expect(links.get("Work Order Completion Evidence")).toBe("/work-orders")
    expect(links.get("Local OMEN Phase 1 Evidence")).toBe("/runtime")
    expect(links.get("Evidence Spine")).toBe("/audit")
    expect(links.get("Blocked Decision Evidence")).toBe("/governance")
    expect(links.get("Safety Posture Evidence")).toBe("/brain-council")
  })

  it("keeps the next recommended work focused on the Systems Status shell surface", () => {
    const surface = getEvidenceCommandSurface()

    expect(surface.nextRecommendedWo).toMatchObject({
      label: "WO-SHELL-007 - Systems Status Surface",
    })
    expect(surface.nextRecommendedWo.reason).toContain("Systems Status")
  })

  it("connects decision authority to work evidence, verified result, and the proof sequence", () => {
    const surface = getEvidenceCommandSurface()

    expect(surface.verificationFlow).toEqual([
      expect.objectContaining({
        label: "Owner Decision",
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
    expect(surface.proofSequence.map((step) => step.status)).toEqual([
      "Bound",
      "Required",
      "Production",
      "Report",
    ])
  })

  it("links Work Order evidence to production, PR, checks, and review proof", () => {
    const surface = getEvidenceCommandSurface()

    expect(surface.workOrderLinks).toEqual([
      expect.objectContaining({
        label: "Scope to proof",
        workOrder: "WO-WOE-033..035",
        href: "/goal-console",
      }),
      expect.objectContaining({
        label: "Surface to proof",
        workOrder: "WO-WOE-036..043",
        href: "/work-orders",
      }),
      expect.objectContaining({
        label: "Closure to proof",
        workOrder: "WO-WOE-046..047",
        href: "/audit",
      }),
    ])
    expect(surface.productionVerificationSummary.map((item) => item.label)).toEqual([
      "/api/health",
      "/api/auth/readiness",
      "/work-orders, /goal-console, /audit",
    ])
    expect(surface.reviewProofContext.map((item) => `${item.label}:${item.status}`)).toEqual([
      "PR state:merged",
      "Checks:green",
      "Review threads:0 unresolved",
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
      surface.operatorPosture,
      ...surface.verificationFlow.flatMap((step) => [
        step.label,
        step.value,
        step.description,
      ]),
      ...surface.proofSequence.flatMap((step) => [
        step.label,
        step.status,
        step.description,
      ]),
      ...surface.categories.flatMap((category) => [
        category.label,
        category.status,
        category.description,
      ]),
      ...surface.blockedExpansion.flatMap((item) => [
        item.label,
        item.status,
        item.description,
      ]),
      surface.nextRecommendedWo.label,
      surface.nextRecommendedWo.reason,
    ].join(" ")

    expect(text).toContain("Primary Operator proof layer")
    expect(text).toContain("record of reality")
    expect(text).toContain("production verification")
    expect(text).toContain("Evidence Spine")
    expect(text).toContain("No auto-ingestion")
    expect(text).toContain("No proof runner")
    expect(text).not.toMatch(
      /analytics dashboard|reporting center|team reports|activity feed|vanity metrics|auto-proof|magic validation/i,
    )
  })
})
