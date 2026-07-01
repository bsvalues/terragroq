import { describe, expect, it } from "vitest"
import { getHermesAuthorityStateModel } from "@/components/brain-council/hermes-authority-state-model"

describe("Hermes authority state model", () => {
  it("defines all readiness states without making execution active", () => {
    const model = getHermesAuthorityStateModel()

    expect(model.currentState).toBe("disabled")
    expect(model.states.map((state) => state.id)).toEqual([
      "disabled",
      "available-for-planning",
      "proposed",
      "blocked",
      "ready-for-activation-review",
      "authorized-design-only",
      "execution-not-active",
    ])
  })

  it("keeps every state guarded by requirements and forbidden actions", () => {
    const model = getHermesAuthorityStateModel()

    expect(model.states.every((state) => state.requiredBeforeNext.length > 0)).toBe(true)
    expect(model.states.every((state) => state.forbiddenActions.length > 0)).toBe(true)
    expect(model.states.flatMap((state) => state.forbiddenActions)).toEqual(
      expect.arrayContaining(["execute work", "dispatch jobs", "MCP execution"]),
    )
  })

  it("does not activate Hermes, transition runtime state, dispatch jobs, grant authority, or write production", () => {
    const model = getHermesAuthorityStateModel()

    expect(model.safety).toEqual({
      modelOnly: true,
      activatesHermes: false,
      transitionsRuntime: false,
      dispatchesJobs: false,
      grantsAuthority: false,
      writesProduction: false,
    })
  })
})
