import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  issue: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/delivery-seal-runtime", () => ({ issuePersistedCodexDeliverySeal: seams.issue }))

import { POST } from "@/app/api/governance/delivery-seal/route"

describe("delivery seal route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
  })

  it("accepts only assignment identity and the commit to inspect, never client authority claims", async () => {
    const response = await POST(new Request("http://localhost/api/governance/delivery-seal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40),
        reservedPaths: ["app/**"],
      }),
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "DELIVERY_SEAL_REQUEST_INVALID" })
    expect(seams.issue).not.toHaveBeenCalled()
  })

  it.each([
    ["cross-origin", { headers: { "content-type": "application/json", host: "localhost", origin: "https://evil.example" }, body: "{}", status: 403, error: "CROSS_ORIGIN_REFUSED" }],
    ["wrong content type", { headers: { "content-type": "text/plain", host: "localhost" }, body: "{}", status: 415, error: "UNSUPPORTED_MEDIA_TYPE" }],
    ["oversized body", { headers: { "content-type": "application/json", host: "localhost" }, body: JSON.stringify({ padding: "x".repeat(2_100) }), status: 413, error: "MESSAGE_TOO_LARGE" }],
    ["malformed JSON", { headers: { "content-type": "application/json", host: "localhost" }, body: "{not-json", status: 400, error: "INVALID_BODY" }],
  ])("rejects %s before authentication or delivery issuance", async (_label, input) => {
    const response = await POST(new Request("http://localhost/api/governance/delivery-seal", {
      method: "POST",
      headers: input.headers,
      body: input.body,
    }))
    expect(response.status).toBe(input.status)
    expect(await response.json()).toEqual({ error: input.error })
    expect(seams.getSession).not.toHaveBeenCalled()
    expect(seams.issue).not.toHaveBeenCalled()
  })

  it("returns the WilliamOS-issued seal for the authenticated owner's existing assignment", async () => {
    const seal = { payload: { version: "williamos-delivery-seal.v1" }, signature: "signed" }
    seams.issue.mockResolvedValue(seal)
    const response = await POST(new Request("http://localhost/api/governance/delivery-seal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40) }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, seal })
    expect(seams.issue).toHaveBeenCalledWith({
      userId: "owner-1", threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40),
    })
  })

  it("fails closed with a typed product seam when signing material is unavailable", async () => {
    seams.issue.mockRejectedValue(Object.assign(new Error("missing key"), { code: "DELIVERY_SEAL_SIGNING_UNAVAILABLE" }))
    const response = await POST(new Request("http://localhost/api/governance/delivery-seal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "thread-1", assignmentHash: "a".repeat(64), commitSha: "2".repeat(40) }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "DELIVERY_SEAL_SIGNING_UNAVAILABLE", detail: "missing key" })
  })
})
