import { afterEach, describe, expect, it } from "vitest"

import {
  normalizeRepositoryIdentity,
  resolveTerraFusionWorkspaceBinding,
  type WorkspaceProjectBindingDependencies,
} from "@/lib/projects/workspace-project-binding"

const originalRoot = process.env.WILLIAMOS_TERRAFUSION_ROOT

afterEach(() => {
  if (originalRoot === undefined) delete process.env.WILLIAMOS_TERRAFUSION_ROOT
  else process.env.WILLIAMOS_TERRAFUSION_ROOT = originalRoot
})

function dependencies(
  rows: readonly Readonly<{
    projectId: number
    projectKey: string
    projectName: string
    repositoryIdentity: string
  }>[] = [{
    projectId: 2,
    projectKey: "terrafusion",
    projectName: "TerraFusion OS",
    repositoryIdentity: "bsvalues/terrafusion_os_1.0",
  }],
  remote = "git@github.com:bsvalues/terrafusion_os_1.0.git",
): WorkspaceProjectBindingDependencies {
  return {
    loadProjectRows: async () => rows,
    readGitRemoteOrigin: async () => remote,
    readGitTopLevel: async (root) => root,
    realpath: async (root) => root,
  }
}

describe("TerraFusion workspace Project binding", () => {
  it.each([
    "bsvalues/terrafusion_os_1.0",
    "git@github.com:bsvalues/terrafusion_os_1.0.git",
    "https://github.com/bsvalues/terrafusion_os_1.0.git",
    "ssh://git@ssh.github.com:443/bsvalues/terrafusion_os_1.0.git",
  ])("normalizes supported canonical repository identity %s", (value) => {
    expect(normalizeRepositoryIdentity(value)).toBe("bsvalues/terrafusion_os_1.0")
  })

  it.each([
    "ssh://owner@ssh.github.com:443/bsvalues/terrafusion_os_1.0.git",
    "ssh://git@ssh.github.com:22/bsvalues/terrafusion_os_1.0.git",
    "https://ssh.github.com:443/bsvalues/terrafusion_os_1.0.git",
  ])("refuses a non-canonical SSH-over-443 identity %s", (value) => {
    expect(normalizeRepositoryIdentity(value)).toBeNull()
  })

  it("binds the durable Project only after the configured checkout origin matches", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    const result = await resolveTerraFusionWorkspaceBinding("owner", dependencies())

    expect(result).toEqual({
      ok: true,
      binding: expect.objectContaining({
        projectId: 2,
        projectKey: "terrafusion",
        projectName: "TerraFusion OS",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        workspaceRoot: expect.stringMatching(/terrafusion_os_1\.0$/),
        project: expect.objectContaining({
          identity: expect.stringMatching(/terrafusion_os_1\.0$/),
          name: "TerraFusion OS",
        }),
      }),
    })
  })

  it("refuses an absent configured checkout instead of falling back to WilliamOS cwd", async () => {
    delete process.env.WILLIAMOS_TERRAFUSION_ROOT
    await expect(resolveTerraFusionWorkspaceBinding("owner", dependencies()))
      .resolves.toEqual({ ok: false, error: "WORKSPACE_ROOT_NOT_CONFIGURED" })
  })

  it("refuses a checkout whose origin is not the Project primary repository", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/william-os-devops"
    await expect(resolveTerraFusionWorkspaceBinding(
      "owner",
      dependencies(undefined, "git@github.com:bsvalues/terragroq.git"),
    )).resolves.toEqual({ ok: false, error: "WORKSPACE_ROOT_PROJECT_MISMATCH" })
  })

  it("refuses missing and ambiguous primary Project bindings", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    await expect(resolveTerraFusionWorkspaceBinding("owner", dependencies([])))
      .resolves.toEqual({ ok: false, error: "TERRAFUSION_PROJECT_UNBOUND" })
    const row = {
      projectId: 2, projectKey: "terrafusion", projectName: "TerraFusion OS",
      repositoryIdentity: "bsvalues/terrafusion_os_1.0",
    }
    await expect(resolveTerraFusionWorkspaceBinding("owner", dependencies([row, row])))
      .resolves.toEqual({ ok: false, error: "TERRAFUSION_PRIMARY_REPO_AMBIGUOUS" })
  })

  it("returns a typed refusal when durable Project lookup is unavailable", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    await expect(resolveTerraFusionWorkspaceBinding("owner", {
      loadProjectRows: async () => { throw new Error("database address") },
      readGitRemoteOrigin: async () => "git@github.com:bsvalues/terrafusion_os_1.0.git",
      readGitTopLevel: async (root) => root,
      realpath: async (root) => root,
    })).resolves.toEqual({ ok: false, error: "WORKSPACE_PROJECT_LOOKUP_UNAVAILABLE" })
  })

  it("refuses a nested directory even when it inherits the canonical repository remote", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0/frontend"
    const seams = dependencies()
    await expect(resolveTerraFusionWorkspaceBinding("owner", {
      ...seams,
      readGitTopLevel: async () => "/repos/terrafusion_os_1.0",
    })).resolves.toEqual({ ok: false, error: "WORKSPACE_ROOT_NOT_REPOSITORY_ROOT" })
  })

  it("keeps the configured-path Space identity while operating on a verified symlink target", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/links/terrafusion"
    const seams = dependencies()
    const result = await resolveTerraFusionWorkspaceBinding("owner", {
      ...seams,
      readGitTopLevel: async (root) => root.replace(/[\\/]links[\\/]/, "/physical/"),
      realpath: async (root) => root.replace(/[\\/]links[\\/]/, "/physical/"),
    })

    expect(result).toEqual({
      ok: true,
      binding: expect.objectContaining({
        workspaceRoot: expect.stringMatching(/physical[\\/]terrafusion$/),
        project: {
          identity: expect.stringMatching(/links[\\/]terrafusion$/),
          name: "TerraFusion OS",
        },
      }),
    })
  })
})
