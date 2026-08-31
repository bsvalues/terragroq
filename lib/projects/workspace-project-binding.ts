import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { project, projectResource } from "@/lib/db/schema"
import { workspaceProjectFromRoot, type WorkspaceProject } from "@/lib/environment/space-persistence"

const TERRAFUSION_PROJECT_KEY = "terrafusion"

export type WorkspaceProjectBinding = Readonly<{
  projectId: number
  projectKey: string
  projectName: string
  repositoryIdentity: string
  workspaceRoot: string
  workspaceAppUrl: string | null
  project: WorkspaceProject
}>

export type WorkspaceProjectBindingResult =
  | Readonly<{ ok: true; binding: WorkspaceProjectBinding }>
  | Readonly<{ ok: false; error: string }>

type ProjectBindingRow = Readonly<{
  projectId: number
  projectKey: string
  projectName: string
  repositoryIdentity: string
}>

export type WorkspaceProjectBindingDependencies = Readonly<{
  loadProjectRows: (userId: string) => Promise<readonly ProjectBindingRow[]>
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
    if (url.hostname.toLowerCase() !== "github.com") return null
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
  async loadProjectRows(userId) {
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
      .where(and(eq(project.userId, userId), eq(project.key, TERRAFUSION_PROJECT_KEY)))
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
  let rows: readonly ProjectBindingRow[]
  try {
    rows = await dependencies.loadProjectRows(userId)
  } catch {
    return { ok: false, error: "WORKSPACE_PROJECT_LOOKUP_UNAVAILABLE" }
  }

  if (rows.length === 0) return { ok: false, error: "TERRAFUSION_PROJECT_UNBOUND" }
  if (rows.length !== 1) return { ok: false, error: "TERRAFUSION_PRIMARY_REPO_AMBIGUOUS" }

  const row = rows[0]
  const canonicalRepository = normalizeRepositoryIdentity(row.repositoryIdentity)
  if (!canonicalRepository) return { ok: false, error: "TERRAFUSION_PRIMARY_REPO_INVALID" }

  const configuredRoot = process.env.WILLIAMOS_PROJECT_ROOT?.trim()
  if (!configuredRoot) return { ok: false, error: "WORKSPACE_ROOT_NOT_CONFIGURED" }
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

  // Space identity remains the stable configured checkout path used before this verifier existed.
  // Filesystem operations use the verified real Git root above, but changing a symlink/junction to
  // its physical target here would orphan the owner's already-persisted Spaces after an upgrade.
  // Outcome assimilation still resolves the configured path's Git origin to the canonical repo.
  const projectBinding = workspaceProjectFromRoot(configuredWorkspaceRoot, row.projectName)
  return {
    ok: true,
    binding: {
      projectId: row.projectId,
      projectKey: row.projectKey,
      projectName: row.projectName,
      repositoryIdentity: row.repositoryIdentity,
      workspaceRoot,
      workspaceAppUrl: process.env.WILLIAMOS_WORKSPACE_APP_URL?.trim() || null,
      project: projectBinding,
    },
  }
}
