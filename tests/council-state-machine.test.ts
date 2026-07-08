import { describe, expect, it } from "vitest"
import { getCouncilStateById, getCouncilStateMachine } from "@/components/brain-council/council-state-machine"

describe("Council state machine", () => {
  it("models the advisory flow from question to authority boundary", () => {
    const machine = getCouncilStateMachine()

    expect(machine.initialState).toBe("DORMANT")
    expect(machine.terminalState).toBe("RETIRED")
    expect(machine.states.map((state) => state.id)).toEqual([
      "DORMANT",
      "DOCUMENTED",
      "ADVISORY_READY",
      "CONTEXT_REQUESTED",
      "EVIDENCE_REVIEW",
      "OPTIONS_FRAMED",
      "CONFIDENCE_REVIEW",
      "DECISION_PACKET_READY",
      "WORK_ORDER_RECOMMENDED",
      "AUTHORITY_REQUIRED",
      "BLOCKED",
      "DENIED",
      "RETIRED",
    ])
  })

  it("guards every nonterminal transition", () => {
    const machine = getCouncilStateMachine()
    const nonterminalStates = machine.states.filter((state) => state.id !== machine.terminalState)

    expect(nonterminalStates.every((state) => state.allowedTransitions.length === 1)).toBe(true)
    expect(nonterminalStates.map((state) => state.allowedTransitions[0].guard)).toEqual([
      "doctrine-required",
      "advisory-scope-required",
      "context-required",
      "evidence-required",
      "options-required",
      "confidence-required",
      "decision-packet-required",
      "work-order-required",
      "authority-review-required",
      "primary-authority-required",
      "policy-boundary-required",
      "retirement-review-required",
    ])
  })

  it("keeps terminal authority state from transitioning automatically", () => {
    const terminal = getCouncilStateById("RETIRED")

    expect(terminal?.allowedTransitions).toEqual([])
    expect(terminal?.blockedActions).toEqual(
      expect.arrayContaining(["resume automatically", "dispatch worker", "mutate state"]),
    )
  })

  it("defines outputs, blocked actions, evidence, and authority implications per state", () => {
    const machine = getCouncilStateMachine()
    const review = getCouncilStateById("EVIDENCE_REVIEW")
    const denied = getCouncilStateById("DENIED")

    expect(machine.noRuntimeTransitionDisclaimer).toContain("static read model only")
    expect(machine.states.every((state) => state.allowedOutputs.length > 0)).toBe(true)
    expect(machine.states.every((state) => state.blockedActions.length > 0)).toBe(true)
    expect(machine.states.every((state) => state.requiredEvidence.length > 0)).toBe(true)
    expect(machine.states.every((state) => state.authorityImplication.length > 0)).toBe(true)
    expect(review?.blockedActions).toContain("invent proof")
    expect(denied?.blockedActions).toContain("expose secrets")
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
