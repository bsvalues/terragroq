import { describe, expect, it, vi } from "vitest"

import {
  buildFocusedValidationCommand,
  createDeterministicValidatorCircuit,
  createDeterministicValidatorReplacement,
  createDeterministicValidatorWallEvidence,
} from "../scripts/hermes-bridge/deterministic-validator-recovery.mjs"
import { recoverDeterministicValidatorQueue } from "../scripts/hermes-bridge/deterministic-validator-queue-recovery.mjs"

function recoveryExecution() {
  const contractBody = {
    id: "outcome-44",
    reservations: ["app/page.tsx", "tests/app.test.tsx"],
    validationCommands: [{ command: "npx", args: ["vitest", "run", "tests/app.test.tsx"], timeoutMs: 60_000 }],
  }
  const contract = { ...contractBody, digest: "a".repeat(64) }
  const focusedValidationCommand = buildFocusedValidationCommand({
    testPaths: ["packages/ui/src/__tests__/county.spec.ts"],
  })
  const evidence = createDeterministicValidatorWallEvidence({
    outcomeId: "44",
    outcomeKey: "goal:GOAL-0040",
    contract,
    worktreeSnapshotHash: "b".repeat(64),
    missingTestPaths: ["packages/ui/src/__tests__/county.spec.ts"],
    focusedValidationCommand,
  })
  const replacement = createDeterministicValidatorReplacement({ contract, evidence })
  const circuit = createDeterministicValidatorCircuit({
    evidence,
    replacement,
    sourceFencingToken: 225,
    sourceCheckpointSequence: 17,
    observedAt: "2026-08-31T12:00:00.000Z",
  })
  return {
    outcomeId: "44",
    fencingToken: 225,
    lease: { status: "ABANDONED" },
    metadata: {
      deterministicValidatorCircuit: circuit,
      outcome: {
        id: 44,
        userId: "owner-id",
        outcomeKey: "goal:GOAL-0040",
        queueBinding: {
          userId: "owner-id",
          outcomeKey: "goal:GOAL-0040",
          expectedVersion: 12,
          executionBinding: "execution-44",
          leaseHolder: "Hermes:hermes-outcome-queue",
          leaseToken: "lease-44",
          acquisitionKey: "acquisition-44",
          fencingToken: 34,
          authorityGrantRef: "grant-44",
          activeWorkOrderId: 144,
        },
      },
    },
  }
}

function queuePool(execution: ReturnType<typeof recoveryExecution>, {
  drift = false, authorityRevoked = false, workOrderInvalid = false,
} = {}) {
  const queue = execution.metadata.outcome.queueBinding
  const recovery = execution.metadata.deterministicValidatorCircuit.recovery
  let receipt: any = null
  let mutations = 0
  let version = drift ? queue.expectedVersion + 1 : queue.expectedVersion
  let fence = queue.fencingToken
  let acquisitionFence = queue.fencingToken
  let leaseExpiresAt = "2026-08-31T12:05:00.000Z"
  let validators = recovery.oldContract.validationCommands.map(
    ({ command, args }: any) => `${command} ${args.join(" ")}`,
  )
  let lockOwner: object | null = null
  const lockWaiters: Array<() => void> = []
  const releaseLock = (clientState: any) => {
    if (lockOwner !== clientState) return
    lockOwner = null
    clientState.hasLock = false
    lockWaiters.shift()?.()
  }
  const query = vi.fn(async (sql: string, args: any[] = [], clientState: any = {}) => {
    if (sql === "BEGIN") return { rows: [] }
    if (sql === "COMMIT" || sql === "ROLLBACK") {
      releaseLock(clientState)
      return { rows: [] }
    }
    if (sql.includes("pg_advisory_xact_lock")) {
      if (!clientState.hasLock) {
        while (lockOwner !== null) await new Promise<void>((resolve) => lockWaiters.push(resolve))
        lockOwner = clientState
        clientState.hasLock = true
      }
      return { rows: [] }
    }
    if (!sql.includes('FROM "outcome_queue_item"')
      && sql.includes('FROM "outcome_queue_mutation_receipt"') && sql.includes('"idempotencyKey"')) {
      return { rows: receipt ? [receipt] : [] }
    }
    if (sql.includes("clock_timestamp")) return { rows: [{ now: "2026-08-31T12:00:01.000Z" }] }
    if (sql.includes('FROM "outcome_queue_item"')) {
      return { rows: authorityRevoked || workOrderInvalid ? [] : [{
        goalId: 40,
        goalRef: "GOAL-0040",
        outcomeKey: "goal:GOAL-0040",
        version,
        fencingToken: fence,
        executionBinding: queue.executionBinding,
        leaseHolder: queue.leaseHolder,
        leaseToken: queue.leaseToken,
        leaseExpiresAt,
        acquisitionKey: queue.acquisitionKey,
        activeWorkOrderId: queue.activeWorkOrderId,
        authorityGrantRef: queue.authorityGrantRef,
        lifecycleState: "active",
      }] }
    }
    if (sql.includes("operation IN ('workbench_execution.authorize', 'runtime_finding.derive')")) {
      return { rows: [{ id: 91, operation: "workbench_execution.authorize", resultBinding: { workContract: recovery.oldContract } }] }
    }
    if (sql.includes('FROM "outcome_queue_acquisition_receipt"')) {
      return { rows: [{ id: 92, latestFencingToken: acquisitionFence }] }
    }
    if (sql.includes('FROM "work_order"')) {
      return { rows: [{
        id: queue.activeWorkOrderId,
        allowedFiles: recovery.oldContract.reservations,
        goal: "GOAL-0040",
        validators,
      }] }
    }
    if (sql.includes('INSERT INTO "outcome_queue_mutation_receipt"')) {
      mutations += 1
      receipt = {
        id: 93,
        requestHash: args[3],
        requestBinding: JSON.parse(args[4]),
        resultBinding: JSON.parse(args[5]),
      }
      return { rows: [{ id: 93 }] }
    }
    if (sql.includes('UPDATE "outcome_queue_item"')) {
      version = args[2]
      fence = args[3]
      leaseExpiresAt = args[7]
      return { rows: [{ id: 1 }] }
    }
    if (sql.includes('UPDATE "outcome_queue_acquisition_receipt"')) {
      acquisitionFence = args[3]
      return { rows: [{ id: 1 }] }
    }
    if (sql.includes('UPDATE "work_order"')) {
      validators = args[2]
      return { rows: [{ id: 1 }] }
    }
    if (sql.includes("UPDATE") || sql.includes('INSERT INTO "governance_event"')) return { rows: [{ id: 1 }] }
    throw new Error(`unexpected SQL: ${sql}`)
  })
  const connect = vi.fn(async () => {
    const clientState = { hasLock: false }
    return {
      query: (sql: string, args: any[] = []) => query(sql, args, clientState),
      release: vi.fn(() => releaseLock(clientState)),
    }
  })
  return {
    pool: { connect },
    query,
    mutations: () => mutations,
    advanceAuthoritativeQueue: () => {
      version += 1
      fence += 1
      acquisitionFence += 1
    },
  }
}

