import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { createHermesOutcomeQueueRuntime } from "../scripts/hermes-bridge/outcome-queue-runtime.mjs"
import {
  acquireNextEligibleOutcome,
  OUTCOME_QUEUE_SQL,
} from "../scripts/hermes-bridge/outcome-queue-source.mjs"
import {
  checkpointRecordMatchesAttempt,
} from "../scripts/hermes-bridge/v1-2-acceptance-campaign.mjs"

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
    campaignWindowId: "campaign-v1-2",
    processIdentity: "supervisor-nonce-1",
    checkpointProofProvider: vi.fn(async ({ outcome }) => ({
      outcomeId: String(outcome.goalId),
      outcomeKey: outcome.outcomeKey,
      workOrderId: outcome.activeWorkOrderId ?? null,
      fencingToken: outcome.fencingToken,
      sequence: 0,
      state: "LEASED",
      commit: { headSha: null, mergeSha: null, prNumber: null },
    })),
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
    verifyQueueWorkOrder: vi.fn(async ({ activeWorkOrderId }) => ({
      ...queueItem,
      lifecycleState: "active",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      activeWorkOrderId,
    })),
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
  it("rejects an unscoped resident runtime before it can certify acquisition evidence", () => {
    expect(() => createHermesOutcomeQueueRuntime({
      campaignWindowId: "",
      processIdentity: "",
    })).toThrowError(expect.objectContaining({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" }))
  })

  it("supplies canonical fresh and durable checkpoint context to the acquisition producer", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-queue-runtime-proof-"))
    const statePath = path.join(runtimeRoot, "state", "state.json")
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    const observed: unknown[] = []
    const acquire = vi.fn(async (input) => {
      observed.push(await input.checkpointProofProvider({
        disposition: "WINNER",
        outcome: {
          activeWorkOrderId: null,
          fencingToken: 3,
          goalId: 77,
          outcomeKey: queueItem.outcomeKey,
        },
        processIdentity: input.processIdentity,
      }))
      return { outcome: queueItem, acquired: true }
    })
    const bridge = runtime({
      acquire,
      runtimeRoot,
      checkpointProofProvider: undefined,
    })
    try {
      await bridge.selectOutcome()
      expect(observed[0]).toEqual({
        outcomeId: "77",
        outcomeKey: queueItem.outcomeKey,
        workOrderId: null,
        fencingToken: 3,
        sequence: 0,
        state: "LEASED",
        commit: { headSha: null, mergeSha: null, prNumber: null },
      })

      fs.writeFileSync(statePath, JSON.stringify({
        schemaVersion: 1,
        storeId: "hermes-bridge",
        revision: 1,
        updatedAt: "2026-07-28T12:00:00.000Z",
        nextFencingToken: 4,
        killSwitch: { active: false, reason: null, updatedAt: null },
        ownerTouchCounters: {
          OWNER_OPERATION_TOUCH_COUNT: 0,
          OWNER_CREDENTIAL_TOUCH_COUNT: 0,
          OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
          OWNER_ROUTINE_DECISION_COUNT: 0,
          OWNER_ROUTINE_CONTACT_COUNT: 0,
        },
        executions: {
          77: {
            outcomeId: "77",
            fencingToken: 3,
            lease: {
              status: "ACTIVE",
              holderId: "resident-hermes",
              acquiredAt: "2026-07-28T12:00:00.000Z",
              expiresAt: "2026-07-28T12:50:00.000Z",
              releasedAt: null,
            },
            checkpoint: {
              sequence: 6,
              state: "COMMIT_CREATED",
              detail: null,
              recordedAt: "2026-07-28T12:10:00.000Z",
            },
            metadata: {
              headRefOid: "a".repeat(40),
              mergeSha: null,
              prNumber: 472,
              outcome: {
                queueBinding: {
                  outcomeKey: queueItem.outcomeKey,
                  activeWorkOrderId: 472,
                },
              },
            },
          },
        },
        idempotency: {},
      }))
      const durableProvider = acquire.mock.calls[0][0].checkpointProofProvider
      await expect(durableProvider({
        disposition: "REPLAY_WINNER",
        outcome: {
          activeWorkOrderId: 472,
          fencingToken: 3,
          goalId: 77,
          outcomeKey: queueItem.outcomeKey,
        },
      })).resolves.toEqual({
        outcomeId: "77",
        outcomeKey: queueItem.outcomeKey,
        workOrderId: 472,
        fencingToken: 3,
        sequence: 6,
        state: "COMMIT_CREATED",
        commit: { headSha: "a".repeat(40), mergeSha: null, prNumber: 472 },
      })
    } finally {
      await bridge.close()
      fs.rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

  it("carries resident identity through the real acquisition producer into checkpoint verification", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-queue-runtime-integration-"))
    const statePath = path.join(runtimeRoot, "state", "state.json")
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    const active = {
      ...queueItem,
      activeWorkOrderId: 472,
      lifecycleState: "active",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const state = {
      schemaVersion: 1,
      storeId: "hermes-bridge",
      revision: 1,
      updatedAt: "2026-07-28T12:00:00.000Z",
      nextFencingToken: 4,
      killSwitch: { active: false, reason: null, updatedAt: null },
      ownerTouchCounters: {
        OWNER_OPERATION_TOUCH_COUNT: 0,
        OWNER_CREDENTIAL_TOUCH_COUNT: 0,
        OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
        OWNER_ROUTINE_DECISION_COUNT: 0,
        OWNER_ROUTINE_CONTACT_COUNT: 0,
      },
      executions: {
        77: {
          outcomeId: "77",
          fencingToken: 3,
          lease: {
            status: "ACTIVE",
            holderId: "resident-hermes",
            acquiredAt: "2026-07-28T12:00:00.000Z",
            expiresAt: "2026-07-28T12:50:00.000Z",
            releasedAt: null,
          },
          checkpoint: {
            sequence: 6,
            state: "COMMIT_CREATED",
            detail: null,
            recordedAt: "2026-07-28T12:10:00.000Z",
          },
          metadata: {
            headRefOid: "a".repeat(40),
            mergeSha: null,
            prNumber: 472,
            outcome: {
              queueBinding: {
                outcomeKey: queueItem.outcomeKey,
                activeWorkOrderId: 472,
              },
            },
          },
        },
      },
      idempotency: {},
    }
    fs.writeFileSync(statePath, JSON.stringify(state))
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
        || sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.readAcquisitionReceipt
        || sql === OUTCOME_QUEUE_SQL.readAcquisition) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.acquire) {
        Object.assign(active, {
          acquisitionKey: values[2],
          executionBinding: values[3],
          leaseHolder: values[4],
          leaseToken: values[5],
          leaseExpiresAt: values[6],
        })
        return { rows: [active] }
      }
      if (sql === OUTCOME_QUEUE_SQL.insertAcquisitionReceipt) return { rows: [{ id: 90 }] }
      if (sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt) return { rows: [{ id: 91 }] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const bridge = runtime({
      runtimeRoot,
      checkpointProofProvider: undefined,
      acquire: (input: Record<string, unknown>) => acquireNextEligibleOutcome({
        ...input,
        query: Object.assign(query, {
          connect: async () => ({ query, release: vi.fn() }),
        }),
      }),
    })
    try {
      await expect(bridge.selectOutcome()).resolves.toMatchObject({
        queueBinding: {
          outcomeKey: active.outcomeKey,
          activeWorkOrderId: 472,
          fencingToken: 3,
        },
      })
      const values = query.mock.calls.find(
        ([sql]) => sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt,
      )?.[1] as unknown[]
      const attempt = {
        id: 91,
        campaignWindowId: values[1],
        processIdentity: values[2],
        leaseHolder: values[3],
        acquisitionKeyDigest: values[4],
        leaseIdentityDigest: values[5],
        checkpointDigest: values[6],
        checkpointOutcomeId: values[7],
        checkpointSequence: values[8],
        checkpointState: values[9],
        checkpointHeadSha: values[10],
        checkpointMergeSha: values[11],
        checkpointPrNumber: values[12],
        outcomeKey: values[13],
        fencingToken: values[14],
        leaseExpiresAt: values[15],
        activeWorkOrderId: values[16],
        disposition: values[17],
        reason: values[18],
        attemptedAt: values[19],
      }
      expect(attempt).toMatchObject({
        campaignWindowId: "campaign-v1-2",
        processIdentity: "supervisor-nonce-1",
        disposition: "WINNER",
      })
      expect(checkpointRecordMatchesAttempt(attempt, [], state)).toBe(true)
      expect(JSON.stringify(attempt)).not.toContain(active.leaseToken)
      expect(JSON.stringify(attempt)).not.toContain(active.executionBinding)
      expect(JSON.stringify(attempt)).not.toContain(active.acquisitionKey)
    } finally {
      await bridge.close()
      fs.rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

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
      campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1",
      checkpointProofProvider: expect.any(Function),
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

  it("uses the active-only source contract for an initial Work Order binding", async () => {
    const bindQueueWorkOrder = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      leaseHolder: "resident-hermes",
      activeWorkOrderId: 472,
    }))
    const bridge = runtime({ bindQueueWorkOrder })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.bindWorkOrder(outcome, 472)).resolves.toMatchObject({
      queueBinding: {
        activeWorkOrderId: 472,
        expectedVersion: 4,
        fencingToken: 3,
      },
    })
    expect(bindQueueWorkOrder).toHaveBeenCalledOnce()
  })

  it("accepts only the exact existing canonical Work Order binding during recovery", async () => {
    const bindQueueWorkOrder = vi.fn()
    const verifyQueueWorkOrder = vi.fn(async ({ activeWorkOrderId }) => ({
      ...queueItem,
      lifecycleState: "active",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      activeWorkOrderId,
    }))
    const bridge = runtime({ bindQueueWorkOrder, verifyQueueWorkOrder })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: queueItem.version,
        activeWorkOrderId: 472,
      },
    }

    await expect(bridge.bindWorkOrder(outcome, 472, "review")).resolves.toMatchObject({
      queueBinding: { activeWorkOrderId: 472 },
    })
    expect(bindQueueWorkOrder).not.toHaveBeenCalled()
    expect(verifyQueueWorkOrder).toHaveBeenCalledWith(expect.objectContaining({
      activeWorkOrderId: 472,
      expectedWorkOrderStatus: "review",
    }))
    await expect(bridge.bindWorkOrder(outcome, 473)).rejects.toMatchObject({
      code: "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL",
    })
  })

  it("preserves an existing Work Order binding reconstructed by exact queue refresh", async () => {
    const acquire = vi.fn(async () => ({
      outcome: {
        ...queueItem,
        lifecycleState: "active",
        leaseHolder: "resident-hermes",
        activeWorkOrderId: 472,
      },
      acquired: true,
      replayed: true,
      reclaimed: false,
      reason: null,
    }))
    const bridge = runtime({ acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome)).resolves.toMatchObject({
      queueBinding: { activeWorkOrderId: 472 },
    })
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
      terminalKey: `hermes:outcome:home-radar:3:${"a".repeat(40)}`,
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: ["EV-HERMES-77-3-14", "pr:475", `merge:${"a".repeat(40)}`],
    }))
    expect(completeQueue.mock.invocationCallOrder[0])
      .toBeLessThan(completeGoal.mock.invocationCallOrder[0])
  })

  it.each([
    ["missing", undefined],
    ["short", "a".repeat(39)],
    ["non-hex", `${"a".repeat(39)}g`],
    ["non-canonical uppercase", "A".repeat(40)],
  ])("rejects a %s merge SHA before any completion settlement", async (_label, mergeSha) => {
    const completeGoal = vi.fn(async () => true)
    const completeQueue = vi.fn()
    const bridge = runtime({ completeGoal, completeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.completeOutcome({
      outcomeId: 77,
      outcome,
      evidence: {
        prNumber: 475,
        mergeSha,
        runtimeEvidenceRef: "EV-HERMES-77-3-14",
      },
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_MERGE_SHA_WALL" })
    expect(completeGoal).not.toHaveBeenCalled()
    expect(completeQueue).not.toHaveBeenCalled()
  })

  it("reconciles an exact queue-only completion after the queue write loses its response", async () => {
    const mergeSha = "a".repeat(40)
    const evidence = {
      prNumber: 475,
      mergeSha,
      runtimeEvidenceRef: "EV-HERMES-77-3-14",
    }
    const completeQueue = vi.fn(async () => {
      throw new Error("connection lost after commit")
    })
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "completed",
      lifecycleReason: null,
      version: 5,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: "COMPLETE",
      terminalEvidenceId: null,
      terminalEvidenceRefs: [
        "EV-HERMES-77-3-14",
        `merge:${mergeSha}`,
        "pr:475",
      ],
      terminalKey: `hermes:${queueItem.outcomeKey}:3:${mergeSha}`,
      terminalAt: "2026-07-28T12:00:00.000Z",
    }])
    const bridge = runtime({ completeQueue, readQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.completeOutcome({ outcomeId: 77, outcome, evidence })).resolves.toBe(true)
  })

  it("moves a terminal Hermes result to a blocked queue state under the exact fence", async () => {
    const transitionQueue = vi.fn(async () => ({ lifecycleState: "blocked" }))
    const terminalizeGoal = vi.fn(async () => true)
    const bridge = runtime({ transitionQueue, terminalizeGoal })
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
    expect(transitionQueue.mock.invocationCallOrder[0])
      .toBeLessThan(terminalizeGoal.mock.invocationCallOrder[0])
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
    expect(deferQueue.mock.invocationCallOrder[0])
      .toBeLessThan(deferGoal.mock.invocationCallOrder[0])
  })

  it("reconciles an exact queue-only provider deferral after the queue write loses its response", async () => {
    const retryAfter = "2026-07-28T12:15:00.000Z"
    const boundItem = {
      ...queueItem,
      activeWorkOrderId: 472,
    }
    const deferQueue = vi.fn(async () => {
      throw new Error("connection lost after commit")
    })
    const readQueue = vi.fn(async () => [{
      ...boundItem,
      lifecycleState: "active",
      lifecycleReason: "PROVIDER_UNAVAILABLE",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: retryAfter,
    }])
    const bridge = runtime({ deferQueue, readQueue })
    const outcome = {
      ...goal,
      queueBinding: { ...boundItem, expectedVersion: boundItem.version },
    }

    await expect(bridge.deferOutcome({ outcomeId: 77, outcome, retryAfter }))
      .resolves.toBe(true)
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
    const checkpointProofProvider = vi.fn()
    const acquire = vi.fn(async (input) => {
      expect(input).toEqual({
        databaseUrl: "postgresql://not-used",
        userId: "primary-user",
        acquisitionKey: "acquisition-77",
        leaseHolder: "resident-hermes",
        leaseToken: "lease-77",
        executionBinding: "execution-77",
        leaseDurationMs: 50 * 60 * 1000,
        campaignWindowId: "campaign-v1-2",
        processIdentity: "supervisor-nonce-1",
        checkpointProofProvider,
        now: new Date("2026-07-28T12:00:00.000Z"),
      })
      return {
        outcome: { ...queueItem, version: 5, fencingToken: 4 },
        acquired: true,
        replayed: false,
        reclaimed: true,
      }
    })
    const bridge = runtime({ acquire, checkpointProofProvider })
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

  it("accepts an exact owner-decision blocked settlement for split replay", async () => {
    const acquire = vi.fn(async () => ({
      outcome: null,
      acquired: false,
      replayed: false,
      reason: "ONLY_BLOCKED_OUTCOMES",
    }))
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "blocked",
      lifecycleReason: "NEW_AUTHORITY_REQUIRED",
      version: 5,
      leaseToken: null,
    }])
    const bridge = runtime({ acquire, readQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "OWNER_DECISION_REQUIRED",
      nextState: "NEW_AUTHORITY_REQUIRED",
    })).resolves.toBe(outcome)
  })

  it("rejects an owner-decision split settlement with a mismatched fence", async () => {
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: null,
        acquired: false,
        reason: "ONLY_BLOCKED_OUTCOMES",
      })),
      readQueue: vi.fn(async () => [{
        ...queueItem,
        lifecycleState: "blocked",
        lifecycleReason: "NEW_AUTHORITY_REQUIRED",
        version: 5,
        fencingToken: 4,
        leaseToken: null,
      }]),
    })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "OWNER_DECISION_REQUIRED",
      nextState: "NEW_AUTHORITY_REQUIRED",
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REFRESH_WALL" })
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
      lifecycleReason: "OWNER_DECISION_RESUMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, { decisionId: 91 }))
      .resolves.toMatchObject({
        queueBinding: { expectedVersion: 6, fencingToken: 4 },
      })
    expect(resumeQueue).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 5,
      fencingToken: 3,
      ownerDecisionId: 91,
      leaseHolder: "resident-hermes",
      leaseToken: "lease-77",
    }))
  })

  it("reconstructs the fresh queue fence from an exact committed resume replay", async () => {
    const resumeQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, { decisionId: 91 }))
      .resolves.toMatchObject({
        queueBinding: {
          expectedVersion: 6,
          fencingToken: 4,
          executionBinding: "execution-77",
          acquisitionKey: "acquisition-77",
          leaseToken: "lease-77",
        },
      })
  })

  it("rejects a reconstructed owner-decision resume with a mismatched fresh fence", async () => {
    const resumeQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 5,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, { decisionId: 91 }))
      .rejects.toMatchObject({
        code: "HERMES_OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL",
      })
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

  it("lazily reuses one database pool and closes it exactly once", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
      .mockResolvedValueOnce({ rows: [goal] })
      .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
      .mockResolvedValueOnce({ rows: [goal] })
    const end = vi.fn(async () => {})
    const on = vi.fn()
    const createPool = vi.fn(async () => ({ query, end, on }))
    const bridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://not-used",
      holderId: "resident-hermes",
      campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1",
      checkpointProofProvider: vi.fn(),
      createPool,
      acquire: vi.fn(async () => ({
        outcome: queueItem,
        acquired: true,
        replayed: false,
        reclaimed: false,
        reason: null,
      })),
    })

    expect(createPool).not.toHaveBeenCalled()
    await bridge.selectOutcome()
    await bridge.selectOutcome()
    expect(createPool).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledTimes(4)
    expect(end).not.toHaveBeenCalled()

    await bridge.close()
    await bridge.close()
    expect(end).toHaveBeenCalledOnce()
    await expect(bridge.selectOutcome())
      .rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_RUNTIME_CLOSED" })
  })

  it("evicts and closes an errored pool before lazily replacing it", async () => {
    const handlers: Array<(error: Error) => void> = []
    const firstEnd = vi.fn(async () => {})
    const secondEnd = vi.fn(async () => {})
    const firstPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
        .mockResolvedValueOnce({ rows: [goal] }),
      end: firstEnd,
      on: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === "error") handlers.push(handler)
      }),
    }
    const secondPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
        .mockResolvedValueOnce({ rows: [goal] }),
      end: secondEnd,
      on: vi.fn(),
    }
    const createPool = vi.fn()
      .mockResolvedValueOnce(firstPool)
      .mockResolvedValueOnce(secondPool)
    const bridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://not-used",
      campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1",
      checkpointProofProvider: vi.fn(),
      createPool,
      acquire: vi.fn(async () => ({ outcome: queueItem, acquired: true })),
    })

    await bridge.selectOutcome()
    handlers[0](new Error("idle client failed"))
    await vi.waitFor(() => expect(firstEnd).toHaveBeenCalledOnce())
    await bridge.selectOutcome()
    expect(createPool).toHaveBeenCalledTimes(2)

    await bridge.close()
    expect(secondEnd).toHaveBeenCalledOnce()
  })
})
