import { describe, expect, it } from "vitest"
import { getProductionOperatingMode } from "@/components/dogfood/production-operating-mode"

describe("Production operating mode", () => {
  it("defines production as command, evidence, and training-candidate surface", () => {
    const mode = getProductionOperatingMode()

    expect(mode.eyebrow).toBe("Dogfood and training capture")
    expect(mode.summary).toContain("command, evidence, and training-candidate surface")
    expect(mode.trainingMaterial.map((item) => item.label)).toEqual([
      "Completed work",
      "Decisions",
      "Evidence",
      "Lessons",
    ])
  })

  it("requires review before memory or training becomes canonical", () => {
    const mode = getProductionOperatingMode()

    expect(mode.reviewGates.map((gate) => gate.label)).toEqual([
      "Primary review",
      "Evidence check",
      "Safety boundary",
    ])
    expect(mode.agentMayDo).toEqual(expect.arrayContaining(["propose memory, training, and eval candidates"]))
  })

  it("does not enable automatic memory, training, execution, access grants, or workers", () => {
    const mode = getProductionOperatingMode()

    expect(mode.safety).toEqual({
      productionCommandSurface: true,
      capturesTrainingCandidates: true,
      automaticMemoryWrites: false,
      automaticTrainingUpdates: false,
      autonomousExecution: false,
      hermesExecution: false,
      accessGrantActivation: false,
      backgroundWorkers: false,
    })
    expect(mode.agentMustNotDo).toEqual(
      expect.arrayContaining([
        "enable Hermes execution",
        "write memory automatically",
        "promote training records automatically",
        "activate access grants",
      ]),
    )
  })
})
