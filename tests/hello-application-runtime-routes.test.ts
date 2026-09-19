import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  assertOwner: vi.fn(),
  getRuntime: vi.fn(),
  getSession: vi.fn(),
  resolveBinding: vi.fn(),
  resolveOwnerUserId: vi.fn(),
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/owner", () => ({
  assertOwner: seams.assertOwner,
  resolveOwnerUserId: seams.resolveOwnerUserId,
}))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: vi.fn(() => ({})) }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveCanonicalWorkspaceProjectBinding: seams.resolveBinding,
}))
vi.mock("@/lib/hello-application/runtime-supervisor", () => ({
  getHelloApplicationRuntime: seams.getRuntime,
  startHelloApplicationRuntime: seams.startRuntime,
  stopHelloApplicationRuntime: seams.stopRuntime,
}))

import { DELETE, GET, POST } from "@/app/api/projects/hello-application/runtime/route"
import { GET as PREVIEW } from "@/app/api/projects/hello-application/preview/route"

const running = {
  state: "running",
  host: "127.0.0.1",
  port: 43117,
  url: "http://127.0.0.1:43117/",
  pid: 42,
  workspaceRoot: "C:/runtime/source/examples/hello-application",
  startedAt: "2026-09-19T18:00:00.000Z",
  error: null,
  logs: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  seams.getSession.mockResolvedValue({ user: { id: "owner" } })
  seams.resolveOwnerUserId.mockResolvedValue("owner")
  seams.assertOwner.mockReturnValue({ ok: true })
  seams.resolveBinding.mockResolvedValue({ ok: true, binding: { workspaceRoot: running.workspaceRoot } })
  seams.getRuntime.mockReturnValue(running)
  seams.startRuntime.mockResolvedValue(running)
  seams.stopRuntime.mockResolvedValue({ ...running, state: "stopped", pid: null, port: null, url: null })
})

describe("Hello Application runtime routes", () => {
  it("starts and stops only the server-resolved Hello runtime", async () => {
    const mutation = new Request("https://williamos.lan:3543/api/projects/hello-application/runtime", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://williamos.lan:3543", host: "williamos.lan:3543" },
    })
    const started = await POST(mutation)
    expect(started.status).toBe(200)
    expect(seams.resolveBinding).toHaveBeenCalledWith("owner", "hello-application")
    expect(seams.startRuntime).toHaveBeenCalledWith({ workspaceRoot: running.workspaceRoot })

    const stopped = await DELETE(new Request(mutation, { method: "DELETE" }))
    expect(stopped.status).toBe(200)
    expect(seams.stopRuntime).toHaveBeenCalledOnce()
  })

  it("rejects cross-origin runtime mutations before resolving or launching anything", async () => {
    const response = await POST(new Request("https://williamos.lan:3543/api/projects/hello-application/runtime", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example", host: "williamos.lan:3543" },
    }))
    expect(response.status).toBe(403)
    expect(seams.resolveBinding).not.toHaveBeenCalled()
    expect(seams.startRuntime).not.toHaveBeenCalled()
  })

  it("reports status without accepting runtime coordinates from the browser", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ runtime: running })
  })

  it("proxies only the supervisor-held loopback page with a strict browser boundary", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<!doctype html><h1>Hello Application</h1>", {
      headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "do-not-forward=1" },
    }))
    vi.stubGlobal("fetch", fetcher)

    const response = await PREVIEW()
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledWith(running.url, expect.objectContaining({ redirect: "error" }))
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'")
    expect(response.headers.get("cache-control")).toBe("no-store")
    await expect(response.text()).resolves.toContain("Hello Application")
  })

  it("refuses preview when the supervised process is not running", async () => {
    seams.getRuntime.mockReturnValue({ ...running, state: "stopped", url: null, pid: null })
    const response = await PREVIEW()
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_APPLICATION_NOT_RUNNING" })
  })
})
