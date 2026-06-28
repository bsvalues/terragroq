import { describe, expect, it } from "vitest"
import { getDecisionEmptyStateSteps } from "@/components/decisions/decision-empty-state"

describe("decision register empty state", () => {
  it("describes governance capture without implying execution authority", () => {
    const steps = getDecisionEmptyStateSteps()

    expect(steps.map((step) => step.title)).toEqual([
      "Capture the call",
      "Separate authority",
      "Preserve lineage",
    ])
    expect(steps.some((step) => step.description.includes("work-order gate"))).toBe(true)
    expect(steps.every((step) => step.description.length > 0)).toBe(true)
  })
})
