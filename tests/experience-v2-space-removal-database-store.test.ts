import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => {
  type Row = Readonly<{ id: string; userId: string; intent: string; snapshot: string; updatedAt: Date }>
  const rows: Row[] = []
  const selects: number[] = []
  const removed: string[] = []

  const transaction = vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => {
    let selectIndex = 0
    const transactionStore = {
      execute: vi.fn(async () => []),
      select: vi.fn(() => {
        const call = selectIndex++
        selects.push(call)
        const query = {
          from: () => query,
          where: () => query,
          limit: () => query,
          offset: () => { throw new Error("REMOVAL_MUST_NOT_PAGE") },
          then: (resolve: (value: readonly Row[]) => unknown) => resolve(call === 0 ? rows.slice(0, 1) : rows.slice()),
        }
        return query
      }),
      delete: vi.fn(() => {
        const query = {
          where: () => query,
          returning: async () => {
            const target = rows.shift()
            if (!target) return []
            removed.push(target.id)
            return [{ id: target.id }]
          },
        }
        return query
      }),
    }
    return work(transactionStore)
  })

  return { rows, selects, removed, transaction }
})

vi.mock("@/lib/db", () => ({ db: { transaction: harness.transaction } }))

import { databaseSpaceWorkingWorldStore } from "@/lib/environment/space-persistence"
import { createWorkingWorld } from "@/lib/environment/working-world"

const root = "williamos-workspace-root:v1:c:/project"
const row = (id: string, resource: string) => ({
  id,
  userId: "owner-a",
  intent: id,
  snapshot: JSON.stringify(createWorkingWorld({ intent: id, resources: [resource] })),
  updatedAt: new Date("2026-08-30T20:00:00.000Z"),
})

beforeEach(() => {
  harness.rows.length = 0
  harness.selects.length = 0
  harness.removed.length = 0
  harness.transaction.mockClear()
})

describe("database Space removal invariant", () => {
  it("counts the complete owner collection in one stable statement instead of mutable OFFSET pages", async () => {
    harness.rows.push(row("target", root), row("other-project-space", root))
    for (let index = 0; index < 25; index += 1) harness.rows.push(row(`foreign-${index}`, "williamos-workspace-root:v1:c:/foreign"))

    await expect(databaseSpaceWorkingWorldStore.removeOwnedProjectSpace!("owner-a", "c:/project", "target")).resolves.toBe("removed")
    expect(harness.selects).toEqual([0, 1])
    expect(harness.removed).toEqual(["target"])
  })

  it("refuses deletion when the one-statement collection proves this is the last project Space", async () => {
    harness.rows.push(row("target", root))
    for (let index = 0; index < 25; index += 1) harness.rows.push(row(`foreign-${index}`, "williamos-workspace-root:v1:c:/foreign"))

    await expect(databaseSpaceWorkingWorldStore.removeOwnedProjectSpace!("owner-a", "c:/project", "target")).resolves.toBe("last-space")
    expect(harness.removed).toEqual([])
  })
})
