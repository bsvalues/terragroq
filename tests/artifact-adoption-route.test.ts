import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({ getSession: vi.fn(), owner: vi.fn(), preview: vi.fn(), previewTarget: vi.fn(), authorize: vi.fn(), issue: vi.fn() }))
vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/owner", () => ({ resolveOwnerUserId: seams.owner, assertOwner: (id: string, owner: string | null) => id === owner ? { ok: true } : { ok: false, failure: "NOT_OWNER" } }))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/governance/artifact-adoption-runtime", () => ({
  previewPersistedArtifactAdoption: seams.preview,
  previewTargetArtifactAdoption: seams.previewTarget,
  authorizePersistedArtifactAdoption: seams.authorize,
  issuePersistedArtifactAdoption: seams.issue,
}))

import { POST } from "@/app/api/governance/delivery-adoption/route"

describe("prospective delivery adoption route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.owner.mockResolvedValue("owner-1")
  })

  it.each([
    [{ mode: "PREVIEW", worldId: "space-1", headSha: "2".repeat(40) }],
    [{ mode: "AUTHORIZE", worldId: "space-1", confirmedPreviewDigest: "a".repeat(64), idempotencyKey: "adopt:1117", paths: ["escape.ts"] }],
    [{ mode: "ISSUE", worldId: "space-1", idempotencyKey: "adopt:1117", adoptionHash: "b".repeat(64) }],
  ])("rejects browser-authored artifact or authority fields", async (body) => {
    const response = await POST(new Request("http://localhost/api/governance/delivery-adoption", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "DELIVERY_SEAL_REQUEST_INVALID" })
    expect(seams.preview).not.toHaveBeenCalled()
  })

  it("supports restore, exact-target preview, authorize, and issue while keeping scope server-derived", async () => {
    seams.preview.mockResolvedValue({ status: "READY_FOR_CONFIRMATION", worldId: "space-1", previewDigest: "a".repeat(64) })
    seams.previewTarget.mockResolvedValue({ status: "READY_FOR_CONFIRMATION", worldId: "space-1", previewDigest: "a".repeat(64) })
    seams.authorize.mockResolvedValue({ status: "AUTHORIZED", worldId: "space-1", adoptionHash: "b".repeat(64), authorizationEventId: 101 })
    seams.issue.mockResolvedValue({ status: "SEALED", worldId: "space-1", adoptionHash: "b".repeat(64), seal: { payload: {}, signature: "signed" } })
    const bodies = [
      { mode: "PREVIEW", worldId: "space-1" },
      { mode: "PREVIEW", worldId: "space-1", pullRequest: 1117, expectedHeadSha: "2".repeat(40) },
      { mode: "AUTHORIZE", worldId: "space-1", pullRequest: 1117, expectedHeadSha: "2".repeat(40), confirmedPreviewDigest: "a".repeat(64), idempotencyKey: "adopt:1117" },
      { mode: "ISSUE", worldId: "space-1", idempotencyKey: "adopt:1117" },
    ]
    for (const body of bodies) {
      const response = await POST(new Request("http://localhost/api/governance/delivery-adoption", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
      expect(response.status).toBe(body.mode === "AUTHORIZE" ? 201 : 200)
    }
    expect(seams.preview).toHaveBeenCalledWith("owner-1", "space-1")
    expect(seams.previewTarget).toHaveBeenCalledWith("owner-1", "space-1", { pullRequest: 1117, expectedHeadSha: "2".repeat(40) })
    expect(seams.authorize).toHaveBeenCalledWith("owner-1", "space-1", { pullRequest: 1117, expectedHeadSha: "2".repeat(40) }, "adopt:1117", "a".repeat(64))
    expect(seams.issue).toHaveBeenCalledWith("owner-1", "space-1", "adopt:1117")
  })
})
