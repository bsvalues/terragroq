import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { project, projectResource } from "@/lib/db/schema"
import { workspaceProjectFromRoot, type WorkspaceProject } from "@/lib/environment/space-persistence"
import {
  CORE_SEVEN_REPOSITORIES,
  resolveWorkspaceRepositorySelection,
  type WorkspaceRepositoryDefinition,
  type WorkspaceRepositoryMountView,
} from "@/lib/projects/core-seven-repositories"
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
  repositoryResourceId: number | null
  repositoryKey: string
  repositoryIdentity: string
  repositoryRole: WorkspaceRepositoryDefinition["role"]
  repositoryLabel: string
  repositoryPreviewSource: boolean
  repositoryMountKey: string
  observedRevision: string | null
  configuredWorkspaceRoot: string
  workspaceRoot: string
  workspaceAppUrl: string | null
  project: WorkspaceProject & Readonly<{ repositories?: readonly WorkspaceRepositoryMountView[] }>
}>

export type WorkspaceProjectBindingResult =
  | Readonly<{ ok: true; binding: WorkspaceProjectBinding }>
  | Readonly<{ ok: false; error: string }>

export type VerifiedTerraFusionWorkspaceRoot = Readonly<{
  projectId: number
  projectKey: string
  projectName: string
  repositoryKey: string
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
  repositoryResourceId?: number
  repositoryIdentity: string
  repositoryLabel?: string
  repositoryKey?: string | null
  repositoryRelationship?: string
}>

export type WorkspaceProjectBindingDependencies = Readonly<{
  loadProjectRows: (userId: string, projectKey: CanonicalWorkspaceProjectKey) => Promise<readonly ProjectBindingRow[]>
  readGitRemoteOrigin: (workspaceRoot: string) => Promise<string>
  readGitTopLevel: (workspaceRoot: string) => Promise<string>
  readGitRevision?: (workspaceRoot: string) => Promise<string>
  readGitBranch?: (workspaceRoot: string) => Promise<string>
  realpath: (workspaceRoot: string) => Promise<string>
}>

export type WorkspaceProjectBindingOptions = Readonly<{
  includeRepositoryCatalog?: boolean
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

function readGitRevision(workspaceRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", workspaceRoot, "rev-parse", "--verify", "HEAD"],
      { encoding: "utf8", windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()),
    )
  })
}

function readGitBranch(workspaceRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", workspaceRoot, "branch", "--show-current"],
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
        repositoryResourceId: projectResource.id,
        repositoryIdentity: projectResource.canonicalIdentity,
        repositoryLabel: projectResource.label,
        repositoryKey: projectResource.resourceKey,
        repositoryRelationship: projectResource.relationship,
      })
      .from(project)
      .innerJoin(projectResource, and(
        eq(projectResource.projectId, project.id),
        eq(projectResource.userId, userId),
        eq(projectResource.type, "repo"),
      ))
      .where(and(eq(project.userId, userId), eq(project.key, projectKey)))
  },
  readGitRemoteOrigin,
  readGitTopLevel,
  readGitRevision,
  readGitBranch,
  realpath: fs.realpath,
}

type PersistedRepositoryResult =
  | Readonly<{ ok: true; row: ProjectBindingRow }>
  | Readonly<{ ok: false; error: string }>

