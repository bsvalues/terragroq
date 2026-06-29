import { describe, expect, it } from "vitest"
import { getBrainCouncilGateExplanations, summarizeBrainCouncilGates } from "@/components/brain-council/brain-council-gates"

describe("Brain Council gate explainer", () => {
  it("classifies pass, inactive, and review gates", () => {
    const summary = summarizeBrainCouncilGates()

    expect(summary.complete).toBeGreaterThan(0)
    expect(summary.inactive).toBeGreaterThan(0)
    expect(summary.review).toBeGreaterThan(0)
  })

  it("keeps MCP and autonomy gates inactive", () => {
    const gates = getBrainCouncilGateExplanations()
    const mcp = gates.find((gate) => gate.gate === "mcp_activation")
    const autonomy = gates.find((gate) => gate.gate === "autonomy")

    expect(mcp).toMatchObject({ status: "NOT_AUTHORIZED", category: "inactive" })
    expect(autonomy).toMatchObject({ status: "NOT_AUTHORIZED", category: "inactive" })
    expect(mcp?.explanation).toContain("explicit authority")
  })
})
