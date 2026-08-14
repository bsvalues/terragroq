import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({ getUserId: vi.fn() }))

import { getUserId } from "@/lib/session"
import { POST } from "@/app/api/intent/route"

const mockedGetUserId = vi.mocked(getUserId)

function request(body: unknown) {
  return new Request("http://localhost/api/intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("authenticated universal intent API", () => {
  beforeEach(() => mockedGetUserId.mockResolvedValue("primary"))

  it("returns the deterministic route without authorizing execution", async () => {
    const response = await POST(request({ intent: "Deploy the cockpit" }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      state: "authority_required",
      intent: "execution",
      executionAuthorized: false,
      destination: { href: "/work-orders" },
    })
  })

  it("rejects malformed or oversized intent", async () => {
    expect((await POST(request({ intent: "" }))).status).toBe(400)
    expect((await POST(request({ intent: "x".repeat(2001) }))).status).toBe(400)
  })

  it("rejects an unauthenticated caller", async () => {
    mockedGetUserId.mockRejectedValueOnce(new Error("unauthorized"))

    expect((await POST(request({ intent: "Open Projects" }))).status).toBe(401)
  })
})
