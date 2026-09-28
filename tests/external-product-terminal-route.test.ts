import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveOwnerUserId: vi.fn(),
  assertOwner: vi.fn(),
  finalize: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/owner", () => ({
  resolveOwnerUserId: seams.resolveOwnerUserId,
  assertOwner: seams.assertOwner,
}))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/environment/external-product-terminal-settlement", () => ({
  finalizeExternalProductTerminalOutcome: seams.finalize,
}))

import { POST } from "@/app/api/environment/space/external-product-terminal/route"

const request = (body: unknown) => new Request(
  "http://localhost/api/environment/space/external-product-terminal",
  { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) },
)

describe("external product terminal route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner" } })
    seams.resolveOwnerUserId.mockResolvedValue("owner")
    seams.assertOwner.mockReturnValue({ ok: true })
    seams.finalize.mockResolvedValue({
      status: "FINALIZED", replayed: false, worldId: "space-waco",
      outcomeKey: "external:7ccb", workOrderId: 101,
      terminalState: "WACO_2026_TERRAFUSION_RELEASE_READY",
      receiptId: `tf-product-terminal:${"a".repeat(64)}`,
      producerCommit: "b".repeat(40),
    })
  })

  it("settles from the authenticated Space identity without accepting caller authority fields", async () => {
    const response = await POST(request({ worldId: "space-waco" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "FINALIZED", workOrderId: 101 })
    expect(seams.finalize).toHaveBeenCalledWith({ userId: "owner", worldId: "space-waco" })
  })

  it.each([
    null,
    {},
    { worldId: "" },
    { worldId: "space-waco", repository: "bsvalues/terrafusion_os_1.0" },
    { worldId: "space-waco", trusted: true },
    { worldId: "space-waco", receiptSha256: "a".repeat(64) },
  ])("rejects malformed or caller-authored trust input %#", async (body) => {
    const response = await POST(request(body))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "PRODUCT_TERMINAL_REQUEST_INVALID" })
    expect(seams.finalize).not.toHaveBeenCalled()
  })

  it("rejects an unauthenticated caller", async () => {
    seams.getSession.mockResolvedValue(null)
    const response = await POST(request({ worldId: "space-waco" }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" })
  })

  it("rejects an authenticated non-owner", async () => {
    seams.assertOwner.mockReturnValue({ ok: false, failure: "NOT_OWNER", detail: "owner required" })
    const response = await POST(request({ worldId: "space-waco" }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "NOT_OWNER", detail: "owner required" })
  })

  it.each([
    ["PRODUCT_TERMINAL_CONTEXT_STALE", 409],
    ["PRODUCT_TERMINAL_AUTHORITY_REVOKED", 409],
    ["PRODUCT_TERMINAL_CONFLICT", 409],
    ["PRODUCT_TERMINAL_PROVENANCE_INVALID", 409],
    ["WORLD_NOT_FOUND", 404],
  ])("returns typed failure %s", async (code, status) => {
    seams.finalize.mockRejectedValue(new Error(code))
    const response = await POST(request({ worldId: "space-waco" }))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: code })
  })
})
