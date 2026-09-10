import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  load: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/environment/cross-repository-change-set", () => ({
  loadOwnedCrossRepositoryChangeSet: seams.load,
}))

import { GET } from "@/app/api/environment/change-set/route"

describe("Experience V2 cross-repository Change Set route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
  })

  it("requires an authenticated owner and one valid Space identity", async () => {
    seams.getSession.mockResolvedValueOnce(null)
    const unauthenticated = await GET(new Request("http://localhost/api/environment/change-set?worldId=space-1"))
    expect(unauthenticated.status).toBe(401)
    expect(await unauthenticated.json()).toEqual({ error: "UNAUTHENTICATED" })
    expect(seams.load).not.toHaveBeenCalled()

    const invalid = await GET(new Request(`http://localhost/api/environment/change-set?worldId=${"x".repeat(201)}`))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: "WORLD_ID_INVALID" })
    expect(seams.load).not.toHaveBeenCalled()
  })

  it("returns only the authenticated owner's persisted Space projection", async () => {
    const projection = {
      version: "williamos-cross-repository-change-set.v1",
      worldId: "space-1",
      project: { id: 7, key: "terrafusion", name: "TerraFusion" },
      outcome: { key: "ATLAS_PROJECTION", title: "Atlas projection" },
      units: [],
      dependencies: [],
      limitations: ["No repository-qualified delivery evidence is persisted for this outcome."],
    }
    seams.load.mockResolvedValue(projection)

    const response = await GET(new Request("http://localhost/api/environment/change-set?worldId=space-1"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual(projection)
    expect(seams.load).toHaveBeenCalledWith("owner-1", "space-1")
  })

  it("distinguishes an absent owned Space from an unavailable canonical reader", async () => {
    seams.load.mockResolvedValueOnce(null)
    const missing = await GET(new Request("http://localhost/api/environment/change-set?worldId=space-missing"))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: "WORLD_NOT_FOUND" })

    seams.load.mockRejectedValueOnce(new Error("database detail must not escape"))
    const unavailable = await GET(new Request("http://localhost/api/environment/change-set?worldId=space-1"))
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ error: "CHANGE_SET_UNAVAILABLE" })
  })
})
