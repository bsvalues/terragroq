import { afterEach, describe, expect, it } from "vitest"

import {
  normalizeRepositoryIdentity,
  resolveCanonicalWorkspaceProjectBinding,
  resolveTerraFusionWorkspaceBinding,
  resolveWilliamOsWorkspaceBinding,
  verifyCanonicalTerraFusionCheckout,
  type WorkspaceProjectBindingDependencies,
} from "@/lib/projects/workspace-project-binding"
import { normalizePortableAbsolutePathIdentity } from "@/lib/setup/project-root-env"

const originalRoot = process.env.WILLIAMOS_TERRAFUSION_ROOT
const originalSpaceIdentity = process.env.WILLIAMOS_TERRAFUSION_SPACE_IDENTITY
const originalWilliamOsRoot = process.env.WILLIAMOS_PROJECT_ROOT
const originalWilliamOsSpaceIdentity = process.env.WILLIAMOS_PROJECT_SPACE_IDENTITY
const originalAtlasRoot = process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT

afterEach(() => {
  if (originalRoot === undefined) delete process.env.WILLIAMOS_TERRAFUSION_ROOT
  else process.env.WILLIAMOS_TERRAFUSION_ROOT = originalRoot
  if (originalSpaceIdentity === undefined) delete process.env.WILLIAMOS_TERRAFUSION_SPACE_IDENTITY
  else process.env.WILLIAMOS_TERRAFUSION_SPACE_IDENTITY = originalSpaceIdentity
  if (originalWilliamOsRoot === undefined) delete process.env.WILLIAMOS_PROJECT_ROOT
  else process.env.WILLIAMOS_PROJECT_ROOT = originalWilliamOsRoot
  if (originalWilliamOsSpaceIdentity === undefined) delete process.env.WILLIAMOS_PROJECT_SPACE_IDENTITY
  else process.env.WILLIAMOS_PROJECT_SPACE_IDENTITY = originalWilliamOsSpaceIdentity
  if (originalAtlasRoot === undefined) delete process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT
  else process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT = originalAtlasRoot
})

