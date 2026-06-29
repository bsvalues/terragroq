import { describe, expect, it } from "vitest"
import { getBrainCouncilDecisionPacketExportPreview } from "@/components/brain-council/brain-council-decision-packet-export"

describe("Brain Council decision packet export", () => {
  it("builds a markdown preview packet", () => {
    const packet = getBrainCouncilDecisionPacketExportPreview()

    expect(packet.format).toBe("text/markdown-preview")
    expect(packet.title).toBe("Brain Council Decision Packet")
    expect(packet.body).toContain("# Brain Council Decision Packet")
    expect(packet.body).toContain("## Evidence")
    expect(packet.body).toContain("## Denied Actions")
    expect(packet.lineCount).toBeGreaterThan(10)
  })

  it("includes the bounded next action and verification", () => {
    const packet = getBrainCouncilDecisionPacketExportPreview()

    expect(packet.body).toContain("Required Verification")
    expect(packet.body).toContain("Next Action")
    expect(packet.body).toContain("Readiness")
  })

  it("does not write, send, or dispatch", () => {
    const packet = getBrainCouncilDecisionPacketExportPreview()

    expect(packet.safety.readOnly).toBe(true)
    expect(packet.safety.wouldExecute).toBe(false)
    expect(packet.safety.fileWrite).toBe(false)
    expect(packet.safety.networkSend).toBe(false)
    expect(packet.safety.workerDispatch).toBe(false)
    expect(packet.safety.productionWrite).toBe(false)
  })
})
