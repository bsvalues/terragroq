import { describe, expect, it, vi } from "vitest"

import {
  ThreadRegistryError,
  registerWorkbenchThread,
  type ThreadRegistryStore,
  type ThreadRegistryTransaction,
  type ThreadRegistryErrorCode,
  type WorkbenchThreadRecord,
  type WorkbenchThreadRootBinding,
} from "@/lib/workbench/thread-registry"

const existingThread: WorkbenchThreadRecord = {
  id: "thread-existing",
  userId: "owner-1",
  projectId: 7,
  title: "Persisted title",
  createdAt: new Date("2026-08-14T10:00:00.000Z"),
  updatedAt: new Date("2026-08-14T10:00:00.000Z"),
}

const existingRoot: WorkbenchThreadRootBinding = {
  userId: "owner-1",
  threadId: "thread-existing",
  sourceType: "goal",
  sourceId: "41",
  role: "root",
}

function makeStore(overrides: Partial<ThreadRegistryTransaction> = {}) {
  const calls: Array<{ operation: string; value?: unknown; inTransaction: boolean }> = []
  let inTransaction = false
  const record = <T>(operation: string, value: T): T => {
    calls.push({ operation, value, inTransaction })
    return value
  }
  const transaction: ThreadRegistryTransaction = {
    async projectExists(identity) {
      return record("projectExists", true)
    },
    async rootSourceExists(identity) {
      return record("rootSourceExists", true)
    },
    async findRootBinding(identity) {
      return record("findRootBinding", null)
    },
    async findThreadById(id) {
      return record("findThreadById", null)
    },
    async insertThreadWithRoot(value) {
      return record("insertThreadWithRoot", "CREATED" as const)
    },
    ...overrides,
  }
  const store: ThreadRegistryStore = {
    async transaction<T>(operation: (transaction: ThreadRegistryTransaction) => Promise<T>) {
      expect(inTransaction).toBe(false)
      inTransaction = true
      try {
        return await operation(transaction)
      } finally {
        inTransaction = false
      }
    },
  }
  return { store, calls }
}

const input = {
  userId: "owner-1",
  projectId: 7,
  title: "Ship the Workbench",
  root: { sourceType: "goal" as const, sourceId: "41" },
}

async function expectCode(promise: Promise<unknown>, code: ThreadRegistryErrorCode) {
  await expect(promise).rejects.toMatchObject({ code } satisfies Partial<ThreadRegistryError>)
}

