import { describe, expect, it, vi } from "vitest"

const databaseHarness = vi.hoisted(() => {
  const rows: OwnedWorkingWorldRecord[] = []
  const offsets: number[] = []
  let currentWorld: OwnedWorkingWorldRecord | null = null
  let barrier: null | {
    delayed: boolean
    waiting: Promise<void>
    release: Promise<void>
    signalWaiting: () => void
    signalRelease: () => void
  } = null

  function select() {
    let limit = Number.POSITIVE_INFINITY
    let offset = 0
    const result = () => (currentWorld ? [currentWorld] : rows).slice(offset, offset + limit)
    const query = {
      from: () => query,
      where: () => query,
      orderBy: () => query,
      limit: (value: number) => { limit = value; return query },
      offset: (value: number) => { offset = value; offsets.push(value); return Promise.resolve(result()) },
      then: (resolve: (value: readonly OwnedWorkingWorldRecord[]) => unknown) => resolve(result()),
    }
    return query
  }

  function update() {
    let changes: { snapshot?: string; intent?: string } = {}
    const query = {
      set: (value: typeof changes) => { changes = value; return query },
      where: () => query,
      returning: async () => {
        if (!currentWorld || !changes.snapshot) return []
        const candidate = JSON.parse(changes.snapshot)
        const isLineMutation = candidate.conversation?.some(
          (turn: { content?: string }) => turn.content === "drop all surfaces",
        )
        if (barrier && isLineMutation && !barrier.delayed) {
          barrier.delayed = true
          barrier.signalWaiting()
          await barrier.release
          return []
        }
        currentWorld = { ...currentWorld, snapshot: changes.snapshot, intent: changes.intent ?? currentWorld.intent }
        return [{ id: currentWorld.id }]
      },
      then: (resolve: (value: readonly { id: string }[]) => unknown) => {
        if (currentWorld && changes.snapshot) {
          currentWorld = { ...currentWorld, snapshot: changes.snapshot, intent: changes.intent ?? currentWorld.intent }
        }
        return resolve(currentWorld ? [{ id: currentWorld.id }] : [])
      },
    }
    return query
  }

  function armLineBarrier() {
    let signalWaiting!: () => void
    let signalRelease!: () => void
    const waiting = new Promise<void>((resolve) => { signalWaiting = resolve })
    const release = new Promise<void>((resolve) => { signalRelease = resolve })
    barrier = { delayed: false, waiting, release, signalWaiting, signalRelease }
    return { waiting, release: signalRelease }
  }

  return {
    rows,
    offsets,
    select: vi.fn(select),
    update: vi.fn(update),
    armLineBarrier,
    getCurrentWorld: () => currentWorld,
    setCurrentWorld: (row: OwnedWorkingWorldRecord | null) => { currentWorld = row },
  }
})

vi.mock("@/lib/db", () => ({
  db: { select: databaseHarness.select, update: databaseHarness.update },
}))
vi.mock("@/lib/session", () => ({ getUserId: vi.fn(async () => "owner-a") }))

import {
  browserSpaceStorageKey,
  databaseSpaceWorkingWorldStore,
  findLatestProjectOwnedByPage,
  findLatestTerraFusionOwnedByPage,
  loadOrCreateOwnedSpace,
  listOwnedProjectSpaces,
  createOwnedProjectSpace,
  loadOwnedCouncilHistory,
  saveOwnedCouncilSession,
  saveOwnedLineWorld,
  selectedLineContextFingerprint,
  saveOwnedSpace,
  workspaceProjectFromRoot,
  type OwnedWorkingWorldRecord,
  type SpaceWorkingWorldStore,
} from "@/lib/environment/space-persistence"
import { createWorkingWorld, withTurn, type SpaceState, type WorkingWorldSnapshot } from "@/lib/environment/working-world"
import { POST } from "@/app/api/environment/line/route"

function councilSession(id: string, createdAt: string) {
  return {
    id, question: `Question ${id}`, status: "ready" as const, createdAt,
    context: { spaceName: "TerraFusion", kind: "file" as const, label: "src/App.tsx" },
    members: [{ id: "architect", role: "Architect", name: "Atlas", provider: "local", model: "model", status: "ready" as const, perspective: "Keep it bounded." }],
    consensus: "Proceed carefully.", dissent: "One risk.", blindSpot: "Unknown.", recommendation: "Verify it.", confidence: 80,
    evidence: [{ id: "selected", label: "Selected file", detail: "src/App.tsx" }],
  }
}

class MemoryStore implements SpaceWorkingWorldStore {
  readonly rows = new Map<string, OwnedWorkingWorldRecord>()
  private projectInsertTail: Promise<void> = Promise.resolve()

  async findOwned(userId: string, worldId: string) {
    const row = this.rows.get(worldId)
    return row?.userId === userId ? row : null
  }

  async findLatestOwned(userId: string) {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null
  }

