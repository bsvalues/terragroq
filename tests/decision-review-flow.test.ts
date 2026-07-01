import { describe, expect, it } from "vitest"
import { getDecisionReviewFlow } from "@/components/decisions/decision-review-flow"

describe("decision review flow", () => {
  it("prioritizes proposed decisions", () => {
    expect(getDecisionReviewFlow({ active: 5, proposed: 2, superseded: 1, all: 8 })).toMatchObject({
      title: "Review proposed decisions",
      action: "Open proposed queue",
      homeSignal: "Home routed here because authority is waiting.",
      queueLabel: "Primary decision queue",
      nextMove: "Resolve the proposed call, then return Home to classify the next objective.",
      boundary: "Decision review records authority. It does not execute work or grant runtime access.",
      tab: "proposed",
    })
  })

  it("routes to accepted decisions when no proposals are waiting", () => {
    expect(getDecisionReviewFlow({ active: 3, proposed: 0, superseded: 1, all: 4 })).toMatchObject({
      title: "Audit active doctrine inputs",
      homeSignal: "Home has no proposed decision blocker.",
      queueLabel: "Accepted operating context",
      nextMove: "Use active decisions as constraints before drafting the next Work Order.",
      tab: "active",
    })
  })

  it("preserves lineage review when only superseded decisions exist", () => {
    expect(getDecisionReviewFlow({ active: 0, proposed: 0, superseded: 2, all: 2 })).toMatchObject({
      title: "Inspect decision lineage",
      queueLabel: "Historical authority trail",
      boundary: "Lineage is evidence. It does not change current authority by itself.",
      tab: "superseded",
    })
  })

  it("starts with logging when the register is empty", () => {
    expect(getDecisionReviewFlow({ active: 0, proposed: 0, superseded: 0, all: 0 })).toMatchObject({
      title: "Log the first decision",
      action: "Log decision",
      homeSignal: "Home needs an authority baseline.",
      nextMove: "Record the first call, then use Work Orders for scoped implementation.",
      tab: "all",
    })
  })
})