describe("registerWorkbenchThread", () => {
  it("creates one context-only Thread from exact tenant, Project, and root identities", async () => {
    const inserted: unknown[] = []
    const { store, calls } = makeStore({
      async insertThreadWithRoot(value) {
        inserted.push(value)
        return "CREATED"
      },
    })

    const result = await registerWorkbenchThread(input, {
      store,
      generateOpaqueId: () => "thread-generated",
      now: () => new Date("2026-08-14T12:00:00.000Z"),
    })

    expect(result).toEqual({
      disposition: "CREATED",
      thread: {
        id: "thread-generated",
        userId: "owner-1",
        projectId: 7,
        title: "Ship the Workbench",
        createdAt: new Date("2026-08-14T12:00:00.000Z"),
        updatedAt: new Date("2026-08-14T12:00:00.000Z"),
      },
      root: {
        userId: "owner-1",
        threadId: "thread-generated",
        sourceType: "goal",
        sourceId: "41",
        role: "root",
      },
    })
    expect(inserted).toEqual([{ thread: result.thread, root: result.root }])
    expect(calls.every((call) => call.inTransaction)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/authority|execution|repo|workOrder/i)
  })

  it("idempotently returns the persisted Thread for the same root and Project", async () => {
    const generateOpaqueId = vi.fn(() => "must-not-be-used")
    const insert = vi.fn()
    const { store } = makeStore({
      async findRootBinding() {
        return existingRoot
      },
      async findThreadById() {
        return existingThread
      },
      insertThreadWithRoot: insert,
    })

    const result = await registerWorkbenchThread(
      { ...input, title: "A retry must not rename the Thread" },
      { store, generateOpaqueId },
    )

    expect(result).toEqual({
      disposition: "EXISTING",
      thread: existingThread,
      root: existingRoot,
    })
    expect(generateOpaqueId).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it("fails closed when the exact tenant Project or root source does not exist", async () => {
    let harness = makeStore({
      async projectExists() {
        return false
      },
    })
    await expectCode(
      registerWorkbenchThread(input, { store: harness.store, generateOpaqueId: () => "unused" }),
      "PROJECT_NOT_FOUND",
    )
    expect(harness.calls.map((call) => call.operation)).toEqual([])

    harness = makeStore({
      async rootSourceExists() {
        return false
      },
    })
    await expectCode(
      registerWorkbenchThread(input, { store: harness.store, generateOpaqueId: () => "unused" }),
      "ROOT_SOURCE_NOT_FOUND",
    )
  })

  it("rejects an existing root bound to another Project", async () => {
    const { store } = makeStore({
      async findRootBinding() {
        return existingRoot
      },
      async findThreadById() {
        return { ...existingThread, projectId: 8 }
      },
    })

    await expectCode(
      registerWorkbenchThread(input, { store, generateOpaqueId: () => "unused" }),
      "ROOT_PROJECT_CONFLICT",
    )
  })

  it("rejects foreign-tenant, mismatched-root, and orphaned binding records", async () => {
    for (const [binding, code] of [
      [{ ...existingRoot, userId: "owner-2" }, "ROOT_USER_CONFLICT"],
      [{ ...existingRoot, sourceType: "outcome" as const }, "ROOT_IDENTITY_CONFLICT"],
    ] as const) {
      const { store } = makeStore({
        async findRootBinding() {
          return binding
        },
      })
      await expectCode(
        registerWorkbenchThread(input, { store, generateOpaqueId: () => "unused" }),
        code,
      )
    }

    const { store } = makeStore({
      async findRootBinding() {
        return existingRoot
      },
      async findThreadById() {
        return null
      },
    })
    await expectCode(
      registerWorkbenchThread(input, { store, generateOpaqueId: () => "unused" }),
      "ROOT_BINDING_ORPHANED",
    )
  })

  it("rejects opaque-ID collisions without treating title, ref, or repo as identity", async () => {
    const observed: unknown[] = []
    const { store } = makeStore({
      async projectExists(value) {
        observed.push(value)
        return true
      },
      async rootSourceExists(value) {
        observed.push(value)
        return true
      },
      async findRootBinding(value) {
        observed.push(value)
        return null
      },
      async findThreadById() {
        return existingThread
      },
    })

    await expectCode(
      registerWorkbenchThread(
        { ...input, repo: "must-not-infer", ref: "GOAL-0041" } as typeof input,
        { store, generateOpaqueId: () => "thread-existing" },
      ),
      "THREAD_ID_CONFLICT",
    )
    expect(observed).toEqual([
      { userId: "owner-1", projectId: 7 },
      { userId: "owner-1", sourceType: "goal", sourceId: "41" },
      { userId: "owner-1", sourceType: "goal", sourceId: "41" },
    ])
  })

  it("recovers an atomic concurrent root conflict only when it resolves to the same Project", async () => {
    let lookup = 0
    const generateOpaqueId = vi.fn(() => "thread-racing")
    const { store } = makeStore({
      async findRootBinding() {
        lookup += 1
        return lookup === 1 ? null : existingRoot
      },
      async findThreadById(id) {
        return id === existingThread.id ? existingThread : null
      },
      async insertThreadWithRoot() {
        return "ROOT_CONFLICT"
      },
    })

    const result = await registerWorkbenchThread(input, { store, generateOpaqueId })
    expect(result).toEqual({ disposition: "EXISTING", thread: existingThread, root: existingRoot })

    lookup = 0
    const conflictHarness = makeStore({
      async findRootBinding() {
        lookup += 1
        return lookup === 1 ? null : existingRoot
      },
      async findThreadById(id) {
        return id === existingThread.id ? { ...existingThread, projectId: 8 } : null
      },
      async insertThreadWithRoot() {
        return "ROOT_CONFLICT"
      },
    })
    await expectCode(
      registerWorkbenchThread(input, {
        store: conflictHarness.store,
        generateOpaqueId: () => "thread-racing-2",
      }),
      "ROOT_PROJECT_CONFLICT",
    )
  })

  it("validates explicit inputs and the generated opaque ID before persistence", async () => {
    for (const [candidate, code] of [
      [{ ...input, userId: " " }, "INVALID_USER_ID"],
      [{ ...input, projectId: 0 }, "INVALID_PROJECT_ID"],
      [{ ...input, title: " " }, "INVALID_TITLE"],
      [{ ...input, root: { sourceType: "work_order", sourceId: "41" } }, "INVALID_ROOT_TYPE"],
      [{ ...input, root: { sourceType: "goal", sourceId: " " } }, "INVALID_ROOT_SOURCE_ID"],
    ] as const) {
      const { store } = makeStore()
      await expectCode(
        registerWorkbenchThread(candidate as typeof input, {
          store,
          generateOpaqueId: () => "unused",
        }),
        code,
      )
    }

    const { store } = makeStore()
    await expectCode(
      registerWorkbenchThread(input, { store, generateOpaqueId: () => " " }),
      "INVALID_GENERATED_ID",
    )
  })
})
