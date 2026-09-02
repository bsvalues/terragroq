import { beforeEach, describe, expect, it, vi } from "vitest"

const sessionMocks = vi.hoisted(() => ({ getSession: vi.fn() }))
const bindingMocks = vi.hoisted(() => ({ resolve: vi.fn() }))
const ownerMocks = vi.hoisted(() => ({
  assertOwner: vi.fn(),
  resolveOwnerUserId: vi.fn(),
}))
const writeMocks = vi.hoisted(() => ({
  governed: vi.fn(),
  manual: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: sessionMocks.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({ resolveCanonicalWorkspaceProjectBinding: bindingMocks.resolve }))
vi.mock("@/lib/governance/owner", () => ownerMocks)
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/loom/workspace-file-write", () => ({
  workspaceFileWriteDependencies: vi.fn(() => ({})),
  writeGovernedWorkspaceFile: writeMocks.governed,
}))
vi.mock("@/lib/loom/manual-owner-file-save", () => ({
  writeManualOwnerWorkspaceFile: writeMocks.manual,
}))

import { PUT } from "@/app/api/loom/files/route"

describe("manual owner file-save route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionMocks.getSession.mockResolvedValue({ user: { id: "member-a", email: "member@example.test" } })
    bindingMocks.resolve.mockResolvedValue({ ok: true, binding: {
      workspaceRoot: "C:/project",
      project: { identity: "c:/project", name: "TerraFusion OS" },
    } })
    ownerMocks.resolveOwnerUserId.mockResolvedValue("owner-a")
    ownerMocks.assertOwner.mockReturnValue({ ok: false, failure: "NOT_OWNER", detail: "owner session required" })
    writeMocks.governed.mockResolvedValue({ ok: true, path: "src/real.ts", modifiedAt: "2026-08-27T18:00:00.000Z", name: "real.ts" })
    writeMocks.manual.mockResolvedValue({ ok: true, path: "src/real.ts", modifiedAt: "2026-08-27T18:00:00.000Z", name: "real.ts" })
  })

  it("refuses a signed-in non-owner before the file adapter can mutate", async () => {
    const response = await PUT(new Request("http://localhost/api/loom/files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "src/real.ts", content: "changed\n" }),
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "NOT_OWNER" })
    expect(writeMocks.manual).not.toHaveBeenCalled()
  })
})
