import fs from "node:fs/promises"

import { getSession } from "@/lib/session"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { writeManualOwnerWorkspaceFile } from "@/lib/loom/manual-owner-file-save"
import { isIgnoredEntry, isSensitiveWorkspacePath, looksBinary, resolveRealWorkspacePath } from "@/lib/loom/workspace"
import { parseWorkspaceFileRef, type WorkspaceFileRef } from "@/lib/projects/workspace-object-ref"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type WorkspaceProjectBinding,
} from "@/lib/projects/workspace-project-binding"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_FILE_BYTES = 2_000_000
const MAX_WRITE_BODY_BYTES = MAX_FILE_BYTES + 32_000

const refuse = (refusal: string, status: number) =>
  Response.json({ error: refusal }, { status, headers: { "cache-control": "no-store" } })

const repositoryProjection = (binding: WorkspaceProjectBinding) => ({
  key: binding.repositoryKey,
  identity: binding.repositoryIdentity,
  role: binding.repositoryRole,
  label: binding.repositoryLabel,
  previewSource: binding.repositoryPreviewSource,
  mountKey: binding.repositoryMountKey,
  observedRevision: binding.observedRevision,
})

function authoritativeFileRef(binding: WorkspaceProjectBinding, path: string): WorkspaceFileRef | null {
  if (!binding.observedRevision) return null
  return {
    projectIdentity: binding.project.identity,
    repositoryResourceKey: binding.repositoryKey,
    repositoryMountKey: binding.repositoryMountKey,
    worktreeKey: null,
    observedRevision: binding.observedRevision,
    path,
  }
}

function fileRefMatchesBinding(fileRef: WorkspaceFileRef, binding: WorkspaceProjectBinding): boolean {
  return binding.observedRevision !== null
    && fileRef.projectIdentity === binding.project.identity
    && fileRef.repositoryResourceKey === binding.repositoryKey
    && fileRef.repositoryMountKey === binding.repositoryMountKey
    && fileRef.worktreeKey === null
    && fileRef.observedRevision === binding.observedRevision
}

/** List a directory, or read a file, from inside the workspace. */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return refuse("UNAUTHENTICATED", 401)

  const url = new URL(request.url)
  const projectKey = url.searchParams.get("projectKey") ?? "terrafusion"
  const repositoryKey = url.searchParams.get("repositoryKey")
  const projectBinding = repositoryKey === null
    ? await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
    : await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey, undefined, repositoryKey)
  if (!projectBinding.ok) return refuse(projectBinding.error, 503)
  const binding = projectBinding.binding

  const resolved = await resolveRealWorkspacePath(binding.workspaceRoot, url.searchParams.get("path") ?? "", fs.realpath)
  if (!resolved.ok || !resolved.absolute) return refuse(resolved.refusal ?? "PATH_INVALID", 400)
  if (isSensitiveWorkspacePath(resolved.relative ?? "")) return refuse("SENSITIVE_PATH", 403)

  let stats
  try {
    stats = await fs.stat(resolved.absolute)
  } catch {
    return refuse("NOT_FOUND", 404)
  }

  if (stats.isDirectory()) {
    const entries = await fs.readdir(resolved.absolute, { withFileTypes: true })
    return Response.json({
      kind: "directory",
      project: binding.project,
      repository: repositoryProjection(binding),
      path: resolved.relative,
      entries: entries
        .filter((entry) => !isIgnoredEntry(entry.name))
        // Directories first, then alphabetical: the order a person expects to read.
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .map((entry) => ({
          name: entry.name,
          path: resolved.relative === "" ? entry.name : `${resolved.relative}/${entry.name}`,
          directory: entry.isDirectory(),
        })),
    }, { headers: { "cache-control": "no-store" } })
  }

  if (stats.size > MAX_FILE_BYTES) return refuse("FILE_TOO_LARGE", 413)

  const bytes = await fs.readFile(resolved.absolute)
  if (looksBinary(bytes)) {
    return Response.json({ kind: "binary", project: binding.project, repository: repositoryProjection(binding), path: resolved.relative, size: stats.size }, { headers: { "cache-control": "no-store" } })
  }
  return Response.json({
    kind: "file",
    project: binding.project,
    repository: repositoryProjection(binding),
    path: resolved.relative,
    content: bytes.toString("utf8"),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  }, { headers: { "cache-control": "no-store" } })
}

/**
 * Save an edited file.
 *
 * The write is refused when the file changed on disk since it was opened, so an edit made here
 * cannot silently discard work the agent did in the same file while the tab sat open. The client
 * sends back the modification time it read; a mismatch is a conflict, not a merge.
 */
export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) return refuse("UNAUTHENTICATED", 401)

  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) {
    return Response.json(
      { error: owner.failure, detail: owner.detail },
      { status: owner.failure === "NOT_OWNER" ? 403 : 409, headers: { "cache-control": "no-store" } },
    )
  }

  const parsed = await readBoundedJson(request, MAX_WRITE_BODY_BYTES)
  if (!parsed.ok) return refuse(parsed.error, parsed.status)
  const body = parsed.value as {
    fileRef?: unknown
    path?: unknown
    content?: unknown
    modifiedAt?: unknown
    projectKey?: unknown
    repositoryKey?: unknown
  }
  if (typeof body.content !== "string") return refuse("CONTENT_REQUIRED", 400)
  if (body.fileRef === undefined) return refuse("WORKSPACE_FILE_REF_REQUIRED", 400)
  let fileRef: WorkspaceFileRef
  try {
    fileRef = parseWorkspaceFileRef(body.fileRef)
  } catch {
    return refuse("WORKSPACE_FILE_REF_INVALID", 400)
  }
  if ((body.path !== undefined && body.path !== fileRef.path)
    || (body.repositoryKey !== undefined && body.repositoryKey !== fileRef.repositoryResourceKey)) {
    return refuse("WORKSPACE_FILE_REF_STALE", 409)
  }
  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(
    session.user.id,
    body.projectKey ?? "terrafusion",
    undefined,
    fileRef.repositoryResourceKey,
  )
  if (!projectBinding.ok) return refuse(projectBinding.error, 503)
  const binding = projectBinding.binding
  if (!fileRefMatchesBinding(fileRef, binding)) return refuse("WORKSPACE_FILE_REF_STALE", 409)

  const result = await writeManualOwnerWorkspaceFile({
    path: fileRef.path,
    content: body.content,
    modifiedAt: body.modifiedAt,
  }, binding.workspaceRoot)
  if (!result.ok) {
    return Response.json(result, { status: result.status, headers: { "cache-control": "no-store" } })
  }
  return Response.json({
    ...result,
    project: binding.project,
    repository: repositoryProjection(binding),
    fileRef: authoritativeFileRef(binding, result.path),
  }, { headers: { "cache-control": "no-store" } })
}
