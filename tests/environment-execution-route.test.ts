import { beforeEach, describe, expect, it, vi } from "vitest"

import { createWorkingWorld } from "@/lib/environment/working-world"

const harness = vi.hoisted(() => {
  const reads: unknown[][] = []

  function select() {
    const rows = reads.shift() ?? []
    let newestFirst = false
    const query = {
      from: () => query,
      where: () => query,
      orderBy: () => {
        newestFirst = true
        return query
      },
      limit: async (count: number) => {
        const selected = newestFirst
          ? [...rows].sort((left, right) => {
              const leftAt = (left as { createdAt?: Date }).createdAt?.getTime() ?? 0
              const rightAt = (right as { createdAt?: Date }).createdAt?.getTime() ?? 0
              return rightAt - leftAt
            })
          : rows
        return selected.slice(0, count)
      },
    }
    return query
  }

  return {
    reads,
    select: vi.fn(select),
    getUserId: vi.fn(async () => "owner-1"),
    loadOwnedWorkingWorld: vi.fn(),
  }
})

vi.mock("@/lib/db", () => ({ db: { select: harness.select } }))
vi.mock("@/lib/session", () => ({ getUserId: harness.getUserId }))
vi.mock("@/lib/environment/space-persistence", () => ({
  loadOwnedWorkingWorld: harness.loadOwnedWorkingWorld,
}))

import { GET } from "@/app/api/environment/execution/route"

beforeEach(() => {
  harness.reads.length = 0
  harness.select.mockClear()
  harness.getUserId.mockClear()
  harness.loadOwnedWorkingWorld.mockReset()
})

describe("GET /api/environment/execution", () => {
  function world(overrides: Readonly<{ outcomeKey?: string; workOrderId?: number }> = {}) {
    return {
      ...createWorkingWorld({ intent: "Finish Experience V2" }),
      spine: {
        projectId: 1,
        projectName: "TerraFusion",
        threadId: "thread-1",
        outcomeKey: overrides.outcomeKey ?? "OUT-41",
        outcomeTitle: "Finish Experience V2",
        workOrderId: overrides.workOrderId ?? 41,
        execution: "implementing",
        worker: null,
        evidence: [],
      },
    }
  }

  it("projects the exact owned Space-bound work-order executor", async () => {
    harness.loadOwnedWorkingWorld.mockResolvedValue(world())
    harness.reads.push(
      [{ lifecycleState: "active", activeWorkOrderId: 41, outcomeTitle: "Finish Experience V2" }],
      [{ id: 41, ref: "WO-0041", title: "Execute the bounded slice", status: "implementing", lane: "ui", assignee: "hermes-codex-bridge", agent: "codex" }],
      [],
    )

    const response = await GET(new Request("http://localhost/api/environment/execution?worldId=world-1"))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(harness.loadOwnedWorkingWorld).toHaveBeenCalledWith("owner-1", "world-1")
    expect(payload).toMatchObject({
      worldId: "world-1",
      outcomeKey: "OUT-41",
      workOrderId: 41,
      worker: { lane: "ui", state: "implementing" },
      session: {
        id: "world-worker:world-1:41:hermes-codex-bridge",
        workOrderId: 41,
        role: "HERMES",
        providerLabel: "Local execution",
      },
    })
  })

  it("returns the newest 50 evidence records in chronological display order", async () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      result: "PASS",
      notes: `evidence-${String(index + 1).padStart(2, "0")}`,
      createdAt: new Date(Date.UTC(2026, 7, 25, 10, index)),
    }))
    harness.loadOwnedWorkingWorld.mockResolvedValue(world())
    harness.reads.push(
      [{ lifecycleState: "active", activeWorkOrderId: 41, outcomeTitle: "Finish Experience V2" }],
      [{ id: 41, ref: "WO-0041", title: "Execute", status: "validating", lane: "ui", assignee: "hermes-codex-bridge", agent: "codex" }],
      records,
    )

    const response = await GET(new Request("http://localhost/api/environment/execution?worldId=world-1"))
    const payload = await response.json()

    expect(payload.evidence).toHaveLength(50)
    expect(payload.evidence.map((record: { detail: string }) => record.detail)).toEqual(
      records.slice(1).map((record) => record.notes),
    )
    expect(payload.evidence.at(-1)).toMatchObject({
      detail: "evidence-51",
      at: "2026-08-25T10:50:00.000Z",
    })
  })

  it("refuses a foreign or absent Space before reading outcome execution", async () => {
    harness.loadOwnedWorkingWorld.mockResolvedValue(null)

    const response = await GET(new Request("http://localhost/api/environment/execution?worldId=foreign-world"))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "WORLD_ABSENT" })
    expect(harness.select).not.toHaveBeenCalled()
  })

  it("fails closed when the Space and outcome disagree on the active Work Order", async () => {
    harness.loadOwnedWorkingWorld.mockResolvedValue(world({ workOrderId: 41 }))
    harness.reads.push(
      [{ lifecycleState: "active", activeWorkOrderId: 42, outcomeTitle: "Finish Experience V2" }],
    )

    const response = await GET(new Request("http://localhost/api/environment/execution?worldId=world-1"))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "SPACE_EXECUTION_BINDING_MISMATCH" })
    expect(harness.select).toHaveBeenCalledTimes(1)
  })

  it("does not infer HERMES from the lane when the persisted assignee differs", async () => {
    harness.loadOwnedWorkingWorld.mockResolvedValue(world())
    harness.reads.push(
      [{ lifecycleState: "active", activeWorkOrderId: 41, outcomeTitle: "Finish Experience V2" }],
      [{ id: 41, ref: "WO-0041", title: "Execute", status: "implementing", lane: "hermes", assignee: "builder-a", agent: "codex" }],
      [],
    )

    const response = await GET(new Request("http://localhost/api/environment/execution?worldId=world-1"))
    const payload = await response.json()

    expect(payload.session).toMatchObject({ role: "Executor", assignee: "builder-a" })
    expect(payload.session.role).not.toBe("HERMES")
  })
})
