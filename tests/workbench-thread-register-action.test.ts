import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => {
  const table = (name: string, fields: string[]) => Object.assign({ tableName: name }, Object.fromEntries(fields.map((field) => [field, `${name}.${field}`])))
  const state = {
    selects: new Map<string, unknown[][]>(),
    insertResults: new Map<string, unknown[][]>(),
    calls: [] as Array<{ operation: string; table?: string; value?: unknown }>,
  }
  const take = (map: Map<string, unknown[][]>, tableName: string): unknown[] => map.get(tableName)?.shift() ?? []
  const transaction = {
    select() {
      return { from(tableValue: { tableName: string }) {
        state.calls.push({ operation: "select", table: tableValue.tableName })
        return { where(value: unknown) {
          state.calls.push({ operation: "where", table: tableValue.tableName, value })
          return { limit: async () => take(state.selects, tableValue.tableName) }
        } }
      } }
    },
    insert(tableValue: { tableName: string }) {
      return { values(value: unknown) {
        state.calls.push({ operation: "insert", table: tableValue.tableName, value })
        return { onConflictDoNothing() {
          return { returning: async () => take(state.insertResults, tableValue.tableName) }
        } }
      } }
    },
    delete(tableValue: { tableName: string }) {
      return { where: async (value: unknown) => {
        state.calls.push({ operation: "delete", table: tableValue.tableName, value })
      } }
    },
  }
  const db = {
    transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
  }
  return {
    getUserId: vi.fn(async () => "owner-1"),
    randomUUID: vi.fn(() => "thread-generated"),
    tables: {
      project: table("project", ["id", "userId"]),
      goal: table("goal", ["id", "userId"]),
      outcomeQueueItem: table("outcomeQueueItem", ["id", "userId", "outcomeKey"]),
      workbenchThread: table("workbenchThread", ["id", "userId", "projectId", "title", "createdAt", "updatedAt"]),
      workbenchThreadSource: table("workbenchThreadSource", ["id", "userId", "threadId", "sourceType", "sourceId", "role"]),
    },
    state,
    db,
  }
})

vi.mock("node:crypto", () => ({ randomUUID: harness.randomUUID }))
vi.mock("@/lib/session", () => ({ getUserId: harness.getUserId }))
vi.mock("@/lib/db/schema", () => harness.tables)
vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ["and", ...values],
  eq: (field: unknown, value: unknown) => ["eq", field, value],
}))

vi.mock("@/lib/db", () => ({ db: harness.db }))

import { registerWorkbenchThreadAction } from "@/app/actions/register-workbench-thread"

function queue(table: keyof typeof harness.tables, ...reads: unknown[][]) {
  harness.state.selects.set(table, [...reads])
}

function queueInsert(table: keyof typeof harness.tables, ...results: unknown[][]) {
  harness.state.insertResults.set(table, [...results])
}

const persistedThread = {
  id: "thread-existing", userId: "owner-1", projectId: 7, title: "Persisted",
  createdAt: new Date("2026-08-14T10:00:00Z"), updatedAt: new Date("2026-08-14T10:00:00Z"),
}
const persistedRoot = {
  userId: "owner-1", threadId: "thread-existing", sourceType: "goal", sourceId: "41", role: "root",
}

beforeEach(() => {
  harness.state.selects.clear()
  harness.state.insertResults.clear()
  harness.state.calls.length = 0
  harness.getUserId.mockClear()
  harness.randomUUID.mockClear()
  harness.db.transaction.mockClear()
})