async function resolvePersistedRepository(
  userId: string,
  definition: WorkspaceRepositoryDefinition,
  dependencies: WorkspaceProjectBindingDependencies,
): Promise<PersistedRepositoryResult> {
  let rows: readonly ProjectBindingRow[]
  try {
    rows = await dependencies.loadProjectRows(userId, definition.projectKey)
  } catch {
    return { ok: false, error: "WORKSPACE_PROJECT_LOOKUP_UNAVAILABLE" }
  }

  if (rows.length === 0) {
    return {
      ok: false,
      error: definition.projectKey === TERRAFUSION_PROJECT_KEY && definition.defaultRepository
        ? "TERRAFUSION_PROJECT_UNBOUND"
        : definition.projectKey === WILLIAMOS_PROJECT_KEY
          ? "WILLIAMOS_PROJECT_UNBOUND"
          : "WORKSPACE_REPOSITORY_UNBOUND",
    }
  }

  const keyed = rows.filter((row) => row.repositoryKey === definition.key)
  // Existing primary repository rows predate resourceKey. Preserve only that exact legacy binding;
  // secondary repositories always require their explicit stable key.
  const candidates = keyed.length > 0
    ? keyed
    : definition.defaultRepository
      ? rows.filter((row) => (
        (row.repositoryKey === undefined || row.repositoryKey === null)
        && (row.repositoryRelationship === undefined || row.repositoryRelationship === "primary-repo")
      ))
      : []

  if (candidates.length === 0) return { ok: false, error: "WORKSPACE_REPOSITORY_UNBOUND" }
  if (candidates.length !== 1) {
    return {
      ok: false,
      error: definition.projectKey === TERRAFUSION_PROJECT_KEY && definition.defaultRepository
        ? "TERRAFUSION_PRIMARY_REPO_AMBIGUOUS"
        : definition.projectKey === WILLIAMOS_PROJECT_KEY
          ? "WILLIAMOS_PRIMARY_REPO_AMBIGUOUS"
          : "WORKSPACE_REPOSITORY_AMBIGUOUS",
    }
  }

  const row = candidates[0]
  const validRelationship = row.repositoryRelationship === undefined
    ? definition.defaultRepository
    : row.repositoryRelationship === definition.relationship
  if (
    row.projectKey !== definition.projectKey
    || normalizeRepositoryIdentity(row.repositoryIdentity) !== definition.identity
    || !validRelationship
  ) {
    return {
      ok: false,
      error: definition.projectKey === TERRAFUSION_PROJECT_KEY && definition.defaultRepository
        ? "TERRAFUSION_PRIMARY_REPO_INVALID"
        : definition.projectKey === WILLIAMOS_PROJECT_KEY
          ? "WILLIAMOS_PRIMARY_REPO_INVALID"
          : "WORKSPACE_REPOSITORY_RESOURCE_INVALID",
    }
  }
  return { ok: true, row }
}

async function observeRevision(
  workspaceRoot: string,
  dependencies: WorkspaceProjectBindingDependencies,
): Promise<Readonly<{ ok: true; revision: string | null }> | Readonly<{ ok: false; error: string }>> {
  // Custom deterministic seams written before revision-qualified mounts may omit this function.
  // The real server dependency always supplies it and therefore always verifies a concrete HEAD.
  if (!dependencies.readGitRevision) return { ok: true, revision: null }
  try {
    const revision = (await dependencies.readGitRevision(workspaceRoot)).trim().toLowerCase()
    return /^[a-f0-9]{40,64}$/.test(revision)
      ? { ok: true, revision }
      : { ok: false, error: "WORKSPACE_REVISION_UNAVAILABLE" }
  } catch {
    return { ok: false, error: "WORKSPACE_REVISION_UNAVAILABLE" }
  }
}

