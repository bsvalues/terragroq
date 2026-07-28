import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  produceRuntimeAgreement,
  RUNTIME_AGREEMENT_SQL,
} from "@/scripts/hermes-bridge/runtime-agreement.mjs"
import { createHermesStateStore } from "@/scripts/hermes-bridge/state-store.mjs"

const roots: string[] = []
const instant = Date.parse("2026-07-28T18:00:00.000Z")

afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})

function stateFixture({ active = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-agreement-"))
  roots.push(root)
  const statePath = path.join(root, "state", "state.json")
  const store = createHermesStateStore(statePath, { now: () => instant })
  store.initialize()
  if (active) {
    store.acquireLease({
      outcomeId: "77",
      holderId: "resident-holder",
      leaseDurationMs: 60 * 60 * 1000,
      metadata: {
        outcome: {
          id: 77,
          queueBinding: {
            userId: "primary-1",
            outcomeKey: "outcome:77",
            expectedVersion: 4,
            executionBinding: "capability-execution",
            leaseToken: "capability-lease",
            fencingToken: 9,
            acquisitionKey: "capability-acquisition",
            activeWorkOrderId: 900,
          },
        },
      },
      idempotencyKey: "agreement-acquire",
    })
  }
  return { root, statePath }
}

function agreementQuery(rows: unknown[], eligibleRows: unknown[] = []) {
  return vi.fn(async (sql: string) => {
    if (/^BEGIN/.test(sql)) return { rows: [] }
    if (/FROM "user"/.test(sql)) return { rows: [{ id: "primary-1" }] }
    if (sql === RUNTIME_AGREEMENT_SQL.active) return { rows }
    if (sql === RUNTIME_AGREEMENT_SQL.eligible) return { rows: eligibleRows }
    if (sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
    throw new Error(`unexpected SQL: ${sql}`)
  })
}

describe("Hermes runtime agreement producer", () => {
  it("atomically emits only sanitized queue, local, and Work Order identity and status", async () => {
    const { root, statePath } = stateFixture()
    const outputPath = path.join(root, "evidence", "queue-runtime-agreement.json")
    const query = agreementQuery([{
      outcomeId: 77,
      queueStatus: "active",
      activeWorkOrderId: 900,
      workOrderId: 900,
      workOrderRef: "WO-HERMES-OUTCOME-77",
      workOrderStatus: "active",
    }])

    await expect(produceRuntimeAgreement({
      statePath,
      outputPath,
      query,
      now: () => instant,
    })).resolves.toEqual({
      schemaVersion: 1,
      observedAt: "2026-07-28T18:00:00.000Z",
      mode: "ACTIVE",
      queue: { outcomeId: 77, status: "active", workOrderRef: "WO-HERMES-OUTCOME-77" },
      local: {
        outcomeId: 77,
        leaseStatus: "ACTIVE",
        checkpointState: "LEASED",
        workOrderRef: "WO-HERMES-OUTCOME-77",
      },
      workOrder: { ref: "WO-HERMES-OUTCOME-77", status: "ACTIVE" },
    })

    const initialPersisted = fs.readFileSync(outputPath, "utf8")
    const replacement = await produceRuntimeAgreement({
      statePath,
      outputPath,
      query: agreementQuery([{
        outcomeId: 77,
        queueStatus: "active",
        activeWorkOrderId: 900,
        workOrderId: 900,
        workOrderRef: "WO-HERMES-OUTCOME-77",
        workOrderStatus: "active",
      }]),
      now: () => instant + 1_000,
    })
    const persisted = fs.readFileSync(outputPath, "utf8")
    expect(JSON.parse(persisted)).toEqual(replacement)
    expect(initialPersisted).not.toBe(persisted)
    expect(persisted).not.toMatch(/capability-|leaseToken|executionBinding|acquisitionKey|fencingToken/)
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      expect.stringContaining('FROM "user"'),
      RUNTIME_AGREEMENT_SQL.active,
      RUNTIME_AGREEMENT_SQL.eligible,
      "COMMIT",
    ])
    expect(fs.readdirSync(path.dirname(outputPath))).toEqual(["queue-runtime-agreement.json"])
  })

  it("reports healthy idle from live stores without requiring a prebuilt agreement fixture", async () => {
    const { statePath } = stateFixture({ active: false })
    await expect(produceRuntimeAgreement({
      statePath,
      query: agreementQuery([]),
      now: () => instant,
    })).resolves.toEqual({
      schemaVersion: 1,
      observedAt: "2026-07-28T18:00:00.000Z",
      mode: "HEALTHY_IDLE",
      queue: null,
      local: null,
      workOrder: null,
    })
  })

  it("rejects healthy idle while executable approved work is waiting for acquisition", async () => {
    const { statePath } = stateFixture({ active: false })
    await expect(produceRuntimeAgreement({
      statePath,
      query: agreementQuery([], [{ outcomeId: 78 }]),
      now: () => instant,
    })).rejects.toMatchObject({ code: "QUEUE_RUNTIME_AGREEMENT_ELIGIBLE_WORK_WALL" })
  })

  it("rejects an active local binding owned by a different user identity", async () => {
    const { statePath } = stateFixture()
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"))
    state.executions["77"].metadata.outcome.queueBinding.userId = "other-user"
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
    await expect(produceRuntimeAgreement({
      statePath,
      query: agreementQuery([{
        outcomeId: 77,
        queueStatus: "active",
        activeWorkOrderId: 900,
        workOrderId: 900,
        workOrderRef: "WO-HERMES-OUTCOME-77",
        workOrderStatus: "active",
      }]),
      now: () => instant,
    })).rejects.toMatchObject({ code: "QUEUE_RUNTIME_AGREEMENT_MISMATCH" })
  })

  it("fails closed when durable queue and local execution identity disagree", async () => {
    const { statePath } = stateFixture()
    await expect(produceRuntimeAgreement({
      statePath,
      query: agreementQuery([{
        outcomeId: 78,
        queueStatus: "active",
        activeWorkOrderId: 900,
        workOrderId: 900,
        workOrderRef: "WO-HERMES-OUTCOME-78",
        workOrderStatus: "active",
      }]),
      now: () => instant,
    })).rejects.toMatchObject({ code: "QUEUE_RUNTIME_AGREEMENT_MISMATCH" })
  })
})
