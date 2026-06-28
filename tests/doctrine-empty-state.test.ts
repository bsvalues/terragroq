import { describe, expect, it } from "vitest"
import { getDoctrineEmptyStateSteps } from "@/components/doctrine/doctrine-empty-state"

describe("doctrine empty state", () => {
  it("describes baseline, approval, and lineage expectations", () => {
    const steps = getDoctrineEmptyStateSteps()

    expect(steps.map((step) => step.id)).toEqual(["baseline", "approval", "lineage"])
    expect(steps.map((step) => step.title)).toEqual([
      "Seed the baseline",
      "Declare approval rules",
      "Supersede, do not overwrite",
    ])
    expect(steps.some((step) => step.description.includes("explicit authority"))).toBe(true)
  })

  it("returns a copy so callers cannot mutate shared state", () => {
    const steps = getDoctrineEmptyStateSteps()
    steps.push({
      id: "mutated",
      title: "Mutated",
      description: "This should not persist.",
    })

    expect(getDoctrineEmptyStateSteps().map((step) => step.id)).toEqual([
      "baseline",
      "approval",
      "lineage",
    ])
  })
})