describe("registerWorkbenchThreadAction", () => {
  it("authenticates and atomically creates a tenant Project-bound goal Thread and root", async () => {
    queue("project", [{ id: 7, userId: "owner-1" }])
    queue("goal", [{ id: 41, userId: "owner-1" }])
    queue("workbenchThreadSource", [])
    queue("workbenchThread", [])
    queueInsert("workbenchThread", [{ id: "thread-generated" }])
    queueInsert("workbenchThreadSource", [{ id: 1 }])

    const result = await registerWorkbenchThreadAction({
      projectId: 7, title: "Ship Workbench", root: { sourceType: "goal", sourceId: "41" },
    })

    expect(harness.getUserId).toHaveBeenCalledOnce()
    expect(harness.db.transaction).toHaveBeenCalledOnce()
    expect(result.disposition).toBe("CREATED")
    expect(harness.state.calls.filter((call) => call.operation === "insert")).toEqual([
      expect.objectContaining({ table: "workbenchThread", value: expect.objectContaining({ userId: "owner-1", projectId: 7 }) }),
      expect.objectContaining({ table: "workbenchThreadSource", value: expect.objectContaining({ userId: "owner-1", sourceType: "goal", sourceId: "41", role: "root" }) }),
    ])
  })

  it("validates outcomes only by canonical outcomeKey and never by numeric row id", async () => {
    queue("project", [{ id: 7, userId: "owner-1" }])
    queue("outcomeQueueItem", [{ id: 99, userId: "owner-1", outcomeKey: "OUT-KEY" }])
    queue("workbenchThreadSource", [])
    queue("workbenchThread", [])
    queueInsert("workbenchThread", [{ id: "thread-generated" }])
    queueInsert("workbenchThreadSource", [{ id: 1 }])

    await registerWorkbenchThreadAction({
      projectId: 7, title: "Outcome", root: { sourceType: "outcome", sourceId: "OUT-KEY" },
    })

    const serializedPredicates = JSON.stringify(harness.state.calls.filter((call) => call.operation === "where"))
    expect(serializedPredicates).toContain("outcomeQueueItem.outcomeKey")
    expect(serializedPredicates).not.toContain("outcomeQueueItem.id")
  })

  it("idempotently recovers an existing same-root Thread without inserting", async () => {
    queue("project", [{ id: 7, userId: "owner-1" }])
    queue("goal", [{ id: 41, userId: "owner-1" }])
    queue("workbenchThreadSource", [persistedRoot])
    queue("workbenchThread", [persistedThread])

    const result = await registerWorkbenchThreadAction({
      projectId: 7, title: "Retry title", root: { sourceType: "goal", sourceId: "41" },
    })

    expect(result).toEqual({ disposition: "EXISTING", thread: persistedThread, root: persistedRoot })
    expect(harness.state.calls.some((call) => call.operation === "insert")).toBe(false)
  })

  it("recovers an atomic root race and removes the losing unbound Thread", async () => {
    queue("project", [{ id: 7, userId: "owner-1" }])
    queue("goal", [{ id: 41, userId: "owner-1" }])
    queue("workbenchThreadSource", [], [persistedRoot])
    queue("workbenchThread", [], [persistedThread])
    queueInsert("workbenchThread", [{ id: "thread-generated" }])
    queueInsert("workbenchThreadSource", [])

    const result = await registerWorkbenchThreadAction({
      projectId: 7, title: "Racing", root: { sourceType: "goal", sourceId: "41" },
    })

    expect(result.disposition).toBe("EXISTING")
    expect(harness.state.calls).toContainEqual(expect.objectContaining({ operation: "delete", table: "workbenchThread" }))
  })

  it("fails closed for a missing tenant Project and a root already bound to another Project", async () => {
    queue("project", [])
    await expect(registerWorkbenchThreadAction({
      projectId: 7, title: "Denied", root: { sourceType: "goal", sourceId: "41" },
    })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" })
    expect(harness.state.calls.some((call) => call.table === "goal")).toBe(false)

    harness.state.calls.length = 0
    queue("project", [{ id: 7, userId: "owner-1" }])
    queue("goal", [{ id: 41, userId: "owner-1" }])
    queue("workbenchThreadSource", [persistedRoot])
    queue("workbenchThread", [{ ...persistedThread, projectId: 8 }])
    await expect(registerWorkbenchThreadAction({
      projectId: 7, title: "Denied", root: { sourceType: "goal", sourceId: "41" },
    })).rejects.toMatchObject({ code: "ROOT_PROJECT_CONFLICT" })
  })
})
