import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DELETE,
  GET,
  PATCH,
  POST,
  PUT,
} from "@/app/api/local/runtime/status/route"
import {
  getLocalRuntimeStatus,
  LOCAL_RUNTIME_HTTP_TARGETS,
  LOCAL_RUNTIME_POSTURE,
  LOCAL_RUNTIME_STATUS_SEMANTICS,
  validateLocalRuntimeStatusRequest,
} from "@/lib/local-runtime-status"

describe("GET /api/local/runtime/status", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("returns the first-slice static posture and approved localhost check shape", async () => {
    const response = await GET(new Request("http://localhost/api/local/runtime/status"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(
      expect.objectContaining({
        ok: true,
        mode: "manual-only",
        host: "HP OMEN Gaming Laptop 16-ap0xxx",
        scope: "localhost-only",
        executionEnabled: false,
        persistenceEnabled: false,
        lanExposureEnabled: false,
        warnings: [],
      }),
    )
    expect(body.checks.app).toEqual(
      expect.objectContaining({
        state: "ready",
        url: "http://127.0.0.1:3100",
        health: "pass",
        readiness: "pass",
      }),
    )
    expect(body.checks.app.routes).toHaveLength(LOCAL_RUNTIME_HTTP_TARGETS.length)
    expect(body.checks.postgresProof).toEqual(
      expect.objectContaining({
        state: "documented",
        expectedPort: "127.0.0.1:15432",
      }),
    )
    expect(body.semantics).toEqual(
      expect.objectContaining({
        sourceModel: "static posture + localhost HTTP GET checks",
        containerizedProofNote: expect.stringContaining("proof container"),
        controlBoundary: expect.stringContaining("No command execution"),
      }),
    )
    expect(body.semantics.stateModel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "ready" }),
        expect.objectContaining({ state: "stopped" }),
        expect.objectContaining({ state: "degraded" }),
        expect.objectContaining({ state: "stale" }),
        expect.objectContaining({ state: "unknown" }),
      ]),
    )
    expect(fetchMock).toHaveBeenCalledTimes(LOCAL_RUNTIME_HTTP_TARGETS.length)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
      LOCAL_RUNTIME_HTTP_TARGETS.map((target) => target.primaryUrl),
    )
  })

  it("falls back to 3101 when the 3100 checks are safely stopped or unknown", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Response("ok", { status: 200 }))

    const status = await getLocalRuntimeStatus({ timeoutMs: 5 })

    expect(status.checks.app.state).toBe("ready")
    expect(status.checks.app.url).toBe("http://127.0.0.1:3101")
    expect(fetchMock.mock.calls.slice(5).map((call) => call[0])).toEqual(
      LOCAL_RUNTIME_HTTP_TARGETS.map((target) => target.fallbackUrl),
    )
  })

  it("degrades safely when localhost checks fail or partially respond", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("unready", { status: 503 }))
      .mockRejectedValueOnce(new Error("timeout"))

    const status = await getLocalRuntimeStatus({ timeoutMs: 5 })

    expect(status.checks.app.state).toBe("degraded")
    expect(status.checks.app.health).toBe("fail")
    expect(status.checks.app.readiness).toBe("unknown")
    expect(status.warnings.join(" ")).toContain("read-only")
  })

  it("rejects action parameters without running localhost checks", async () => {
    const response = await GET(
      new Request("http://localhost/api/local/runtime/status?action=start"),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toContain("Action parameters")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("blocks non-GET methods with an Allow header", async () => {
    for (const handler of [POST, PUT, PATCH, DELETE]) {
      const response = await handler()
      const body = await response.json()

      expect(response.status).toBe(405)
      expect(response.headers.get("Allow")).toBe("GET")
      expect(body.ok).toBe(false)
      expect(body.error).toContain("GET status reads only")
    }
  })

  it("keeps the posture model free of execution, Docker, backup, port-scan, and secret surfaces", () => {
    const serialized = JSON.stringify({
      posture: LOCAL_RUNTIME_POSTURE,
      semantics: LOCAL_RUNTIME_STATUS_SEMANTICS,
    })

    expect(LOCAL_RUNTIME_POSTURE.executionEnabled).toBe(false)
    expect(LOCAL_RUNTIME_POSTURE.persistenceEnabled).toBe(false)
    expect(LOCAL_RUNTIME_POSTURE.lanExposureEnabled).toBe(false)
    expect(serialized).not.toContain("DATABASE_URL")
    expect(serialized).not.toContain("BETTER_AUTH_SECRET")
    expect(serialized).not.toContain("docker inspect")
    expect(serialized).not.toContain("backupPath")
    expect(serialized).not.toContain("latestBackup")
    expect(serialized).not.toContain("netstat")
  })

  it("keeps the runtime status contract observational rather than operational", async () => {
    const response = await GET(new Request("http://localhost/api/local/runtime/status"))
    const body = await response.json()
    const serialized = JSON.stringify(body).toLowerCase()

    expect(body.executionEnabled).toBe(false)
    expect(body.persistenceEnabled).toBe(false)
    expect(body.lanExposureEnabled).toBe(false)
    expect(serialized).not.toContain("docker inspect")
    expect(serialized).not.toContain("docker ps")
    expect(serialized).not.toContain("backuppath")
    expect(serialized).not.toContain("latestbackup")
    expect(serialized).not.toContain("portstatus")
    expect(serialized).not.toContain("listeningports")
    expect(serialized).not.toContain("database_url")
    expect(serialized).not.toContain("better_auth_secret")
  })

  it("treats refresh, command, target, and start-stop params as unsafe action inputs", () => {
    for (const param of ["refresh", "command", "target", "start", "stop", "restart"]) {
      const validation = validateLocalRuntimeStatusRequest(
        new Request(`http://localhost/api/local/runtime/status?${param}=1`),
      )

      expect(validation.ok).toBe(false)
    }
  })
})

