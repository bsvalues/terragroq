import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveBinding: vi.fn(),
  deriveAuthority: vi.fn(),
  threadDescriptor: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveCanonicalWorkspaceProjectBinding: seams.resolveBinding,
}))
vi.mock("@/lib/governance/space-mutation-authority", () => ({
  deriveSpaceMutationAuthority: seams.deriveAuthority,
  SpaceMutationAuthorityError: class SpaceMutationAuthorityError extends Error {
    readonly code = "SPACE_MUTATION_AUTHORITY_REFUSED"
  },
}))
vi.mock("@/lib/loom/threads", async () => ({
  ...await vi.importActual<typeof import("@/lib/loom/threads")>("@/lib/loom/threads"),
  loomThreadDescriptor: seams.threadDescriptor,
}))

import { GET, POST } from "@/app/api/loom/agent/route"

const revision = "a".repeat(40)
const binding = {
  projectId: 7,
  projectKey: "terrafusion",
  repositoryKey: "atlas",
  repositoryIdentity: "bsvalues/terrafusion-atlas",
  repositoryMountKey: "terrafusion:atlas:configured",
  observedRevision: revision,
  project: { identity: "c:/terrafusion", name: "TerraFusion" },
  workspaceRoot: process.cwd(),
  configuredWorkspaceRoot: process.cwd(),
}

const authority = {
  owner: "owner-1",
  worldId: "space-atlas",
  worldRevision: 12,
  projectId: 7,
  projectKey: "terrafusion",
  repositoryResourceKey: "atlas",
  repositoryIdentity: "bsvalues/terrafusion-atlas",
  repositoryMountKey: "terrafusion:atlas:configured",
  observedRevision: revision,
  outcomeKey: "OUTCOME-ATLAS",
  workOrderId: 41,
  grantId: 51,
  actor: "claude",
  selectedPath: "src/project-atlas-feature.mjs",
}

describe("repository-qualified Claude assignment route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.resolveBinding.mockResolvedValue({ ok: true, binding })
    seams.deriveAuthority.mockResolvedValue(authority)
    seams.threadDescriptor.mockResolvedValue(null)
  })

  it("projects eligibility only for the exact server-resolved repository selection", async () => {
    const response = await GET(new Request(
      "http://williamos.test/api/loom/agent?worldId=space-atlas&actor=claude&path=src%2Fproject-atlas-feature.mjs&projectKey=terrafusion&repositoryKey=atlas",
    ))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      eligible: true,
      repositoryResourceKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: revision,
    })
    expect(seams.resolveBinding).toHaveBeenCalledWith("owner-1", "terrafusion", undefined, "atlas")
    expect(seams.deriveAuthority).toHaveBeenCalledWith(expect.objectContaining({
      binding: {
        projectId: 7,
        projectKey: "terrafusion",
        repositoryResourceKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        repositoryMountKey: "terrafusion:atlas:configured",
        observedRevision: revision,
        spaceIdentity: "c:/terrafusion",
      },
    }))
  })

  it("resolves generic cloud execution against the same exact repository before provider work", async () => {
    seams.deriveAuthority.mockRejectedValue(new Error("test stop before provider"))

    const response = await POST(new Request("http://williamos.test/api/loom/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "cloud",
        worldId: "space-atlas",
        projectKey: "terrafusion",
        repositoryKey: "atlas",
        prompt: "Change the selected Atlas file.",
      }),
    }))

    expect(response.status).toBe(503)
    expect(seams.resolveBinding).toHaveBeenCalledWith("owner-1", "terrafusion", undefined, "atlas")
    expect(seams.deriveAuthority).toHaveBeenCalledWith(expect.objectContaining({
      worldId: "space-atlas",
      binding: {
        projectId: 7,
        projectKey: "terrafusion",
        repositoryResourceKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        repositoryMountKey: "terrafusion:atlas:configured",
        observedRevision: revision,
        spaceIdentity: "c:/terrafusion",
      },
    }))
  })

  it.each([
    ["root", "workspaceRoot", "C:/attacker"],
    ["role", "repositoryRole", "integrated-runtime"],
    ["remote", "repositoryIdentity", "attacker/repository"],
  ])("rejects a client-authored repository %s from eligibility", async (_label, key, value) => {
    const url = new URL(
      "http://williamos.test/api/loom/agent?worldId=space-atlas&actor=claude&path=src%2Fproject-atlas-feature.mjs&projectKey=terrafusion&repositoryKey=atlas",
    )
    url.searchParams.set(key, value)
    const response = await GET(new Request(url))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ eligible: false, reason: "ELIGIBILITY_REQUEST_INVALID" })
    expect(seams.resolveBinding).not.toHaveBeenCalled()
  })

  it.each([
    ["root", { workspaceRoot: "C:/attacker" }],
    ["role", { repositoryRole: "integrated-runtime" }],
    ["remote", { repositoryIdentity: "attacker/repository" }],
  ])("rejects a client-authored repository %s from execution", async (_label, extra) => {
    const response = await POST(new Request("http://williamos.test/api/loom/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "cloud",
        worldId: "space-atlas",
        projectKey: "terrafusion",
        repositoryKey: "atlas",
        prompt: "Change the selected Atlas file.",
        ...extra,
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "BAD_REQUEST" })
    expect(seams.resolveBinding).not.toHaveBeenCalled()
  })

  it("refuses to resume a Claude session recorded for another repository", async () => {
    seams.threadDescriptor.mockResolvedValue({
      owner: "owner-1",
      provider: "cloud",
      mode: "agent",
      worldId: "space-atlas",
      path: "src/project-atlas-feature.mjs",
      repositoryResourceKey: "forge",
      repositoryIdentity: "bsvalues/terrafusion-forge",
      repositoryMountKey: "terrafusion:forge:configured",
      observedRevision: "b".repeat(40),
    })

    const response = await POST(new Request("http://williamos.test/api/loom/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "cloud",
        worldId: "space-atlas",
        projectKey: "terrafusion",
        repositoryKey: "atlas",
        prompt: "Continue the selected Atlas file.",
        sessionId: "123e4567-e89b-42d3-a456-426614174000",
        resume: true,
      }),
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "THREAD_CONTEXT_MISMATCH" })
  })
})
