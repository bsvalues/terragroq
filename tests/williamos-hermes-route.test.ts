import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  readHermesStatus: vi.fn(),
  verifyHermesInference: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/hermes/status-source", () => ({
  readHermesStatus: seams.readHermesStatus,
  verifyHermesInference: seams.verifyHermesInference,
}))

import { GET, POST } from "@/app/api/environment/hermes/route"

beforeEach(() => {
  vi.clearAllMocks()
  seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
  seams.readHermesStatus.mockResolvedValue({ ownerState: "DEGRADED" })
  seams.verifyHermesInference.mockResolvedValue({ result: "PASS", receiptSha256: "a".repeat(64) })
})

describe("WilliamOS HERMES route boundary", () => {
  it("does not disclose HERMES status without a WilliamOS session", async () => {
    seams.getSession.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(seams.readHermesStatus).not.toHaveBeenCalled()
  })

  it("returns the validated native projection without cache authority", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ ownerState: "DEGRADED" })
  })

  it("exposes exactly the admitted read-only inference action", async () => {
    const rejected = await POST(new Request("http://localhost/api/environment/hermes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restart-service" }),
    }))
    expect(rejected.status).toBe(400)
    expect(seams.verifyHermesInference).not.toHaveBeenCalled()

    const admitted = await POST(new Request("http://localhost/api/environment/hermes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify-inference" }),
    }))
    expect(admitted.status).toBe(200)
    expect(await admitted.json()).toEqual({ receipt: { result: "PASS", receiptSha256: "a".repeat(64) } })
    expect(seams.verifyHermesInference).toHaveBeenCalledTimes(1)
  })

  it("rejects action smuggling and oversized requests", async () => {
    const extraKey = await POST(new Request("http://localhost/api/environment/hermes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify-inference", command: "whoami" }),
    }))
    expect(extraKey.status).toBe(400)

    const oversized = await POST(new Request("http://localhost/api/environment/hermes", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "4097" },
      body: JSON.stringify({ action: "verify-inference" }),
    }))
    expect(oversized.status).toBe(413)
    const chunked = await POST(new Request("http://localhost/api/environment/hermes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify-inference", padding: "x".repeat(5000) }),
    }))
    expect(chunked.status).toBe(413)
    expect(seams.verifyHermesInference).not.toHaveBeenCalled()
  })
})
