import { describe, expect, it } from "vitest"

import { getGoalNativeConceptSurface } from "@/components/goal-console/goal-native-concept"

describe("/goal native concept surface", () => {
  it("frames /goal as governed intent for WilliamOS", () => {
    const surface = getGoalNativeConceptSurface()

    expect(surface.title).toContain("/goal")
    expect(surface.description).toContain("Primary Operator")
    expect(surface.cards.map((card) => card.title)).toEqual([
      "Intent layer",
      "Authority checkpoint",
      "Work Order handoff",
    ])
  })

  it("keeps /goal read-only and unable to grant authority or execute", () => {
    const surface = getGoalNativeConceptSurface()

    expect(surface.boundaries).toContain("A goal does not execute work.")
    expect(surface.boundaries).toContain("A goal does not grant authority.")
    expect(surface.boundaries).toContain("A goal does not create background loops.")
    expect(surface.boundaries).toContain("A goal must hand off to a Work Order before mutation.")
  })

  it("routes the next step toward Work Orders instead of execution", () => {
    const surface = getGoalNativeConceptSurface()

    expect(surface.nextStep).toEqual({
      label: "Review Work Orders",
      href: "/work-orders",
    })
  })

  it("exposes a goal-bound read-only owner-operation evidence placeholder", () => {
    const surface = getGoalNativeConceptSurface()

    expect(surface.ownerOperationEvidence.binding.surface).toBe("goal")
    expect(surface.ownerOperationEvidence.counters.OWNER_OPERATION_TOUCH_COUNT).toBeNull()
    expect(surface.ownerOperationEvidence.lifecycleState).toBe("NO_OWNER_OPERATION_EVIDENCE")
    expect(surface.ownerOperationEvidence.certification.independentEvidenceRequired).toBe(true)
    expect(surface.ownerOperationEvidence.reasonCode).toBe("OWNER_OPERATION_EVIDENCE_MISSING")
  })
})
