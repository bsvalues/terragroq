export type WorkspaceFileRef = Readonly<{
  projectIdentity: string
  repositoryResourceKey: string
  repositoryMountKey: string
  worktreeKey: string | null
  /** Exact revision observed when the file was loaded. This fences stale work but is not the tab identity. */
  observedRevision: string
  path: string
}>

const FILE_REF_KEYS = new Set([
  "projectIdentity",
  "repositoryResourceKey",
  "repositoryMountKey",
  "worktreeKey",
  "observedRevision",
  "path",
])

function identity(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || value.includes("\0")
    || value.includes("\\") || value.startsWith("/") || value.split("/").includes("..")
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    throw new Error(`WORKSPACE_FILE_REF_${field}_INVALID`)
  }
  return value
}

function relativePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000 || value.includes("\0")) {
    throw new Error("WORKSPACE_FILE_REF_PATH_INVALID")
  }
  const raw = value.replace(/\\/g, "/")
  if (raw.startsWith("/") || raw.startsWith("//") || /^[A-Za-z]:/.test(raw)) {
    throw new Error("WORKSPACE_FILE_REF_PATH_INVALID")
  }
  const segments = raw.split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    throw new Error("WORKSPACE_FILE_REF_PATH_INVALID")
  }
  return segments.join("/")
}

export function parseWorkspaceFileRef(value: unknown): WorkspaceFileRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("WORKSPACE_FILE_REF_INVALID")
  }
  const candidate = value as Record<string, unknown>
  for (const key of Object.keys(candidate)) {
    if (!FILE_REF_KEYS.has(key)) throw new Error(`WORKSPACE_FILE_REF_UNKNOWN_KEY:${key}`)
  }
  const worktreeKey = candidate.worktreeKey === null
    ? null
    : identity(candidate.worktreeKey, "WORKTREE_KEY")
  const observedRevision = typeof candidate.observedRevision === "string" && /^[a-f0-9]{40,64}$/.test(candidate.observedRevision)
    ? candidate.observedRevision
    : null
  if (!observedRevision) throw new Error("WORKSPACE_FILE_REF_REVISION_INVALID")

  return Object.freeze({
    projectIdentity: identity(candidate.projectIdentity, "PROJECT_IDENTITY"),
    repositoryResourceKey: identity(candidate.repositoryResourceKey, "REPOSITORY_RESOURCE_KEY"),
    repositoryMountKey: identity(candidate.repositoryMountKey, "REPOSITORY_MOUNT_KEY"),
    worktreeKey,
    observedRevision,
    path: relativePath(candidate.path),
  })
}

/** Stable tab/object identity. Revision changes are detected separately as stale-state evidence. */
export function canonicalWorkspaceObjectKey(value: WorkspaceFileRef): string {
  const ref = parseWorkspaceFileRef(value)
  return JSON.stringify([
    ref.projectIdentity,
    ref.repositoryResourceKey,
    ref.repositoryMountKey,
    ref.worktreeKey,
    ref.path,
  ])
}

export function sameWorkspaceObject(left: WorkspaceFileRef, right: WorkspaceFileRef): boolean {
  return canonicalWorkspaceObjectKey(left) === canonicalWorkspaceObjectKey(right)
}
