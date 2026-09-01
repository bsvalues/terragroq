import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getAuthReadiness: vi.fn(),
  getSession: vi.fn(),
  resolveOwnerUserId: vi.fn(),
  assertOwner: vi.fn(),
  resolveBinding: vi.fn(),
}))

vi.mock("@/lib/auth-readiness", () => ({ getAuthReadiness: seams.getAuthReadiness }))
vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/owner", () => ({
  resolveOwnerUserId: seams.resolveOwnerUserId,
  assertOwner: seams.assertOwner,
}))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: vi.fn(() => ({})) }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveTerraFusionWorkspaceBinding: seams.resolveBinding,
}))
vi.mock("@/lib/runtime-instance", () => ({
  getProcessStartedAt: vi.fn(() => 100),
  getRuntimeInstanceId: vi.fn(() => "runtime-1"),
}))

import { GET } from "@/app/api/setup/local-status/route"

describe("GET /api/setup/local-status verified checkout truth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NODE_ENV = "development"
    delete process.env.LOCAL_SETUP_ENABLED
    seams.getAuthReadiness.mockResolvedValue({ ready: true })
    seams.getSession.mockResolvedValue({ user: { id: "owner" } })
    seams.resolveOwnerUserId.mockResolvedValue("owner")
    seams.assertOwner.mockReturnValue({ ok: true })
    seams.resolveBinding.mockResolvedValue({ ok: true, binding: { workspaceRoot: "/repos/terrafusion" } })
  })

  it("reports connected only after owner and repository verification", async () => {
    const response = await GET(new Request("http://localhost:3000/api/setup/local-status"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.terraFusionRootConfigured).toBe(true)
    expect(body.terraFusionRootStatus).toBe("VERIFIED")
  })

  it("does not turn a nonempty but invalid root into a connected claim", async () => {
    seams.resolveBinding.mockResolvedValueOnce({ ok: false, error: "WORKSPACE_ROOT_PROJECT_MISMATCH" })
    const response = await GET(new Request("http://localhost:3000/api/setup/local-status"))
    const body = await response.json()

    expect(body.terraFusionRootConfigured).toBe(false)
    expect(body.terraFusionRootStatus).toBe("WORKSPACE_ROOT_PROJECT_MISMATCH")
  })

  it("does not expose a connected claim to a non-owner session", async () => {
    seams.assertOwner.mockReturnValueOnce({ ok: false, failure: "NOT_OWNER", detail: "owner mismatch" })
    const response = await GET(new Request("http://localhost:3000/api/setup/local-status"))
    const body = await response.json()

    expect(body.terraFusionRootConfigured).toBe(false)
    expect(body.terraFusionRootStatus).toBe("NOT_OWNER")
    expect(seams.resolveBinding).not.toHaveBeenCalled()
  })
})
