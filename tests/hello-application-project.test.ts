import { afterEach, describe, expect, it } from "vitest"

import {
  resolveRequestedWorkspaceProjectKey,
  resolveVisibleWorkspaceProjects,
} from "@/lib/projects/workspace-project-key"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type WorkspaceProjectBindingDependencies,
} from "@/lib/projects/workspace-project-binding"

const savedEnvironment = {
  WILLIAMOS_DEFAULT_PROJECT: process.env.WILLIAMOS_DEFAULT_PROJECT,
  WILLIAMOS_HELLO_ENABLED: process.env.WILLIAMOS_HELLO_ENABLED,
  WILLIAMOS_PROJECT_ROOT: process.env.WILLIAMOS_PROJECT_ROOT,
  WILLIAMOS_VISIBLE_PROJECTS: process.env.WILLIAMOS_VISIBLE_PROJECTS,
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function dependencies(): WorkspaceProjectBindingDependencies {
  return {
    loadProjectRows: async (_userId, projectKey) => projectKey === "williamos" ? [{
      projectId: 1,
      projectKey: "williamos",
      projectName: "WilliamOS",
      repositoryResourceId: 1,
      repositoryIdentity: "bsvalues/terragroq",
      repositoryKey: "williamos",
      repositoryRelationship: "primary-repo",
      repositoryLabel: "WilliamOS",
    }] : [],
    readGitRemoteOrigin: async () => "git@github.com:bsvalues/terragroq.git",
    readGitTopLevel: async () => "C:/runtime/williamos-source",
    readGitRevision: async () => "1".repeat(40),
    readGitBranch: async () => "main",
    realpath: async (value) => value.replaceAll("\\", "/"),
  }
}

describe("Hello Application project", () => {
  it("is visible and selected only through the server-owned project catalog", () => {
    process.env.WILLIAMOS_HELLO_ENABLED = "1"
    process.env.WILLIAMOS_VISIBLE_PROJECTS = "hello-application,williamos,unknown"
    process.env.WILLIAMOS_DEFAULT_PROJECT = "hello-application"

    expect(resolveVisibleWorkspaceProjects()).toEqual([
      { key: "hello-application", name: "Hello Application" },
      { key: "williamos", name: "WilliamOS" },
    ])
    expect(resolveRequestedWorkspaceProjectKey(undefined)).toBe("hello-application")
    expect(resolveRequestedWorkspaceProjectKey("hello-application")).toBe("hello-application")
    expect(resolveRequestedWorkspaceProjectKey("unknown")).toBe("hello-application")
  })

  it("binds the distinct Hello project to the contained source in the verified WilliamOS checkout", async () => {
    process.env.WILLIAMOS_HELLO_ENABLED = "1"
    process.env.WILLIAMOS_PROJECT_ROOT = "C:/runtime/williamos-source"

    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner",
      "hello-application",
      dependencies(),
    )).resolves.toEqual({
      ok: true,
      binding: expect.objectContaining({
        projectId: 1,
        projectKey: "hello-application",
        projectName: "Hello Application",
        repositoryIdentity: "bsvalues/terragroq",
        repositoryMountKey: "williamos:hello-application:contained",
        observedRevision: "1".repeat(40),
        configuredWorkspaceRoot: expect.stringMatching(/examples[\\/]hello-application$/),
        workspaceRoot: expect.stringMatching(/examples[\\/]hello-application$/),
        workspaceAppUrl: "/api/projects/hello-application/preview",
        project: expect.objectContaining({
          name: "Hello Application",
          identity: expect.stringMatching(/examples[\\/]hello-application$/),
        }),
      }),
    })
  })

  it("fails closed when the contained source is disabled or escapes the verified checkout", async () => {
    process.env.WILLIAMOS_PROJECT_ROOT = "C:/runtime/williamos-source"
    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner",
      "hello-application",
      dependencies(),
    )).resolves.toEqual({ ok: false, error: "HELLO_APPLICATION_DISABLED" })

    process.env.WILLIAMOS_HELLO_ENABLED = "1"
    const seams = dependencies()
    await expect(resolveCanonicalWorkspaceProjectBinding(
      "owner",
      "hello-application",
      {
        ...seams,
        realpath: async (value) => value.includes("examples")
          ? "C:/other/hello-application"
          : value.replaceAll("\\", "/"),
      },
    )).resolves.toEqual({ ok: false, error: "HELLO_APPLICATION_ROOT_INVALID" })
  })
})
