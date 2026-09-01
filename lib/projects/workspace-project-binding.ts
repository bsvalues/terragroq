import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { project, projectResource } from "@/lib/db/schema"
import { workspaceProjectFromRoot, type WorkspaceProject } from "@/lib/environment/space-persistence"
import { normalizePortableAbsolutePathIdentity } from "@/lib/setup/project-root-env"

const TERRAFUSION_PROJECT_KEY = "terrafusion"
export const TERRAFUSION_REPOSITORY_IDENTITY = "bsvalues/terrafusion_os_1.0"
const WILLIAMOS_PROJECT_KEY = "williamos"
export const WILLIAMOS_REPOSITORY_IDENTITY = "bsvalues/terragroq"

export type CanonicalWorkspaceProjectKey = typeof TERRAFUSION_PROJECT_KEY | typeof WILLIAMOS_PROJECT_KEY

export type WorkspaceProjectBinding = Readonly<{
  projectId: number
  projectKey: string
  projectName: string
  repositoryIdentity: string
  configuredWorkspaceRoot: string
  workspaceRoot: string
  workspaceAppUrl: string | null
  project: WorkspaceProject
}>

export type WorkspaceProjectBindingResult =
  | Readonly<{ ok: true; binding: WorkspaceProjectBinding }>
  | Readonly<{ ok: false; error: string }>

export type VerifiedTerraFusionWorkspaceRoot = Readonly<{
  projectId: number
  projectKey: string
  projectName: string
  repositoryIdentity: string
  configuredWorkspaceRoot: string
  workspaceRoot: string
}>

export type VerifiedTerraFusionWorkspaceRootResult =
  | Readonly<{ ok: true; binding: VerifiedTerraFusionWorkspaceRoot }>
  | Readonly<{ ok: false; error: string }>

export type VerifiedWorkspaceCheckout = Readonly<{
  configuredWorkspaceRoot: string
  workspaceRoot: string
}>

type ProjectBindingRow = Readonly<{
  projectId: number
  projectKey: string
  projectName: string
  repositoryIdentity: string
}>

export type WorkspaceProjectBindingDependencies = Readonly<{
  loadProjectRows: (userId: string, projectKey: CanonicalWorkspaceProjectKey) => Promise<readonly ProjectBindingRow[]>
  readGitRemoteOrigin: (workspaceRoot: string) => Promise<string>
  readGitTopLevel: (workspaceRoot: string) => Promise<string>
  realpath: (workspaceRoot: string) => Promise<string>
}>

export function normalizeRepositoryIdentity(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null

  const short = raw.replace(/\.git$/i, "")
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(short)) return short.toLowerCase()

  const ssh = raw.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i)
  if (ssh) return ssh[1].toLowerCase()

  try {
    const url = new URL(raw)
    const hostname = url.hostname.toLowerCase()
    const githubWebRemote = hostname === "github.com"
    const githubSshOver443Remote = hostname === "ssh.github.com"
      && url.protocol === "ssh:"
      && url.username === "git"
      && url.port === "443"
    if (!githubWebRemote && !githubSshOver443Remote) return null
    const identity = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identity) ? identity.toLowerCase() : null
  } catch {
    return null
  }
}

function readGitRemoteOrigin(workspaceRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", workspaceRoot, "config", "--get", "remote.origin.url"],
      { encoding: "utf8", windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()),
    )
  })
}

function readGitTopLevel(workspaceRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", workspaceRoot, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()),
    )
  })
}

const workspaceProjectBindingDependencies: WorkspaceProjectBindingDependencies = {
  async loadProjectRows(userId, projectKey) {
    return db
      .select({
        projectId: project.id,
        projectKey: project.key,
        projectName: project.name,
        repositoryIdentity: projectResource.canonicalIdentity,
      })
      .from(project)
      .innerJoin(projectResource, and(
        eq(projectResource.projectId, project.id),
        eq(projectResource.userId, userId),
        eq(projectResource.type, "repo"),
        eq(projectResource.relationship, "primary-repo"),
      ))
      .where(and(eq(project.userId, userId), eq(project.key, projectKey)))
      .limit(2)
  },
  readGitRemoteOrigin,
  readGitTopLevel,
  realpath: fs.realpath,
}

/**
 * Resolve TerraFusion from the signed-in owner's durable Project, then prove the configured local
 * checkout is that Project's primary repository. The deployment path locates a checkout; it cannot
 * choose which Project WilliamOS claims to be operating.
 */
