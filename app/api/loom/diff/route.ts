import { execFile } from "node:child_process"
import { promisify } from "node:util"

import fs from "node:fs/promises"

import { getSession } from "@/lib/session"
import { resolveRealWorkspacePath } from "@/lib/loom/workspace"
import { deriveWorkspaceFileDiff } from "@/lib/loom/workspace-diff"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const run = promisify(execFile)
const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()
const MAX_DIFF_BYTES = 2_000_000

/**
 * The current diff, for one file or for the whole working tree.
 *
 * git is invoked with a fixed argument list and the validated relative path passed after `--`, so a
 * path can never be read as an option however it is spelled. An untracked file has nothing to diff
 * against, so it is reported as added rather than coming back mysteriously empty -- "no output" and
 * "brand new file" look identical otherwise, and that ambiguity is exactly what makes a diff view
 * untrustworthy.
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  const requested = new URL(request.url).searchParams.get("path")
  const scoped = requested !== null && requested !== ""
  const resolved = scoped ? await resolveRealWorkspacePath(PROJECT_ROOT, requested, fs.realpath) : null
  if (scoped && (!resolved?.ok || !resolved.relative)) {
    return Response.json({ error: resolved?.refusal ?? "PATH_INVALID" }, { status: 400 })
  }

  const options = { cwd: PROJECT_ROOT, maxBuffer: MAX_DIFF_BYTES, windowsHide: true } as const

  try {
    if (scoped && resolved?.relative) {
      const snapshot = await deriveWorkspaceFileDiff(PROJECT_ROOT, resolved.relative)
      if (snapshot.state === "git-unavailable") {
        return Response.json({ error: "GIT_UNAVAILABLE", state: snapshot.state, path: snapshot.path }, { status: 503 })
      }
      if (snapshot.state === "oversize") {
        return Response.json({
          ...snapshot,
          untracked: false,
          diff: "",
          note: "The current patch exceeds the Changes grounding limit.",
        }, { headers: { "cache-control": "no-store" } })
      }
      if (snapshot.state === "untracked") {
        return Response.json(
          { ...snapshot, untracked: true, diff: "", note: "This file is new — it is not in git yet." },
          { headers: { "cache-control": "no-store" } },
        )
      }
      return Response.json({ ...snapshot, untracked: false, diff: snapshot.patch }, { headers: { "cache-control": "no-store" } })
    }

    const [{ stdout: diff }, { stdout: status }] = await Promise.all([
      run("git", ["diff", "--patch", "--no-color", "HEAD"], options),
      run("git", ["status", "--short"], options),
    ])
    return Response.json({ path: null, untracked: false, diff, status }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    // A repository with no commits, or a git failure, must not look like "nothing has changed".
    return Response.json({ error: "DIFF_UNAVAILABLE", detail: String((error as Error)?.message ?? error).slice(0, 300) }, { status: 503 })
  }
}
