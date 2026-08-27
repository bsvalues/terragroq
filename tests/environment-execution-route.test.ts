import { beforeEach, describe, expect, it, vi } from "vitest"

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
  }
})

vi.mock("@/lib/db", () => ({ db: { select: harness.select } }))
vi.mock("@/lib/session", () => ({ getUserId: harness.getUserId }))

import { GET } from "@/app/api/environment/execution/route"

beforeEach(() => {
  harness.reads.length = 0
  harness.select.mockClear()
  harness.getUserId.mockClear()
})

describe("GET /api/environment/execution", () => {
  it("projects the persisted work-order lane as the live worker", async () => {
    harness.reads.push(
      [{ lifecycleState: "active", activeWorkOrderId: 41 }],
      [{ status: "implementing", lane: "builder-a" }],
      [],
    )

    const response = await GET(new Request("http://localhost/api/environment/execution?outcomeKey=OUT-41"))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.worker).toMatchObject({ lane: "builder-a", state: "implementing" })
  })

  it("returns the newest 50 evidence records in chronological display order", async () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      result: "PASS",
      notes: `evidence-${String(index + 1).padStart(2, "0")}`,
      createdAt: new Date(Date.UTC(2026, 7, 25, 10, index)),
    }))
    harness.reads.push(
      [{ lifecycleState: "active", activeWorkOrderId: 41 }],
      [{ status: "validating", lane: "builder-a" }],
      records,
    )

    const response = await GET(new Request("http://localhost/api/environment/execution?outcomeKey=OUT-41"))
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
})