export async function resolveTerraFusionWorkspaceBinding(
  userId: string,
  dependencies: WorkspaceProjectBindingDependencies = workspaceProjectBindingDependencies,
): Promise<WorkspaceProjectBindingResult> {
  const configuredRoot = process.env.WILLIAMOS_TERRAFUSION_ROOT?.trim()
  if (!configuredRoot) return { ok: false, error: "WORKSPACE_ROOT_NOT_CONFIGURED" }
  const verified = await verifyTerraFusionWorkspaceRoot(userId, configuredRoot, dependencies)
  if (!verified.ok) return verified

  const {
    projectId,
    projectKey,
    projectName,
    repositoryIdentity,
    configuredWorkspaceRoot,
    workspaceRoot,
  } = verified.binding

  // Filesystem operations follow the currently verified checkout. Space identity is a separate,
  // server-managed continuity key: /setup seeds it from the first root and preserves it when that
  // checkout moves, so replacing a path cannot orphan persisted Spaces or browser namespaces.
  let configuredSpaceIdentity: string
  try {
    configuredSpaceIdentity = normalizePortableAbsolutePathIdentity(
      process.env.WILLIAMOS_TERRAFUSION_SPACE_IDENTITY || configuredWorkspaceRoot,
    )
  } catch {
    return { ok: false, error: "WORKSPACE_SPACE_IDENTITY_INVALID" }
  }
  const projectBinding = workspaceProjectFromRoot(configuredSpaceIdentity, projectName)
  return {
    ok: true,
    binding: {
      projectId,
      projectKey,
      projectName,
      repositoryIdentity,
      configuredWorkspaceRoot,
      workspaceRoot,
      workspaceAppUrl: process.env.WILLIAMOS_WORKSPACE_APP_URL?.trim() || null,
      project: projectBinding,
    },
  }
}

/**
 * Resolve the signed-in owner's canonical WilliamOS Project and prove that the server-declared
 * WilliamOS checkout is exactly the bsvalues/terragroq repository. Neither repository identity nor
 * checkout location is accepted from the browser.
 */
export async function resolveWilliamOsWorkspaceBinding(
  userId: string,
  dependencies: WorkspaceProjectBindingDependencies = workspaceProjectBindingDependencies,
): Promise<WorkspaceProjectBindingResult> {
  const configuredRoot = process.env.WILLIAMOS_PROJECT_ROOT?.trim()
  if (!configuredRoot) return { ok: false, error: "WILLIAMOS_WORKSPACE_ROOT_NOT_CONFIGURED" }

  let rows: readonly ProjectBindingRow[]
  try {
    rows = await dependencies.loadProjectRows(userId, WILLIAMOS_PROJECT_KEY)
  } catch {
    return { ok: false, error: "WORKSPACE_PROJECT_LOOKUP_UNAVAILABLE" }
  }
  if (rows.length === 0) return { ok: false, error: "WILLIAMOS_PROJECT_UNBOUND" }
  if (rows.length !== 1) return { ok: false, error: "WILLIAMOS_PRIMARY_REPO_AMBIGUOUS" }

  const row = rows[0]
  if (
    row.projectKey !== WILLIAMOS_PROJECT_KEY
    || normalizeRepositoryIdentity(row.repositoryIdentity) !== WILLIAMOS_REPOSITORY_IDENTITY
  ) return { ok: false, error: "WILLIAMOS_PRIMARY_REPO_INVALID" }

  const checkout = await verifyCanonicalTerraFusionCheckout(
    configuredRoot,
    WILLIAMOS_REPOSITORY_IDENTITY,
    dependencies,
  )
  if (!checkout.ok) return checkout

  let configuredSpaceIdentity: string
  try {
    configuredSpaceIdentity = normalizePortableAbsolutePathIdentity(checkout.binding.configuredWorkspaceRoot)
  } catch {
    return { ok: false, error: "WORKSPACE_SPACE_IDENTITY_INVALID" }
  }

  return {
    ok: true,
    binding: {
      projectId: row.projectId,
      projectKey: row.projectKey,
      projectName: row.projectName,
      repositoryIdentity: row.repositoryIdentity,
      ...checkout.binding,
      workspaceAppUrl: null,
      project: workspaceProjectFromRoot(configuredSpaceIdentity, row.projectName),
    },
  }
}