  async findLatestOwnedForProject(userId: string, projectIdentity: string) {
    const ordered = [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    return findLatestProjectOwnedByPage(projectIdentity, async (offset, limit) => (
      ordered.slice(offset, offset + limit)
    ))
  }

  async listOwnedForProject(userId: string) {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id))
  }

  async readOwnedPage(userId: string, offset: number, limit: number) {
    return (await this.listOwnedForProject(userId)).slice(offset, offset + limit)
  }

  insertOwnedProjectSpace(userId: string, projectIdentity: string, row: OwnedWorkingWorldRecord) {
    let resolve!: (result: "created" | "limit") => void
    let reject!: (error: unknown) => void
    const result = new Promise<"created" | "limit">((done, failed) => { resolve = done; reject = failed })
    this.projectInsertTail = this.projectInsertTail.then(async () => {
      const projectRows = (await this.listOwnedForProject(userId)).filter((candidate) => {
        try { return JSON.parse(candidate.snapshot).resources.includes(`williamos-workspace-root:v1:${projectIdentity}`) }
        catch { return false }
      })
      if (projectRows.length >= 12) { resolve("limit"); return }
      await this.insertOwned(row)
      resolve("created")
    }).catch(reject)
    return result
  }

  async insertOwned(row: OwnedWorkingWorldRecord) {
    if (this.rows.has(row.id)) throw new Error("WORLD_ID_COLLISION")
    this.rows.set(row.id, row)
  }

  async updateOwned(userId: string, worldId: string, snapshot: string, intent: string, expectedSnapshot: string) {
    const row = await this.findOwned(userId, worldId)
    if (!row || row.snapshot !== expectedSnapshot) return false
    this.rows.set(worldId, { ...row, snapshot, intent, updatedAt: new Date(row.updatedAt.getTime() + 1) })
    return true
  }
}

class BarrierStore extends MemoryStore {
  private releaseRevision2!: () => void
  readonly revision2Waiting = new Promise<void>((resolve) => { this.revision2WaitingResolve = resolve })
  private revision2WaitingResolve!: () => void
  private revision2Delayed = false
  private readonly revision1Committed = new Promise<void>((resolve) => { this.releaseRevision2 = resolve })

  override async updateOwned(userId: string, worldId: string, snapshot: string, intent: string, expectedSnapshot: string) {
    const revision = JSON.parse(snapshot).space.revision as number
    if (revision === 2 && !this.revision2Delayed) {
      this.revision2Delayed = true
      this.revision2WaitingResolve()
      await this.revision1Committed
      return super.updateOwned(userId, worldId, snapshot, intent, expectedSnapshot)
    }
    const updated = await super.updateOwned(userId, worldId, snapshot, intent, expectedSnapshot)
    if (revision === 1 && updated) {
      const row = this.rows.get(worldId)!
      const concurrent = { ...JSON.parse(row.snapshot), openConcerns: ["concurrent world update"] }
      this.rows.set(worldId, { ...row, snapshot: JSON.stringify(concurrent) })
      this.releaseRevision2()
    }
    return updated
  }
}

class LineBarrierStore extends MemoryStore {
  private releaseLine!: () => void
  readonly lineWaiting = new Promise<void>((resolve) => { this.lineWaitingResolve = resolve })
  private lineWaitingResolve!: () => void
  private readonly spaceCommitted = new Promise<void>((resolve) => { this.releaseLine = resolve })
  private lineDelayed = false

  override async updateOwned(userId: string, worldId: string, snapshot: string, intent: string, expectedSnapshot: string) {
    const world = JSON.parse(snapshot)
    const isLineMutation = world.conversation?.some((turn: { content?: string }) => turn.content === "show current work")
    if (isLineMutation && !this.lineDelayed) {
      this.lineDelayed = true
      this.lineWaitingResolve()
      await this.spaceCommitted
    }
    return super.updateOwned(userId, worldId, snapshot, intent, expectedSnapshot)
  }

  releaseAfterSpaceCommit() {
    this.releaseLine()
  }
}

class RejectingCasStore extends MemoryStore {
  updateAttempts = 0

  override async updateOwned() {
    this.updateAttempts += 1
    return false
  }
}

function space(runningAppUrl: string | null = "javascript:alert(1)", revision = 1): SpaceState {
  return {
    schemaVersion: 1,
    revision,
    windows: [
      { id: "editor", kind: "editor", title: "Source", frame: { x: 24, y: 40, width: 900, height: 680 }, z: 4, minimized: false },
      { id: "app", kind: "running-app", title: "TerraFusion", frame: { x: 860, y: 70, width: 820, height: 620 }, z: 3, minimized: true },
      { id: "inspector", kind: "inspector", title: "Evidence", frame: { x: 1200, y: 90, width: 420, height: 560 }, z: 5, minimized: false, surfaceKind: "evidence", surfaceSubject: "audit:1042" },
    ],
    openFiles: ["src/search-ranking.ts", "src/query.ts"],
    panes: [
      { id: "left", filePath: "src/search-ranking.ts", selection: { anchor: 2, head: 8 } },
      { id: "right", filePath: "src/query.ts", selection: { anchor: 11, head: 23 } },
    ],
    selection: { filePath: "src/query.ts", anchor: 11, head: 23 },
    activeWindowId: "editor",
    activePaneId: "right",
    runningAppUrl,
  }
}

