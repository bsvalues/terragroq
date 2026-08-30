import { getTableName } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildHistoricalDoctrineInsert, getHistoricalDoctrineCatalog } from "@/lib/history/historical-doctrine"

const harness = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  revalidated: [] as string[],
  getUserId: vi.fn(async () => "tenant-a"),
}))

function equalityPredicates(condition: unknown) {
  const predicates: Array<[string, unknown]> = []
  const visited = new Set<unknown>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return
    visited.add(value)
    const candidate = value as {
      constructor?: { name?: string }
      encoder?: { name?: string }
      queryChunks?: unknown[]
      value?: unknown
    }
    if (candidate.constructor?.name === "Param" && typeof candidate.encoder?.name === "string") {
      predicates.push([candidate.encoder.name, candidate.value])
      return
    }
    candidate.queryChunks?.forEach(visit)
  }
  visit(condition)
  return predicates
}

function matchingRows(condition: unknown) {
  const predicates = equalityPredicates(condition)
  return harness.rows.filter((row) => predicates.every(([column, value]) => row[column] === value))
}

function projectRows(rows: Record<string, unknown>[], projection?: Record<string, unknown>) {
  if (!projection) return rows.map((row) => ({ ...row }))
  return rows.map((row) => Object.fromEntries(
    Object.keys(projection).map((key) => [key, row[key]]),
  ))
}

const database = {
  select: vi.fn((projection?: Record<string, unknown>) => {
    let condition: unknown
    const read = () => projectRows(matchingRows(condition), projection)
    const chain = {
      from(table: unknown) {
        if (getTableName(table as never) !== "doctrine") throw new Error("unexpected table")
        return chain
      },
      where(next: unknown) {
        condition = next
        return chain
      },
      orderBy() {
        return chain
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(read()).then(resolve, reject)
      },
    }
    return chain
  }),
  insert: vi.fn((table: unknown) => {
    if (getTableName(table as never) !== "doctrine") throw new Error("unexpected table")
    let value: Record<string, unknown>
    const chain = {
      values(next: Record<string, unknown>) {
        value = next
        return chain
      },
      onConflictDoNothing() {
        return chain
      },
      returning() {
        const collision = harness.rows.find((row) => (
          row.userId === value.userId
          && row.historicalCandidateId === value.historicalCandidateId
        ))
        if (collision) return Promise.resolve([])
        const row = {
          id: harness.rows.length + 1,
          createdAt: new Date("2026-08-30T00:00:00.000Z"),
          updatedAt: new Date("2026-08-30T00:00:00.000Z"),
          ...value,
        }
        harness.rows.push(row)
        return Promise.resolve([{ ...row }])
      },
    }
    return chain
  }),
  update: vi.fn((table: unknown) => {
    if (getTableName(table as never) !== "doctrine") throw new Error("unexpected table")
    let update: Record<string, unknown>
    let condition: unknown
    const apply = () => {
      const rows = matchingRows(condition)
      rows.forEach((row) => Object.assign(row, update))
      return rows.map((row) => ({ ...row }))
    }
    const chain = {
      set(next: Record<string, unknown>) {
        update = next
        return chain
      },
      where(next: unknown) {
        condition = next
        return chain
      },
      returning() {
        return Promise.resolve(apply())
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(apply()).then(resolve, reject)
      },
    }
    return chain
  }),
  delete: vi.fn((table: unknown) => {
    if (getTableName(table as never) !== "doctrine") throw new Error("unexpected table")
    let condition: unknown
    const apply = () => {
      const matches = new Set(matchingRows(condition))
      harness.rows.splice(0, harness.rows.length, ...harness.rows.filter((row) => !matches.has(row)))
    }
    const chain = {
      where(next: unknown) {
        condition = next
        return chain
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        apply()
        return Promise.resolve(undefined).then(resolve, reject)
      },
    }
    return chain
  }),
}

vi.doMock("@/lib/db", () => ({ db: database }))
vi.doMock("@/lib/session", () => ({ getUserId: harness.getUserId }))
vi.doMock("@/lib/registers/events", () => ({
  logEvent: vi.fn(async (event: Record<string, unknown>) => {
    harness.events.push(event)
  }),
}))
vi.doMock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => {
    harness.revalidated.push(path)
  }),
}))

