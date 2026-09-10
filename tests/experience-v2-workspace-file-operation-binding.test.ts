import { describe, expect, it, vi } from "vitest"

import {
  resolveWorkspaceFileOperationBinding,
  WorkspaceFileOperationBindingError,
} from "@/lib/loom/workspace-file-operation-binding"

const revision = "a".repeat(40)
const binding = {
  projectId: 2, projectKey: "terrafusion", projectName: "TerraFusion", repositoryResourceId: 11,
  repositoryKey: "atlas", repositoryIdentity: "bsvalues/terrafusion-atlas", repositoryRole: "suite-source",
  repositoryLabel: "Atlas", repositoryPreviewSource: false, repositoryMountKey: "terrafusion:atlas:configured",
  observedRevision: revision, configuredWorkspaceRoot: "C:/atlas", workspaceRoot: "C:/atlas", workspaceAppUrl: null,
  project: { identity: "terrafusion-project", name: "TerraFusion" },
} as const
const fileRef = {
  projectIdentity: "terrafusion-project", repositoryResourceKey: "atlas",
  repositoryMountKey: "terrafusion:atlas:configured", worktreeKey: null,
  observedRevision: revision, path: "src/atlas.ts",
} as const

describe("repository-qualified selected-file operation binding", () => {
  it("resolves the exact selected repository instead of defaulting the path to OS 1.0", async () => {
    const resolve = vi.fn(async () => ({ ok: true as const, binding }))
    const result = await resolveWorkspaceFileOperationBinding({
      userId: "owner-1", projectKey: "terrafusion", repositoryKey: "atlas", path: "src/atlas.ts", fileRef,
    }, resolve)

    expect(resolve).toHaveBeenCalledWith("owner-1", "terrafusion", undefined, "atlas")
    expect(result).toEqual({ binding, fileRef })
  })

  it.each([
    ["missing ref", { fileRef: undefined }, "WORKSPACE_FILE_REF_REQUIRED"],
    ["different path", { path: "src/other.ts" }, "WORKSPACE_FILE_REF_MISMATCH"],
    ["different repository", { repositoryKey: "os-1" }, "WORKSPACE_FILE_REF_MISMATCH"],
    ["worktree claim", { fileRef: { ...fileRef, worktreeKey: "agent-worktree" } }, "WORKSPACE_FILE_REF_MISMATCH"],
  ])("fails closed for %s", async (_label, override, code) => {
    await expect(resolveWorkspaceFileOperationBinding({
      userId: "owner-1", projectKey: "terrafusion", repositoryKey: "atlas", path: "src/atlas.ts", fileRef,
      ...override,
    }, async () => ({ ok: true, binding }))).rejects.toMatchObject({ code })
  })

  it("rejects a mount whose current revision changed after the file was selected", async () => {
    await expect(resolveWorkspaceFileOperationBinding({
      userId: "owner-1", projectKey: "terrafusion", repositoryKey: "atlas", path: "src/atlas.ts", fileRef,
    }, async () => ({ ok: true, binding: { ...binding, observedRevision: "b".repeat(40) } })))
      .rejects.toEqual(new WorkspaceFileOperationBindingError("WORKSPACE_FILE_REF_STALE"))
  })
})
