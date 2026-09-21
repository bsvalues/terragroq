import fs from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const seams = vi.hoisted(() => ({ user: "owner" as string | null, get: vi.fn(), start: vi.fn(), stop: vi.fn(), preview: vi.fn() }))
vi.mock("@/lib/session", () => ({ getSession: async () => seams.user ? { user: { id: seams.user } } : null }))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/governance/owner", () => ({ resolveOwnerUserId: async () => "owner", assertOwner: (user: string) => user === "owner" ? { ok: true } : { ok: false, failure: "NOT_OWNER" } }))
vi.mock("@/lib/applications/application-runtime", () => ({ getApplicationRuntime: seams.get, startApplicationRuntime: seams.start, stopApplicationRuntime: seams.stop, readApplicationPreview: seams.preview }))
vi.mock("@/lib/build-provenance", () => ({ getBuildProvenance: () => ({ sha: "a".repeat(40), builtAt: "now" }) }))
import { GET, POST, DELETE } from "@/app/api/projects/[projectKey]/application-runtime/route"
import { GET as PREVIEW } from "@/app/api/projects/[projectKey]/application-preview/route"
import { fixture } from "./application-runtime-fixture"
let f: Awaited<ReturnType<typeof fixture>>
let application: Awaited<ReturnType<typeof f.app>>
const request = (method = "GET", body?: object, origin = "https://williamos.test") => new Request("https://williamos.test/api/projects/first-board/application-runtime", { method, headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
const context = (projectKey = "first-board") => ({ params: Promise.resolve({ projectKey }) })
beforeEach(async () => { f = await fixture(); application = await f.app(); vi.stubEnv("WILLIAMOS_APPLICATIONS_ROOT", f.apps); seams.user = "owner"; vi.clearAllMocks(); seams.get.mockResolvedValue({ desired: "running", observed: "running" }); seams.start.mockResolvedValue({ observed: "running" }); seams.stop.mockResolvedValue({ observed: "stopped" }); seams.preview.mockResolvedValue("<!doctype html><h1>Preview</h1>") })
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(f.root, { recursive: true, force: true }) })
describe("catalog-authorized generic runtime routes", () => {
  it("resolves all actions including stop and preview from the catalog and exposes one truth object", async () => {
    const response = await GET(request(), context())
    expect(await response.json()).toEqual({ runtime: { desired: "running", observed: "running" }, truth: { runtimeBuild: { sha: "a".repeat(40), builtAt: "now" }, activeProjectHead: application.head } })
    await POST(request("POST"), context()); await DELETE(request("DELETE"), context()); const preview = await PREVIEW(request(), context())
    for (const fn of [seams.get, seams.start, seams.stop, seams.preview]) expect(fn).toHaveBeenCalledWith(expect.objectContaining({ repositoryRoot: application.repositoryRoot, manifestDigest: application.manifestDigest }))
    expect(preview.headers.get("content-security-policy")).toContain("connect-src 'none'")
    expect(preview.headers.get("content-security-policy")).toContain("sandbox allow-scripts")
    expect(preview.headers.get("content-security-policy")).not.toContain("allow-same-origin")
    expect(preview.headers.get("cache-control")).toBe("no-store")
    expect(await preview.text()).toContain("Preview")
  })
  it.each([GET, POST, DELETE, PREVIEW])("refuses unknown, invalid and unauthorized applications before runtime action", async (handler) => {
    const method = handler === POST ? "POST" : handler === DELETE ? "DELETE" : "GET"
    expect((await handler(request(method), context("unknown-board"))).status).toBe(404)
    seams.user = null; expect((await handler(request(method), context())).status).toBe(401)
    seams.user = "other"; expect((await handler(request(method), context())).status).toBe(403)
    for (const fn of [seams.get, seams.start, seams.stop, seams.preview]) expect(fn).not.toHaveBeenCalled()
  })
  it("rejects cross-origin mutations and all caller policy inputs", async () => {
    expect((await POST(request("POST", undefined, "https://evil.test"), context())).status).toBe(403)
    expect((await DELETE(request("DELETE", undefined, "https://evil.test"), context())).status).toBe(403)
    expect((await POST(request("POST", { root: "C:/escape", command: "evil" }), context())).status).toBe(400)
    expect(seams.start).not.toHaveBeenCalled(); expect(seams.stop).not.toHaveBeenCalled()
  })
})
