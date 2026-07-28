import { getTableName } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => {
  const state = {
    goals: [] as Record<string, unknown>[],
    outcomes: [] as Record<string, unknown>[],
    receipts: [] as Record<string, unknown>[],
    governance: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    failAfterCommit: false,
  }
  return {
    state,
    transaction: vi.fn(),
    revalidatePath: vi.fn((path: string) => {
      if (path === "/goal-console" && state.failAfterCommit) {
        state.failAfterCommit = false
        throw new Error("SIMULATED_RESPONSE_LOSS")
      }
    }),
  }
})

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (...args: unknown[]) => harness.transaction(...args),
  },
}))
vi.mock("@/lib/session", () => ({ getUserId: async () => "owner" }))
vi.mock("@/app/actions/locks", () => ({ getActiveLocks: async () => [] }))
vi.mock("@/app/actions/doctrine", () => ({
  validateAction: async () => ({ verdict: "allowed", matches: [] }),
}))
vi.mock("@/lib/goal/classifier", () => ({
  classifyGoal: (command: string) => ({
    lane: "BUILD",
    mode: "EXECUTE",
    risk: "low",
    authority: "A2_WRITE_OWN",
    verdict: "allow",
    rationale: command,
    mistakePatterns: [],
    doctrineViolations: [],
    recommendedMove: "Queue bounded delivery",
  }),
}))
vi.mock("@/app/actions/work-orders", () => ({ createWorkOrder: vi.fn() }))
vi.mock("@/lib/goal/loop", () => ({
  runLoopVerifier: vi.fn(),
  refuseExecution: vi.fn(),
}))
vi.mock("@/lib/registers/events", () => ({
  getRecentEvents: async () => [],
  logEvent: vi.fn(),
}))
vi.mock("@/scripts/hermes-bridge/outcome-queue-source.mjs", () => ({
  ensureOutcomeQueueHardeningSchema: async () => true,
}))
vi.mock("next/cache", () => ({ revalidatePath: harness.revalidatePath }))

import { submitGoal } from "@/app/actions/goals"

function tableRows(table: unknown) {
  switch (getTableName(table as never)) {
    case "goal":
      return harness.state.goals
    case "outcome_queue_item":
      return harness.state.outcomes
    case "goal_outcome_intake_receipt":
      return harness.state.receipts
    default:
      return []
  }
}

function transactionAdapter() {
  return {
    execute: vi.fn(async () => ({ rows: [] })),
    select: vi.fn((projection?: Record<string, unknown>) => {
      let table: unknown
      const read = () => {
        const rows = tableRows(table)
        if (!projection) return rows.map((row) => ({ ...row }))
        return rows.map((row) => Object.fromEntries(
          Object.keys(projection).map((key) => [key, row[key]]),
        ))
      }
      const chain = {
        from(value: unknown) {
          table = value
          return chain
        },
        where() {
          return chain
        },
        limit(count: number) {
          return Promise.resolve(read().slice(0, count))
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(read()).then(resolve, reject)
        },
      }
      return chain
    }),
    insert: vi.fn((table: unknown) => {
      let value: Record<string, unknown>
      const commit = () => {
        const tableName = getTableName(table as never)
        if (tableName === "goal") {
          const row = {
            id: harness.state.goals.length + 1,
            createdAt: new Date("2026-07-28T12:00:00.000Z"),
            updatedAt: new Date("2026-07-28T12:00:00.000Z"),
            linkedWorkOrderId: null,
            ...value,
          }
          harness.state.goals.push(row)
          return row
        }
        if (tableName === "outcome_queue_item") {
          const row = { id: harness.state.outcomes.length + 1, ...value }
          harness.state.outcomes.push(row)
          return row
        }
        if (tableName === "goal_outcome_intake_receipt") {
          const row = { id: harness.state.receipts.length + 1, ...value }
          harness.state.receipts.push(row)
          return row
        }
        if (tableName === "governance_event") {
          const row = { id: harness.state.governance.length + 1, ...value }
          harness.state.governance.push(row)
          return row
        }
        if (tableName === "event_log") {
          const row = { id: harness.state.events.length + 1, ...value }
          harness.state.events.push(row)
          return row
        }
        throw new Error(`unexpected insert: ${tableName}`)
      }
      let committed: Record<string, unknown> | null = null
      const chain = {
        values(next: Record<string, unknown>) {
          value = next
          return chain
        },
        returning(projection?: Record<string, unknown>) {
          committed ??= commit()
          if (!projection) return Promise.resolve([committed])
          return Promise.resolve([Object.fromEntries(
            Object.keys(projection).map((key) => [key, committed?.[key]]),
          )])
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          committed ??= commit()
          return Promise.resolve(undefined).then(resolve, reject)
        },
      }
      return chain
    }),
    update: vi.fn(() => {
      let update: Record<string, unknown>
      const chain = {
        set(value: Record<string, unknown>) {
          update = value
          return chain
        },
        where() {
          return chain
        },
        returning() {
          const receipt = harness.state.receipts[0]
          receipt.replayCount = Number(receipt.replayCount) + 1
          receipt.lastReplayedAt = update.lastReplayedAt
          return Promise.resolve([{ id: receipt.id }])
        },
      }
      return chain
    }),
  }
}

beforeEach(() => {
  harness.state.goals.length = 0
  harness.state.outcomes.length = 0
  harness.state.receipts.length = 0
  harness.state.governance.length = 0
  harness.state.events.length = 0
  harness.state.failAfterCommit = false
  harness.revalidatePath.mockClear()
  let prior = Promise.resolve()
  harness.transaction.mockImplementation((callback: (transaction: unknown) => Promise<unknown>) => {
    const current = prior.then(() => callback(transactionAdapter()))
    prior = current.then(() => undefined, () => undefined)
    return current
  })
})

describe("authenticated goal outcome intake idempotency", () => {
  it("returns the original goal after a post-commit response loss", async () => {
    harness.state.failAfterCommit = true
    await expect(submitGoal(
      "Deliver retry-safe intake",
      "goal-intake:response-loss-0001",
    )).rejects.toThrow("SIMULATED_RESPONSE_LOSS")

    const replayed = await submitGoal(
      "Deliver retry-safe intake",
      "goal-intake:response-loss-0001",
    )

    expect(replayed.id).toBe(1)
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
    expect(harness.state.receipts).toHaveLength(1)
    expect(harness.state.receipts[0]).toMatchObject({ goalId: 1, replayCount: 1 })
    expect(harness.state.governance).toHaveLength(1)
    expect(harness.state.events).toHaveLength(1)
  })

  it("fences concurrent same-key acquisition to one goal and queue item", async () => {
    const [first, replay] = await Promise.all([
      submitGoal("Deliver once", "goal-intake:concurrent-0001"),
      submitGoal("Deliver once", "goal-intake:concurrent-0001"),
    ])

    expect(first.id).toBe(replay.id)
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
    expect(harness.state.receipts).toHaveLength(1)
    expect(harness.state.receipts[0].replayCount).toBe(1)
  })

  it("rejects reuse of a stable key for different intent", async () => {
    await submitGoal("First intent", "goal-intake:conflict-0001")
    await expect(submitGoal(
      "Different intent",
      "goal-intake:conflict-0001",
    )).rejects.toThrow("GOAL_INTAKE_IDEMPOTENCY_CONFLICT")

    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
  })
})
