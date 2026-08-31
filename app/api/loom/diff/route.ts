import fs from "node:fs/promises"

import { getSession } from "@/lib/session"
import { isSensitiveWorkspacePath, resolveRealWorkspacePath } from "@/lib/loom/workspace"
import { deriveWorkspaceFileDiff } from "@/lib/loom/workspace-diff"
import { resolveTerraFusionWorkspaceBinding } from "@/lib/projects/workspace-project-binding"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * The current diff for one exact selected file. Whole-repository requests are refused because an
 * unscoped response can expose changes from sensitive or unrelated paths.
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
  const projectBinding = await resolveTerraFusionWorkspaceBinding(session.user.id)
  if (!projectBinding.ok) return Response.json({ error: projectBinding.error }, { status: 503 })
  const projectRoot = projectBinding.binding.workspaceRoot

  const requested = new URL(request.url).searchParams.get("path")
  if (requested === null || requested === "") return Response.json({ error: "DIFF_PATH_REQUIRED" }, { status: 400 })
  if (isSensitiveWorkspacePath(requested)) {
    return Response.json({ error: "SENSITIVE_PATH" }, { status: 400 })
  }
  const resolved = await resolveRealWorkspacePath(projectRoot, requested, fs.realpath)
  if (!resolved.ok || !resolved.relative) {
    return Response.json({ error: resolved?.refusal ?? "PATH_INVALID" }, { status: 400 })
  }
  if (isSensitiveWorkspacePath(resolved.relative)) {
    return Response.json({ error: "SENSITIVE_PATH" }, { status: 400 })
  }

  try {
    const snapshot = await deriveWorkspaceFileDiff(projectRoot, resolved.relative)
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
  } catch {
    // A repository with no commits, or a git failure, must not look like "nothing has changed".
    return Response.json({ error: "DIFF_UNAVAILABLE" }, { status: 503 })
  }
}
