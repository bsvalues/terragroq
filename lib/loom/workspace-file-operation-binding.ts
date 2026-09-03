import { parseWorkspaceFileRef, type WorkspaceFileRef } from "@/lib/projects/workspace-object-ref"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type WorkspaceProjectBinding,
} from "@/lib/projects/workspace-project-binding"

export class WorkspaceFileOperationBindingError extends Error {
  readonly code:
    | "WORKSPACE_FILE_REF_REQUIRED"
    | "WORKSPACE_FILE_REF_MISMATCH"
    | "WORKSPACE_FILE_REF_STALE"
    | "WORKSPACE_REPOSITORY_UNAVAILABLE"

  constructor(code: WorkspaceFileOperationBindingError["code"]) {
    super(code)
    this.name = "WorkspaceFileOperationBindingError"
    this.code = code
  }
}

type BindingResolver = typeof resolveCanonicalWorkspaceProjectBinding

function exactText(value: unknown): string | null {
  return typeof value === "string" && value === value.trim() && value.length > 0 ? value : null
}

/**
 * Re-resolve one browser-selected file against the server repository catalog and current mount.
 * The WorkspaceFileRef is object identity, not authority; this function grants nothing.
 */
export async function resolveWorkspaceFileOperationBinding(input: Readonly<{
  userId: string
  projectKey: unknown
  repositoryKey: unknown
  path: unknown
  fileRef: unknown
}>, resolve: BindingResolver = resolveCanonicalWorkspaceProjectBinding): Promise<Readonly<{
  binding: WorkspaceProjectBinding
  fileRef: WorkspaceFileRef
}>> {
  let fileRef: WorkspaceFileRef
  try {
    fileRef = parseWorkspaceFileRef(input.fileRef)
  } catch {
    throw new WorkspaceFileOperationBindingError("WORKSPACE_FILE_REF_REQUIRED")
  }
  const path = exactText(input.path)
  const repositoryKey = exactText(input.repositoryKey)
  if (!path || path !== fileRef.path || !repositoryKey || repositoryKey !== fileRef.repositoryResourceKey
    || fileRef.worktreeKey !== null) {
    throw new WorkspaceFileOperationBindingError("WORKSPACE_FILE_REF_MISMATCH")
  }
  const result = await resolve(input.userId, input.projectKey, undefined, repositoryKey)
  if (!result.ok) throw new WorkspaceFileOperationBindingError("WORKSPACE_REPOSITORY_UNAVAILABLE")
  const binding = result.binding
  if (binding.project.identity !== fileRef.projectIdentity
    || binding.repositoryKey !== fileRef.repositoryResourceKey
    || binding.repositoryMountKey !== fileRef.repositoryMountKey
    || binding.repositoryIdentity.length === 0) {
    throw new WorkspaceFileOperationBindingError("WORKSPACE_FILE_REF_MISMATCH")
  }
  if (!binding.observedRevision || binding.observedRevision !== fileRef.observedRevision) {
    throw new WorkspaceFileOperationBindingError("WORKSPACE_FILE_REF_STALE")
  }
  return { binding, fileRef }
}

export function sameWorkspaceFileOperationBinding(
  left: WorkspaceProjectBinding,
  right: WorkspaceProjectBinding,
): boolean {
  return left.projectId === right.projectId
    && left.projectKey === right.projectKey
    && left.project.identity === right.project.identity
    && left.repositoryResourceId === right.repositoryResourceId
    && left.repositoryKey === right.repositoryKey
    && left.repositoryIdentity === right.repositoryIdentity
    && left.repositoryMountKey === right.repositoryMountKey
    && left.observedRevision === right.observedRevision
    && left.workspaceRoot === right.workspaceRoot
}