describe("authoritative deterministic validator queue recovery", () => {
  it("commits one queue/contract fence and replays the durable receipt after a crash", async () => {
    const execution = recoveryExecution()
    const value = queuePool(execution)
    const first = await recoverDeterministicValidatorQueue({ execution, pool: value.pool as any })
    const replay = await recoverDeterministicValidatorQueue({ execution, pool: value.pool as any })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      sourceExpectedVersion: 12,
      recoveredExpectedVersion: 13,
      sourceFencingToken: 34,
      recoveredFencingToken: 35,
      recoveredLeaseExpiresAt: "2026-08-31T12:50:01.000Z",
      receiptId: 93,
    })
    expect(value.mutations()).toBe(1)
  })

  it("fails closed when another writer has advanced the queue version", async () => {
    const execution = recoveryExecution()
    const value = queuePool(execution, { drift: true })
    await expect(recoverDeterministicValidatorQueue({ execution, pool: value.pool as any }))
      .rejects.toMatchObject({ code: "HERMES_DETERMINISTIC_QUEUE_RECOVERY_CAS_WALL" })
    expect(value.mutations()).toBe(0)
  })

  it("rejects a durable receipt replay after the authoritative queue advances", async () => {
    const execution = recoveryExecution()
    const value = queuePool(execution)
    await recoverDeterministicValidatorQueue({ execution, pool: value.pool as any })
    value.advanceAuthoritativeQueue()

    await expect(recoverDeterministicValidatorQueue({ execution, pool: value.pool as any }))
      .rejects.toMatchObject({ code: "HERMES_DETERMINISTIC_QUEUE_RECOVERY_CAS_WALL" })
    expect(value.mutations()).toBe(1)
  })

  it("fails closed when the exact live authority graph no longer admits the outcome", async () => {
    const execution = recoveryExecution()
    const value = queuePool(execution, { authorityRevoked: true })
    await expect(recoverDeterministicValidatorQueue({ execution, pool: value.pool as any }))
      .rejects.toMatchObject({ code: "HERMES_DETERMINISTIC_QUEUE_RECOVERY_CAS_WALL" })
    const authorityQuery = value.query.mock.calls.find(([sql]) => String(sql).includes('FROM "outcome_queue_item"'))?.[0]
    expect(authorityQuery).toContain('workbench_execution.authorize')
    expect(authorityQuery).toContain('"revokedAt" IS NULL')
    expect(authorityQuery).toContain('exact_execution_goal')
    expect(authorityQuery).toContain('exact_implementation_grant')
  })

  it("re-proves the exact active projected Work Order before reacquiring the queue lease", async () => {
    const execution = recoveryExecution()
    const value = queuePool(execution, { workOrderInvalid: true })
    await expect(recoverDeterministicValidatorQueue({ execution, pool: value.pool as any }))
      .rejects.toMatchObject({ code: "HERMES_DETERMINISTIC_QUEUE_RECOVERY_CAS_WALL" })
    const query = value.query.mock.calls.find(([sql]) => String(sql).includes('FROM "outcome_queue_item"'))?.[0]
    expect(query).toContain('projected_work.status = \'active\'')
    expect(query).toContain('projected_work."authorityGrantId"')
    expect(query).toContain('q."leaseHolder" = $5')
    expect(query).toContain('projected_work.validators = $6::text[]')
    expect(value.mutations()).toBe(0)
  })

  it("serializes two database clients so only one CAS mutation wins", async () => {
    const execution = recoveryExecution()
    const value = queuePool(execution)
    const [first, second] = await Promise.all([
      recoverDeterministicValidatorQueue({ execution, pool: value.pool as any }),
      recoverDeterministicValidatorQueue({ execution, pool: value.pool as any }),
    ])
    expect(first).toEqual(second)
    expect(value.mutations()).toBe(1)
    expect(value.pool.connect).toHaveBeenCalledTimes(2)
  })
})
