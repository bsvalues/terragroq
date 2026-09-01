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

function queuePool(execution: ReturnType<typeof recoveryExecution>, { drift = false } = {}) {
  const queue = execution.metadata.outcome.queueBinding
  const recovery = execution.metadata.deterministicValidatorCircuit.recovery
  let receipt: any = null
  let mutations = 0
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("pg_advisory_xact_lock")) {
      return { rows: [] }
    }
    if (sql.includes('FROM "outcome_queue_mutation_receipt"') && sql.includes('"idempotencyKey"')) {
      return { rows: receipt ? [receipt] : [] }
    }
    if (sql.includes("clock_timestamp")) return { rows: [{ now: "2026-08-31T12:00:01.000Z" }] }
    if (sql.includes('FROM "outcome_queue_item"')) {
      return { rows: [{
        version: drift ? queue.expectedVersion + 1 : queue.expectedVersion,
        fencingToken: queue.fencingToken,
        executionBinding: queue.executionBinding,
        leaseHolder: queue.leaseHolder,
        leaseToken: queue.leaseToken,
        acquisitionKey: queue.acquisitionKey,
        activeWorkOrderId: queue.activeWorkOrderId,
        authorityGrantRef: queue.authorityGrantRef,
        lifecycleState: "active",
      }] }
    }
    if (sql.includes('operation = \'workbench_execution.authorize\'')) {
      return { rows: [{ id: 91, resultBinding: { workContract: recovery.oldContract } }] }
    }
    if (sql.includes('FROM "outcome_queue_acquisition_receipt"')) {
      return { rows: [{ id: 92, latestFencingToken: queue.fencingToken }] }
    }
    if (sql.includes('FROM "work_order"')) {
      return { rows: [{
        id: queue.activeWorkOrderId,
        allowedFiles: recovery.oldContract.reservations,
        validators: recovery.oldContract.validationCommands.map(({ command, args }: any) => `${command} ${args.join(" ")}`),
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
    if (sql.includes("UPDATE") || sql.includes('INSERT INTO "governance_event"')) return { rows: [{ id: 1 }] }
    throw new Error(`unexpected SQL: ${sql}`)
  })
  const client = { query, release: vi.fn() }
  return {
    pool: { connect: vi.fn(async () => client) },
    query,
    mutations: () => mutations,
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
})
