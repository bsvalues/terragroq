import { describe, expect, it } from "vitest"
import { getHermesCandidateCapabilityMap } from "@/components/brain-council/brain-council-hermes-capability-map"

describe("Hermes candidate capability map", () => {
  it("separates candidate capabilities from blocked runtime capabilities", () => {
    const map = getHermesCandidateCapabilityMap()

    expect(map.posture).toBe("CANDIDATE_CAPABILITIES_ONLY")
    expect(map.capabilities.some((capability) => capability.authority === "draft-only")).toBe(true)
    expect(map.capabilities.some((capability) => capability.authority === "denied")).toBe(true)
  })

  it("does not grant runtime authority", () => {
    const map = getHermesCandidateCapabilityMap()

    expect(map.safety).toEqual({
      grantsAuthority: false,
      executesCapability: false,
      dispatchesWorker: false,
      activatesMcp: false,
      mutatesRepo: false,
      productionWrite: false,
    })
  })

  it("keeps skill and repo mutation capabilities denied", () => {
    const map = getHermesCandidateCapabilityMap()
    const denied = map.capabilities.filter((capability) => capability.authority === "denied")

    expect(denied.map((capability) => capability.id)).toEqual(["repo-mutation", "skill-runtime"])
  })
})
