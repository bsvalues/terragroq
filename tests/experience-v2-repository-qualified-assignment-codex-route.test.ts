import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveBinding: vi.fn(),
  deriveAuthority: vi.fn(),
  deriveAssignment: vi.fn(),
  continuationDependencies: vi.fn(),
  threadDescriptor: vi.fn(),
  reservationClaims: vi.fn(),
  assessReservation: vi.fn(),
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
vi.mock("@/lib/loom/codex-assignment", () => ({
  deriveCodexAssignment: seams.deriveAssignment,
  deriveCodexAssignmentForVerifiedRootAlias: vi.fn(),
  revalidateCodexAssignment: vi.fn(),
}))
vi.mock("@/lib/loom/codex-continuation", () => ({
  prepareCodexContinuation: vi.fn(),
  readCodexContinuation: vi.fn(),
}))
vi.mock("@/lib/loom/codex-continuation-runtime", () => ({
  acquireCodexContinuationClaim: vi.fn(),
  codexContinuationDependenciesForProjectRoot: seams.continuationDependencies,
}))
vi.mock("@/lib/loom/codex-isolated-workspace", () => ({
  cleanupCodexIsolatedWorkspace: vi.fn(),
  createCodexIsolatedWorkspace: vi.fn(),
  inspectCodexIsolatedWorkspace: vi.fn(),
}))
vi.mock("@/lib/loom/workspace-file-write", () => ({
  workspaceFileWriteDependencies: vi.fn(),
  writeGovernedWorkspaceFile: vi.fn(),
}))
vi.mock("@/lib/loom/receipts", () => ({
  commitLoomCodexSuccess: vi.fn(),
  recordLoomCodexAssignment: vi.fn(),
  recordLoomEnd: vi.fn(),
}))
vi.mock("@/lib/loom/threads", () => ({ loomCodexThreadDescriptor: seams.threadDescriptor }))
vi.mock("@/lib/loom/repository-assignment-runtime", () => ({
  deriveRepositoryAssignmentReservationClaims: seams.reservationClaims,
  assessActiveRepositoryAssignment: seams.assessReservation,
}))
vi.mock("@/scripts/hermes-bridge/app-server-client.mjs", () => ({
  CodexAppServerClient: class {},
  sanitizeAppServerText: (value: unknown) => String(value ?? ""),
}))

import { POST } from "@/app/api/loom/codex/route"

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

describe("repository-qualified Codex assignment route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.resolveBinding.mockResolvedValue({ ok: true, binding })
    seams.continuationDependencies.mockReturnValue({ project: "atlas" })
    seams.reservationClaims.mockResolvedValue({ contracts: [], environments: [] })
    seams.assessReservation.mockResolvedValue({ status: "COMPATIBLE", activeAssignments: [], dependencies: [] })
    seams.deriveAuthority.mockResolvedValue({
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
      actor: "codex",
      selectedPath: "src/project-atlas-feature.mjs",
    })
    seams.deriveAssignment.mockRejectedValue(Object.assign(new Error("test stop"), {
      code: "CODEX_ASSIGNMENT_REFUSED",
    }))
  })

  it("resolves and derives one assignment against the browser-selected stable repository key", async () => {
    const response = await POST(new Request("http://williamos.test/api/loom/codex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        worldId: "space-atlas",
        projectKey: "terrafusion",
        repositoryKey: "atlas",
        prompt: "Implement the selected Atlas file.",
      }),
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "CODEX_ASSIGNMENT_REFUSED" })
    expect(seams.resolveBinding).toHaveBeenCalledWith("owner-1", "terrafusion", undefined, "atlas")
    expect(seams.deriveAuthority).toHaveBeenCalledWith({
      userId: "owner-1",
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
      expected: { actor: "codex", capability: "selected-file-change" },
      target: { kind: "selected-file" },
    })
    expect(seams.deriveAssignment).toHaveBeenCalledWith({
      userId: "owner-1",
      worldId: "space-atlas",
      projectRoot: process.cwd(),
      projectBinding: {
        projectId: 7,
        projectKey: "terrafusion",
        repositoryResourceKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        repositoryMountKey: "terrafusion:atlas:configured",
        observedRevision: revision,
        spaceIdentity: "c:/terrafusion",
      },
    })
  })

  it.each([
    ["root", { workspaceRoot: "C:/attacker" }],
    ["role", { repositoryRole: "integrated-runtime" }],
    ["remote", { repositoryIdentity: "attacker/repository" }],
  ])("rejects a client-authored repository %s instead of forwarding it", async (_label, extra) => {
    const response = await POST(new Request("http://williamos.test/api/loom/codex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        worldId: "space-atlas",
        projectKey: "terrafusion",
        repositoryKey: "atlas",
        prompt: "Implement the selected Atlas file.",
        ...extra,
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "BAD_REQUEST" })
    expect(seams.resolveBinding).not.toHaveBeenCalled()
  })

  it("refuses to resume a durable session recorded for a different repository mount", async () => {
    seams.deriveAssignment.mockResolvedValue({
      owner: "owner-1",
      worldId: "space-atlas",
      projectRoot: process.cwd(),
      outcomeKey: "OUTCOME-ATLAS",
      workOrderId: 41,
      grantId: 51,
      selectedPath: "src/project-atlas-feature.mjs",
      selectedFileRef: null,
      allowed: ["src/project-atlas-feature.mjs"],
      forbidden: [],
      binding: {
        spaceRevision: 12,
        outcomeId: 5,
        outcomeVersion: 1,
        workOrderRef: "WO-ATLAS-1",
        workOrderVersion: "2026-09-02T00:00:00.000Z",
        grantRef: "GRANT-ATLAS-1",
        grantVersion: "grant-version",
        reservationVersion: "f".repeat(64),
        projectId: 7,
        projectKey: "terrafusion",
        repositoryResourceKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        repositoryMountKey: "terrafusion:atlas:configured",
        observedRevision: revision,
        spaceIdentity: "c:/terrafusion",
      },
      assignmentHash: "b".repeat(64),
      target: { content: "before", modifiedAt: "2026-09-02TRect00:00:00.000Z", digest: "c".repeat(64) },
    })
    seams.threadDescriptor.mockResolvedValue({
      owner: "owner-1",
      provider: "Codex",
      mode: "delegate",
      workspace: process.cwd(),
      worldId: "space-atlas",
      outcomeKey: "OUTCOME-ATLAS",
      workOrderId: 41,
      grantId: 51,
      assignmentHash: "b".repeat(64),
      selectedPath: "src/project-atlas-feature.mjs",
      repositoryResourceKey: "forge",
      repositoryIdentity: "bsvalues/terrafusion-forge",
      repositoryMountKey: "terrafusion:forge:configured",
      observedRevision: "d".repeat(40),
    })

    const response = await POST(new Request("http://williamos.test/api/loom/codex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        worldId: "space-atlas",
        projectKey: "terrafusion",
        repositoryKey: "atlas",
        prompt: "Continue the selected Atlas file.",
        sessionId: "codex-thread-1",
        resume: true,
      }),
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "THREAD_DESCRIPTOR_MISMATCH" })
  })
})
