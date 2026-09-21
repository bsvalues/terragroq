import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const authentication = vi.hoisted(() => ({ user: "owner" as string | null }))
vi.mock("@/lib/session", () => ({ getSession: async () => authentication.user ? { user: { id: authentication.user } } : null }))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/governance/owner", () => ({ resolveOwnerUserId: async () => "owner", assertOwner: (user: string) => user === "owner" ? { ok: true } : { ok: false, failure: "NOT_OWNER" } }))
import { GET, POST } from "@/app/api/applications/route"
import { resolveApplicationRouteContext } from "@/lib/applications/application-route-context"
let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "application-route-")); vi.stubEnv("WILLIAMOS_APPLICATIONS_ROOT", root); authentication.user = "owner" })
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }) })
const request = (body: unknown, headers = {}) => new Request("https://williamos.test/api/applications", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
describe("owner guarded application catalog API", () => {
  it("creates and lists a safe public application projection and resolves only that application", async () => {
    expect((await POST(request({ id: "board", displayName: "My Board" }))).status).toBe(201)
    const response = await GET()
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = await response.json()
    expect(body.applications[0]).toMatchObject({ projectKey: "board", manifest: { displayName: "My Board" }, previewUrl: "/api/projects/board/application-preview" })
    expect(JSON.stringify(body)).not.toContain(root.replaceAll("\\", "\\\\"))
    const context = await resolveApplicationRouteContext("board")
    expect(context).toMatchObject({ ok: true, context: { userId: "owner", application: { repositoryRoot: path.join(root, "board") } } })
    const unknown = await resolveApplicationRouteContext("unknown-app")
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.response.status).toBe(404)
    expect((await POST(request({ id: "board", displayName: "Duplicate" }))).status).toBe(409)
  })
  it("refuses anonymous, non-owner, cross-origin (without Host), path-policy payloads and oversized bodies before writing", async () => {
    authentication.user = null; expect((await GET()).status).toBe(401)
    expect((await POST(request({ id: "board", displayName: "Board" }))).status).toBe(401)
    authentication.user = "other"; expect((await POST(request({ id: "board", displayName: "Board" }))).status).toBe(403)
    authentication.user = "owner"
    expect((await POST(request({ id: "board", displayName: "Board" }, { origin: "https://attacker.test" }))).status).toBe(403)
    expect((await POST(request({ id: "board", displayName: "Board", root: "C:/escape" }))).status).toBe(400)
    expect((await POST(request({ id: "board", displayName: "x".repeat(9000) }))).status).toBe(413)
    expect(await fs.readdir(root)).toEqual([])
  })
})
