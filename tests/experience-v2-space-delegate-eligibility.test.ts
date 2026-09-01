import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveBinding: vi.fn(),
  deriveAuthority: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveTerraFusionWorkspaceBinding: seams.resolveBinding,
}))
vi.mock("@/lib/governance/space-mutation-authority", () => ({
  deriveSpaceMutationAuthority: seams.deriveAuthority,
  SpaceMutationAuthorityError: class SpaceMutationAuthorityError extends Error {
    readonly code = "SPACE_MUTATION_AUTHORITY_REFUSED"
  },
}))

import { GET } from "@/app/api/loom/agent/route"

const binding = {
  projectId: 7,
  projectKey: "williamos",
  repositoryIdentity: "repo:williamos",
  project: { identity: "c:/repos/williamos" },
}

beforeEach(() => {
  vi.clearAllMocks()
  seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
  seams.resolveBinding.mockResolvedValue({ ok: true, binding })
  seams.deriveAuthority.mockResolvedValue({
    owner: "owner-1", worldId: "world-a", worldRevision: 9,
    projectId: 7, projectKey: "williamos", repositoryIdentity: "repo:williamos",
    outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1121, grantId: 44,
    actor: "codex", selectedPath: "src/app.ts",
  })
})

describe("Space Delegate exact-path eligibility", () => {
  it("projects only the exact server-derived Codex selected-file authority", async () => {
    const response = await GET(new Request("http://localhost/api/loom/agent?worldId=world-a&actor=codex&path=src%2Fapp.ts"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      eligible: true,
      worldId: "world-a",
      worldRevision: 9,
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      workOrderId: 1121,
      grantId: 44,
      actor: "codex",
      selectedPath: "src/app.ts",
    })
    expect(seams.deriveAuthority).toHaveBeenCalledWith({
      userId: "owner-1",
      worldId: "world-a",
      binding: {
        projectId: 7, projectKey: "williamos",
        repositoryIdentity: "repo:williamos", spaceIdentity: "c:/repos/williamos",
      },
      expected: { actor: "codex", capability: "selected-file-change" },
      target: { kind: "selected-file", requestedPath: "src/app.ts" },
    })
  })

  it("projects the independently derived Claude selected-file authority without reusing Codex proof", async () => {
    seams.deriveAuthority.mockResolvedValue({
      owner: "owner-1", worldId: "world-a", worldRevision: 9,
      projectId: 7, projectKey: "williamos", repositoryIdentity: "repo:williamos",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1121, grantId: 45,
      actor: "claude", selectedPath: "src/app.ts",
    })

    const response = await GET(new Request("http://localhost/api/loom/agent?worldId=world-a&actor=claude&path=src%2Fapp.ts"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      eligible: true, actor: "claude", grantId: 45, selectedPath: "src/app.ts",
    }))
    expect(seams.deriveAuthority).toHaveBeenCalledWith(expect.objectContaining({
      expected: { actor: "claude", capability: "selected-file-change" },
    }))
  })

  it("returns a non-sensitive ineligible projection when exact authority is refused", async () => {
    const AuthorityError = (await import("@/lib/governance/space-mutation-authority")).SpaceMutationAuthorityError
    seams.deriveAuthority.mockRejectedValue(new AuthorityError("secret reservation details"))

    const response = await GET(new Request("http://localhost/api/loom/agent?worldId=world-a&actor=codex&path=src%2Fapp.ts"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ eligible: false, reason: "EXACT_PATH_AUTHORITY_UNAVAILABLE" })
  })

  it("rejects a sensitive canonical selected path before authority derivation", async () => {
    const response = await GET(new Request("http://localhost/api/loom/agent?worldId=world-a&actor=codex&path=.env"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ eligible: false, reason: "EXACT_PATH_AUTHORITY_UNAVAILABLE" })
    expect(seams.deriveAuthority).not.toHaveBeenCalled()
  })

  it.each([
    ["missing world", "http://localhost/api/loom/agent?actor=codex&path=src%2Fapp.ts"],
    ["unsupported actor", "http://localhost/api/loom/agent?worldId=world-a&actor=sea&path=src%2Fapp.ts"],
    ["non-canonical path", "http://localhost/api/loom/agent?worldId=world-a&actor=codex&path=%20src%2Fapp.ts"],
    ["client-authored authority field", "http://localhost/api/loom/agent?worldId=world-a&actor=codex&path=src%2Fapp.ts&grantId=44"],
    ["duplicate world guard", "http://localhost/api/loom/agent?worldId=world-a&worldId=world-b&actor=codex&path=src%2Fapp.ts"],
  ])("fails closed for %s", async (_label, url) => {
    const response = await GET(new Request(url))
    expect(response.status).toBe(400)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ eligible: false, reason: "ELIGIBILITY_REQUEST_INVALID" })
    expect(seams.deriveAuthority).not.toHaveBeenCalled()
  })
})
