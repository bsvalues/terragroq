import { describe, expect, it } from "vitest"

import { buildProtectedOutcomeReorderSnapshot } from "@/lib/outcome-queue/protected-reorder-snapshot"

const protectedKeys = new Set(["proof", "campaign"])

describe("protected outcome reorder snapshots", () => {
  const rows = [
    { outcomeKey: "ordinary-a", lifecycleState: "suggested", version: 2 },
    { outcomeKey: "proof", lifecycleState: "blocked", version: 4 },
    { outcomeKey: "ordinary-b", lifecycleState: "approved", version: 5 },
    { outcomeKey: "campaign", lifecycleState: "suggested", version: 0 },
    { outcomeKey: "active", lifecycleState: "active", version: 8 },
  ]

  it("sends a complete reorderable snapshot while preserving protected positions", () => {
    expect(buildProtectedOutcomeReorderSnapshot({
      rows,
      outcomeKey: "ordinary-a",
      direction: 1,
      protectedOutcomeKeys: protectedKeys,
    })).toEqual([
      { outcomeKey: "ordinary-b", expectedVersion: 5 },
      { outcomeKey: "proof", expectedVersion: 4 },
      { outcomeKey: "ordinary-a", expectedVersion: 2 },
      { outcomeKey: "campaign", expectedVersion: 0 },
    ])
  })

  it("never moves a protected row or crosses the ordinary bounds", () => {
    expect(buildProtectedOutcomeReorderSnapshot({
      rows,
      outcomeKey: "proof",
      direction: 1,
      protectedOutcomeKeys: protectedKeys,
    })).toBeNull()
    expect(buildProtectedOutcomeReorderSnapshot({
      rows,
      outcomeKey: "ordinary-a",
      direction: -1,
      protectedOutcomeKeys: protectedKeys,
    })).toBeNull()
  })
})
