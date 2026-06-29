import { describe, expect, it } from "vitest"
import { getBrainCouncilCognitiveDebtDashboard } from "@/components/brain-council/brain-council-cognitive-debt"

describe("Brain Council cognitive debt dashboard", () => {
  it("surfaces cognitive debt categories", () => {
    const dashboard = getBrainCouncilCognitiveDebtDashboard()

    expect(dashboard.posture).toBe("COGNITIVE_DEBT_READ_ONLY")
    expect(dashboard.items.map((item) => item.id)).toContain("open-contradictions")
  })

  it("includes high-severity debt", () => {
    const dashboard = getBrainCouncilCognitiveDebtDashboard()

    expect(dashboard.items.some((item) => item.severity === "high")).toBe(true)
  })

  it("does not resolve debt or mutate governance state", () => {
    const dashboard = getBrainCouncilCognitiveDebtDashboard()

    expect(dashboard.safety).toEqual({
      resolvesDebt: false,
      updatesMemory: false,
      changesPolicy: false,
      mutatesData: false,
    })
  })
})
