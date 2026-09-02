import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  readCodexContinuation: vi.fn(),
  loadOwnedWorkingWorld: vi.fn(),
  resolveProjectBinding: vi.fn(),
  dependenciesForProjectRoot: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/loom/codex-continuation", () => ({
  readCodexContinuation: seams.readCodexContinuation,
}))
vi.mock("@/lib/loom/codex-continuation-runtime", () => ({
  codexContinuationDependenciesForProjectRoot: seams.dependenciesForProjectRoot,
}))
vi.mock("@/lib/environment/space-persistence", () => ({
  loadOwnedWorkingWorld: seams.loadOwnedWorkingWorld,
}))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveCanonicalWorkspaceProjectBinding: seams.resolveProjectBinding,
}))

import { GET } from "@/app/api/loom/codex/continuation/route"

describe("Codex continuation restoration route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.resolveProjectBinding.mockResolvedValue({
      ok: true,
      binding: {
        workspaceRoot: "C:/physical/terrafusion", projectId: 7, projectName: "TerraFusion",
        project: { identity: "c:/terrafusion" },
      },
    })
    seams.loadOwnedWorkingWorld.mockResolvedValue({
      spine: { projectId: 7, projectName: "TerraFusion" },
      resources: ["williamos-workspace-root:v1:c:/terrafusion"],
    })
    seams.dependenciesForProjectRoot.mockReturnValue({ verified: "physical-terrafusion" })
  })

  it("restores the server-derived pending assignment for an owned Space", async () => {
    seams.readCodexContinuation.mockResolvedValue({
      status: "NEXT_ASSIGNMENT",
      selectedPath: "src/next.ts",
      task: "Continue the bound Work Order in src/next.ts.",
    })

    const response = await GET(new Request("http://williamos.test/api/loom/codex/continuation?worldId=world-1&projectKey=terrafusion"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "NEXT_ASSIGNMENT",
      selectedPath: "src/next.ts",
      task: "Continue the bound Work Order in src/next.ts.",
    })
    expect(seams.dependenciesForProjectRoot).toHaveBeenCalledWith("C:/physical/terrafusion")
    expect(seams.resolveProjectBinding).toHaveBeenCalledWith("owner-1", "terrafusion")
    expect(seams.readCodexContinuation).toHaveBeenCalledWith(
      "owner-1",
      "world-1",
      { verified: "physical-terrafusion" },
    )
  })

  it("does not expose continuation state without an authenticated owner session", async () => {
    seams.getSession.mockResolvedValue(null)

    const response = await GET(new Request("http://williamos.test/api/loom/codex/continuation?worldId=world-1&projectKey=terrafusion"))

    expect(response.status).toBe(401)
    expect(seams.readCodexContinuation).not.toHaveBeenCalled()
  })

  it("fails closed when the active project key is absent", async () => {
    const response = await GET(new Request("http://williamos.test/api/loom/codex/continuation?worldId=world-1"))

    expect(response.status).toBe(400)
    expect(seams.resolveProjectBinding).not.toHaveBeenCalled()
    expect(seams.readCodexContinuation).not.toHaveBeenCalled()
  })

  it("refuses continuation projection when the owned Space belongs to another project", async () => {
    seams.loadOwnedWorkingWorld.mockResolvedValue({
      spine: { projectId: 8, projectName: "WilliamOS" },
      resources: ["williamos-workspace-root:v1:c:/williamos"],
    })

    const response = await GET(new Request("http://williamos.test/api/loom/codex/continuation?worldId=world-1&projectKey=terrafusion"))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "WORLD_PROJECT_MISMATCH" })
    expect(seams.readCodexContinuation).not.toHaveBeenCalled()
  })
})
