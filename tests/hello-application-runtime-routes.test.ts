import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  assertOwner: vi.fn(),
  getBuildProvenance: vi.fn(),
  getRuntime: vi.fn(),
  getSession: vi.fn(),
  readProjectHead: vi.fn(),
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
vi.mock("@/lib/build-provenance", () => ({ getBuildProvenance: seams.getBuildProvenance }))
vi.mock("@/lib/hello-application/runtime-truth", () => ({
  readHelloApplicationProjectHead: seams.readProjectHead,
}))
vi.mock("@/lib/hello-application/runtime-supervisor", () => ({
  getHelloApplicationRuntime: seams.getRuntime,
  startHelloApplicationRuntime: seams.startRuntime,
  stopHelloApplicationRuntime: seams.stopRuntime,
}))

import { DELETE, GET, POST } from "@/app/api/projects/hello-application/runtime/route"
import { GET as PREVIEW } from "@/app/api/projects/hello-application/preview/route"
import { adaptApplicationRuntimePayload } from "@/components/workspace-shell/application-ui-contract"
import { HELLO_APPLICATION_WORKSPACE_PROJECT } from "@/lib/projects/workspace-project-key"

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

const projectedRunning = {
  state: "running",
  pid: 42,
  url: "http://127.0.0.1:43117/",
  error: null,
}

