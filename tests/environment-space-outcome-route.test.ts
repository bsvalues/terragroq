import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  assimilate: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/environment/space-outcome-assimilation", () => ({
  assimilateOwnedSpaceOutcome: seams.assimilate,
}))

import { POST } from "@/app/api/environment/space/outcome/route"

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3000/api/environment/space/outcome", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3000", ...headers },
    body: JSON.stringify(body),
  })
}

describe("Space outcome assimilation route", () => {
  beforeEach(() => {
    seams.getSession.mockReset().mockResolvedValue({ user: { id: "owner-1" } })
    seams.assimilate.mockReset().mockResolvedValue({ status: "MISSING_AUTHORITY", reason: "NO_ACTIVE_OWNER_OUTCOME" })
  })

  it("accepts only an owned Space identity and never a client-selected outcome or Work Order", async () => {
    for (const body of [
      { worldId: "space-1", outcomeKey: "manufactured" },
      { worldId: "space-1", workOrderRef: "WO-FAKE" },
      { worldId: "space-1", reservedPaths: ["app/**"] },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "REQUEST_FIELDS_INVALID" })
    }
  })

  it("returns typed missing authority without owner administration instructions", async () => {
    const response = await POST(request({ worldId: "space-1" }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ status: "MISSING_AUTHORITY", reason: "NO_ACTIVE_OWNER_OUTCOME" })
  })

  it("scopes assimilation to the authenticated owner", async () => {
    seams.assimilate.mockImplementation(async (input: { worldId: string }) => ({
      status: "ATTACHED", worldId: input.worldId,
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 41,
      authorityLevel: "A2_WRITE_OWN", reservedPaths: ["lib/environment/"],
    }))

    const response = await POST(request({ worldId: "space-1" }))

    expect(response.status).toBe(200)
    expect(seams.assimilate).toHaveBeenCalledWith({ userId: "owner-1", worldId: "space-1" })
  })

  it("refuses unauthenticated requests before reading authority", async () => {
    seams.getSession.mockResolvedValue(null)

    const response = await POST(request({ worldId: "space-1" }))

    expect(response.status).toBe(401)
    expect(seams.assimilate).not.toHaveBeenCalled()
  })

  it("refuses a cross-origin browser mutation before resolving the session", async () => {
    const response = await POST(request(
      { worldId: "space-1" },
      { origin: "https://evil.example" },
    ))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "CROSS_ORIGIN_REFUSED" })
    expect(seams.getSession).not.toHaveBeenCalled()
    expect(seams.assimilate).not.toHaveBeenCalled()
  })

  it("refuses a form-compatible content type before resolving the session", async () => {
    const response = await POST(request(
      { worldId: "space-1" },
      { "content-type": "text/plain" },
    ))

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: "UNSUPPORTED_MEDIA_TYPE" })
    expect(seams.getSession).not.toHaveBeenCalled()
  })
})
