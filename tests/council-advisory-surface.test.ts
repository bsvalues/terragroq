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
      writesProduction: false,
    })
  })
})
