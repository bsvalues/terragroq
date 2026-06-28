import { describe, expect, it } from "vitest"
import { getEventEmptyStateActions } from "@/components/dashboard/event-empty-state"

describe("dashboard audit empty state", () => {
  it("offers non-executing operator actions that can create future audit evidence", () => {
    const actions = getEventEmptyStateActions()

    expect(actions.map((action) => action.href)).toEqual([
      "/goal-console",
      "/work-orders",
      "/doctrine",
    ])
    expect(actions.every((action) => action.title.length > 0)).toBe(true)
    expect(actions.every((action) => action.description.length > 0)).toBe(true)
  })
})
