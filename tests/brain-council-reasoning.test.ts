import { describe, expect, it } from "vitest"
import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"

describe("Brain Council reasoning packet", () => {
  it("builds a cognition-oriented decision packet", () => {
    const packet = getBrainCouncilReasoningPacket()

    expect(packet.question).toContain("safest next step")
    expect(packet.selectedBrains.length).toBeGreaterThanOrEqual(4)
    expect(packet.evidence.length).toBeGreaterThanOrEqual(3)
    expect(packet.unknowns.length).toBeGreaterThanOrEqual(3)
    expect(packet.hypotheses).toHaveLength(3)
    expect(packet.ranking).toEqual(packet.hypotheses.map((hypothesis) => hypothesis.id))
    expect(packet.confidence).toBeGreaterThan(0)
    expect(packet.decisionPacket.nextAction).toContain("Readiness Evaluator")
  })

  it("keeps every hypothesis verifiable", () => {
    const packet = getBrainCouncilReasoningPacket()

    expect(packet.hypotheses.every((hypothesis) => hypothesis.confidence > 0)).toBe(true)
    expect(packet.hypotheses.every((hypothesis) => hypothesis.verification.length > 0)).toBe(true)
  })

  it("does not grant runtime authority", () => {
    const packet = getBrainCouncilReasoningPacket()

    expect(packet.safety.readOnly).toBe(true)
    expect(packet.safety.wouldExecute).toBe(false)
    expect(packet.safety.autonomyEnabled).toBe(false)
    expect(packet.safety.mcpActivation).toBe(false)
    expect(packet.safety.productionWrite).toBe(false)
    expect(packet.decisionPacket.blockedActions).toEqual(
      expect.arrayContaining([
        "execute Brain Council",
        "activate MCP",
        "enable autonomy",
        "dispatch workers",
        "write production data",
      ]),
    )
  })
})
