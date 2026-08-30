import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  remove: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/environment/space-persistence", () => ({
  workspaceProjectFromRoot: () => ({ identity: "c:/project", name: "Project" }),
  removeOwnedProjectSpace: seams.remove,
}))

import { DELETE } from "@/app/api/environment/spaces/[worldId]/route"

const request = new Request("http://localhost/api/environment/spaces/world-b", { method: "DELETE" })
const context = (worldId: string) => ({ params: Promise.resolve({ worldId }) })

beforeEach(() => {
  seams.getSession.mockReset().mockResolvedValue({ user: { id: "owner-a" } })
  seams.remove.mockReset().mockResolvedValue({ removedWorldId: "world-b" })
})

describe("Experience V2 Space removal route", () => {
  it("requires an authenticated owner", async () => {
    seams.getSession.mockResolvedValueOnce(null)
    const response = await DELETE(request, context("world-b"))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" })
    expect(seams.remove).not.toHaveBeenCalled()
  })

  it("removes only the exact route-bound Space in the configured project", async () => {
    const response = await DELETE(request, context("world-b"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ removedWorldId: "world-b" })
    expect(seams.remove).toHaveBeenCalledWith({
      userId: "owner-a",
      project: { identity: "c:/project", name: "Project" },
      worldId: "world-b",
    })
  })

  it("rejects malformed route identity before persistence", async () => {
    const response = await DELETE(request, context(""))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "WORLD_ID_INVALID" })
    expect(seams.remove).not.toHaveBeenCalled()
  })

  it.each([
    ["WORLD_NOT_FOUND", 404],
    ["SPACE_PROJECT_MISMATCH", 400],
    ["SPACE_LAST_PROJECT_SPACE", 409],
  ] as const)("returns typed %s without weakening it", async (error, status) => {
    seams.remove.mockRejectedValueOnce(new Error(error))
    const response = await DELETE(request, context("world-b"))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error })
  })

  it("does not expose unexpected persistence failures", async () => {
    seams.remove.mockRejectedValueOnce(new Error("database address"))
    const response = await DELETE(request, context("world-b"))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "SPACE_REMOVAL_UNAVAILABLE" })
  })
})
