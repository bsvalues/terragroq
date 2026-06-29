import { describe, expect, it } from "vitest"
import { getBrainCouncilStatus } from "@/components/brain-council/brain-council-status"

describe("Brain Council status", () => {
  it("presents Brain Council as installed, verified, and governed", () => {
    const status = getBrainCouncilStatus()

    expect(status.version).toBe("1.5.1")
    expect(status.installed).toBe(true)
    expect(status.verified).toBe(true)
    expect(status.governed).toBe(true)
    expect(status.summary).toContain("specification/readiness layer")
  })

  it("keeps runtime activation, MCP, autonomy, and production writes disabled", () => {
    const status = getBrainCouncilStatus()

    expect(status.runtimeActivation).toBe("disabled")
    expect(status.mcp).toBe("disabled")
    expect(status.autonomy).toBe("disabled")
    expect(status.productionWrite).toBe("disabled")
  })
})
