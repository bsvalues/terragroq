import { describe, expect, it } from "vitest"
import { getBrainCouncilAssumptionRegistry } from "@/components/brain-council/brain-council-assumption-registry"

describe("Brain Council assumption registry", () => {
  it("shows assumptions as read-only records", () => {
    const registry = getBrainCouncilAssumptionRegistry()

    expect(registry.posture).toBe("ASSUMPTION_REGISTRY_READ_ONLY")
    expect(registry.assumptions.map((assumption) => assumption.id)).toContain("ASM-001")
  })

  it("surfaces review-needed and challenged indicators", () => {
    const registry = getBrainCouncilAssumptionRegistry()

    expect(registry.assumptions.some((assumption) => assumption.reviewNeeded)).toBe(true)
    expect(registry.assumptions.some((assumption) => assumption.status === "challenged")).toBe(true)
  })

  it("does not mutate beliefs or research state", () => {
    const registry = getBrainCouncilAssumptionRegistry()

    expect(registry.safety).toEqual({
      changesBeliefs: false,
      retiresAssumptions: false,
      promotesMemory: false,
      writesData: false,
    })
  })
})