function dependencies(
  rows: readonly Readonly<{
    projectId: number
    projectKey: string
    projectName: string
    repositoryIdentity: string
    repositoryKey?: string | null
    repositoryRelationship?: string
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
    readGitRevision: async () => "1".repeat(40),
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

  it("resolves an Atlas operation through its server-owned verified mount", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT = "/repos/terrafusion-atlas"
    const atlasRow = {
      projectId: 2,
      projectKey: "terrafusion",
      projectName: "TerraFusion OS",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryKey: "atlas",
      repositoryRelationship: "suite-source",
    }

    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner",
      "terrafusion",
      dependencies([atlasRow], "git@github.com:bsvalues/terrafusion-atlas.git"),
      "atlas",
    )).resolves.toEqual({
      ok: true,
      binding: expect.objectContaining({
        repositoryKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        repositoryRole: "suite-source",
        repositoryLabel: "Atlas",
        repositoryPreviewSource: false,
        repositoryMountKey: "terrafusion:atlas:configured",
        observedRevision: "1".repeat(40),
        workspaceRoot: expect.stringMatching(/repos[\\/]terrafusion-atlas$/),
      }),
    })
  })

  it("projects all Core Seven repositories with independent mount truth into the Space Project", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT = "/repos/terrafusion-atlas"
    const rows = [
      {
        projectId: 2,
        projectKey: "terrafusion",
        projectName: "TerraFusion OS",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        repositoryKey: "os-1",
        repositoryRelationship: "primary-repo",
      },
      {
        projectId: 2,
        projectKey: "terrafusion",
        projectName: "TerraFusion OS",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        repositoryKey: "atlas",
        repositoryRelationship: "suite-source",
      },
    ]
    const seams: WorkspaceProjectBindingDependencies = {
      loadProjectRows: async () => rows,
      readGitRemoteOrigin: async (root) => root.endsWith("terrafusion-atlas")
        ? "git@github.com:bsvalues/terrafusion-atlas.git"
        : "git@github.com:bsvalues/terrafusion_os_1.0.git",
      readGitTopLevel: async (root) => root,
      readGitRevision: async (root) => root.endsWith("terrafusion-atlas") ? "a".repeat(40) : "1".repeat(40),
      readGitBranch: async (root) => root.endsWith("terrafusion-atlas") ? "feature/atlas" : "main",
      realpath: async (root) => root,
    }

    const result = await resolveTerraFusionWorkspaceBinding("owner", seams)

    expect(result).toEqual({
      ok: true,
      binding: expect.objectContaining({
        project: expect.objectContaining({
          repositories: expect.arrayContaining([
            expect.objectContaining({
              key: "os-1",
              role: "integrated-runtime",
              previewSource: true,
              mount: {
                key: "terrafusion:os-1:configured",
                configured: true,
                verified: true,
                branch: "main",
                revision: "1".repeat(40),
                refusal: null,
              },
            }),
            expect.objectContaining({
              key: "atlas",
              role: "suite-source",
              mount: {
                key: "terrafusion:atlas:configured",
                configured: true,
                verified: true,
                branch: "feature/atlas",
                revision: "a".repeat(40),
                refusal: null,
              },
            }),
            expect.objectContaining({
              key: "sovereign-os",
              role: "sovereign-planning-and-promotion",
              previewSource: false,
              mount: {
                key: "terrafusion:sovereign-os:configured",
                configured: false,
                verified: false,
                branch: null,
                revision: null,
                refusal: "WORKSPACE_REPOSITORY_MOUNT_NOT_CONFIGURED",
              },
            }),
          ]),
        }),
      }),
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.binding.project.repositories).toHaveLength(7)
  })

  it("keeps explicitly attached historical repositories outside the Core Seven and read-only by default", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    const rows = [{
      projectId: 2,
      projectKey: "terrafusion",
      projectName: "TerraFusion OS",
      repositoryResourceId: 8,
      repositoryIdentity: "bsvalues/TerraFusionSync",
      repositoryKey: "terrafusion-sync-history",
      repositoryRelationship: "attached-source",
      repositoryLabel: "TerraFusionSync history",
    }, {
      projectId: 2,
      projectKey: "terrafusion",
      projectName: "TerraFusion OS",
      repositoryResourceId: 2,
      repositoryIdentity: "bsvalues/terrafusion_os_1.0",
      repositoryKey: "os-1",
      repositoryRelationship: "primary-repo",
      repositoryLabel: "OS 1.0",
    }]

    const result = await resolveTerraFusionWorkspaceBinding("owner", dependencies(rows))

    if (!result.ok) throw new Error(result.error)
    expect(result.binding.project.repositories).toHaveLength(8)
    expect(result.binding.project.repositories?.at(-1)).toEqual({
      repositoryResourceId: 8,
      key: "terrafusion-sync-history",
      identity: "bsvalues/terrafusionsync",
      label: "TerraFusionSync history",
      role: "attached-source",
      suite: null,
      previewSource: false,
      defaultRepository: false,
      mount: {
        key: "terrafusion:terrafusion-sync-history:attached",
        configured: false,
        verified: false,
        branch: null,
        revision: null,
        refusal: "ATTACHED_SOURCE_READ_ONLY_REFERENCE",
      },
    })
  })

  it("fails closed for an unknown, unconfigured, or mismatched Core Seven mount", async () => {
    const loadProjectRows = async () => {
      throw new Error("catalog rejection must happen before durable lookup")
    }
    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner", "terrafusion", { ...dependencies(), loadProjectRows }, "TerraFusionSync",
    )).resolves.toEqual({ ok: false, error: "WORKSPACE_REPOSITORY_UNKNOWN" })

    delete process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT
    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner", "terrafusion", dependencies(), "atlas",
    )).resolves.toEqual({ ok: false, error: "WORKSPACE_REPOSITORY_MOUNT_NOT_CONFIGURED" })

    process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT = "/repos/terrafusion-atlas"
    const atlasRow = {
      projectId: 2,
      projectKey: "terrafusion",
      projectName: "TerraFusion OS",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryKey: "atlas",
      repositoryRelationship: "suite-source",
    }
    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner",
      "terrafusion",
      dependencies([atlasRow], "git@github.com:bsvalues/terrafusion-forge.git"),
      "atlas",
    )).resolves.toEqual({ ok: false, error: "WORKSPACE_ROOT_PROJECT_MISMATCH" })
  })

  it("refuses a repository resource whose persisted role does not match the server catalog", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT = "/repos/terrafusion-atlas"
    const wronglyClassifiedAtlas = {
      projectId: 2,
      projectKey: "terrafusion",
      projectName: "TerraFusion OS",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryKey: "atlas",
      repositoryRelationship: "sovereign-planning-and-promotion",
    }

    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner",
      "terrafusion",
      dependencies([wronglyClassifiedAtlas], "git@github.com:bsvalues/terrafusion-atlas.git"),
      "atlas",
    )).resolves.toEqual({ ok: false, error: "WORKSPACE_REPOSITORY_RESOURCE_INVALID" })
  })

  it("refuses a selected mount whose current revision cannot be verified", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    process.env.WILLIAMOS_TERRAFUSION_ATLAS_ROOT = "/repos/terrafusion-atlas"
    const atlasRow = {
      projectId: 2,
      projectKey: "terrafusion",
      projectName: "TerraFusion OS",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryKey: "atlas",
      repositoryRelationship: "suite-source",
    }
    const seams = dependencies([atlasRow], "git@github.com:bsvalues/terrafusion-atlas.git")

    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner",
      "terrafusion",
      { ...seams, readGitRevision: async () => "not-a-commit" },
      "atlas",
    )).resolves.toEqual({ ok: false, error: "WORKSPACE_REVISION_UNAVAILABLE" })
  })

  it("verifies a bootstrap checkout against canonical TerraFusion without trusting the browser", async () => {
    await expect(verifyCanonicalTerraFusionCheckout(
      "/repos/terrafusion_os_1.0",
      undefined,
      dependencies(),
    )).resolves.toEqual({
      ok: true,
      binding: {
        configuredWorkspaceRoot: expect.stringMatching(/terrafusion_os_1\.0$/),
        workspaceRoot: expect.stringMatching(/terrafusion_os_1\.0$/),
      },
    })

    await expect(verifyCanonicalTerraFusionCheckout(
      "/repos/william-os-devops",
      undefined,
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
        project: expect.objectContaining({
          identity: expect.stringMatching(/links[\\/]terrafusion$/),
          name: "TerraFusion OS",
        }),
      }),
    })
  })

  it("keeps the original Space identity after the verified checkout moves", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/moved/terrafusion_os_1.0"
    process.env.WILLIAMOS_TERRAFUSION_SPACE_IDENTITY = "/repos/original/terrafusion_os_1.0"

    const result = await resolveTerraFusionWorkspaceBinding("owner", dependencies())

    expect(result).toEqual({
      ok: true,
      binding: expect.objectContaining({
        configuredWorkspaceRoot: expect.stringMatching(/repos[\\/]moved[\\/]terrafusion_os_1\.0$/),
        workspaceRoot: expect.stringMatching(/repos[\\/]moved[\\/]terrafusion_os_1\.0$/),
        project: expect.objectContaining({
          identity: expect.stringMatching(/repos[\\/]original[\\/]terrafusion_os_1\.0$/),
          name: "TerraFusion OS",
        }),
      }),
    })
  })

  it("refuses a non-absolute server-managed Space identity", async () => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    process.env.WILLIAMOS_TERRAFUSION_SPACE_IDENTITY = "relative/identity"

    await expect(resolveTerraFusionWorkspaceBinding("owner", dependencies()))
      .resolves.toEqual({ ok: false, error: "WORKSPACE_SPACE_IDENTITY_INVALID" })
  })

  it.each([
    ["control character", `C:/repos/original${String.fromCharCode(10)}evil`],
    ["oversized value", `C:/${"x".repeat(4_100)}`],
    ["dotenv interpolation", "C:/repos/$identity"],
  ])("refuses a %s in the server-managed Space identity", async (_label, identity) => {
    process.env.WILLIAMOS_TERRAFUSION_ROOT = "/repos/terrafusion_os_1.0"
    process.env.WILLIAMOS_TERRAFUSION_SPACE_IDENTITY = identity

    await expect(resolveTerraFusionWorkspaceBinding("owner", dependencies()))
      .resolves.toEqual({ ok: false, error: "WORKSPACE_SPACE_IDENTITY_INVALID" })
  })

  it("rejects NUL before a portable Space identity can reach process.env", () => {
    expect(() => normalizePortableAbsolutePathIdentity(`C:/repos/original${String.fromCharCode(0)}evil`))
      .toThrow("WILLIAMOS_TERRAFUSION_SPACE_IDENTITY is invalid")
  })
})