function mutationRequest(method: "POST" | "DELETE") {
  return new Request("https://williamos.lan:3543/api/projects/hello-application/runtime", {
    method,
    headers: { "content-type": "application/json", origin: "https://williamos.lan:3543", host: "williamos.lan:3543" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  seams.getSession.mockResolvedValue({ user: { id: "owner" } })
  seams.resolveOwnerUserId.mockResolvedValue("owner")
  seams.assertOwner.mockReturnValue({ ok: true })
  seams.resolveBinding.mockResolvedValue({ ok: true, binding: { workspaceRoot: running.workspaceRoot } })
  seams.getBuildProvenance.mockReturnValue({ sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" })
  seams.readProjectHead.mockResolvedValue("b".repeat(40))
  seams.getRuntime.mockReturnValue(running)
  seams.startRuntime.mockResolvedValue(running)
  seams.stopRuntime.mockResolvedValue({ ...running, state: "stopped", pid: null, port: null, url: null })
})

describe("Hello Application runtime routes", () => {
  it("starts and stops only the server-resolved Hello runtime", async () => {
    const mutation = mutationRequest("POST")
    const started = await POST(mutation)
    expect(started.status).toBe(200)
    await expect(started.json()).resolves.toEqual({ runtime: projectedRunning })
    expect(seams.resolveBinding).toHaveBeenCalledWith("owner", "hello-application")
    expect(seams.startRuntime).toHaveBeenCalledWith({ workspaceRoot: running.workspaceRoot })

    const stopped = await DELETE(new Request(mutation, { method: "DELETE" }))
    expect(stopped.status).toBe(200)
    await expect(stopped.json()).resolves.toEqual({
      runtime: { state: "stopped", pid: null, url: null, error: null },
    })
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

  it("reports runtime-build SHA and the canonical active-project HEAD on one authorized truth surface", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({
      runtime: projectedRunning,
      truth: {
        runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" },
        activeProjectHead: "b".repeat(40),
      },
    })
    expect(adaptApplicationRuntimePayload(HELLO_APPLICATION_WORKSPACE_PROJECT, payload)).toMatchObject({
      state: "running",
      previewAvailable: true,
      activeProjectHead: "b".repeat(40),
      detail: null,
    })
    expect(seams.resolveBinding).toHaveBeenCalledWith("owner", "hello-application")
    expect(seams.readProjectHead).toHaveBeenCalledWith(running.workspaceRoot)
  })

  it("normalizes supervisor failures without exposing colon detail, paths, or logs", async () => {
    const failed = {
      ...running,
      state: "failed",
      pid: null,
      url: null,
      error: "HELLO_APPLICATION_EXITED:17",
      logs: ["C:/secret/runtime/source/server.mjs failed"],
    }
    seams.getRuntime.mockReturnValue(failed)
    seams.startRuntime.mockResolvedValue({ ...failed, error: "spawn ENOENT C:/secret/runtime/source/server.mjs" })
    seams.stopRuntime.mockResolvedValue({ ...failed, error: "APPLICATION_DOCKER_TIMEOUT: C:/secret/docker.log" })

    const getPayload = await (await GET()).json()
    expect(getPayload.runtime).toEqual({ state: "failed", pid: null, url: null, error: "HELLO_APPLICATION_EXITED" })
    expect(JSON.stringify(getPayload)).not.toContain("secret")

    const postPayload = await (await POST(mutationRequest("POST"))).json()
    expect(postPayload).toEqual({
      runtime: { state: "failed", pid: null, url: null, error: "HELLO_APPLICATION_RUNTIME_FAILED" },
    })
    expect(JSON.stringify(postPayload)).not.toContain("secret")

    const deletePayload = await (await DELETE(mutationRequest("DELETE"))).json()
    expect(deletePayload).toEqual({
      runtime: { state: "failed", pid: null, url: null, error: "APPLICATION_DOCKER_TIMEOUT" },
    })
    expect(JSON.stringify(deletePayload)).not.toContain("secret")
  })

  it("normalizes a thrown supervisor error before returning a start failure", async () => {
    seams.startRuntime.mockRejectedValueOnce(new Error("HELLO_APPLICATION_EXITED:17"))
    const admitted = await POST(mutationRequest("POST"))
    expect(admitted.status).toBe(503)
    await expect(admitted.json()).resolves.toEqual({ error: "HELLO_APPLICATION_EXITED" })

    seams.startRuntime.mockRejectedValueOnce(new Error("spawn ENOENT C:/secret/runtime/source/server.mjs"))
    const unknown = await POST(mutationRequest("POST"))
    expect(unknown.status).toBe(503)
    await expect(unknown.json()).resolves.toEqual({ error: "HELLO_APPLICATION_START_FAILED" })
  })

  it("normalizes a thrown supervisor error before returning a stop failure", async () => {
    seams.stopRuntime.mockRejectedValueOnce(new Error("APPLICATION_DOCKER_TIMEOUT: C:/secret/docker.log"))
    const admitted = await DELETE(mutationRequest("DELETE"))
    expect(admitted.status).toBe(503)
    await expect(admitted.json()).resolves.toEqual({ error: "APPLICATION_DOCKER_TIMEOUT" })

    seams.stopRuntime.mockRejectedValueOnce(new Error("spawn ENOENT C:/secret/runtime/source/server.mjs"))
    const unknown = await DELETE(mutationRequest("DELETE"))
    expect(unknown.status).toBe(503)
    await expect(unknown.json()).resolves.toEqual({ error: "HELLO_APPLICATION_STOP_FAILED" })
  })

  it("fails closed when the canonical project binding cannot be resolved", async () => {
    seams.resolveBinding.mockResolvedValue({ ok: false, error: "HELLO_APPLICATION_BINDING_UNAVAILABLE" })

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_APPLICATION_BINDING_UNAVAILABLE" })
    expect(seams.readProjectHead).not.toHaveBeenCalled()
  })

  it("fails closed without leaking process details when active-project HEAD cannot be proven", async () => {
    seams.readProjectHead.mockRejectedValue(new Error("spawn git ENOENT C:\\secret\\workspace"))

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_APPLICATION_PROJECT_TRUTH_UNAVAILABLE" })
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
    const csp = response.headers.get("content-security-policy") ?? ""
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).toContain("style-src 'unsafe-inline'")
    expect(csp).toContain("img-src data:")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("sandbox allow-scripts")
    expect(csp).not.toContain("allow-same-origin")
    expect(response.headers.get("cache-control")).toBe("no-store")
    await expect(response.text()).resolves.toContain("Hello Application")
  })

  it.each([
    ["a non-OK status", 503, "text/html", "HELLO_APPLICATION_UPSTREAM_503"],
    ["an invalid content type", 200, "application/json", "HELLO_APPLICATION_PREVIEW_TYPE_INVALID"],
  ])("aborts and cancels the upstream body when refusing %s", async (_label, status, contentType, expected) => {
    const cancel = vi.fn()
    let signal: AbortSignal | undefined
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options: RequestInit) => {
      signal = options.signal as AbortSignal
      return Promise.resolve(new Response(body, { status, headers: { "content-type": contentType } }))
    }))

    const response = await PREVIEW()

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: expected })
    expect(signal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("rejects a declared oversized preview before reading and cancels the upstream body", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      headers: { "content-type": "text/html", "content-length": "1000001" },
    })))

    const response = await PREVIEW()

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_APPLICATION_PREVIEW_TOO_LARGE" })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("stops and cancels a chunked preview as soon as the hard body cap is crossed", async () => {
    const cancel = vi.fn()
    const chunks = [new Uint8Array(600_000), new Uint8Array(400_001)]
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (chunk) controller.enqueue(chunk)
      },
      cancel,
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      headers: { "content-type": "text/html" },
    })))

    const response = await PREVIEW()

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_APPLICATION_PREVIEW_TOO_LARGE" })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("keeps the preview deadline active through a body that stalls after headers", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    let signal: AbortSignal | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("<!doctype html>")) },
      pull: () => new Promise<void>(() => {}),
      cancel,
    })
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options: RequestInit) => {
      signal = options.signal as AbortSignal
      return Promise.resolve(new Response(body, { headers: { "content-type": "text/html" } }))
    }))

    try {
      let response: Response | undefined
      void PREVIEW().then((value) => { response = value })
      await vi.advanceTimersByTimeAsync(5_001)
      await Promise.resolve()

      expect(response).toBeInstanceOf(Response)
      expect(response!.status).toBe(502)
      await expect(response!.json()).resolves.toEqual({ error: "HELLO_APPLICATION_PREVIEW_UNAVAILABLE" })
      expect(signal?.aborted).toBe(true)
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("refuses preview when the supervised process is not running", async () => {
    seams.getRuntime.mockReturnValue({ ...running, state: "stopped", url: null, pid: null })
    const response = await PREVIEW()
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_APPLICATION_NOT_RUNNING" })
  })
})
