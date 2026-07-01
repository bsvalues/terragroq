import { describe, expect, it } from "vitest"
import { getDoctrineNativeArea } from "@/components/doctrine/doctrine-native-area"

describe("Doctrine native area", () => {
  it("frames Doctrine as WilliamOS operating law", () => {
    const area = getDoctrineNativeArea()

    expect(area.title).toBe("Doctrine")
    expect(area.eyebrow).toBe("WilliamOS Operating Law")
    expect(area.description).toContain("operating law")
    expect(area.description).toContain("safety boundaries")
    expect(area.description).toContain("approval gates")
    expect(area.postureSummary).toEqual([
      expect.objectContaining({
        label: "Operating law",
        value: "governs behavior",
      }),
      expect.objectContaining({
        label: "Primary authority",
        value: "required",
      }),
      expect.objectContaining({
        label: "Enforcement",
        value: "described, not changed",
      }),
    ])
  })

  it("shows principles, boundaries, gates, advisory posture, disabled capability, correction, and review", () => {
    const area = getDoctrineNativeArea()
    const labels = area.sections.map((section) => section.label)

    expect(labels).toEqual([
      "Principles",
      "Safety Boundaries",
      "Approval Gates",
      "Advisory Only",
      "Disabled Until Authorized",
      "Correction",
      "Review",
    ])
    expect(area.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Safety Boundaries",
        posture: "Guarded",
      }),
      expect.objectContaining({
        label: "Approval Gates",
        posture: "Explicit",
      }),
      expect.objectContaining({
        label: "Disabled Until Authorized",
        posture: "Fail-closed",
      }),
    ]))
  })

  it("connects Doctrine to Governance, Work Orders, Evidence, and Decisions", () => {
    const area = getDoctrineNativeArea()
    const links = new Map(area.links.map((link) => [link.label, link.href]))

    expect(links.get("Governance")).toBe("/governance")
    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Decisions")).toBe("/decisions")
  })

  it("does not change enforcement, access, approval, runtime, or production behavior", () => {
    const area = getDoctrineNativeArea()

    expect(area.safety).toEqual({
      nativeToWilliamOS: true,
      changesAuthBehavior: false,
      changesAccessBehavior: false,
      activatesAccessGrants: false,
      changesTokenHandling: false,
      addsAuditWriter: false,
      addsDurableLimiter: false,
      changesRuntimeValidation: false,
      changesPermissionModel: false,
      executesApprovals: false,
      mutatesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
    expect(area.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Rules",
        state: "Not runtime",
      }),
      expect.objectContaining({
        label: "Approval",
        state: "Not execution",
      }),
      expect.objectContaining({
        label: "Activation",
        state: "Blocked",
      }),
    ])
  })

  it("avoids generic policy, admin, SaaS, and AI-governance copy", () => {
    const area = getDoctrineNativeArea()
    const text = [
      area.title,
      area.eyebrow,
      area.description,
      ...area.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...area.sections.flatMap((section) => [
        section.label,
        section.posture,
        section.purpose,
        section.boundary,
        section.evidence,
        section.ownerReview,
        section.nextSafeStep,
      ]),
      ...area.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...area.links.flatMap((link) => [link.label, link.description]),
    ].join(" ")

    expect(text).not.toMatch(
      /generic policy center|team admin|compliance dashboard|AI governance|autonomous agents|one-click approval|productivity|unleash|boost|marketplace|enterprise SaaS/i,
    )
  })
})
