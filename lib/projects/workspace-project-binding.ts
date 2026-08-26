import { execFile } from "node:child_process"
import path from "node:path"

import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { project, projectResource } from "@/lib/db/schema"

const TERRAFUSION_PROJECT_KEY = "terrafusion"

export type WorkspaceProjectBinding = Readonly<{
  projectId: number
  projectKey: string
  projectName: string
  repositoryIdentity: string
  workspaceRoot: string
  workspaceAppUrl: string | null
}>

export type WorkspaceProjectBindingResult =
  | Readonly<{ ok: true; binding: WorkspaceProjectBinding }>
  | Readonly<{ ok: false; error: string }>

function normalizeRepositoryIdentity(value: string): string | null {
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
      (error, stdout) => {
        if (error) return reject(error)
        resolve(stdout.trim())
      },
    )
  })
}

/**
 * Resolve the one W1 workspace from durable Project identity, then prove the configured local
 * checkout is actually that Project's primary repository. Environment values are deployment
 * locations only; they cannot choose which Project the Space represents.
 */
export async function resolveTerraFusionWorkspaceBinding(
  userId: string,
): Promise<WorkspaceProjectBindingResult> {
  const rows = await db
    .select({
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      repositoryIdentity: projectResource.canonicalIdentity,
    })
    .from(project)
    .innerJoin(
      projectResource,
      and(
        eq(projectResource.projectId, project.id),
        eq(projectResource.userId, userId),
        eq(projectResource.type, "repo"),
        eq(projectResource.relationship, "primary-repo"),
      ),
    )
    .where(and(eq(project.userId, userId), eq(project.key, TERRAFUSION_PROJECT_KEY)))
    .limit(2)

  if (rows.length === 0) return { ok: false, error: "TERRAFUSION_PROJECT_UNBOUND" }
  if (rows.length !== 1) return { ok: false, error: "TERRAFUSION_PRIMARY_REPO_AMBIGUOUS" }

  const row = rows[0]
  const canonicalRepository = normalizeRepositoryIdentity(row.repositoryIdentity)
  if (!canonicalRepository) return { ok: false, error: "TERRAFUSION_PRIMARY_REPO_INVALID" }

  const configuredRoot = process.env.WILLIAMOS_PROJECT_ROOT?.trim()
  if (!configuredRoot) return { ok: false, error: "WORKSPACE_ROOT_NOT_CONFIGURED" }
  const workspaceRoot = path.resolve(configuredRoot)

  let observedRemote: string
  try {
    observedRemote = await readGitRemoteOrigin(workspaceRoot)
  } catch {
    return { ok: false, error: "WORKSPACE_ROOT_NOT_REPOSITORY" }
  }

  if (normalizeRepositoryIdentity(observedRemote) !== canonicalRepository) {
    return { ok: false, error: "WORKSPACE_ROOT_PROJECT_MISMATCH" }
  }

  return {
    ok: true,
    binding: {
      projectId: row.projectId,
      projectKey: row.projectKey,
      projectName: row.projectName,
      repositoryIdentity: row.repositoryIdentity,
      workspaceRoot,
      workspaceAppUrl: process.env.WILLIAMOS_WORKSPACE_APP_URL?.trim() || null,
    },
  }
}
