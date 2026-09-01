import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  load: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  resolveBinding: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveTerraFusionWorkspaceBinding: seams.resolveBinding,
}))
vi.mock("@/lib/environment/space-persistence", () => ({
  workspaceProjectFromRoot: () => ({ identity: "c:/project", name: "Project" }),
  browserSpaceStorageKey: () => "opaque-browser-key",
  createDefaultSpace: () => ({ schemaVersion: 1, revision: 0, windows: [], openFiles: [], panes: [], selection: null, activeWindowId: null, activePaneId: null, runningAppUrl: null }),
  loadOrCreateOwnedSpace: seams.load,
  listOwnedProjectSpaces: seams.list,
  createOwnedProjectSpace: seams.create,
  saveOwnedSpace: seams.save,
}))
vi.mock("@/lib/environment/workspace-app", () => ({
  admitWorkspaceApp: async () => ({ ok: false }),
  williamOsOrigin: () => "http://localhost",
}))

import { GET, POST, PUT } from "@/app/api/environment/space/route"

const current = { worldId: "a", name: "Alpha", space: { revision: 2 }, spine: {}, judgment: null, project: { identity: "c:/project", name: "Project" } }

beforeEach(() => {
  seams.getSession.mockReset().mockResolvedValue({ user: { id: "owner" } })
  seams.load.mockReset().mockResolvedValue(current)
  seams.list.mockReset().mockResolvedValue([{ worldId: "a", name: "Alpha", space: { revision: 2 }, updatedAt: "2026-08-28T00:00:00Z" }])
  seams.create.mockReset().mockResolvedValue({ ...current, worldId: "b", name: "Beta", space: { revision: 0 } })
  seams.save.mockReset()
  seams.resolveBinding.mockReset().mockResolvedValue({ ok: true, binding: {
    workspaceAppUrl: null,
    project: { identity: "c:/project", name: "Project" },
  } })
})

describe("Experience V2 Space route", () => {
  it("refuses an unverified Project binding instead of fabricating a TerraFusion Space", async () => {
    seams.resolveBinding.mockResolvedValueOnce({ ok: false, error: "WORKSPACE_ROOT_PROJECT_MISMATCH" })
    const response = await GET(new Request("http://localhost/api/environment/space"))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "WORKSPACE_ROOT_PROJECT_MISMATCH" })
    expect(seams.load).not.toHaveBeenCalled()
  })

  it("returns the exact current envelope with the bounded real collection and opaque preference namespace", async () => {
    const response = await GET(new Request("http://localhost/api/environment/space?worldId=a"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      worldId: "a", name: "Alpha", spaces: [{ worldId: "a", name: "Alpha" }],
      multiSpaceAvailable: true, preferenceStorageKey: "opaque-browser-key",
    })
    expect(seams.load).toHaveBeenCalledWith(expect.objectContaining({ worldId: "a", userId: "owner" }))
  })

  it("creates from name only and ignores client identity, project and snapshot widening", async () => {
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: " Beta ", worldId: "client", project: { identity: "foreign" }, space: { openFiles: ["secret"] } }),
    }))
    expect(response.status).toBe(201)
    expect(seams.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", name: " Beta " }))
    expect(seams.create.mock.calls[0][0]).not.toHaveProperty("worldId")
    expect(seams.create.mock.calls[0][0]).not.toHaveProperty("space")
  })

  it("never degrades an exact missing or project-mismatched lookup into browser state", async () => {
    seams.load.mockResolvedValueOnce(null)
    const missing = await GET(new Request("http://localhost/api/environment/space?worldId=foreign"))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: "WORLD_NOT_FOUND" })

    seams.load.mockRejectedValueOnce(new Error("SPACE_PROJECT_MISMATCH"))
    const mismatch = await GET(new Request("http://localhost/api/environment/space?worldId=stale"))
    expect(mismatch.status).toBe(400)
    expect(await mismatch.json()).toEqual({ error: "SPACE_PROJECT_MISMATCH" })
  })

  it("uses one truthful browser-local Space only for default persistence degradation", async () => {
    seams.load.mockRejectedValueOnce(new Error("database unavailable"))
    const response = await GET(new Request("http://localhost/api/environment/space"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      worldId: "browser-local", storage: "browser", multiSpaceAvailable: false,
      spaces: [{ worldId: "browser-local", name: "Project" }],
    })
  })

  it("keeps a successful server GET when only collection listing degrades", async () => {
    seams.list.mockRejectedValueOnce(new Error("list unavailable"))
    const response = await GET(new Request("http://localhost/api/environment/space?worldId=a"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      worldId: "a", storage: "server", collectionAvailable: false,
      collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      spaces: [{ worldId: "a", name: "Alpha", space: { revision: 2 } }],
    })
  })

  it("returns a committed creation when only post-insert collection listing fails", async () => {
    seams.list.mockRejectedValueOnce(new Error("list unavailable"))
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Beta" }),
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      worldId: "b", name: "Beta", collectionAvailable: false,
      collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      spaces: [{ worldId: "b", name: "Beta", space: { revision: 0 } }],
    })
  })

  it("returns the exact server-authored persistence timestamp without dropping existing save fields", async () => {
    seams.save.mockResolvedValueOnce({
      ...current,
      updatedAt: "2026-08-29T18:42:03.456Z",
      conversation: [{ role: "owner", text: "Keep building." }],
    })
    const response = await PUT(new Request("http://localhost/api/environment/space", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "a", space: { revision: 3 } }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      worldId: "a",
      space: { revision: 2 },
      updatedAt: "2026-08-29T18:42:03.456Z",
      conversation: [{ role: "owner", text: "Keep building." }],
    })
  })

  it("returns 503 when creation persistence fails instead of fabricating a Space", async () => {
    seams.create.mockRejectedValueOnce(new Error("db down"))
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Beta" }),
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "SPACE_PERSISTENCE_UNAVAILABLE" })
  })

  it("returns a typed conflict when the bounded project collection already has twelve Spaces", async () => {
    seams.create.mockRejectedValueOnce(new Error("SPACE_LIMIT_REACHED"))
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Thirteen" }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "SPACE_LIMIT_REACHED" })
  })
})
