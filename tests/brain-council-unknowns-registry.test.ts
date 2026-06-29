import { describe, expect, it } from "vitest"
import { getBrainCouncilUnknownsRegistry } from "@/components/brain-council/brain-council-unknowns-registry"

describe("Brain Council unknowns registry", () => {
  it("tracks known unknowns as read-only records", () => {
    const registry = getBrainCouncilUnknownsRegistry()

    expect(registry.posture).toBe("UNKNOWNS_REGISTRY_READ_ONLY")
    expect(registry.unknowns.map((unknown) => unknown.id)).toContain("UNK-001")
  })

  it("surfaces priority and blocked status", () => {
    const registry = getBrainCouncilUnknownsRegistry()

    expect(registry.unknowns.some((unknown) => unknown.priority === "high")).toBe(true)
    expect(registry.unknowns.some((unknown) => unknown.status === "blocked")).toBe(true)
  })

  it("does not assign owners, schedule, or write state", () => {
    const registry = getBrainCouncilUnknownsRegistry()

    expect(registry.safety).toEqual({
      assignsOwner: false,
      startsResearch: false,
      schedulesWork: false,
      writesData: false,
    })
  })
})
