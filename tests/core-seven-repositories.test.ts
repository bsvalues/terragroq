import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { buildCanonicalOwnerProjectPlan } from "@/lib/projects/canonical-owner-projects.mjs"
import {
  CORE_SEVEN_REPOSITORIES,
  resolveWorkspaceRepositorySelection,
} from "@/lib/projects/core-seven-repositories"

const temporaryRoots: string[] = []

afterEach(async () => {
  vi.resetModules()
  vi.doUnmock("@/lib/session")
  vi.doUnmock("@/lib/projects/workspace-project-binding")
  vi.doUnmock("@/lib/governance/owner")
  vi.doUnmock("@/lib/governance/owner-lookup")
  vi.doUnmock("@/lib/loom/manual-owner-file-save")
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("TerraFusion Core Seven repository catalog", () => {
  it("provisions the seven role-qualified repositories without promoting TerraFusionSync", () => {
    const plan = buildCanonicalOwnerProjectPlan("owner")
    const repositories = plan.resources
      .filter((resource) => resource.projectKey === "terrafusion" && resource.type === "repo")
      .map(({ canonicalIdentity, resourceKey, role, previewSource }) => ({
        canonicalIdentity,
        resourceKey,
        role,
        previewSource,
      }))

    expect(repositories).toEqual([
      {
        canonicalIdentity: "bsvalues/terrafusion_os_1.0",
        resourceKey: "os-1",
        role: "integrated-runtime",
        previewSource: true,
      },
      {
        canonicalIdentity: "bsvalues/terrafusion-os",
        resourceKey: "sovereign-os",
        role: "sovereign-planning-and-promotion",
        previewSource: false,
      },
      {
        canonicalIdentity: "bsvalues/terrafusion-forge",
        resourceKey: "forge",
        role: "suite-source",
        previewSource: false,
      },
      {
        canonicalIdentity: "bsvalues/terrafusion-atlas",
        resourceKey: "atlas",
        role: "suite-source",
        previewSource: false,
      },
      {
        canonicalIdentity: "bsvalues/terrafusion-dais",
        resourceKey: "dais",
        role: "suite-source",
        previewSource: false,
      },
      {
        canonicalIdentity: "bsvalues/terrafusion-dossier",
        resourceKey: "dossier",
        role: "suite-source",
        previewSource: false,
      },
      {
        canonicalIdentity: "bsvalues/terrafusion-gpt",
        resourceKey: "gpt",
        role: "suite-source",
        previewSource: false,
      },
    ])
    expect(plan.resources.some((resource) => /terrafusionsync/i.test(resource.canonicalIdentity))).toBe(false)
  })

  it("defaults TerraFusion to the integrated runtime and refuses unknown repository keys", () => {
    expect(CORE_SEVEN_REPOSITORIES).toHaveLength(7)
    expect(CORE_SEVEN_REPOSITORIES.map(({ key, label }) => [key, label])).toEqual([
      ["os-1", "OS 1.0"],
      ["sovereign-os", "Sovereign OS"],
      ["forge", "Forge"],
      ["atlas", "Atlas"],
      ["dais", "Dais"],
      ["dossier", "Dossier"],
      ["gpt", "GPT"],
    ])
    expect(resolveWorkspaceRepositorySelection("terrafusion", undefined)).toEqual({
      ok: true,
      repository: expect.objectContaining({
        key: "os-1",
        identity: "bsvalues/terrafusion_os_1.0",
        role: "integrated-runtime",
        previewSource: true,
        configuredRootEnvironment: "WILLIAMOS_TERRAFUSION_ROOT",
      }),
    })
    expect(resolveWorkspaceRepositorySelection("terrafusion", "sovereign-os")).toEqual({
      ok: true,
      repository: expect.objectContaining({
        key: "sovereign-os",
        identity: "bsvalues/terrafusion-os",
        role: "sovereign-planning-and-promotion",
        previewSource: false,
      }),
    })
    expect(resolveWorkspaceRepositorySelection("terrafusion", "TerraFusionSync"))
      .toEqual({ ok: false, error: "WORKSPACE_REPOSITORY_UNKNOWN" })
  })

  it("reads a file only from the selected repository mount and returns its qualified identity", async () => {
    const atlasRoot = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-atlas-mount-"))
    temporaryRoots.push(atlasRoot)
    await fs.writeFile(path.join(atlasRoot, "README.md"), "Atlas source\n")
    const resolveBinding = vi.fn(async () => ({ ok: true, binding: {
      workspaceRoot: atlasRoot,
      project: { identity: "c:/terrafusion", name: "TerraFusion OS" },
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryRole: "suite-source",
      repositoryLabel: "Atlas",
      repositoryPreviewSource: false,
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: "a".repeat(40),
    } }))
    vi.resetModules()
    vi.doMock("@/lib/session", () => ({ getSession: async () => ({ user: { id: "owner" } }) }))
    vi.doMock("@/lib/projects/workspace-project-binding", () => ({
      resolveCanonicalWorkspaceProjectBinding: resolveBinding,
    }))
    const { GET } = await import("@/app/api/loom/files/route")

    const response = await GET(new Request(
      "http://localhost/api/loom/files?projectKey=terrafusion&repositoryKey=atlas&path=README.md",
    ))

    expect(response.status).toBe(200)
    expect(resolveBinding).toHaveBeenCalledWith("owner", "terrafusion", undefined, "atlas")
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      kind: "file",
      path: "README.md",
      content: "Atlas source\n",
      repository: {
        key: "atlas",
        identity: "bsvalues/terrafusion-atlas",
        role: "suite-source",
        label: "Atlas",
        previewSource: false,
        mountKey: "terrafusion:atlas:configured",
        observedRevision: "a".repeat(40),
      },
    }))
  })

  it("saves only through the exact repository-qualified file reference that was opened", async () => {
    const resolveBinding = vi.fn(async () => ({ ok: true, binding: {
      workspaceRoot: "C:/mounts/terrafusion-atlas",
      project: { identity: "c:/terrafusion", name: "TerraFusion OS" },
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryRole: "suite-source",
      repositoryLabel: "Atlas",
      repositoryPreviewSource: false,
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: "a".repeat(40),
    } }))
    const write = vi.fn(async () => ({
      ok: true,
      path: "README.md",
      name: "README.md",
      modifiedAt: "2026-09-02T12:00:00.000Z",
    }))
    vi.resetModules()
    vi.doMock("@/lib/session", () => ({ getSession: async () => ({ user: { id: "owner" } }) }))
    vi.doMock("@/lib/projects/workspace-project-binding", () => ({
      resolveCanonicalWorkspaceProjectBinding: resolveBinding,
    }))
    vi.doMock("@/lib/governance/owner", () => ({
      resolveOwnerUserId: async () => "owner",
      assertOwner: () => ({ ok: true }),
    }))
    vi.doMock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
    vi.doMock("@/lib/loom/manual-owner-file-save", () => ({ writeManualOwnerWorkspaceFile: write }))
    const { PUT } = await import("@/app/api/loom/files/route")

    const fileRef = {
      projectIdentity: "c:/terrafusion",
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: "a".repeat(40),
      path: "README.md",
    }
    const response = await PUT(new Request("http://localhost/api/loom/files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectKey: "terrafusion",
        fileRef,
        content: "updated Atlas\n",
        modifiedAt: "2026-09-02T11:00:00.000Z",
      }),
    }))

    expect(response.status).toBe(200)
    expect(resolveBinding).toHaveBeenCalledWith("owner", "terrafusion", undefined, "atlas")
    expect(write).toHaveBeenCalledWith({
      path: "README.md",
      content: "updated Atlas\n",
      modifiedAt: "2026-09-02T11:00:00.000Z",
    }, "C:/mounts/terrafusion-atlas")
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      repository: expect.objectContaining({ key: "atlas", mountKey: "terrafusion:atlas:configured" }),
      fileRef,
    }))
  })

  it.each([
    ["project identity", { projectIdentity: "c:/another-project" }],
    ["repository resource", { repositoryResourceKey: "dais" }],
    ["mount", { repositoryMountKey: "terrafusion:atlas:other" }],
    ["worktree", { worktreeKey: "worktree:atlas:other" }],
    ["revision", { observedRevision: "b".repeat(40) }],
  ])("refuses a save when the opened file's %s no longer matches the server binding", async (_label, changed) => {
    const resolveBinding = vi.fn(async () => ({ ok: true, binding: {
      workspaceRoot: "C:/mounts/terrafusion-atlas",
      project: { identity: "c:/terrafusion", name: "TerraFusion OS" },
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryRole: "suite-source",
      repositoryLabel: "Atlas",
      repositoryPreviewSource: false,
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: "a".repeat(40),
    } }))
    const write = vi.fn()
    vi.resetModules()
    vi.doMock("@/lib/session", () => ({ getSession: async () => ({ user: { id: "owner" } }) }))
    vi.doMock("@/lib/projects/workspace-project-binding", () => ({
      resolveCanonicalWorkspaceProjectBinding: resolveBinding,
    }))
    vi.doMock("@/lib/governance/owner", () => ({
      resolveOwnerUserId: async () => "owner",
      assertOwner: () => ({ ok: true }),
    }))
    vi.doMock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
    vi.doMock("@/lib/loom/manual-owner-file-save", () => ({ writeManualOwnerWorkspaceFile: write }))
    const { PUT } = await import("@/app/api/loom/files/route")
    const response = await PUT(new Request("http://localhost/api/loom/files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectKey: "terrafusion",
        fileRef: {
          projectIdentity: "c:/terrafusion",
          repositoryResourceKey: "atlas",
          repositoryMountKey: "terrafusion:atlas:configured",
          worktreeKey: null,
          observedRevision: "a".repeat(40),
          path: "README.md",
          ...changed,
        },
        content: "must not be written\n",
        modifiedAt: "2026-09-02T11:00:00.000Z",
      }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "WORKSPACE_FILE_REF_STALE" })
    expect(write).not.toHaveBeenCalled()
  })

  it("refuses a path-only save because it cannot prove which mounted file was opened", async () => {
    const write = vi.fn()
    vi.resetModules()
    vi.doMock("@/lib/session", () => ({ getSession: async () => ({ user: { id: "owner" } }) }))
    vi.doMock("@/lib/governance/owner", () => ({
      resolveOwnerUserId: async () => "owner",
      assertOwner: () => ({ ok: true }),
    }))
    vi.doMock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
    vi.doMock("@/lib/loom/manual-owner-file-save", () => ({ writeManualOwnerWorkspaceFile: write }))
    const { PUT } = await import("@/app/api/loom/files/route")

    const response = await PUT(new Request("http://localhost/api/loom/files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectKey: "terrafusion",
        repositoryKey: "atlas",
        path: "README.md",
        content: "must not be written\n",
        modifiedAt: "2026-09-02T11:00:00.000Z",
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "WORKSPACE_FILE_REF_REQUIRED" })
    expect(write).not.toHaveBeenCalled()
  })
})
