import { beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  getSession: vi.fn(),
  load: vi.fn(),
  submitLine: vi.fn(),
  compare: vi.fn(),
  admitEndpoint: vi.fn(),
  observeExecution: vi.fn(),
  requireRuntimeAuthority: vi.fn(),
  verifyEndpointLiveness: vi.fn(),
  appendGovernanceEvent: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: boundary.getSession }))
vi.mock("@/lib/environment/server", () => ({
  environmentWorldService: {
    load: boundary.load,
    submitLine: boundary.submitLine,
    compare: boundary.compare,
    admitEndpoint: boundary.admitEndpoint,
    observeExecution: boundary.observeExecution,
  },
}))
vi.mock("@/lib/environment/runtime-ingress", () => ({
  requireEnvironmentRuntimeAuthority: boundary.requireRuntimeAuthority,
}))
vi.mock("@/lib/environment/endpoint-liveness", () => ({
  verifyEndpointLiveness: boundary.verifyEndpointLiveness,
}))
vi.mock("@/lib/governance/events", () => ({ appendGovernanceEvent: boundary.appendGovernanceEvent }))

import { POST as linePost } from "@/app/api/environment/line/route"
import { GET as worldGet } from "@/app/api/environment/world/route"
import { POST as runtimePost } from "@/app/api/environment/runtime/route"

function lineRequest(body: unknown) {
  return new Request("http://localhost/api/environment/line", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Environment authenticated routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    boundary.getSession.mockResolvedValue({ user: { id: "owner" } })
    boundary.requireRuntimeAuthority.mockResolvedValue({ evidence: [{ id: 7, ref: "EV-1" }] })
  })

  it("uses getSession and returns 401 when auth resolution throws instead of leaking a 500", async () => {
    boundary.getSession.mockRejectedValueOnce(new Error("auth unavailable"))

    const response = await linePost(lineRequest({ text: "work" }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHENTICATED" })
    expect(boundary.submitLine).not.toHaveBeenCalled()
  })

  it("restores latest and exact worlds through a no-store user-scoped GET", async () => {
    boundary.load.mockResolvedValue({ worldId: "world", intent: "work" })
    const latest = await worldGet(new Request("http://localhost/api/environment/world"))
    const exact = await worldGet(new Request("http://localhost/api/environment/world?worldId=world"))

    expect(latest.status).toBe(200)
    expect(exact.headers.get("cache-control")).toBe("no-store")
    expect(boundary.load).toHaveBeenNthCalledWith(1, "owner", null)
    expect(boundary.load).toHaveBeenNthCalledWith(2, "owner", "world")
  })

  it("requires an enrolled runtime device before publishing a world endpoint", async () => {
    boundary.getSession.mockResolvedValueOnce({ user: { id: "owner" }, session: { token: "browser-session" } })

    const response = await runtimePost(new Request("http://localhost/api/environment/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "admit_endpoint" }),
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "RUNTIME_DEVICE_REQUIRED" })
    expect(boundary.requireRuntimeAuthority).not.toHaveBeenCalled()
  })

  it("rejects a null runtime payload as invalid input", async () => {
    boundary.getSession.mockResolvedValueOnce({
      user: { id: "owner" },
      session: { token: "<device-session-redacted>" },
    })

    const response = await runtimePost(new Request("http://localhost/api/environment/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "INVALID_BODY" })
  })

  it("rejects oversized runtime input before authority or projection work", async () => {
    boundary.getSession.mockResolvedValueOnce({
      user: { id: "owner" },
      session: { token: "<device-session-redacted>" },
    })

    const response = await runtimePost(new Request("http://localhost/api/environment/runtime", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "2250001" },
      body: "{}",
    }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: "REQUEST_BODY_TOO_LARGE" })
    expect(boundary.requireRuntimeAuthority).not.toHaveBeenCalled()
  })

  it("admits a live endpoint only after exact authority and evidence checks", async () => {
    boundary.getSession.mockResolvedValueOnce({
      user: { id: "owner" },
      session: { token: "<device-session-redacted>" },
    })
    const candidate = {
      id: "endpoint-1",
      worldId: "world-1",
      resourceIdentity: "repo:one",
      sandboxId: "sandbox-1",
      appUrl: "http://127.0.0.1:4101",
      branch: "world/one",
      filesystemRoot: "/worktrees/one",
      terminalStreamRef: "terminal://one",
      testStreamRef: "tests://one",
      provenance: { source: "execution_receipt", evidenceRef: "EV-1", capturedAt: "2026-08-20T19:00:00.000Z" },
    }
    const verified = {
      ...candidate,
      provenance: { ...candidate.provenance, liveness: { status: "reachable", httpStatus: 200, observedAt: "2026-08-20T19:00:01.000Z", evidenceRef: "EV-1" } },
    }
    boundary.verifyEndpointLiveness.mockResolvedValueOnce(verified)
    boundary.admitEndpoint.mockResolvedValueOnce({ worldId: "world-1" })

    const response = await runtimePost(new Request("http://localhost/api/environment/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "admit_endpoint",
        worldId: "world-1",
        workOrderRef: "WO-1",
        grantRef: "GRANT-1",
        endpoint: candidate,
      }),
    }))

    expect(response.status).toBe(200)
    expect(boundary.requireRuntimeAuthority).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner", worldId: "world-1", workOrderRef: "WO-1", grantRef: "GRANT-1", evidenceRefs: ["EV-1"],
    }))
    expect(boundary.admitEndpoint).toHaveBeenCalledWith("owner", "world-1", verified)
    expect(boundary.appendGovernanceEvent).toHaveBeenCalledWith(expect.objectContaining({ entityId: "world-1", eventType: "EVIDENCE_RECORDED" }))
  })
})
