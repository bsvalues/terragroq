import { describe, expect, it } from "vitest"

import {
  buildOutcomeQueueRuntimeMutation,
  classifyOutcomeQueueMutationError,
  isOutcomeAuthorityBindingAllowed,
  isOutcomeAuthorityLifecycleEligible,
  outcomeAuthorityGrantResult,
  shouldOfferOutcomeAuthorityBinding,
  shouldRebindOutcomeAuthority,
  scopeMatchesOutcome,
  validateOutcomeQueueMutationInput,
  type OutcomeQueueMutationInput,
} from "@/lib/outcome-queue/operator-mutations"

describe("outcome queue server-action boundary", () => {
  const authorityItem = {
    outcomeKey: "goal:GOAL-1000",
    title: "Improve the WilliamOS queue",
    objective: "Add a bounded operator surface",
    riskClass: "R1",
    authorityLevel: "A2_WRITE_OWN",
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
  }
  const approval = {
    status: "accepted",
    authority: "binding",
    decision: "APPROVE",
    scope: authorityItem.outcomeKey,
  }

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
      dependencyKeys: undefined,
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
    expect(classifyOutcomeQueueMutationError("OUTCOME_QUEUE_AUTHORITY_EXPIRED"))
      .toBe("UNAUTHORIZED")
    expect(classifyOutcomeQueueMutationError("OUTCOME_QUEUE_TRANSITION_ILLEGAL"))
      .toBe("INVALID")
    expect(classifyOutcomeQueueMutationError("OUTCOME_QUEUE_DEPENDENCY_CYCLE"))
      .toBe("INVALID")
    expect(classifyOutcomeQueueMutationError("UNRELATED_DATABASE_ERROR")).toBeNull()
  })

  it("never treats two null scopes as an authority match", () => {
    expect(scopeMatchesOutcome(null, "outcome:successor:1", null)).toBe(false)
    expect(scopeMatchesOutcome("outcome:successor:1", "outcome:successor:1", null))
      .toBe(true)
    expect(scopeMatchesOutcome("GOAL-1000", "outcome:1", "GOAL-1000")).toBe(true)
  })

  it("permits only exact-scope, bounded WilliamOS outcome authority", () => {
    expect(isOutcomeAuthorityBindingAllowed(authorityItem, approval)).toBe(true)
    expect(isOutcomeAuthorityBindingAllowed(authorityItem, {
      ...approval,
      decision: "DENY",
    })).toBe(false)
    expect(isOutcomeAuthorityBindingAllowed(authorityItem, {
      ...approval,
      scope: "GOAL-1000",
    })).toBe(false)
    expect(isOutcomeAuthorityBindingAllowed({
      ...authorityItem,
      authorityLevel: "A3_WRITE_SHARED",
    }, approval)).toBe(false)
    expect(isOutcomeAuthorityBindingAllowed({
      ...authorityItem,
      authoritySubject: "codex",
    }, approval)).toBe(false)
    expect(isOutcomeAuthorityBindingAllowed({
      ...authorityItem,
      authorityAction: "production:deploy",
    }, approval)).toBe(false)
    expect(isOutcomeAuthorityBindingAllowed({
      ...authorityItem,
      title: "Deploy TerraFusion to production",
    }, approval)).toBe(false)
    for (const title of [
      "Update production configuration",
      "Deploy on production",
      "Mutating production records",
    ]) {
      expect(isOutcomeAuthorityBindingAllowed({
        ...authorityItem,
        title,
      }, approval)).toBe(false)
    }
    expect(isOutcomeAuthorityBindingAllowed({
      ...authorityItem,
      objective: "Retry rejected issue #357",
    }, approval)).toBe(false)
    expect(isOutcomeAuthorityBindingAllowed({
      ...authorityItem,
      objective: "Release the next eligible Work Order after completion",
    }, approval)).toBe(true)
    expect(isOutcomeAuthorityBindingAllowed({
      ...authorityItem,
      objective: "Improve billing status visibility and the decision dropdown",
    }, approval)).toBe(true)
  })

  it("permits authority recording only before execution or in a blocked state", () => {
    for (const lifecycleState of ["suggested", "approved", "blocked"]) {
      expect(isOutcomeAuthorityLifecycleEligible(lifecycleState)).toBe(true)
    }
    for (const lifecycleState of ["active", "completed", "declined", "superseded"]) {
      expect(isOutcomeAuthorityLifecycleEligible(lifecycleState)).toBe(false)
    }
  })

  it("reports shared grant replay without claiming a new grant", () => {
    expect(outcomeAuthorityGrantResult("GRANT-0007", false)).toEqual({
      status: "RECORDED",
      message: "Exact-scope outcome authority recorded.",
      grantRef: "GRANT-0007",
    })
    expect(outcomeAuthorityGrantResult("GRANT-0007", true)).toEqual({
      status: "REPLAYED",
      message: "The scoped authority grant is already recorded.",
      grantRef: "GRANT-0007",
    })
  })

  it("rebinds renewed authority only for an approved row with a changed grant", () => {
    expect(shouldRebindOutcomeAuthority("approved", "GRANT-0001", "GRANT-0002"))
      .toBe(true)
    expect(shouldRebindOutcomeAuthority("approved", "GRANT-0002", "GRANT-0002"))
      .toBe(false)
    expect(shouldRebindOutcomeAuthority("suggested", null, "GRANT-0002"))
      .toBe(false)
    expect(shouldRebindOutcomeAuthority("blocked", "GRANT-0001", "GRANT-0002"))
      .toBe(false)
  })

  it("keeps approved-row authority repair available after a failed rebind", () => {
    expect(shouldOfferOutcomeAuthorityBinding("approved", "GRANT-0001", "GRANT-0002"))
      .toBe(true)
    expect(shouldOfferOutcomeAuthorityBinding("approved", "GRANT-0002", "GRANT-0002"))
      .toBe(false)
    expect(shouldOfferOutcomeAuthorityBinding("approved", "GRANT-0001", null))
      .toBe(true)
    expect(shouldOfferOutcomeAuthorityBinding("blocked", "GRANT-0001", "GRANT-0002"))
      .toBe(false)
  })

  it("rejects malformed or unbounded public mutation payloads", () => {
    expect(validateOutcomeQueueMutationInput({
      action: "destroy",
      outcomeKey: "goal:1",
      expectedVersion: 1,
      idempotencyKey: "key",
    })).toBeNull()
    expect(validateOutcomeQueueMutationInput({
      action: "supersede",
      outcomeKey: "goal:1",
      expectedVersion: 1,
      idempotencyKey: "key",
      replacement: { title: "x".repeat(501) },
    })).toBeNull()
    expect(validateOutcomeQueueMutationInput({
      action: "reorder",
      outcomeKey: "goal:1",
      expectedVersion: 1,
      idempotencyKey: "key",
      orderedOutcomes: Array.from({ length: 501 }, (_, index) => ({
        outcomeKey: `goal:${index}`,
        expectedVersion: 1,
      })),
    })).toBeNull()
    expect(validateOutcomeQueueMutationInput({
      action: "dependencies",
      outcomeKey: "goal:1",
      expectedVersion: 1,
      idempotencyKey: "key",
    })).toBeNull()
    expect(validateOutcomeQueueMutationInput({
      action: "dependencies",
      outcomeKey: "goal:1",
      expectedVersion: 1,
      idempotencyKey: "key",
      dependencyKeys: ["goal:2", "goal:2"],
    })).toBeNull()
    expect(validateOutcomeQueueMutationInput({
      action: "dependencies",
      outcomeKey: "goal:1",
      expectedVersion: 1,
      idempotencyKey: "key",
      dependencyKeys: ["goal:2"],
    })).toMatchObject({ action: "dependencies", dependencyKeys: ["goal:2"] })
  })
})