export async function resolveCanonicalWorkspaceProjectBinding(
  userId: string,
  projectKey: unknown,
  dependencies?: WorkspaceProjectBindingDependencies,
): Promise<WorkspaceProjectBindingResult> {
  if (projectKey === WILLIAMOS_PROJECT_KEY) return resolveWilliamOsWorkspaceBinding(userId, dependencies)
  if (projectKey === TERRAFUSION_PROJECT_KEY) return resolveTerraFusionWorkspaceBinding(userId, dependencies)
  return { ok: false, error: "SPACE_PROJECT_INVALID" }
}

/**
 * Verify one proposed checkout against the signed-in owner's durable TerraFusion Project before it
 * can be persisted as server-global configuration. The browser supplies a candidate path only; it
 * cannot choose the Project or repository identity that the server will accept.
 */
export async function verifyTerraFusionWorkspaceRoot(
  userId: string,
  configuredRoot: string,
  dependencies: WorkspaceProjectBindingDependencies = workspaceProjectBindingDependencies,
): Promise<VerifiedTerraFusionWorkspaceRootResult> {
  let rows: readonly ProjectBindingRow[]
  try {
    rows = await dependencies.loadProjectRows(userId, TERRAFUSION_PROJECT_KEY)
  } catch {
    return { ok: false, error: "WORKSPACE_PROJECT_LOOKUP_UNAVAILABLE" }
  }

  if (rows.length === 0) return { ok: false, error: "TERRAFUSION_PROJECT_UNBOUND" }
  if (rows.length !== 1) return { ok: false, error: "TERRAFUSION_PRIMARY_REPO_AMBIGUOUS" }

  const row = rows[0]
  const canonicalRepository = normalizeRepositoryIdentity(row.repositoryIdentity)
  if (!canonicalRepository) return { ok: false, error: "TERRAFUSION_PRIMARY_REPO_INVALID" }

  const checkout = await verifyCanonicalTerraFusionCheckout(configuredRoot, canonicalRepository, dependencies)
  if (!checkout.ok) return checkout

  return {
    ok: true,
    binding: {
      projectId: row.projectId,
      projectKey: row.projectKey,
      projectName: row.projectName,
      repositoryIdentity: row.repositoryIdentity,
      ...checkout.binding,
    },
  }
}

/** Prove that a proposed path is the root of the canonical TerraFusion Git repository. */
export async function verifyCanonicalTerraFusionCheckout(
  configuredRoot: string,
  expectedRepositoryIdentity: string = TERRAFUSION_REPOSITORY_IDENTITY,
  dependencies: Pick<WorkspaceProjectBindingDependencies, "readGitRemoteOrigin" | "readGitTopLevel" | "realpath"> = workspaceProjectBindingDependencies,
): Promise<Readonly<{ ok: true; binding: VerifiedWorkspaceCheckout }> | Readonly<{ ok: false; error: string }>> {
  const canonicalRepository = normalizeRepositoryIdentity(expectedRepositoryIdentity)
  if (!canonicalRepository) return { ok: false, error: "TERRAFUSION_PRIMARY_REPO_INVALID" }

  if (!path.isAbsolute(configuredRoot)) return { ok: false, error: "WORKSPACE_ROOT_NOT_ABSOLUTE" }
  const configuredWorkspaceRoot = path.resolve(configuredRoot)

  let workspaceRoot: string
  let observedRemote: string
  try {
    const [configuredRealRoot, topLevel] = await Promise.all([
      dependencies.realpath(configuredWorkspaceRoot),
      dependencies.readGitTopLevel(configuredWorkspaceRoot),
    ])
    const topLevelRealRoot = await dependencies.realpath(path.resolve(topLevel))
    if (workspaceProjectFromRoot(configuredRealRoot).identity !== workspaceProjectFromRoot(topLevelRealRoot).identity) {
      return { ok: false, error: "WORKSPACE_ROOT_NOT_REPOSITORY_ROOT" }
    }
    workspaceRoot = topLevelRealRoot
    observedRemote = await dependencies.readGitRemoteOrigin(workspaceRoot)
  } catch {
    return { ok: false, error: "WORKSPACE_ROOT_NOT_REPOSITORY" }
  }
  if (normalizeRepositoryIdentity(observedRemote) !== canonicalRepository) {
    return { ok: false, error: "WORKSPACE_ROOT_PROJECT_MISMATCH" }
  }

  return {
    ok: true,
    binding: {
      configuredWorkspaceRoot,
      workspaceRoot,
    },
  }
}
