import { describe, expect, it } from "vitest"
import { getBrainCouncilExperimentRegistry } from "@/components/brain-council/brain-council-experiment-registry"

describe("Brain Council experiment registry", () => {
  it("shows experiments as read-only records", () => {
    const registry = getBrainCouncilExperimentRegistry()

    expect(registry.posture).toBe("EXPERIMENT_REGISTRY_READ_ONLY")
    expect(registry.experiments.map((experiment) => experiment.id)).toContain("EXP-001")
  })

  it("tracks required experiment fields", () => {
    const registry = getBrainCouncilExperimentRegistry()
    const experiment = registry.experiments[0]

    expect(experiment.question).toContain("?")
    expect(experiment.hypothesis.length).toBeGreaterThan(10)
    expect(experiment.prediction.length).toBeGreaterThan(10)
    expect(typeof experiment.architectureAllowed).toBe("boolean")
  })

  it("does not execute experiments or authorize architecture", () => {
    const registry = getBrainCouncilExperimentRegistry()

    expect(registry.experiments.every((experiment) => experiment.architectureAllowed === false)).toBe(true)
    expect(registry.safety).toEqual({
      executesExperiment: false,
      changesArchitecture: false,
      activatesHermes: false,
      writesData: false,
    })
  })
})
