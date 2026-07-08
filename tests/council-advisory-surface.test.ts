import { describe, expect, it } from "vitest"
import { getCouncilAdvisorySurface } from "@/components/brain-council/council-advisory-surface"

describe("Council advisory surface", () => {
  it("summarizes doctrine, state, packet, and reasoning context", () => {
    const surface = getCouncilAdvisorySurface()

    expect(surface.title).toBe("Council advisory surface")
    expect(surface.currentQuestion).toContain("safest next step")
    expect(surface.operatingLoop.map((item) => item.label)).toEqual([
      "Doctrine",
      "State",
      "Packet",
    ])
    expect(surface.reviewReadiness.map((item) => item.label)).toEqual([
      "Evidence records",
      "Unknowns",
      "Hypotheses",
      "Confidence",
    ])
    expect(surface.evidenceRequirements.map((item) => item.type)).toEqual([
      "current origin/main",
      "GOAL/WO reports",
      "PR/check status",
      "production verification",
      "safety posture",
      "Academy/Wiki, Hermes, WOE, and Trace/Eval doctrine",
    ])
  })

  it("defines confidence, risk, recommendation-to-WOE, and blocked denied doctrine", () => {
    const surface = getCouncilAdvisorySurface()

    expect(surface.confidenceRiskModel.map((item) => item.level)).toEqual([
      "low",
      "medium",
      "high",
      "blocked",
    ])
    expect(surface.confidenceRiskModel[3]?.description).toContain("TerraFusion/PACS")
    expect(surface.recommendationModel.requiredFields).toEqual([
      "goal",
      "scope",
      "authority required",
      "stop conditions",
      "evidence required",
      "validators",
      "blocked actions",
      "next safe gate",
    ])
    expect(surface.recommendationModel.rule).toContain("Council does not execute Codex")
    expect(surface.recommendationModel.blockedActions).toContain("auto-WO creation")
    expect(surface.blockedDeniedDoctrine.map((item) => item.label)).toEqual([
      "Evidence missing",
      "Owner authority required",
      "Execution implied",
      "Policy boundary crossed",
    ])
  })

  it("covers the expected static registry links", () => {
    const surface = getCouncilAdvisorySurface()
    const links = new Map(surface.registryCoverage.map((item) => [item.label, item.value]))

    expect(links.get("Council doctrine")).toBe("/brain-council")
    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Academy/Wiki")).toBe("/academy")
    expect(links.get("Trace/Eval")).toBe("/trace")
    expect(links.get("Hermes")).toBe("/hermes")
    expect(links.get("Authority")).toBe("/governance")
  })

  it("keeps blocked powers visible for Primary review", () => {
    const surface = getCouncilAdvisorySurface()

    expect(surface.blockedPowers).toEqual(
      expect.arrayContaining([
        "Runtime orchestration",
        "Production mutation",
        "execute recommendation",
        "activate Hermes",
        "activate MCP",
        "grant access",
      ]),
    )
    expect(surface.nextSafeMove).toContain("Work Order")
    expect(surface.nextSafeMove).toContain("Primary authority")
  })

  it("cannot execute, create work orders, grant authority, activate tools, or write production", () => {
    const surface = getCouncilAdvisorySurface()

    expect(surface.safety).toEqual({
      overviewOnly: true,
      executes: false,
      createsWorkOrder: false,
      grantsAuthority: false,
      activatesTools: false,
      activatesHermes: false,
      activatesMcp: false,
      writesMemory: false,
      dynamicIngestion: false,
      writesProduction: false,
    })
  })
})
