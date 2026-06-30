import { describe, expect, it } from "vitest"
import { getBrainCouncilBoundary } from "@/components/brain-council/brain-council-boundary"

describe("Brain Council boundary copy", () => {
  it("separates operator console duties from Brain Council duties", () => {
    const boundary = getBrainCouncilBoundary()

    expect(boundary.operatorConsole).toContain("WilliamOS")
    expect(boundary.operatorConsole).toContain("Primary Operator console")
    expect(boundary.brainCouncil).toContain("native advisory/readiness layer")
    expect(boundary.inactiveRuntime).toContain("not running")
  })

  it("keeps unsafe capabilities explicitly not granted", () => {
    const boundary = getBrainCouncilBoundary()

    expect(boundary.prohibited).toContain("MCP activation")
    expect(boundary.prohibited).toContain("autonomous execution")
    expect(boundary.prohibited).toContain("production data writes")
    expect(boundary.prohibited).toContain("deployment or release authority")
  })
})
