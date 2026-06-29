import { describe, expect, it } from "vitest"
import { getBrainCouncilHermesBoundaryPreview } from "@/components/brain-council/brain-council-hermes-boundary"

describe("Brain Council Hermes boundary preview", () => {
  it("keeps Hermes in preview-only not-ready posture", () => {
    const boundary = getBrainCouncilHermesBoundaryPreview()

    expect(boundary.verdict).toBe("HERMES_NOT_READY_PREVIEW_ONLY")
    expect(boundary.gates.length).toBeGreaterThanOrEqual(4)
    expect(boundary.gates.map((gate) => gate.status)).toContain("requires-owner")
    expect(boundary.nextSafeStep).toContain("candidate/boundary")
  })

  it("lists missing approvals and blocked capabilities", () => {
    const boundary = getBrainCouncilHermesBoundaryPreview()

    expect(boundary.missingApprovals).toContain("Hermes runtime design approval")
    expect(boundary.blockedCapabilities).toEqual(
      expect.arrayContaining([
        "launch Hermes",
        "execute skills",
        "schedule loops",
        "dispatch workers",
        "activate MCP",
        "write production data",
      ]),
    )
  })

  it("does not enable Hermes or autonomy", () => {
    const boundary = getBrainCouncilHermesBoundaryPreview()

    expect(boundary.safety.readOnly).toBe(true)
    expect(boundary.safety.hermesRuntimeEnabled).toBe(false)
    expect(boundary.safety.mcpActivation).toBe(false)
    expect(boundary.safety.schedulerEnabled).toBe(false)
    expect(boundary.safety.autonomyEnabled).toBe(false)
    expect(boundary.safety.workerDispatch).toBe(false)
    expect(boundary.safety.skillExecution).toBe(false)
    expect(boundary.safety.productionWrite).toBe(false)
  })
})
