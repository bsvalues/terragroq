import { describe, expect, it } from "vitest"
import { getDecisionReviewFlow } from "@/components/decisions/decision-review-flow"

describe("decision review flow", () => {
  it("prioritizes proposed decisions", () => {
    expect(getDecisionReviewFlow({ active: 5, proposed: 2, superseded: 1, all: 8 })).toMatchObject({
      title: "Review proposed decisions",
      action: "Open proposed queue",
      tab: "proposed",
    })
  })

  it("routes to accepted decisions when no proposals are waiting", () => {
    expect(getDecisionReviewFlow({ active: 3, proposed: 0, superseded: 1, all: 4 })).toMatchObject({
      title: "Audit active doctrine inputs",
      tab: "active",
    })
  })

  it("preserves lineage review when only superseded decisions exist", () => {
    expect(getDecisionReviewFlow({ active: 0, proposed: 0, superseded: 2, all: 2 })).toMatchObject({
      title: "Inspect decision lineage",
      tab: "superseded",
    })
  })

  it("starts with logging when the register is empty", () => {
    expect(getDecisionReviewFlow({ active: 0, proposed: 0, superseded: 0, all: 0 })).toMatchObject({
      title: "Log the first decision",
      action: "Log decision",
      tab: "all",
    })
  })
})
