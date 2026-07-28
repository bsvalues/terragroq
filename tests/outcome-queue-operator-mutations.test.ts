import { describe, expect, it } from "vitest"

import {
  buildOutcomeQueueRuntimeMutation,
  classifyOutcomeQueueMutationError,
  scopeMatchesOutcome,
  type OutcomeQueueMutationInput,
} from "@/lib/outcome-queue/operator-mutations"

describe("outcome queue server-action boundary", () => {
  it("forwards only allowlisted mutation fields and preserves trusted scope", () => {
    const query = { trusted: true }
    const input = {
      action: "pause",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 4,
      idempotencyKey: "decision-1",
      reason: "Pause",
      userId: "attacker",
      query: { trusted: false },
      databaseUrl: "attacker-controlled",
      now: "1999-01-01T00:00:00.000Z",
    } as OutcomeQueueMutationInput & Record<string, unknown>

    expect(buildOutcomeQueueRuntimeMutation(input, "owner", query)).toEqual({
      query,
      userId: "owner",
      action: "pause",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 4,
      idempotencyKey: "decision-1",
      reason: "Pause",
      approvalDecisionId: undefined,
      authorityGrantRef: undefined,
      orderedOutcomes: undefined,
      replacement: undefined,
    })
  })

  it("classifies normal concurrent snapshot membership changes as stale", () => {
    expect(classifyOutcomeQueueMutationError(
      "OUTCOME_QUEUE_ORDERED_SNAPSHOT_INCOMPLETE",
    )).toBe("STALE")
    expect(classifyOutcomeQueueMutationError("OUTCOME_QUEUE_OUTCOME_NOT_FOUND")).toBe("STALE")
    expect(classifyOutcomeQueueMutationError("OUTCOME_QUEUE_IDEMPOTENCY_CONFLICT"))
      .toBe("CONFLICT")
  })

  it("never treats two null scopes as an authority match", () => {
    expect(scopeMatchesOutcome(null, "outcome:successor:1", null)).toBe(false)
    expect(scopeMatchesOutcome("outcome:successor:1", "outcome:successor:1", null))
      .toBe(true)
    expect(scopeMatchesOutcome("GOAL-1000", "outcome:1", "GOAL-1000")).toBe(true)
  })
})