describe("server-owned Space persistence", () => {
  it("lists only valid owner and project Spaces newest first", async () => {
    const store = new MemoryStore()
    const project = workspaceProjectFromRoot("C:\\repos\\TerraFusion")
    const other = workspaceProjectFromRoot("C:\\repos\\Other")
    const make = (id: string, userId: string, target: typeof project, updatedAt: string) => {
      const world = createWorkingWorld({ intent: id, resources: [`williamos-workspace-root:v1:${target.identity}`] })
      store.rows.set(id, { id, userId, intent: id, snapshot: JSON.stringify({ ...world, space: space(null, 1) }), updatedAt: new Date(updatedAt) })
    }
    make("older", "owner-a", project, "2026-08-20T00:00:00Z")
    make("newer", "owner-a", project, "2026-08-22T00:00:00Z")
    make("foreign-owner", "owner-b", project, "2026-08-24T00:00:00Z")
    make("foreign-project", "owner-a", other, "2026-08-23T00:00:00Z")
    store.rows.set("corrupt", { id: "corrupt", userId: "owner-a", intent: "bad", snapshot: "{", updatedAt: new Date("2026-08-25T00:00:00Z") })

    expect((await listOwnedProjectSpaces({ userId: "owner-a", project }, store)).map((item) => item.worldId)).toEqual(["newer", "older"])
  })

  it("creates a fresh server-derived Space from only a canonical name", async () => {
    const store = new MemoryStore()
    const project = workspaceProjectFromRoot("C:\\repos\\TerraFusion")
    const created = await createOwnedProjectSpace({
      userId: "owner-a", project, name: "  Release work  ", newWorldId: () => "server-id",
    }, store)
    expect(created.worldId).toBe("server-id")
    expect(created.name).toBe("Release work")
    expect(created.space.revision).toBe(0)
    expect(created.space.openFiles).toEqual([])
    expect(JSON.parse(store.rows.get("server-id")!.snapshot).resources).toContain(`williamos-workspace-root:v1:${project.identity}`)
    await expect(createOwnedProjectSpace({ userId: "owner-a", project, name: "bad\nname" }, store)).rejects.toThrow("SPACE_NAME_INVALID")
  })

  it("pages beyond 240 newer foreign rows to find the exact project collection", async () => {
    const store = new MemoryStore()
    const project = workspaceProjectFromRoot("C:\\repos\\TerraFusion")
    const other = workspaceProjectFromRoot("C:\\repos\\Other")
    for (let index = 0; index < 260; index += 1) {
      const world = createWorkingWorld({ intent: `foreign-${index}`, resources: [`williamos-workspace-root:v1:${other.identity}`] })
      store.rows.set(`foreign-${index}`, { id: `foreign-${index}`, userId: "owner-a", intent: world.intent, snapshot: JSON.stringify(world), updatedAt: new Date(10_000 + index) })
    }
    const exactWorld = createWorkingWorld({ intent: "Exact", resources: [`williamos-workspace-root:v1:${project.identity}`] })
    store.rows.set("exact", { id: "exact", userId: "owner-a", intent: "Exact", snapshot: JSON.stringify({ ...exactWorld, space: space(null, 1) }), updatedAt: new Date(1) })
    expect((await listOwnedProjectSpaces({ userId: "owner-a", project }, store)).map((item) => item.worldId)).toEqual(["exact"])
  })

  it("transactionally refuses the thirteenth project Space under concurrent creation", async () => {
    const store = new MemoryStore()
    const project = workspaceProjectFromRoot("C:\\repos\\TerraFusion")
    for (let index = 0; index < 11; index += 1) {
      await createOwnedProjectSpace({ userId: "owner-a", project, name: `Space ${index}`, newWorldId: () => `world-${index}` }, store)
    }
    const outcomes = await Promise.allSettled([
      createOwnedProjectSpace({ userId: "owner-a", project, name: "Space eleven", newWorldId: () => "world-11" }, store),
      createOwnedProjectSpace({ userId: "owner-a", project, name: "Space twelve", newWorldId: () => "world-12" }, store),
    ])
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter((item) => item.status === "rejected").map((item) => (item as PromiseRejectedResult).reason.message)).toEqual(["SPACE_LIMIT_REACHED"])
    expect((await listOwnedProjectSpaces({ userId: "owner-a", project }, store))).toHaveLength(12)
  })
  it("derives separate opaque browser fallback namespaces per user and project", () => {
    const owner = browserSpaceStorageKey("owner-a", "c:/repos/terrafusion")
    expect(owner).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(owner).not.toContain("owner-a")
    expect(browserSpaceStorageKey("owner-b", "c:/repos/terrafusion")).not.toBe(owner)
    expect(browserSpaceStorageKey("owner-a", "c:/repos/other")).not.toBe(owner)
  })

  it("derives one stable user-visible project identity from the configured root", () => {
    expect(workspaceProjectFromRoot("C:\\workspaces\\TerraFusion_OS_1.0\\.")).toEqual({
      identity: "c:/workspaces/terrafusion_os_1.0",
      name: "TerraFusion_OS_1.0",
    })
  })

  it("binds the Line route persistence seam to the shared CAS writer", async () => {
    const initial = { ...createWorkingWorld({ intent: "TerraFusion" }), space: space(null, 1) }
    const initialRow = {
      id: "world-a", userId: "owner-a", intent: initial.intent,
      snapshot: JSON.stringify(initial), updatedAt: new Date("2026-08-25T10:00:00Z"),
    }
    databaseHarness.setCurrentWorld(initialRow)
    const overlap = databaseHarness.armLineBarrier()
    const lineSave = POST(new Request("http://localhost/api/environment/line", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ worldId: "world-a", text: "drop all surfaces" }),
    }))
    await Promise.race([
      overlap.waiting,
      lineSave.then(() => { throw new Error("Line save completed before the overlap barrier") }),
    ])
    databaseHarness.setCurrentWorld({
      ...initialRow,
      snapshot: JSON.stringify({ ...initial, space: space(null, 2) }),
    })
    overlap.release()
    expect((await lineSave).status).toBe(200)

    const persisted = JSON.parse(databaseHarness.getCurrentWorld()!.snapshot)
    expect(persisted.space.revision).toBe(2)
    expect(persisted.conversation.some((turn: { content?: string }) => turn.content === "drop all surfaces")).toBe(true)
  })

  it("binds the database store to scope-correct TerraFusion pagination", async () => {
    databaseHarness.setCurrentWorld(null)
    databaseHarness.rows.length = 0
    databaseHarness.offsets.length = 0
    databaseHarness.rows.push(...Array.from({ length: 20 }, (_, index) => ({
      id: `unrelated-${index}`,
      userId: "owner-a",
      intent: `Unrelated world ${index}`,
      snapshot: JSON.stringify(createWorkingWorld({ intent: `Unrelated world ${index}` })),
      updatedAt: new Date(2026, 7, 25, 12, 0, 20 - index),
    })), {
      id: "terrafusion-world",
      userId: "owner-a",
      intent: "TerraFusion",
      snapshot: JSON.stringify(createWorkingWorld({ intent: "TerraFusion" })),
      updatedAt: new Date(2026, 7, 24),
    })

    expect((await databaseSpaceWorkingWorldStore.findLatestOwned("owner-a"))?.id).toBe("terrafusion-world")
    expect(databaseHarness.offsets).toEqual([0, 20])
  })

  it("continues past the first owned-world page to restore an older TerraFusion Space", async () => {
    const world = createWorkingWorld({ intent: "TerraFusion", resources: ["bsvalues/terragroq"] })
    const rows: OwnedWorkingWorldRecord[] = Array.from({ length: 20 }, (_, index) => ({
      id: `unrelated-${index}`,
      userId: "owner-a",
      intent: `Unrelated world ${index}`,
      snapshot: JSON.stringify(createWorkingWorld({ intent: `Unrelated world ${index}` })),
      updatedAt: new Date(2026, 7, 25, 12, 0, 20 - index),
    }))
    rows.push({
      id: "terrafusion-world",
      userId: "owner-a",
      intent: world.intent,
      snapshot: JSON.stringify(world),
      updatedAt: new Date(2026, 7, 24),
    })
    const offsets: number[] = []

    const found = await findLatestTerraFusionOwnedByPage(async (offset, limit) => {
      offsets.push(offset)
      return rows.slice(offset, offset + limit)
    })

    expect(found?.id).toBe("terrafusion-world")
    expect(offsets).toEqual([0, 20])
  })

  it("creates a uniquely owned cold-start world and restores it from the server store", async () => {
    const store = new MemoryStore()
    const project = { identity: "c:/repos/terrafusion", name: "TerraFusion" }
    const opened = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "world-uuid-a",
      workspaceAppUrl: "https://configured.terrafusion.test/",
      project,
    }, store)

    expect(opened).toMatchObject({
      worldId: "world-uuid-a",
      project,
      space: { runningAppUrl: "https://configured.terrafusion.test/" },
    })
    expect(opened?.space.revision).toBe(0)
    expect(opened?.spine).toMatchObject({ execution: "idle", projectId: null })
    expect(store.rows.get("world-uuid-a")?.userId).toBe("owner-a")

    const restored = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "must-not-be-used",
      workspaceAppUrl: "https://configured.terrafusion.test/",
      project,
    }, store)
    expect(restored!.worldId).toBe("world-uuid-a")
  })

  it("restores the durable William conversation with its owned Space", async () => {
    const store = new MemoryStore()
    const project = { identity: "c:/repos/terrafusion", name: "TerraFusion" }
    const world = withTurn(
      withTurn(createWorkingWorld({
        intent: "TerraFusion",
        resources: ["williamos-workspace-root:v1:c:/repos/terrafusion"],
      }), "owner", "What changed in the selected file?"),
      "williamos",
      "The save path is now revision-bound.",
    )
    store.rows.set("world-conversation", {
      id: "world-conversation",
      userId: "owner-a",
      intent: world.intent,
      snapshot: JSON.stringify({ ...world, space: space(null, 3) }),
      updatedAt: new Date("2026-08-29T09:00:00Z"),
    })

    const restored = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      worldId: "world-conversation",
      project,
    }, store)

    expect(restored?.conversation.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "owner", content: "What changed in the selected file?" },
      { role: "williamos", content: "The save path is now revision-bound." },
    ])
  })

  it("starts a clean bound Space instead of reinterpreting saved paths against another repository", async () => {
    const store = new MemoryStore()
    const first = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "world-repo-a",
      project: { identity: "c:/repos/terrafusion-a", name: "TerraFusion A" },
    }, store)
    await saveOwnedSpace({
      userId: "owner-a",
      worldId: first!.worldId,
      space: space(null, 1),
      project: first!.project,
    }, store)

    const second = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "world-repo-b",
      project: { identity: "c:/repos/terrafusion-b", name: "TerraFusion B" },
    }, store)

    expect(second).toMatchObject({
      worldId: "world-repo-b",
      project: { identity: "c:/repos/terrafusion-b", name: "TerraFusion B" },
      space: { openFiles: [], revision: 0 },
    })
    expect(JSON.parse(store.rows.get("world-repo-a")!.snapshot).space.openFiles).toEqual([
      "src/search-ranking.ts", "src/query.ts",
    ])
  })

  it("returns to an older bound Space after a different repository became the latest world", async () => {
    const store = new MemoryStore()
    const projectA = { identity: "c:/repos/terrafusion-a", name: "TerraFusion A" }
    const first = await loadOrCreateOwnedSpace({
      userId: "owner-a", newWorldId: () => "world-repo-a", project: projectA,
    }, store)
    await saveOwnedSpace({
      userId: "owner-a", worldId: first!.worldId, space: space(null, 1), project: projectA,
    }, store)

    await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "world-repo-b",
      project: { identity: "c:/repos/terrafusion-b", name: "TerraFusion B" },
    }, store)

    const reopened = await loadOrCreateOwnedSpace({
      userId: "owner-a", newWorldId: () => "must-not-create", project: projectA,
    }, store)
    expect(reopened).toMatchObject({
      worldId: "world-repo-a",
      space: { revision: 1, openFiles: ["src/search-ranking.ts", "src/query.ts"] },
    })
    expect(store.rows.has("must-not-create")).toBe(false)
  })

  it("restores the same project identity when only its display name changes", async () => {
    const store = new MemoryStore()
    await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "world-repo-a",
      project: { identity: "c:/repos/terrafusion", name: "Old display name" },
    }, store)

    const reopened = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "must-not-create",
      project: { identity: "c:/repos/terrafusion", name: "New display name" },
    }, store)
    expect(reopened).toMatchObject({
      worldId: "world-repo-a",
      project: { identity: "c:/repos/terrafusion", name: "New display name" },
    })
    expect(store.rows.has("must-not-create")).toBe(false)
  })

  it("refuses an addressed Space when the configured repository no longer matches its binding", async () => {
    const store = new MemoryStore()
    await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "world-repo-a",
      project: { identity: "c:/repos/terrafusion-a", name: "TerraFusion A" },
    }, store)

    await expect(loadOrCreateOwnedSpace({
      userId: "owner-a",
      worldId: "world-repo-a",
      project: { identity: "c:/repos/terrafusion-b", name: "TerraFusion B" },
    }, store)).rejects.toThrow("SPACE_PROJECT_MISMATCH")
  })

  it("refuses a delayed save after the configured repository changes", async () => {
    const store = new MemoryStore()
    const opened = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "world-repo-a",
      project: { identity: "c:/repos/terrafusion-a", name: "TerraFusion A" },
    }, store)

    await expect(saveOwnedSpace({
      userId: "owner-a",
      worldId: opened!.worldId,
      space: space(null, 1),
      project: { identity: "c:/repos/terrafusion-b", name: "TerraFusion B" },
    }, store)).rejects.toThrow("SPACE_PROJECT_MISMATCH")
    expect(JSON.parse(store.rows.get("world-repo-a")!.snapshot).space.revision).toBe(0)
  })

  it("creates a dedicated TerraFusion world instead of falling back to an unrelated latest world", async () => {
    const store = new MemoryStore()
    const unrelated = createWorkingWorld({ intent: "Review payroll policy", resources: ["internal/policy"] })
    store.rows.set("unrelated-world", {
      id: "unrelated-world", userId: "owner-a", intent: unrelated.intent,
      snapshot: JSON.stringify(unrelated), updatedAt: new Date("2026-08-25T11:00:00Z"),
    })

    const opened = await loadOrCreateOwnedSpace({
      userId: "owner-a", newWorldId: () => "terrafusion-world", workspaceAppUrl: null,
    }, store)

    expect(opened!.worldId).toBe("terrafusion-world")
    expect(store.rows.get("terrafusion-world")?.intent).toBe("TerraFusion")
    expect(JSON.parse(store.rows.get("unrelated-world")!.snapshot).space).toBeUndefined()
  })

  it("round-trips geometry, z-order, minimized state, files, panes, selection and focus", async () => {
    const store = new MemoryStore()
    const world = {
      ...createWorkingWorld({ intent: "TerraFusion", resources: ["bsvalues/terragroq"] }),
      spine: {
        ...createWorkingWorld({ intent: "spine source" }).spine,
        projectId: 42,
        projectName: "TerraFusion",
        execution: "implementing" as const,
      },
      surfaces: [{ kind: "browser" as const, subject: "https://live.terrafusion.test/" }],
    }
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: world.intent,
      snapshot: JSON.stringify(world), updatedAt: new Date("2026-08-25T10:00:00Z"),
    })

    const saved = await saveOwnedSpace({
      userId: "owner-a",
      worldId: "world-a",
      space: space(),
      workspaceAppUrl: "https://admitted.terrafusion.test/",
    }, store)
    expect(saved?.space.runningAppUrl).toBe("https://admitted.terrafusion.test/")

    const reopened = await loadOrCreateOwnedSpace({
      userId: "owner-a", worldId: "world-a", newWorldId: () => "unused",
      workspaceAppUrl: "https://admitted.terrafusion.test/",
    }, store)
    expect(reopened!.space).toEqual({ ...space(), runningAppUrl: "https://admitted.terrafusion.test/" })
    expect(reopened!.spine).toMatchObject({ projectId: 42, projectName: "TerraFusion", execution: "implementing" })
  })

  it("does not update another owner's world", async () => {
    const store = new MemoryStore()
    const world = createWorkingWorld({ intent: "TerraFusion" })
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: world.intent,
      snapshot: JSON.stringify(world), updatedAt: new Date("2026-08-25T10:00:00Z"),
    })

    expect(await saveOwnedSpace({
      userId: "owner-b", worldId: "world-a", space: space("https://attacker.invalid/"),
      workspaceAppUrl: "https://configured.terrafusion.test/",
    }, store)).toBeNull()
    expect(JSON.parse(store.rows.get("world-a")!.snapshot).space).toBeUndefined()
  })

  it("refuses a delayed revision before it can overwrite newer geometry, files or selection", async () => {
    const store = new MemoryStore()
    const world = createWorkingWorld({ intent: "TerraFusion" })
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: world.intent,
      snapshot: JSON.stringify(world), updatedAt: new Date("2026-08-25T10:00:00Z"),
    })
    const revision2 = {
      ...space("https://browser.invalid/", 2),
      windows: space(null, 2).windows.map((window) => window.id === "editor"
        ? { ...window, frame: { x: 200, y: 180, width: 1000, height: 720 } }
        : window),
      openFiles: ["src/new.ts"],
      panes: [{ id: "left", filePath: "src/new.ts" }],
      selection: { filePath: "src/new.ts", anchor: 7, head: 12 },
      activePaneId: "left",
    }
    await saveOwnedSpace({ userId: "owner-a", worldId: "world-a", space: revision2 }, store)

    const delayed = { ...space(null, 1), openFiles: [], panes: [], selection: null, activePaneId: null }
    await expect(saveOwnedSpace({ userId: "owner-a", worldId: "world-a", space: delayed }, store))
      .rejects.toThrow(/SPACE_REVISION_STALE/)

    const reopened = await loadOrCreateOwnedSpace({ userId: "owner-a", worldId: "world-a" }, store)
    expect(reopened?.space).toMatchObject({
      revision: 2,
      openFiles: ["src/new.ts"],
      selection: { filePath: "src/new.ts", anchor: 7, head: 12 },
    })
    expect(reopened?.space.windows.find((window) => window.id === "editor")?.frame.x).toBe(200)
  })

  it("retries a lost CAS when its revision is still newer and preserves concurrent world fields", async () => {
    const store = new BarrierStore()
    const world = createWorkingWorld({ intent: "TerraFusion" })
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: world.intent,
      snapshot: JSON.stringify(world), updatedAt: new Date("2026-08-25T10:00:00Z"),
    })
    const revision2 = {
      ...space(null, 2),
      windows: space(null, 2).windows.map((window) => window.id === "editor"
        ? { ...window, frame: { x: 222, y: 180, width: 1000, height: 720 } }
        : window),
      openFiles: ["src/revision-2.ts"],
      panes: [{ id: "left", filePath: "src/revision-2.ts" }],
      selection: { filePath: "src/revision-2.ts", anchor: 2, head: 8 },
      activePaneId: "left",
    }
    const revision1 = { ...space(null, 1), openFiles: [], panes: [], selection: null, activePaneId: null }

    const newer = saveOwnedSpace({ userId: "owner-a", worldId: "world-a", space: revision2 }, store)
    await store.revision2Waiting
    await saveOwnedSpace({ userId: "owner-a", worldId: "world-a", space: revision1 }, store)
    await expect(newer).resolves.toMatchObject({ space: { revision: 2 } })

    const reopened = await loadOrCreateOwnedSpace({ userId: "owner-a", worldId: "world-a" }, store)
    expect(reopened?.space).toMatchObject({
      revision: 2,
      openFiles: ["src/revision-2.ts"],
      selection: { filePath: "src/revision-2.ts", anchor: 2, head: 8 },
    })
    expect(reopened?.space.windows.find((window) => window.id === "editor")?.frame.x).toBe(222)
    expect(JSON.parse(store.rows.get("world-a")!.snapshot).openConcerns).toEqual(["concurrent world update"])
  })

  it("retries a Line CAS and preserves a Space save that lands while the Line request is in flight", async () => {
    const store = new LineBarrierStore()
    const initial = { ...createWorkingWorld({ intent: "TerraFusion" }), space: space(null, 1) }
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: initial.intent,
      snapshot: JSON.stringify(initial), updatedAt: new Date("2026-08-25T10:00:00Z"),
    })
    const lineWorld = withTurn(initial, "owner", "show current work", () => "2026-08-25T10:01:00Z")
    const lineSave = saveOwnedLineWorld({
      userId: "owner-a", worldId: "world-a", world: lineWorld, isNew: false,
    }, store)
    await store.lineWaiting

    const moved = {
      ...space(null, 2),
      windows: space(null, 2).windows.map((window) => window.id === "editor"
        ? { ...window, frame: { x: 333, y: 144, width: 980, height: 710 } }
        : window),
    }
    await saveOwnedSpace({ userId: "owner-a", worldId: "world-a", space: moved }, store)
    store.releaseAfterSpaceCommit()
    await lineSave

    const persisted = JSON.parse(store.rows.get("world-a")!.snapshot)
    expect(persisted.conversation.at(-1)).toMatchObject({ content: "show current work" })
    expect(persisted.space.revision).toBe(2)
    expect(persisted.space.windows.find((window: { id: string }) => window.id === "editor").frame.x).toBe(333)
  })

  it("refuses a stale Line reply when the persisted selected context changes during inference", async () => {
    const store = new LineBarrierStore()
    const initial = { ...createWorkingWorld({ intent: "TerraFusion" }), space: space(null, 1) }
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: initial.intent,
      snapshot: JSON.stringify(initial), updatedAt: new Date("2026-08-25T10:00:00Z"),
    })
    const answered = withTurn(
      withTurn(initial, "owner", "show current work", () => "2026-08-25T10:01:00Z"),
      "williamos",
      "A reply bound to the old selection.",
      () => "2026-08-25T10:01:01Z",
    )
    const lineSave = saveOwnedLineWorld({
      userId: "owner-a",
      worldId: "world-a",
      world: answered,
      isNew: false,
      expectedSelectedContext: selectedLineContextFingerprint(initial),
    }, store)
    await store.lineWaiting

    const moved = {
      ...space(null, 2),
      selection: { filePath: "src/search-ranking.ts", anchor: 2, head: 8 },
      activePaneId: "left",
      activeWindowId: "editor",
    }
    await saveOwnedSpace({ userId: "owner-a", worldId: "world-a", space: moved }, store)
    store.releaseAfterSpaceCommit()

    await expect(lineSave).rejects.toThrow("LINE_CONTEXT_STALE")
    const reopened = await loadOrCreateOwnedSpace({ userId: "owner-a", worldId: "world-a" }, store)
    expect(reopened?.space.revision).toBe(2)
    expect(reopened?.conversation).toEqual([])
  })

  it("refuses a Line reply when the authoritative bytes change at the same persisted selection", async () => {
    const store = new MemoryStore()
    const initial = { ...createWorkingWorld({ intent: "TerraFusion" }), space: space(null, 1) }
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: initial.intent,
      snapshot: JSON.stringify(initial), updatedAt: new Date("2026-08-25T10:00:00Z"),
    })
    let selectedVersion = "sha256:before"
    const deriveSelectedContext = async (world: WorkingWorldSnapshot) => JSON.stringify({
      persisted: selectedLineContextFingerprint(world),
      path: "src/query.ts",
      version: selectedVersion,
    })
    const expectedSelectedContext = await deriveSelectedContext(initial)
    const answered = withTurn(
      withTurn(initial, "owner", "Explain this file"),
      "williamos",
      "A reply grounded in the old bytes.",
    )

    selectedVersion = "sha256:after"
    await expect(saveOwnedLineWorld({
      userId: "owner-a",
      worldId: "world-a",
      world: answered,
      isNew: false,
      expectedSelectedContext,
      deriveSelectedContext,
    }, store)).rejects.toThrow("LINE_CONTEXT_STALE")

    const reopened = await loadOrCreateOwnedSpace({ userId: "owner-a", worldId: "world-a" }, store)
    expect(reopened?.conversation).toEqual([])
    expect(reopened?.space.selection?.filePath).toBe("src/query.ts")
  })

  it("lets a later Space save preserve a Line turn committed first", async () => {
    const store = new MemoryStore()
    const initial = { ...createWorkingWorld({ intent: "TerraFusion" }), space: space(null, 1) }
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: initial.intent,
      snapshot: JSON.stringify(initial), updatedAt: new Date("2026-08-25T10:00:00Z"),
    })

    await saveOwnedLineWorld({
      userId: "owner-a",
      worldId: "world-a",
      world: withTurn(initial, "owner", "show current work", () => "2026-08-25T10:01:00Z"),
      isNew: false,
    }, store)
    await saveOwnedSpace({ userId: "owner-a", worldId: "world-a", space: space(null, 2) }, store)

    const persisted = JSON.parse(store.rows.get("world-a")!.snapshot)
    expect(persisted.conversation.at(-1)).toMatchObject({ content: "show current work" })
    expect(persisted.space.revision).toBe(2)
  })

  it("fails typed and leaves the world untouched when the Line CAS retry budget is exhausted", async () => {
    const store = new RejectingCasStore()
    const initial = { ...createWorkingWorld({ intent: "TerraFusion" }), space: space(null, 1) }
    const originalSnapshot = JSON.stringify(initial)
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: initial.intent,
      snapshot: originalSnapshot, updatedAt: new Date("2026-08-25T10:00:00Z"),
    })

    await expect(saveOwnedLineWorld({
      userId: "owner-a",
      worldId: "world-a",
      world: withTurn(initial, "owner", "show current work"),
      isNew: false,
    }, store)).rejects.toThrow("WORLD_PERSISTENCE_BUSY")
    expect(store.updateAttempts).toBe(3)
    expect(store.rows.get("world-a")?.snapshot).toBe(originalSnapshot)
  })

  it("persists, deduplicates, and prunes Council history while preserving unrelated world state", async () => {
    const store = new MemoryStore()
    const initial = { ...createWorkingWorld({ intent: "TerraFusion" }), space: space(null, 1) }
    store.rows.set("world-a", { id: "world-a", userId: "owner-a", intent: initial.intent, snapshot: JSON.stringify(initial), updatedAt: new Date() })
    for (let index = 0; index < 7; index += 1) {
      await saveOwnedCouncilSession({ userId: "owner-a", worldId: "world-a", session: councilSession(`c-${index}`, `2026-08-27T10:0${index}:00.000Z`) }, store)
    }
    await saveOwnedCouncilSession({ userId: "owner-a", worldId: "world-a", session: councilSession("c-6", "2026-08-27T10:09:00.000Z") }, store)

    const history = await loadOwnedCouncilHistory("owner-a", "world-a", store)
    expect(history?.map((entry) => entry.id)).toEqual(["c-1", "c-2", "c-3", "c-4", "c-5", "c-6"])
    expect(history?.at(-1)?.createdAt).toBe("2026-08-27T10:09:00.000Z")
    expect(JSON.parse(store.rows.get("world-a")!.snapshot).space.revision).toBe(1)
    expect(await loadOwnedCouncilHistory("owner-b", "world-a", store)).toBeNull()
  })

  it("retries Council CAS against the latest world instead of replacing concurrent fields", async () => {
    class CouncilRetryStore extends MemoryStore {
      attempts = 0
      override async updateOwned(userId: string, worldId: string, snapshot: string, intent: string, expectedSnapshot: string) {
        this.attempts += 1
        if (this.attempts === 1) {
          const row = this.rows.get(worldId)!
          this.rows.set(worldId, { ...row, snapshot: JSON.stringify({
            ...JSON.parse(row.snapshot),
            openConcerns: ["concurrent"],
            councilHistory: [councilSession("c-concurrent", "2026-08-27T09:59:00.000Z")],
          }) })
          return false
        }
        return super.updateOwned(userId, worldId, snapshot, intent, expectedSnapshot)
      }
    }
    const store = new CouncilRetryStore()
    const initial = createWorkingWorld({ intent: "TerraFusion" })
    store.rows.set("world-a", { id: "world-a", userId: "owner-a", intent: initial.intent, snapshot: JSON.stringify(initial), updatedAt: new Date() })

    await saveOwnedCouncilSession({ userId: "owner-a", worldId: "world-a", session: councilSession("c-current", "2026-08-27T10:00:00.000Z") }, store)

    expect(store.attempts).toBe(2)
    expect(JSON.parse(store.rows.get("world-a")!.snapshot).openConcerns).toEqual(["concurrent"])
    expect(JSON.parse(store.rows.get("world-a")!.snapshot).councilHistory.map((entry: { id: string }) => entry.id)).toEqual(["c-concurrent", "c-current"])
  })
})
