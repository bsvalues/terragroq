import { describe, expect, it } from "vitest"

import {
  findLatestTerraFusionOwnedByPage,
  loadOrCreateOwnedSpace,
  saveOwnedLineWorld,
  saveOwnedSpace,
  type OwnedWorkingWorldRecord,
  type SpaceWorkingWorldStore,
} from "@/lib/environment/space-persistence"
import { createWorkingWorld, withTurn, type SpaceState } from "@/lib/environment/working-world"

class MemoryStore implements SpaceWorkingWorldStore {
  readonly rows = new Map<string, OwnedWorkingWorldRecord>()

  async findOwned(userId: string, worldId: string) {
    const row = this.rows.get(worldId)
    return row?.userId === userId ? row : null
  }

  async findLatestOwned(userId: string) {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null
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
    const opened = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "world-uuid-a",
      workspaceAppUrl: "https://configured.terrafusion.test/",
    }, store)

    expect(opened).toMatchObject({ worldId: "world-uuid-a", space: { runningAppUrl: "https://configured.terrafusion.test/" } })
    expect(opened?.space.revision).toBe(0)
    expect(opened?.spine).toMatchObject({ execution: "idle", projectId: null })
    expect(store.rows.get("world-uuid-a")?.userId).toBe("owner-a")

    const restored = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      newWorldId: () => "must-not-be-used",
      workspaceAppUrl: "https://configured.terrafusion.test/",
    }, store)
    expect(restored!.worldId).toBe("world-uuid-a")
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
})