async function buildTerraFusionRepositoryCatalog(
  userId: string,
  dependencies: WorkspaceProjectBindingDependencies,
): Promise<readonly WorkspaceRepositoryMountView[]> {
  let registeredRows: readonly ProjectBindingRow[] = []
  try {
    registeredRows = await dependencies.loadProjectRows(userId, TERRAFUSION_PROJECT_KEY)
  } catch {
    // The selected primary binding already reports a durable lookup failure. Catalog enrichment is
    // read-only presentation and cannot turn an otherwise valid mount into invented source truth.
  }
  const core = await Promise.all(CORE_SEVEN_REPOSITORIES.map(async (definition): Promise<WorkspaceRepositoryMountView> => {
    const configuredRoot = process.env[definition.configuredRootEnvironment]?.trim()
    const registered = registeredRows.filter((row) => row.repositoryKey === definition.key)
    const base = {
      ...(registered.length === 1 && registered[0].repositoryResourceId
        ? { repositoryResourceId: registered[0].repositoryResourceId }
        : {}),
      key: definition.key,
      identity: definition.identity,
      label: definition.label,
      role: definition.role,
      suite: definition.suite,
      previewSource: definition.previewSource,
      defaultRepository: definition.defaultRepository,
    }
    if (!configuredRoot) {
      return {
        ...base,
        mount: {
          key: definition.mountKey,
          configured: false,
          verified: false,
          branch: null,
          revision: null,
          refusal: "WORKSPACE_REPOSITORY_MOUNT_NOT_CONFIGURED",
        },
      }
    }

    const persisted = await resolvePersistedRepository(userId, definition, dependencies)
    if (!persisted.ok) {
      return {
        ...base,
        mount: {
          key: definition.mountKey,
          configured: true,
          verified: false,
          branch: null,
          revision: null,
          refusal: persisted.error,
        },
      }
    }
    const boundBase = {
      ...base,
      ...(persisted.row.repositoryResourceId ? { repositoryResourceId: persisted.row.repositoryResourceId } : {}),
    }
    const checkout = await verifyCanonicalTerraFusionCheckout(configuredRoot, definition.identity, dependencies)
    if (!checkout.ok) {
      return {
        ...boundBase,
        mount: {
          key: definition.mountKey,
          configured: true,
          verified: false,
          branch: null,
          revision: null,
          refusal: checkout.error,
        },
      }
    }
    const revision = await observeRevision(checkout.binding.workspaceRoot, dependencies)
    if (!revision.ok || revision.revision === null) {
      return {
        ...boundBase,
        mount: {
          key: definition.mountKey,
          configured: true,
          verified: false,
          branch: null,
          revision: null,
          refusal: revision.ok ? "WORKSPACE_REVISION_UNAVAILABLE" : revision.error,
        },
      }
    }
    let branch: string | null = null
    if (dependencies.readGitBranch) {
      try {
        branch = (await dependencies.readGitBranch(checkout.binding.workspaceRoot)).trim() || null
      } catch {
        // Detached or otherwise unavailable branch state does not invalidate the verified revision.
      }
    }
    return {
      ...boundBase,
      mount: {
        key: definition.mountKey,
        configured: true,
        verified: true,
        branch,
        revision: revision.revision,
        refusal: null,
      },
    }
  }))

  const coreKeys = new Set<string>(CORE_SEVEN_REPOSITORIES.map((repository) => repository.key))
  const attachedCandidates = registeredRows.filter((row) => row.repositoryRelationship === "attached-source"
    && typeof row.repositoryResourceId === "number" && Number.isSafeInteger(row.repositoryResourceId) && row.repositoryResourceId > 0
    && typeof row.repositoryKey === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.repositoryKey)
    && !coreKeys.has(row.repositoryKey)
    && typeof row.repositoryLabel === "string" && row.repositoryLabel.trim().length > 0
    && normalizeRepositoryIdentity(row.repositoryIdentity) !== null)
  const keyCounts = new Map<string, number>()
  const identityCounts = new Map<string, number>()
  for (const row of attachedCandidates) {
    keyCounts.set(row.repositoryKey!, (keyCounts.get(row.repositoryKey!) ?? 0) + 1)
    const identity = normalizeRepositoryIdentity(row.repositoryIdentity)!
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1)
  }
  const attached = attachedCandidates
    .filter((row) => keyCounts.get(row.repositoryKey!) === 1
      && identityCounts.get(normalizeRepositoryIdentity(row.repositoryIdentity)!) === 1)
    .sort((left, right) => left.repositoryKey!.localeCompare(right.repositoryKey!))
    .map((row): WorkspaceRepositoryMountView => ({
      repositoryResourceId: row.repositoryResourceId!,
      key: row.repositoryKey!,
      identity: normalizeRepositoryIdentity(row.repositoryIdentity)!,
      label: row.repositoryLabel!.trim(),
      role: "attached-source",
      suite: null,
      previewSource: false,
      defaultRepository: false,
      mount: {
        key: `terrafusion:${row.repositoryKey}:attached`,
        configured: false,
        verified: false,
        branch: null,
        revision: null,
        refusal: "ATTACHED_SOURCE_READ_ONLY_REFERENCE",
      },
    }))
  return [...core, ...attached]
}

/**
 * Resolve TerraFusion from the signed-in owner's durable Project, then prove the configured local
 * checkout is that Project's primary repository. The deployment path locates a checkout; it cannot
 * choose which Project WilliamOS claims to be operating.
 */
