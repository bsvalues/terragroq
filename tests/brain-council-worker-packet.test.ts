import { describe, expect, it } from "vitest"
import { getBrainCouncilWorkerPacketPreview } from "@/components/brain-council/brain-council-worker-packet"

describe("Brain Council worker packet preview", () => {
  it("packages reasoning evidence and readiness checks", () => {
    const packet = getBrainCouncilWorkerPacketPreview()

    expect(packet.packetId).toBe("BC-WORKER-PREVIEW-001")
    expect(packet.targetWorker).toBe("Codex or Claude")
    expect(packet.evidence.length).toBeGreaterThanOrEqual(3)
    expect(packet.requiredChecks.length).toBeGreaterThanOrEqual(6)
    expect(packet.expectedOutput).toContain("SAFETY_POSTURE")
  })

  it("keeps allowed and denied actions explicit", () => {
    const packet = getBrainCouncilWorkerPacketPreview()

    expect(packet.allowedActions).toContain("run focused validation")
    expect(packet.deniedActions).toEqual(
      expect.arrayContaining([
        "execute Brain Council",
        "activate MCP",
        "enable autonomy",
        "dispatch workers",
        "write production data",
      ]),
    )
  })

  it("does not dispatch or mutate queues", () => {
    const packet = getBrainCouncilWorkerPacketPreview()

    expect(packet.dispatch.enabled).toBe(false)
    expect(packet.safety.readOnly).toBe(true)
    expect(packet.safety.wouldExecute).toBe(false)
    expect(packet.safety.queueMutation).toBe(false)
    expect(packet.safety.externalWorkerExecution).toBe(false)
    expect(packet.safety.autonomyEnabled).toBe(false)
    expect(packet.safety.productionWrite).toBe(false)
  })
})