let doctrineActions: typeof import("@/app/actions/doctrine")

function storedHistoricalRow(index = 0) {
  return {
    id: index + 1,
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
    ...buildHistoricalDoctrineInsert("tenant-a", getHistoricalDoctrineCatalog()[index]),
  }
}

beforeEach(async () => {
  harness.rows.length = 0
  harness.events.length = 0
  harness.revalidated.length = 0
  harness.getUserId.mockClear()
  vi.clearAllMocks()
  vi.resetModules()
  doctrineActions = await import("@/app/actions/doctrine")
})

describe("historical Doctrine actions", () => {
  it("creates one inactive historical-input event and replays the exact promotion idempotently", async () => {
    const candidate = getHistoricalDoctrineCatalog()[0]

    const created = await doctrineActions.promoteHistoricalDoctrineInput(candidate.candidateId)
    const replay = await doctrineActions.promoteHistoricalDoctrineInput(candidate.candidateId)

    expect(created).toMatchObject({ replayed: false, row: { active: false, status: "historical_input" } })
    expect(replay).toMatchObject({ replayed: true, row: { id: created.row.id } })
    expect(harness.rows).toHaveLength(1)
    expect(harness.events).toEqual([expect.objectContaining({
      type: "doctrine.historical_input_created",
      register: "doctrine",
      refId: created.row.id,
    })])
    expect(String(harness.events[0].summary)).not.toMatch(/ratif|activat/i)
  })

  it("fails closed when a candidate identity collides with different content", async () => {
    harness.rows.push({ ...storedHistoricalRow(), statement: "Conflicting content" })

    await expect(doctrineActions.promoteHistoricalDoctrineInput("HKR-32a0add1327ffadd"))
      .rejects.toThrow("HISTORICAL_DOCTRINE_COLLISION:HKR-32a0add1327ffadd")
    expect(harness.events).toHaveLength(0)
  })

  it("reads historical inputs in catalog order while active enforcement reads none", async () => {
    harness.rows.push(storedHistoricalRow(2), storedHistoricalRow(0), storedHistoricalRow(1))

    await expect(doctrineActions.getHistoricalDoctrineInputs()).resolves.toMatchObject([
      { historicalClaimId: "HKR004-C001" },
      { historicalClaimId: "HKR004-C002" },
      { historicalClaimId: "HKR004-C003" },
    ])
    await expect(doctrineActions.getActiveDoctrine("tenant-a")).resolves.toEqual([])
  })

  it("archives only through the explicit lifecycle and repeats as a no-op", async () => {
    harness.rows.push(storedHistoricalRow(1))

    const archived = await doctrineActions.archiveHistoricalDoctrineInput("HKR-ada454f7cb889228")
    const replay = await doctrineActions.archiveHistoricalDoctrineInput("HKR-ada454f7cb889228")

    expect(archived).toMatchObject({ replayed: false, row: { active: false, status: "historical_archived" } })
    expect(replay).toMatchObject({ replayed: true, row: { active: false, status: "historical_archived" } })
    expect(harness.events).toEqual([expect.objectContaining({
      type: "doctrine.historical_input_archived",
    })])
  })

  it("refuses toggle, evidence-link, supersede, and delete mutations for historical rows", async () => {
    harness.rows.push(storedHistoricalRow(2))
    const replacement = { title: "Replacement", statement: "Replacement statement" }

    for (const mutation of [
      () => doctrineActions.toggleDoctrine(3, true),
      () => doctrineActions.linkDoctrineEvidence(3, "evidence-1"),
      () => doctrineActions.supersedeDoctrine(3, replacement),
      () => doctrineActions.deleteDoctrine(3),
    ]) {
      await expect(mutation()).rejects.toThrow("HISTORICAL_DOCTRINE_GENERIC_MUTATION_FORBIDDEN")
    }

    expect(harness.rows).toHaveLength(1)
    expect(harness.rows[0]).toMatchObject({
      status: "historical_input",
      active: false,
      evidence: [],
    })
    expect(harness.events).toHaveLength(0)
  })
})
