import { describe, expect, it } from "vitest"
import { getCouncilStateById, getCouncilStateMachine } from "@/components/brain-council/council-state-machine"

describe("Council state machine", () => {
  it("models the advisory flow from question to authority boundary", () => {
    const machine = getCouncilStateMachine()

    expect(machine.initialState).toBe("question-framed")
    expect(machine.terminalState).toBe("blocked-for-authority")
    expect(machine.states.map((state) => state.id)).toEqual([
      "question-framed",
      "evidence-gathering",
      "hypothesis-ranking",
      "decision-packet-ready",
      "work-order-required",
      "blocked-for-authority",
    ])
  })

  it("guards every nonterminal transition", () => {
    const machine = getCouncilStateMachine()
    const nonterminalStates = machine.states.filter((state) => state.id !== machine.terminalState)

    expect(nonterminalStates.every((state) => state.allowedTransitions.length === 1)).toBe(true)
    expect(nonterminalStates.map((state) => state.allowedTransitions[0].guard)).toEqual([
      "evidence-required",
      "confidence-required",
      "evidence-required",
      "work-order-required",
      "primary-authority-required",
    ])
  })

  it("keeps terminal authority state from transitioning automatically", () => {
    const terminal = getCouncilStateById("blocked-for-authority")

    expect(terminal?.allowedTransitions).toEqual([])
    expect(terminal?.blockedActions).toEqual(
      expect.arrayContaining(["grant authority", "execute approval", "start automation"]),
    )
  })

  it("is read-only and cannot execute loops, workers, or production writes", () => {
    const machine = getCouncilStateMachine()

    expect(machine.safety).toEqual({
      readOnlySchema: true,
      executesTransitions: false,
      dispatchesWorkers: false,
      startsLoops: false,
      writesProduction: false,
    })
  })
})
