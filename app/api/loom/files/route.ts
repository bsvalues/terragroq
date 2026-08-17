import fs from "node:fs/promises"
import path from "node:path"

import { getSession } from "@/lib/session"
import { isIgnoredEntry, looksBinary, resolveRealWorkspacePath } from "@/lib/loom/workspace"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()
const MAX_FILE_BYTES = 2_000_000

const refuse = (refusal: string, status: number) =>
  Response.json({ error: refusal }, { status, headers: { "cache-control": "no-store" } })

/** List a directory, or read a file, from inside the workspace. */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return refuse("UNAUTHENTICATED", 401)

  const url = new URL(request.url)
  const resolved = await resolveRealWorkspacePath(PROJECT_ROOT, url.searchParams.get("path") ?? "", fs.realpath)
  if (!resolved.ok || !resolved.absolute) return refuse(resolved.refusal ?? "PATH_INVALID", 400)

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
    return Response.json({ kind: "binary", path: resolved.relative, size: stats.size }, { headers: { "cache-control": "no-store" } })
  }
  return Response.json({
    kind: "file",
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

  let body: { path?: unknown; content?: unknown; modifiedAt?: unknown }
  try {
    body = await request.json()
  } catch {
    return refuse("BAD_REQUEST", 400)
  }
  if (typeof body.content !== "string") return refuse("CONTENT_REQUIRED", 400)

  const resolved = await resolveRealWorkspacePath(PROJECT_ROOT, body.path, fs.realpath)
  if (!resolved.ok || !resolved.absolute) return refuse(resolved.refusal ?? "PATH_INVALID", 400)

  let current
  try {
    current = await fs.stat(resolved.absolute)
  } catch {
    return refuse("NOT_FOUND", 404)
  }
  if (!current.isFile()) return refuse("NOT_A_FILE", 400)

  if (typeof body.modifiedAt === "string" && current.mtime.toISOString() !== body.modifiedAt) {
    return Response.json(
      { error: "CHANGED_ON_DISK", modifiedAt: current.mtime.toISOString() },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }

  await fs.writeFile(resolved.absolute, body.content, "utf8")
  const saved = await fs.stat(resolved.absolute)
  return Response.json(
    { ok: true, path: resolved.relative, modifiedAt: saved.mtime.toISOString(), name: path.basename(resolved.absolute) },
    { headers: { "cache-control": "no-store" } },
  )
}
