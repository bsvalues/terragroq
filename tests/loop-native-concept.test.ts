import { describe, expect, it } from "vitest"

import { getLoopNativeConceptSurface } from "@/components/goal-console/loop-native-concept"

describe("/loop native concept surface", () => {
  it("frames /loop as controlled progress through truth, constraints, reports, and stops", () => {
    const surface = getLoopNativeConceptSurface()

    expect(surface.title).toContain("/loop")
    expect(surface.steps.map((step) => step.label)).toEqual([
      "Read current truth",
      "Verify constraints",
      "Report transition",
      "Stop for authority",
    ])
  })

  it("keeps loop operation non-autonomous and bounded to the active playbook", () => {
    const surface = getLoopNativeConceptSurface()

    expect(surface.guarantees).toContain("No hidden continuation beyond the active playbook.")
    expect(surface.guarantees).toContain("No mutation buttons or repo-writing action from the UI.")
    expect(surface.guarantees).toContain("No scheduler, background worker, Hermes, MCP, or autonomy activation.")
    expect(surface.guarantees).toContain("No production write without a separate authorized Work Order.")
  })

  it("names real authority gates instead of normal pass states", () => {
    const surface = getLoopNativeConceptSurface()
    const stopStep = surface.steps.find((step) => step.status === "stop")

    expect(stopStep?.description).toContain("security")
    expect(stopStep?.description).toContain("data mutation")
    expect(stopStep?.description).toContain("deploy")
  })
})
