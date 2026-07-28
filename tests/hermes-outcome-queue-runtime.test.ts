import { describe, expect, it, vi } from "vitest"

import { createHermesOutcomeQueueRuntime } from "../scripts/hermes-bridge/outcome-queue-runtime.mjs"

const queueItem = {
  userId: "primary-user",
  outcomeKey: "outcome:home-radar",
  goalId: 77,
  goalRef: "GOAL-0077",
  version: 4,
  executionBinding: "execution-77",
  leaseToken: "lease-77",
  fencingToken: 3,
  acquisitionKey: "acquisition-77",
}

const goal = {
  id: 77,
  userId: "primary-user",
  ref: "GOAL-0077",
  command: "Improve the WilliamOS Home radar",
  lane: "ui",
  mode: "implementation",
  risk: "R1",
  authority: "A2_WRITE_OWN",
  verdict: "allow",
  requiresApproval: false,
  matchedRules: [],
  status: "classified",
}

function runtime(overrides: Record<string, unknown> = {}) {
  return createHermesOutcomeQueueRuntime({
    databaseUrl: "postgresql://not-used",
    holderId: "resident-hermes",
    now: () => new Date("2026-07-28T12:00:00.000Z"),
    resolvePrimary: vi.fn(async () => ({ id: "primary-user" })),
    resolveGoal: vi.fn(async () => goal),
    acquire: vi.fn(async () => ({
      outcome: queueItem,
      acquired: true,
      replayed: false,
      reclaimed: false,
      reason: null,
    })),
    bindQueueWorkOrder: vi.fn(async () => queueItem),
    completeGoal: vi.fn(async () => true),
    completeQueue: vi.fn(async () => ({ outcome: { lifecycleState: "completed" }, replayed: false })),
    terminalizeGoal: vi.fn(async () => true),
    transitionQueue: vi.fn(async () => ({ lifecycleState: "blocked" })),
    deferGoal: vi.fn(async () => true),
    deferQueue: vi.fn(async () => queueItem),
    readQueue: vi.fn(async () => []),
    resumeQueue: vi.fn(async () => ({ ...queueItem, version: 5, fencingToken: 4 })),
    renewQueue: vi.fn(async () => queueItem),
    ...overrides,
  })
}

