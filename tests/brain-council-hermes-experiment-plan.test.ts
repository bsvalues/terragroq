import { describe, expect, it } from "vitest"
import { getHermesNonRuntimeExperimentPlan } from "@/components/brain-council/brain-council-hermes-experiment-plan"

describe("Hermes non-runtime experiment plan", () => {
  it("defines a proposal-only experiment posture", () => {
    const plan = getHermesNonRuntimeExperimentPlan()

    expect(plan.posture).toBe("NON_RUNTIME_EXPERIMENT_ONLY")
    expect(plan.steps.length).toBeGreaterThanOrEqual(4)
    expect(plan.question).toContain("proposal-only")
  })

  it("blocks runtime and worker actions", () => {
    const plan = getHermesNonRuntimeExperimentPlan()

    expect(plan.blockedActions).toContain("run Hermes")
    expect(plan.blockedActions).toContain("dispatch a worker")
    expect(plan.blockedActions).toContain("activate MCP")
  })

  it("does not execute or mutate anything", () => {
    const plan = getHermesNonRuntimeExperimentPlan()

    expect(plan.safety).toEqual({
      runsHermes: false,
      dispatchesWorker: false,
      schedulesLoop: false,
      invokesSkill: false,
      writesFiles: false,
      writesProductionData: false,
    })
  })
})
