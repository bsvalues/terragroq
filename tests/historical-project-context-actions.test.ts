import { getTableName } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildHistoricalProjectContextInsert,
  getHistoricalProjectContextCatalog,
} from "@/lib/history/historical-project-context"

const harness = vi.hoisted(() => ({
  documents: [] as Record<string, unknown>[],
  chunks: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  revalidated: [] as string[],
  failEventInsert: false,
  getUserId: vi.fn(async () => "tenant-a"),
  projects: [
    { id: 10, userId: "tenant-a", key: "terrafusion", name: "TerraFusion OS" },
    { id: 20, userId: "tenant-a", key: "williamos", name: "WilliamOS" },
    { id: 30, userId: "tenant-b", key: "terrafusion", name: "Other TerraFusion" },
  ] as Record<string, unknown>[],
  threads: [
    { id: "thread-tf", userId: "tenant-a", projectId: 10, title: "TerraFusion thread" },
    { id: "thread-wos", userId: "tenant-a", projectId: 20, title: "WilliamOS thread" },
    { id: "thread-other", userId: "tenant-b", projectId: 30, title: "Other tenant" },
  ] as Record<string, unknown>[],
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

function matchingRows(rows: Record<string, unknown>[], condition: unknown) {
  const predicates = equalityPredicates(condition)
  return rows.filter((row) => predicates.every(([column, value]) => row[column] === value))
}

function projectRows(rows: Record<string, unknown>[], projection?: Record<string, unknown>) {
  if (!projection) return rows.map((row) => ({ ...row }))
  return rows.map((row) => Object.fromEntries(Object.keys(projection).map((key) => [key, row[key]])))
}

function rowsForTable(tableName: string) {
  if (tableName === "document") return harness.documents
  if (tableName === "document_chunk") return harness.chunks
  if (tableName === "project") return harness.projects
  if (tableName === "workbench_thread") return harness.threads
  throw new Error(`unexpected select table:${tableName}`)
}

const database = {
  select: vi.fn((projection?: Record<string, unknown>) => {
    let tableName = ""
    let condition: unknown
    let joinedDocument = false
    let maximum: number | undefined
    const read = () => {
      if (tableName === "document_chunk" && joinedDocument) {
        const predicates = equalityPredicates(condition)
        const joined = harness.chunks.flatMap((chunk) => {
          const doc = harness.documents.find((candidate) => candidate.id === chunk.documentId)
          if (!doc) return []
          const combined: Record<string, unknown> = {
            ...doc,
            ...chunk,
            documentId: doc.id,
            chunkId: chunk.id,
          }
          if (!predicates.every(([column, value]) => combined[column] === value)) return []
          return [{
            chunkId: chunk.id,
            documentId: doc.id,
            content: chunk.content,
            title: doc.title,
            source: doc.source,
            similarity: 1,
          }]
        })
        return maximum === undefined ? joined : joined.slice(0, maximum)
      }
      const rows = matchingRows(rowsForTable(tableName), condition)
      const projected = projectRows(rows, projection)
      return maximum === undefined ? projected : projected.slice(0, maximum)
    }
    const chain = {
      from(table: unknown) {
        tableName = getTableName(table as never)
        return chain
      },
      innerJoin(table: unknown) {
        if (getTableName(table as never) !== "document") throw new Error("unexpected join")
        joinedDocument = true
        return chain
      },
      where(next: unknown) {
        condition = next
        return chain
      },
      orderBy() {
        return chain
      },
      limit(next: number) {
        maximum = next
        return chain
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(read()).then(resolve, reject)
      },
    }
    return chain
  }),
  insert: vi.fn((table: unknown) => {
    const tableName = getTableName(table as never)
    let values: Record<string, unknown> | Record<string, unknown>[]
    let committed = false
    const commit = () => {
      if (committed) return null
      if (tableName === "event_log") {
        if (harness.failEventInsert) throw new Error("SIMULATED_HISTORICAL_EVENT_FAILURE")
        const event = { id: harness.events.length + 1, ...(values as Record<string, unknown>) }
        harness.events.push(event)
        committed = true
        return event
      }
      if (tableName === "document_chunk") {
        const entries = Array.isArray(values) ? values : [values]
        entries.forEach((entry) => harness.chunks.push({
          id: harness.chunks.length + 1,
          ...entry,
        }))
        committed = true
        return null
      }
      if (tableName !== "document") throw new Error(`unexpected insert table:${tableName}`)
      const value = values as Record<string, unknown>
      const collision = harness.documents.find((row) => (
        value.historicalCandidateId != null
        && row.userId === value.userId
        && row.historicalCandidateId === value.historicalCandidateId
      ))
      if (collision) return null
      const row = {
        id: harness.documents.length + 1,
        projectId: null,
        threadId: null,
        historicalCandidateId: null,
        historicalClaimId: null,
        historicalProvenance: null,
        privacy: null,
        authority: null,
        executionMode: null,
        archivedAt: null,
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
        updatedAt: new Date("2026-08-30T00:00:00.000Z"),
        ...value,
      }
      harness.documents.push(row)
      committed = true
      return row
    }
    const chain = {
      values(next: Record<string, unknown> | Record<string, unknown>[]) {
        values = next
        return chain
      },
      onConflictDoNothing() {
        return chain
      },
      returning() {
        const row = commit()
        return Promise.resolve(row ? [{ ...row }] : [])
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve().then(commit).then(resolve, reject)
      },
    }
    return chain
  }),
  update: vi.fn((table: unknown) => {
    if (getTableName(table as never) !== "document") throw new Error("unexpected update")
    let update: Record<string, unknown>
    let condition: unknown
    const apply = () => {
      const rows = matchingRows(harness.documents, condition)
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
    }
    return chain
  }),
  delete: vi.fn((table: unknown) => {
    const tableName = getTableName(table as never)
    let condition: unknown
    const apply = () => {
      const rows = rowsForTable(tableName)
      const matches = new Set(matchingRows(rows, condition))
      rows.splice(0, rows.length, ...rows.filter((row) => !matches.has(row)))
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
  transaction: vi.fn(),
}

vi.doMock("@/lib/db", () => ({ db: database }))
vi.doMock("@/lib/session", () => ({ getUserId: harness.getUserId }))
vi.doMock("@/lib/ai/embeddings", () => ({
  chunkText: vi.fn((content: string) => [content]),
  embedTexts: vi.fn(async (chunks: string[]) => chunks.map(() => [0.1, 0.2])),
  embedText: vi.fn(async () => [0.1, 0.2]),
  toVectorLiteral: vi.fn(() => "[0.1,0.2]"),
}))
vi.doMock("@/lib/registers/events", () => ({ logEvent: vi.fn(async () => undefined) }))
vi.doMock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => harness.revalidated.push(path)),
}))

let documentActions: typeof import("@/app/actions/documents")

function storedHistoricalRow(index: number, overrides: Record<string, unknown> = {}) {
  const candidate = getHistoricalProjectContextCatalog()[index]
  const projectId = candidate.targetProjectKey === "terrafusion" ? 10 : 20
  return {
    id: index + 1,
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
    ...buildHistoricalProjectContextInsert("tenant-a", projectId, candidate, null),
    ...overrides,
  }
}

beforeEach(async () => {
  harness.documents.length = 0
  harness.chunks.length = 0
  harness.events.length = 0
  harness.revalidated.length = 0
  harness.failEventInsert = false
  harness.getUserId.mockReset().mockResolvedValue("tenant-a")
  vi.clearAllMocks()
  database.transaction.mockImplementation(async (callback: (transaction: typeof database) => Promise<unknown>) => {
    const documentSnapshot = harness.documents.map((row) => ({ ...row }))
    const chunkSnapshot = harness.chunks.map((row) => ({ ...row }))
    const eventSnapshot = harness.events.map((row) => ({ ...row }))
    try {
      return await callback(database)
    } catch (error) {
      harness.documents.splice(0, harness.documents.length, ...documentSnapshot)
      harness.chunks.splice(0, harness.chunks.length, ...chunkSnapshot)
      harness.events.splice(0, harness.events.length, ...eventSnapshot)
      throw error
    }
  })
  vi.resetModules()
  documentActions = await import("@/app/actions/documents")
})

describe("historical private Project/Thread context actions", () => {
  it("admits all six to established Projects without chunks and replays idempotently", async () => {
    const catalog = getHistoricalProjectContextCatalog()
    for (const candidate of catalog) {
      const created = await documentActions.promoteHistoricalProjectContext(candidate.candidateId)
      const replay = await documentActions.promoteHistoricalProjectContext(candidate.candidateId)
      expect(created).toMatchObject({ replayed: false, row: { chunkCount: 0, threadId: null } })
      expect(replay).toMatchObject({ replayed: true, row: { id: created.row.id } })
    }

    expect(harness.documents.map((row) => row.projectId)).toEqual([10, 10, 20, 10, 10, 20])
    expect(harness.documents).toHaveLength(6)
    expect(harness.chunks).toEqual([])
    expect(harness.events).toHaveLength(6)
    expect(harness.events.every((event) => event.type === "document.historical_project_context_created"))
      .toBe(true)
  })

  it("fails closed on content, provenance, Project, or Thread collisions", async () => {
    const candidateId = getHistoricalProjectContextCatalog()[0].candidateId
    for (const collision of [
      { content: "Different content" },
      { historicalProvenance: { ...getHistoricalProjectContextCatalog()[0].provenance, blobId: "different" } },
      { projectId: 20 },
      { threadId: "thread-tf" },
    ]) {
      harness.documents.splice(0, harness.documents.length, storedHistoricalRow(0, collision))
      await expect(documentActions.promoteHistoricalProjectContext(candidateId))
        .rejects.toThrow(`HISTORICAL_PROJECT_CONTEXT_COLLISION:${candidateId}`)
    }
    expect(harness.events).toEqual([])
  })

  it("keeps private historical rows out of corpus listing and vector retrieval", async () => {
    harness.documents.push(
      storedHistoricalRow(0),
      {
        id: 90,
        userId: "tenant-a",
        title: "Ordinary corpus item",
        source: null,
        mimeType: "text/plain",
        content: "ordinary",
        chunkCount: 1,
        status: "indexed",
        projectId: null,
        threadId: null,
        historicalCandidateId: null,
      },
    )
    harness.chunks.push(
      { id: 1, userId: "tenant-a", documentId: 1, content: "must stay private", embedding: [0.1] },
      { id: 2, userId: "tenant-a", documentId: 90, content: "ordinary", embedding: [0.1] },
    )

    await expect(documentActions.getDocuments()).resolves.toMatchObject([
      { id: 90, status: "indexed" },
    ])
    await expect(documentActions.searchCorpus("tenant-a", "private")).resolves.toMatchObject([
      { documentId: 90, content: "ordinary" },
    ])
  })

  it("reads only authenticated Project scope and validates optional Thread tenancy and Project binding", async () => {
    harness.documents.push(
      storedHistoricalRow(0),
      storedHistoricalRow(1),
      storedHistoricalRow(2),
      { ...storedHistoricalRow(3), userId: "tenant-b", projectId: 30 },
    )

    await expect(documentActions.getHistoricalProjectContext("terrafusion"))
      .resolves.toMatchObject([
        { historicalClaimId: "HKR004-C029" },
        { historicalClaimId: "HKR004-C030" },
      ])
    await expect(documentActions.getHistoricalProjectContext("williamos"))
      .resolves.toMatchObject([{ historicalClaimId: "HKR004-C031" }])
    await expect(documentActions.getHistoricalProjectContext("terrafusion", "thread-wos"))
      .rejects.toThrow("HISTORICAL_PROJECT_CONTEXT_THREAD_SCOPE_MISMATCH:thread-wos")
    await expect(documentActions.getHistoricalProjectContext("terrafusion", "thread-other"))
      .rejects.toThrow("HISTORICAL_PROJECT_CONTEXT_THREAD_NOT_FOUND:thread-other")
  })

  it("supports Thread-bound admission only when the Thread belongs to the same tenant and Project", async () => {
    const candidateId = getHistoricalProjectContextCatalog()[0].candidateId

    await expect(documentActions.promoteHistoricalProjectContext(candidateId, "thread-tf"))
      .resolves.toMatchObject({ row: { projectId: 10, threadId: "thread-tf" } })
    await expect(documentActions.getHistoricalProjectContext("terrafusion", "thread-tf"))
      .resolves.toMatchObject([{ historicalCandidateId: candidateId, threadId: "thread-tf" }])

    harness.documents.length = 0
    await expect(documentActions.promoteHistoricalProjectContext(candidateId, "thread-wos"))
      .rejects.toThrow("HISTORICAL_PROJECT_CONTEXT_THREAD_SCOPE_MISMATCH:thread-wos")
    await expect(documentActions.promoteHistoricalProjectContext(candidateId, "thread-other"))
      .rejects.toThrow("HISTORICAL_PROJECT_CONTEXT_THREAD_NOT_FOUND:thread-other")
  })

  it("archives only through the explicit lifecycle and generic deletion fails closed", async () => {
    harness.documents.push(storedHistoricalRow(1))

    await expect(documentActions.deleteDocument(2))
      .rejects.toThrow("HISTORICAL_PROJECT_CONTEXT_GENERIC_DELETE_FORBIDDEN")
    const archived = await documentActions.archiveHistoricalProjectContext("HKR-f2ae70ee3f7b4bda")
    const replay = await documentActions.archiveHistoricalProjectContext("HKR-f2ae70ee3f7b4bda")

    expect(archived).toMatchObject({
      replayed: false,
      row: { status: "archived_private_project_context", archivedAt: expect.any(Date) },
    })
    expect(replay).toMatchObject({ replayed: true, row: { id: archived.row.id } })
    expect(harness.events).toEqual([expect.objectContaining({
      type: "document.historical_project_context_archived",
    })])
  })

  it("rolls admission back if its required provenance event cannot persist", async () => {
    harness.failEventInsert = true

    await expect(documentActions.promoteHistoricalProjectContext("HKR-eabf2e0c67a8a0f4"))
      .rejects.toThrow("SIMULATED_HISTORICAL_EVENT_FAILURE")
    expect(harness.documents).toEqual([])
    expect(harness.events).toEqual([])
  })

  it("generic ingestion ignores historical fields and creates only ordinary indexed corpus", async () => {
    const result = await documentActions.ingestDocument({
      title: "Ordinary",
      content: "ordinary content",
      historicalCandidateId: "HKR-eabf2e0c67a8a0f4",
      projectId: 10,
      status: "private_project_context",
    } as never)

    expect(result).toMatchObject({
      status: "indexed",
      projectId: null,
      historicalCandidateId: null,
    })
    expect(harness.chunks).toHaveLength(1)
  })
})
