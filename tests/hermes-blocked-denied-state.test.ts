import { describe, expect, it } from "vitest"
import { getHermesBlockedDeniedState } from "@/components/brain-council/hermes-blocked-denied-state"

describe("Hermes blocked and denied state UX", () => {
  it("explains why Hermes cannot act and what review is needed", () => {
    const state = getHermesBlockedDeniedState()

    expect(state.items.map((item) => item.label)).toEqual([
      "Runtime denied",
      "Tool access blocked",
      "Production write denied",
    ])
    expect(state.items.every((item) => item.reason.length > 0)).toBe(true)
    expect(state.items.every((item) => item.missingAuthority.length > 0)).toBe(true)
    expect(state.items.every((item) => item.evidenceRequired.length > 0)).toBe(true)
    expect(state.items.every((item) => item.nextReview.length > 0)).toBe(true)
  })

  it("shows that no action has been taken", () => {
    const state = getHermesBlockedDeniedState()

    expect(state.summary).toContain("No action has been taken")
    expect(state.items.every((item) => item.actionTaken === "none")).toBe(true)
  })

  it("does not expose approval execution, activation, dispatch, worker start, or production write behavior", () => {
    const state = getHermesBlockedDeniedState()

    expect(state.safety).toEqual({
      noApprovalExecution: true,
      activationButton: false,
      dispatchAffordance: false,
      workerStarted: false,
      productionWrite: false,
    })
  })
})
