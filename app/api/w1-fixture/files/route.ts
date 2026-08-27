import fs from "node:fs/promises"

import { readBoundedJson } from "@/lib/environment/line-guard"
import { admitW1LocalFixtureRequest, validateW1LocalFixtureHome } from "@/lib/environment/w1-local-fixture"
import { isIgnoredEntry, looksBinary, resolveRealWorkspacePath } from "@/lib/loom/workspace"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_FILE_BYTES = 2_000_000
const refuse = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } })

export async function GET(request: Request) {
  const fixture = admitW1LocalFixtureRequest(request)
  if (!fixture || !(await validateW1LocalFixtureHome(fixture))) return refuse("NOT_FOUND", 404)
  const requested = new URL(request.url).searchParams.get("path") ?? ""
  const resolved = await resolveRealWorkspacePath(fixture.root, requested, fs.realpath)
  if (!resolved.ok || !resolved.absolute) return refuse(resolved.refusal ?? "PATH_INVALID", 400)
  let stats
  try { stats = await fs.stat(resolved.absolute) } catch { return refuse("NOT_FOUND", 404) }
  if (stats.isDirectory()) {
    const entries = await fs.readdir(resolved.absolute, { withFileTypes: true })
    return Response.json({
      kind: "directory",
      path: resolved.relative,
      entries: entries
        .filter((entry) => !isIgnoredEntry(entry.name))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .map((entry) => ({
          name: entry.name,
          path: resolved.relative ? `${resolved.relative}/${entry.name}` : entry.name,
          directory: entry.isDirectory(),
        })),
    }, { headers: { "cache-control": "no-store" } })
  }
  if (stats.size > MAX_FILE_BYTES) return refuse("FILE_TOO_LARGE", 413)
  const bytes = await fs.readFile(resolved.absolute)
  if (looksBinary(bytes)) return Response.json({ kind: "binary", path: resolved.relative, size: stats.size })
  return Response.json({
    kind: "file", path: resolved.relative, content: bytes.toString("utf8"), size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  }, { headers: { "cache-control": "no-store" } })
}

export async function PUT(request: Request) {
  const fixture = admitW1LocalFixtureRequest(request)
  if (!fixture || !(await validateW1LocalFixtureHome(fixture))) return refuse("NOT_FOUND", 404)
  const parsed = await readBoundedJson(request, MAX_FILE_BYTES + 32_000)
  if (!parsed.ok) return refuse(parsed.error, parsed.status)
  const body = parsed.value as { path?: unknown; content?: unknown; modifiedAt?: unknown }
  if (typeof body.content !== "string" || Buffer.byteLength(body.content, "utf8") > MAX_FILE_BYTES) return refuse("CONTENT_INVALID", 400)
  if (typeof body.modifiedAt !== "string") return refuse("MODIFIED_AT_REQUIRED", 400)
  const resolved = await resolveRealWorkspacePath(fixture.root, body.path, fs.realpath)
  if (!resolved.ok || !resolved.absolute || !resolved.relative) return refuse(resolved.refusal ?? "PATH_INVALID", 400)
  let before
  try { before = await fs.stat(resolved.absolute) } catch { return refuse("NOT_FOUND", 404) }
  if (!before.isFile()) return refuse("NOT_A_FILE", 400)
  if (before.mtime.toISOString() !== body.modifiedAt) return refuse("CHANGED_ON_DISK", 409)
  await fs.writeFile(resolved.absolute, body.content, "utf8")
  const after = await fs.stat(resolved.absolute)
  return Response.json({ ok: true, path: resolved.relative, modifiedAt: after.mtime.toISOString() }, {
    headers: { "cache-control": "no-store" },
  })
}
