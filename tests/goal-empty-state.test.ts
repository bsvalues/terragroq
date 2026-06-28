import { describe, expect, it } from "vitest"
import { getGoalEmptyStatePrompts } from "@/components/goal-console/goal-empty-state"

describe("goal console empty state prompts", () => {
  it("offers safe starter prompts that do not imply execution", () => {
    const prompts = getGoalEmptyStatePrompts()

    expect(prompts).toHaveLength(3)
    expect(prompts.map((item) => item.intent)).toEqual([
      "Safe read-only classification",
      "Plan-mode goal with no execution",
      "Read-only loop verifier candidate",
    ])
    expect(prompts.every((item) => item.prompt.length > 0)).toBe(true)
  })
})