describe("WilliamOS workspace Project binding", () => {
  const row = {
    projectId: 1,
    projectKey: "williamos",
    projectName: "WilliamOS",
    repositoryIdentity: "bsvalues/terragroq",
  }

  it("binds only the declared WilliamOS checkout to the canonical TerraGroq repository", async () => {
    process.env.WILLIAMOS_PROJECT_ROOT = "/repos/terragroq"
    const seams = dependencies([row], "git@github.com:bsvalues/terragroq.git")
    const result = await resolveWilliamOsWorkspaceBinding("owner", seams)

    expect(result).toEqual({
      ok: true,
      binding: expect.objectContaining({
        projectId: 1,
        projectKey: "williamos",
        projectName: "WilliamOS",
        repositoryIdentity: "bsvalues/terragroq",
        workspaceAppUrl: null,
        project: expect.objectContaining({ name: "WilliamOS", identity: expect.stringMatching(/repos[\\/]terragroq$/) }),
      }),
    })
  })

  it("keeps WilliamOS Space identity stable when its verified checkout moves", async () => {
    process.env.WILLIAMOS_PROJECT_ROOT = "/repos/moved/terragroq"
    process.env.WILLIAMOS_PROJECT_SPACE_IDENTITY = "/repos/original/terragroq"
    const result = await resolveWilliamOsWorkspaceBinding(
      "owner",
      dependencies([row], "git@github.com:bsvalues/terragroq.git"),
    )

    expect(result).toEqual({
      ok: true,
      binding: expect.objectContaining({
        configuredWorkspaceRoot: expect.stringMatching(/repos[\\/]moved[\\/]terragroq$/),
        project: { identity: expect.stringMatching(/repos[\\/]original[\\/]terragroq$/), name: "WilliamOS" },
      }),
    })
  })

  it("dispatches only the server-whitelisted WilliamOS key", async () => {
    process.env.WILLIAMOS_PROJECT_ROOT = "/repos/terragroq"
    const seams = dependencies([row], "git@github.com:bsvalues/terragroq.git")
    await expect(resolveCanonicalWorkspaceProjectBinding("owner", "williamos", seams))
      .resolves.toMatchObject({ ok: true, binding: { projectKey: "williamos" } })
    await expect(resolveCanonicalWorkspaceProjectBinding("owner", "foreign", seams))
      .resolves.toEqual({ ok: false, error: "SPACE_PROJECT_INVALID" })
  })

  it("fails closed for missing root, missing Project, and noncanonical repository identity", async () => {
    delete process.env.WILLIAMOS_PROJECT_ROOT
    await expect(resolveWilliamOsWorkspaceBinding("owner", dependencies([row], "git@github.com:bsvalues/terragroq.git")))
      .resolves.toEqual({ ok: false, error: "WILLIAMOS_WORKSPACE_ROOT_NOT_CONFIGURED" })

    process.env.WILLIAMOS_PROJECT_ROOT = "/repos/terragroq"
    await expect(resolveWilliamOsWorkspaceBinding("owner", dependencies([], "git@github.com:bsvalues/terragroq.git")))
      .resolves.toEqual({ ok: false, error: "WILLIAMOS_PROJECT_UNBOUND" })

    await expect(resolveWilliamOsWorkspaceBinding("owner", dependencies([{ ...row, repositoryIdentity: "bsvalues/other" }], "git@github.com:bsvalues/other.git")))
      .resolves.toEqual({ ok: false, error: "WILLIAMOS_PRIMARY_REPO_INVALID" })
  })
})
