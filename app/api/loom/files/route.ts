import fs from "node:fs/promises"

import { getSession } from "@/lib/session"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { isIgnoredEntry, looksBinary, resolveRealWorkspacePath } from "@/lib/loom/workspace"
import { workspaceFileWriteDependencies, writeGovernedWorkspaceFile } from "@/lib/loom/workspace-file-write"
import { resolveTerraFusionWorkspaceBinding } from "@/lib/projects/workspace-project-binding"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_FILE_BYTES = 2_000_000
const MAX_WRITE_BODY_BYTES = MAX_FILE_BYTES + 32_000

const refuse = (refusal: string, status: number) =>
  Response.json({ error: refusal }, { status, headers: { "cache-control": "no-store" } })

/** List a directory, or read a file, from inside the selected Project workspace. */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return refuse("UNAUTHENTICATED", 401)

  const projectBinding = await resolveTerraFusionWorkspaceBinding(session.user.id)
  if (!projectBinding.ok) return refuse(projectBinding.error, 503)
  const binding = projectBinding.binding

  const url = new URL(request.url)
  const resolved = await resolveRealWorkspacePath(binding.workspaceRoot, url.searchParams.get("path") ?? "", fs.realpath)
  if (!resolved.ok || !resolved.absolute) return refuse(resolved.refusal ?? "PATH_INVALID", 400)

  let stats
  try {
    stats = await fs.stat(resolved.absolute)
  } catch {
    return refuse("NOT_FOUND", 404)
  }

  const projectIdentity = {
    id: binding.projectId,
    key: binding.projectKey,
    name: binding.projectName,
    repository: binding.repositoryIdentity,
  }

  if (stats.isDirectory()) {
    const entries = await fs.readdir(resolved.absolute, { withFileTypes: true })
    return Response.json({
      kind: "directory",
      project: projectIdentity,
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
    return Response.json({ kind: "binary", project: projectIdentity, path: resolved.relative, size: stats.size }, { headers: { "cache-control": "no-store" } })
  }
  return Response.json({
    kind: "file",
    project: projectIdentity,
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

  const projectBinding = await resolveTerraFusionWorkspaceBinding(session.user.id)
  if (!projectBinding.ok) return refuse(projectBinding.error, 503)
  const binding = projectBinding.binding

  const parsed = await readBoundedJson(request, MAX_WRITE_BODY_BYTES)
  if (!parsed.ok) return refuse(parsed.error, parsed.status)
  const body = parsed.value as { path?: unknown; content?: unknown; modifiedAt?: unknown }
  if (typeof body.content !== "string") return refuse("CONTENT_REQUIRED", 400)

  const result = await writeGovernedWorkspaceFile({
    userId: session.user.id,
    path: body.path,
    content: body.content,
    modifiedAt: body.modifiedAt,
  }, workspaceFileWriteDependencies(binding.workspaceRoot))
  if (!result.ok) {
    return Response.json(result, { status: result.status, headers: { "cache-control": "no-store" } })
  }
  return Response.json({
    ...result,
    project: {
      id: binding.projectId,
      key: binding.projectKey,
      name: binding.projectName,
      repository: binding.repositoryIdentity,
    },
  }, { headers: { "cache-control": "no-store" } })
}