export async function resolveTerraFusionWorkspaceBinding(
  userId: string,
  dependencies: WorkspaceProjectBindingDependencies = workspaceProjectBindingDependencies,
  repositoryKey?: unknown,
  options: WorkspaceProjectBindingOptions = {},
): Promise<WorkspaceProjectBindingResult> {
  const selection = resolveWorkspaceRepositorySelection(TERRAFUSION_PROJECT_KEY, repositoryKey)
  if (!selection.ok) return selection
  const definition = selection.repository
  const includeRepositoryCatalog = options.includeRepositoryCatalog ?? repositoryKey === undefined
  const configuredRoot = process.env[definition.configuredRootEnvironment]?.trim()
  if (!configuredRoot) {
    return {
      ok: false,
      error: definition.defaultRepository
        ? "WORKSPACE_ROOT_NOT_CONFIGURED"
        : "WORKSPACE_REPOSITORY_MOUNT_NOT_CONFIGURED",
    }
  }
  const persisted = await resolvePersistedRepository(userId, definition, dependencies)
  if (!persisted.ok) return persisted
  const checkout = await verifyCanonicalTerraFusionCheckout(configuredRoot, definition.identity, dependencies)
  if (!checkout.ok) return checkout
  const revision = await observeRevision(checkout.binding.workspaceRoot, dependencies)
  if (!revision.ok) return revision

  const { projectId, projectKey, projectName } = persisted.row
  const { configuredWorkspaceRoot, workspaceRoot } = checkout.binding

  // Filesystem operations follow the currently verified checkout. Space identity is a separate,
  // server-managed continuity key: /setup seeds it from the first root and preserves it when that
  // checkout moves, so replacing a path cannot orphan persisted Spaces or browser namespaces.
  let configuredSpaceIdentity: string
  try {
    configuredSpaceIdentity = normalizePortableAbsolutePathIdentity(
      process.env.WILLIAMOS_TERRAFUSION_SPACE_IDENTITY
        || process.env.WILLIAMOS_TERRAFUSION_ROOT
        || configuredWorkspaceRoot,
    )
  } catch {
    return { ok: false, error: "WORKSPACE_SPACE_IDENTITY_INVALID" }
  }
  const baseProject = workspaceProjectFromRoot(configuredSpaceIdentity, projectName)
  const projectBinding = includeRepositoryCatalog
    ? { ...baseProject, repositories: await buildTerraFusionRepositoryCatalog(userId, dependencies) }
    : baseProject
  return {
    ok: true,
    binding: {
      projectId,
      projectKey,
      projectName,
      repositoryResourceId: persisted.row.repositoryResourceId ?? null,
      repositoryKey: definition.key,
      repositoryIdentity: definition.identity,
      repositoryRole: definition.role,
      repositoryLabel: definition.label,
      repositoryPreviewSource: definition.previewSource,
      repositoryMountKey: definition.mountKey,
      observedRevision: revision.revision,
      configuredWorkspaceRoot,
      workspaceRoot,
      workspaceAppUrl: definition.previewSource
        ? process.env.WILLIAMOS_WORKSPACE_APP_URL?.trim() || null
        : null,
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
  const selection = resolveWorkspaceRepositorySelection(WILLIAMOS_PROJECT_KEY, "williamos")
  if (!selection.ok) return selection
  const definition = selection.repository
  const persisted = await resolvePersistedRepository(userId, definition, dependencies)
  if (!persisted.ok) return persisted
  const row = persisted.row

  const checkout = await verifyCanonicalTerraFusionCheckout(
    configuredRoot,
    WILLIAMOS_REPOSITORY_IDENTITY,
    dependencies,
  )
  if (!checkout.ok) return checkout
  const revision = await observeRevision(checkout.binding.workspaceRoot, dependencies)
  if (!revision.ok) return revision

  let configuredSpaceIdentity: string
  try {
    // The checkout location is operational state; it is not the persisted Space namespace. The
    // server preserves this continuity identity when WILLIAMOS_PROJECT_ROOT later moves, exactly as
    // it does for the TerraFusion target above.
    configuredSpaceIdentity = normalizePortableAbsolutePathIdentity(
      process.env.WILLIAMOS_PROJECT_SPACE_IDENTITY || checkout.binding.configuredWorkspaceRoot,
    )
  } catch {
    return { ok: false, error: "WORKSPACE_SPACE_IDENTITY_INVALID" }
  }

  return {
    ok: true,
    binding: {
      projectId: row.projectId,
      projectKey: row.projectKey,
      projectName: row.projectName,
      repositoryResourceId: row.repositoryResourceId ?? null,
      repositoryKey: definition.key,
      repositoryIdentity: definition.identity,
      repositoryRole: definition.role,
      repositoryLabel: definition.label,
      repositoryPreviewSource: definition.previewSource,
      repositoryMountKey: definition.mountKey,
      observedRevision: revision.revision,
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
  repositoryKey?: unknown,
  options?: WorkspaceProjectBindingOptions,
): Promise<WorkspaceProjectBindingResult> {
  const selection = resolveWorkspaceRepositorySelection(projectKey, repositoryKey)
  if (!selection.ok) return selection
  if (projectKey === WILLIAMOS_PROJECT_KEY) return resolveWilliamOsWorkspaceBinding(userId, dependencies)
  return resolveTerraFusionWorkspaceBinding(userId, dependencies, selection.repository.key, {
    includeRepositoryCatalog: options?.includeRepositoryCatalog ?? repositoryKey === undefined,
  })
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
  const selection = resolveWorkspaceRepositorySelection(TERRAFUSION_PROJECT_KEY, "os-1")
  if (!selection.ok) return selection
  const persisted = await resolvePersistedRepository(userId, selection.repository, dependencies)
  if (!persisted.ok) return persisted
  const row = persisted.row
  const checkout = await verifyCanonicalTerraFusionCheckout(configuredRoot, selection.repository.identity, dependencies)
  if (!checkout.ok) return checkout

  return {
    ok: true,
    binding: {
      projectId: row.projectId,
      projectKey: row.projectKey,
      projectName: row.projectName,
      repositoryKey: selection.repository.key,
      repositoryIdentity: selection.repository.identity,
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