describe("Hermes durable outcome queue runtime", () => {
  it("acquires the deterministic queue candidate and binds it to its governed goal", async () => {
    const acquire = vi.fn(async () => ({
      outcome: queueItem,
      acquired: true,
      replayed: false,
      reclaimed: false,
      reason: null,
    }))
    const bridge = runtime({ acquire })

    const selected = await bridge.selectOutcome()

    expect(selected).toMatchObject({
      id: 77,
      ref: "GOAL-0077",
      queueBinding: {
        userId: "primary-user",
        outcomeKey: "outcome:home-radar",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
      },
    })
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      userId: "primary-user",
      leaseHolder: "resident-hermes",
      leaseDurationMs: 50 * 60 * 1000,
    }))
  })

  it("returns no work when the queue has no eligible acquisition", async () => {
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: null,
        acquired: false,
        replayed: false,
        reclaimed: false,
        reason: "NO_READY_OUTCOME",
      })),
    })

    await expect(bridge.selectOutcome()).resolves.toBeNull()
  })

  it("blocks an invalid linked candidate and continues to the next eligible outcome", async () => {
    const invalid = { ...queueItem, outcomeKey: "outcome:invalid", goalId: null, version: 8 }
    const acquire = vi.fn()
      .mockResolvedValueOnce({ outcome: invalid, acquired: true })
      .mockResolvedValueOnce({ outcome: queueItem, acquired: true })
    const transitionQueue = vi.fn(async () => ({ lifecycleState: "blocked" }))
    const resolveGoal = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("invalid"), { code: "HERMES_OUTCOME_QUEUE_GOAL_WALL" }))
      .mockResolvedValueOnce(goal)
    const bridge = runtime({ acquire, transitionQueue, resolveGoal })

    await expect(bridge.selectOutcome()).resolves.toMatchObject({ id: 77 })
    expect(transitionQueue).toHaveBeenCalledWith(expect.objectContaining({
      outcomeKey: "outcome:invalid",
      fromState: "active",
      toState: "blocked",
      expectedVersion: 8,
      lifecycleReason: "HERMES_OUTCOME_QUEUE_GOAL_WALL",
    }))
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it("does not quarantine an acquired outcome for a transient goal-read failure", async () => {
    const transitionQueue = vi.fn()
    const bridge = runtime({
      resolveGoal: vi.fn(async () => {
        throw Object.assign(new Error("database unavailable"), { code: "ECONNRESET" })
      }),
      transitionQueue,
    })

    await expect(bridge.selectOutcome()).rejects.toMatchObject({ code: "ECONNRESET" })
    expect(transitionQueue).not.toHaveBeenCalled()
  })

  it("settles the governed goal and exact queue fence after reviewed merge evidence", async () => {
    const completeGoal = vi.fn(async () => true)
    const completeQueue = vi.fn(async () => ({ outcome: { lifecycleState: "completed" }, replayed: false }))
    const bridge = runtime({ completeGoal, completeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.completeOutcome({
      outcomeId: 77,
      outcome,
      evidence: {
        prNumber: 475,
        mergeSha: "a".repeat(40),
        runtimeEvidenceRef: "EV-HERMES-77-3-14",
      },
    })).resolves.toBe(true)

    expect(completeGoal).toHaveBeenCalledWith(expect.objectContaining({ outcomeId: 77 }))
    expect(completeQueue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "primary-user",
      outcomeKey: "outcome:home-radar",
      expectedVersion: 4,
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      fencingToken: 3,
      acquisitionKey: "acquisition-77",
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: ["EV-HERMES-77-3-14", "pr:475", `merge:${"a".repeat(40)}`],
    }))
  })

  it("moves a terminal Hermes result to a blocked queue state under the exact fence", async () => {
    const transitionQueue = vi.fn(async () => ({ lifecycleState: "blocked" }))
    const bridge = runtime({ transitionQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.terminalizeOutcome({
      outcomeId: 77,
      outcome,
      result: "FAILED_TERMINAL",
      nextState: "VALIDATION_FAILED",
    })).resolves.toBe(true)

    expect(transitionQueue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "primary-user",
      outcomeKey: "outcome:home-radar",
      fromState: "active",
      toState: "blocked",
      expectedVersion: 4,
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      fencingToken: 3,
      lifecycleReason: "VALIDATION_FAILED",
    }))
  })

  it("accepts an exact replay after terminal queue settlement completed before restart", async () => {
    const transitionQueue = vi.fn(async () => {
      throw Object.assign(new Error("stale"), { code: "OUTCOME_QUEUE_STALE_FENCE" })
    })
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "blocked",
      lifecycleReason: "VALIDATION_FAILED",
      version: 5,
    }])
    const bridge = runtime({ transitionQueue, readQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.terminalizeOutcome({
      outcomeId: 77,
      outcome,
      result: "FAILED_TERMINAL",
      nextState: "VALIDATION_FAILED",
    })).resolves.toBe(true)
  })

  it("defers both the governed goal and exact queue lease to the retry boundary", async () => {
    const deferGoal = vi.fn(async () => true)
    const deferQueue = vi.fn(async () => queueItem)
    const bridge = runtime({ deferGoal, deferQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.deferOutcome({
      outcomeId: 77,
      outcome,
      retryAfter: "2026-07-28T12:15:00.000Z",
    })).resolves.toBe(true)
    expect(deferQueue).toHaveBeenCalledWith(expect.objectContaining({
      outcomeKey: "outcome:home-radar",
      retryAfter: "2026-07-28T12:15:00.000Z",
      lifecycleReason: "PROVIDER_UNAVAILABLE",
    }))
  })

  it("renews the exact persisted queue lease alongside the resident Hermes lease", async () => {
    const renewQueue = vi.fn(async () => queueItem)
    const bridge = runtime({ renewQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await bridge.renewOutcomeLease(outcome)

    expect(renewQueue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "primary-user",
      outcomeKey: "outcome:home-radar",
      expectedVersion: 4,
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      fencingToken: 3,
      leaseDurationMs: 50 * 60 * 1000,
    }))
  })

  it("refreshes an expired persisted binding through its original acquisition identity", async () => {
    const acquire = vi.fn(async () => ({
      outcome: { ...queueItem, version: 5, fencingToken: 4 },
      acquired: true,
      replayed: false,
      reclaimed: true,
    }))
    const bridge = runtime({ acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome)).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 5,
        fencingToken: 4,
        acquisitionKey: "acquisition-77",
        executionBinding: "execution-77",
        leaseToken: "lease-77",
      },
    })
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      acquisitionKey: "acquisition-77",
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      leaseHolder: "resident-hermes",
    }))
  })

  it("accepts an exact completed queue settlement for terminal checkpoint replay", async () => {
    const mergeSha = "a".repeat(40)
    const completed = {
      ...queueItem,
      lifecycleState: "completed",
      lifecycleReason: null,
      version: 5,
      leaseToken: null,
      terminalResult: "COMPLETE",
      terminalEvidenceId: null,
      terminalEvidenceRefs: [
        "EV-HERMES-77-3-14",
        `merge:${mergeSha}`,
        "pr:475",
      ],
      terminalKey: `hermes:${queueItem.outcomeKey}:3:${mergeSha}`,
    }
    const acquire = vi.fn(async () => ({
      outcome: completed,
      acquired: false,
      replayed: true,
      reason: "OUTCOME_ALREADY_COMPLETED",
    }))
    const bridge = runtime({ acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "COMPLETE",
      evidence: {
        prNumber: 475,
        mergeSha,
        runtimeEvidenceRef: "EV-HERMES-77-3-14",
      },
    })).resolves.toBe(outcome)
  })

  it("accepts an exact blocked queue settlement for terminal checkpoint replay", async () => {
    const acquire = vi.fn(async () => ({
      outcome: null,
      acquired: false,
      replayed: false,
      reason: "ONLY_BLOCKED_OUTCOMES",
    }))
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "blocked",
      lifecycleReason: "VALIDATION_FAILED",
      version: 5,
      leaseToken: null,
    }])
    const bridge = runtime({ acquire, readQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "FAILED_TERMINAL",
      nextState: "VALIDATION_FAILED",
    })).resolves.toBe(outcome)
  })

  it.each([
    ["completed version", { version: 6 }],
    ["completed fence", { fencingToken: 4 }],
    ["completed acquisition", { acquisitionKey: "other-acquisition" }],
    ["completed evidence", { terminalEvidenceRefs: ["pr:475"] }],
  ])("rejects a mismatched %s during terminal checkpoint refresh", async (_label, mismatch) => {
    const mergeSha = "a".repeat(40)
    const acquire = vi.fn(async () => ({
      outcome: {
        ...queueItem,
        lifecycleState: "completed",
        lifecycleReason: null,
        version: 5,
        leaseToken: null,
        terminalResult: "COMPLETE",
        terminalEvidenceId: null,
        terminalEvidenceRefs: [
          "EV-HERMES-77-3-14",
          `merge:${mergeSha}`,
          "pr:475",
        ],
        terminalKey: `hermes:${queueItem.outcomeKey}:3:${mergeSha}`,
        ...mismatch,
      },
      acquired: false,
      replayed: true,
      reason: "OUTCOME_ALREADY_COMPLETED",
    }))
    const bridge = runtime({ acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "COMPLETE",
      evidence: {
        prNumber: 475,
        mergeSha,
        runtimeEvidenceRef: "EV-HERMES-77-3-14",
      },
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REFRESH_WALL" })
  })

  it("rejects a blocked settlement with a different terminal reason", async () => {
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: null,
        acquired: false,
        reason: "ONLY_BLOCKED_OUTCOMES",
      })),
      readQueue: vi.fn(async () => [{
        ...queueItem,
        lifecycleState: "blocked",
        lifecycleReason: "REVIEW_FAILED",
        version: 5,
      }]),
    })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "FAILED_TERMINAL",
      nextState: "VALIDATION_FAILED",
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REFRESH_WALL" })
  })

  it("reactivates an owner-blocked queue item under the accepted exact decision", async () => {
    const resumeQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      version: 5,
      fencingToken: 4,
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, { decisionId: 91 }))
      .resolves.toMatchObject({
        queueBinding: { expectedVersion: 5, fencingToken: 4 },
      })
    expect(resumeQueue).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 5,
      fencingToken: 3,
      ownerDecisionId: 91,
      leaseHolder: "resident-hermes",
      leaseToken: "lease-77",
    }))
  })

  it("preserves legacy goal settlement while rejecting a malformed queue binding", async () => {
    const completeGoal = vi.fn(async () => true)
    const bridge = runtime({ completeGoal })
    await expect(bridge.completeOutcome({
      outcomeId: 77,
      outcome: goal,
      evidence: { prNumber: 475, mergeSha: "a".repeat(40) },
    })).resolves.toBe(true)
    expect(completeGoal).toHaveBeenCalledOnce()

    await expect(bridge.completeOutcome({
      outcomeId: 77,
      outcome: { ...goal, queueBinding: {} },
      evidence: { prNumber: 475, mergeSha: "a".repeat(40) },
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_BINDING_WALL" })
  })
})
