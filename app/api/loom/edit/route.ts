import { spawn } from "node:child_process"

import fs from "node:fs/promises"

import { getSession } from "@/lib/session"
import { LOCAL_ENDPOINT, LOCAL_MODEL } from "@/lib/loom/providers"
import { isSensitiveWorkspacePath, resolveRealWorkspacePath } from "@/lib/loom/workspace"
import { recordLoomEnd, recordLoomEvidence, recordLoomStart } from "@/lib/loom/receipts"
import { deriveSpaceMutationAuthority, SpaceMutationAuthorityError, type SpaceMutationAuthority } from "@/lib/governance/space-mutation-authority"
import { loadOwnedWorkingWorld } from "@/lib/environment/space-persistence"
import { deriveWorkspaceFileDiff } from "@/lib/loom/workspace-diff"
import {
  resolveWorkspaceFileOperationBinding,
  sameWorkspaceFileOperationBinding,
  WorkspaceFileOperationBindingError,
} from "@/lib/loom/workspace-file-operation-binding"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SEA_ROOT = process.env.WILLIAMOS_SEA_ROOT ?? "D:/williamos-sea"
const PYTHON = process.env.WILLIAMOS_PYTHON ?? "python"
const EDIT_TIMEOUT_MS = 20 * 60_000

/**
 * Have the LOCAL model edit a file, through the structured-edit adapter rather than freehand.
 *
 * A small local model cannot be trusted to rewrite a file directly -- that is the finding SEA was
 * built on. So it never writes: it proposes validated JSON edits, and the adapter checks each one is
 * uniquely anchored, applies them atomically, verifies, and restores the workspace if nothing
 * verifies. A failed attempt leaves the file exactly as it was rather than half-edited, which is what
 * makes an unreliable model safe to point at real code.
 *
 * The adapter is invoked rather than reimplemented. It already has its own test suite, and a second
 * copy of this logic in TypeScript would be one more thing to keep honest.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let body: { path?: unknown; task?: unknown; model?: unknown; test?: unknown; intent?: unknown; worldId?: unknown; expectedDiffFingerprint?: unknown; projectKey?: unknown; repositoryKey?: unknown; fileRef?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }
  let selectedFile
  try {
    selectedFile = await resolveWorkspaceFileOperationBinding({
      userId: session.user.id,
      projectKey: body.projectKey ?? "terrafusion",
      repositoryKey: body.repositoryKey,
      path: body.path,
      fileRef: body.fileRef,
    })
  } catch (error) {
    const code = error instanceof WorkspaceFileOperationBindingError ? error.code : "WORKSPACE_REPOSITORY_UNAVAILABLE"
    return Response.json({ error: code }, { status: code === "WORKSPACE_REPOSITORY_UNAVAILABLE" ? 503 : code === "WORKSPACE_FILE_REF_REQUIRED" ? 400 : 409 })
  }
  const binding = selectedFile.binding
  const projectRoot = binding.workspaceRoot

  const task = typeof body.task === "string" ? body.task.trim() : ""
  if (!task) return Response.json({ error: "TASK_REQUIRED" }, { status: 400 })

  if (typeof body.path === "string" && isSensitiveWorkspacePath(body.path)) {
    return Response.json({ error: "SENSITIVE_PATH" }, { status: 403 })
  }
  const resolved = await resolveRealWorkspacePath(projectRoot, body.path, fs.realpath)
  if (!resolved.ok || !resolved.relative) {
    return Response.json({ error: resolved.refusal ?? "PATH_INVALID" }, { status: 400 })
  }
  if (isSensitiveWorkspacePath(resolved.relative)) {
    return Response.json({ error: "SENSITIVE_PATH" }, { status: 403 })
  }

  const worldId = typeof body.worldId === "string" ? body.worldId : ""
  let mutationAuthority: SpaceMutationAuthority
  try {
    mutationAuthority = await deriveSpaceMutationAuthority({
      userId: session.user.id,
      worldId,
      binding: {
        projectId: binding.projectId,
        projectKey: binding.projectKey,
        repositoryResourceKey: binding.repositoryKey,
        repositoryIdentity: binding.repositoryIdentity,
        repositoryMountKey: binding.repositoryMountKey,
        observedRevision: binding.observedRevision,
        spaceIdentity: binding.project.identity,
      },
      expected: { actor: "sea", capability: "selected-file-change" },
      target: { kind: "selected-file", requestedPath: resolved.relative },
    })
  } catch (error) {
    return Response.json({ error: error instanceof SpaceMutationAuthorityError ? error.code : "SPACE_MUTATION_AUTHORITY_UNAVAILABLE" }, {
      status: error instanceof SpaceMutationAuthorityError ? 403 : 503,
    })
  }

  if (body.intent === "improve-diff") {
    const expectedDiffFingerprint = typeof body.expectedDiffFingerprint === "string" ? body.expectedDiffFingerprint : ""
    if (!worldId || worldId.length > 200 || /[\0-\x1f\x7f]/.test(worldId)
      || !expectedDiffFingerprint || expectedDiffFingerprint.length > 16_384) {
      return Response.json({ error: "DIFF_CONTEXT_STALE" }, { status: 409 })
    }
    const world = await loadOwnedWorkingWorld(session.user.id, worldId)
    const activeDiff = world?.space?.windows?.find((window) => window.id === "workspace-diff")
    const activePane = world?.space?.panes?.find((pane) => pane.id === world.space?.activePaneId) ?? null
    const selectedPath = world?.space?.selection?.filePath ?? activePane?.filePath ?? null
    if (!world || world.space?.activeWindowId !== "workspace-diff" || !activeDiff || activeDiff.minimized
      || selectedPath !== resolved.relative) {
      return Response.json({ error: "DIFF_CONTEXT_STALE" }, { status: 409 })
    }
    // The browser supplies only the expected identity; the server derives current Git truth for
    // the exact persisted selection itself, then rechecks that selection before spawning.
    const currentDiff = await deriveWorkspaceFileDiff(projectRoot, resolved.relative)
    if (currentDiff.state !== "modified" || currentDiff.fingerprint !== expectedDiffFingerprint) {
      return Response.json({ error: "DIFF_CONTEXT_STALE" }, { status: 409 })
    }
    const terminalWorld = await loadOwnedWorkingWorld(session.user.id, worldId)
    const terminalDiff = terminalWorld?.space?.windows?.find((window) => window.id === "workspace-diff")
    const terminalPane = terminalWorld?.space?.panes?.find((pane) => pane.id === terminalWorld.space?.activePaneId) ?? null
    const terminalPath = terminalWorld?.space?.selection?.filePath ?? terminalPane?.filePath ?? null
    if (!terminalWorld || terminalWorld.space?.activeWindowId !== "workspace-diff" || !terminalDiff
      || terminalDiff.minimized || terminalPath !== resolved.relative) {
      return Response.json({ error: "DIFF_CONTEXT_STALE" }, { status: 409 })
    }
    // Loading the terminal owned Space is itself an await boundary. Re-derive Git identity after it
    // and immediately before spawn so a patch/index/HEAD change during that load cannot cross the
    // mutation boundary under the earlier fingerprint.
    const terminalDiffSnapshot = await deriveWorkspaceFileDiff(projectRoot, resolved.relative)
    if (terminalDiffSnapshot.state !== "modified" || terminalDiffSnapshot.fingerprint !== expectedDiffFingerprint) {
      return Response.json({ error: "DIFF_CONTEXT_STALE" }, { status: 409 })
    }
  }

  // Every Space/diff/filesystem await above can race the active Work Order or grant. Re-derive the
  // exact SEA authority immediately before spawn and reject any snapshot drift.
  try {
    const currentFile = await resolveWorkspaceFileOperationBinding({
      userId: session.user.id,
      projectKey: body.projectKey ?? "terrafusion",
      repositoryKey: body.repositoryKey,
      path: body.path,
      fileRef: body.fileRef,
    })
    if (!sameWorkspaceFileOperationBinding(binding, currentFile.binding)) {
      return Response.json({ error: "WORKSPACE_FILE_REF_STALE" }, { status: 409 })
    }
    const terminalAuthority = await deriveSpaceMutationAuthority({
      userId: session.user.id,
      worldId,
      binding: {
        projectId: binding.projectId,
        projectKey: binding.projectKey,
        repositoryResourceKey: binding.repositoryKey,
        repositoryIdentity: binding.repositoryIdentity,
        repositoryMountKey: binding.repositoryMountKey,
        observedRevision: binding.observedRevision,
        spaceIdentity: binding.project.identity,
      },
      expected: { actor: "sea", capability: "selected-file-change" },
      target: { kind: "selected-file", requestedPath: resolved.relative },
    })
    if (terminalAuthority.worldRevision !== mutationAuthority.worldRevision
      || terminalAuthority.workOrderId !== mutationAuthority.workOrderId
      || terminalAuthority.grantId !== mutationAuthority.grantId
      || terminalAuthority.selectedPath !== mutationAuthority.selectedPath
      || terminalAuthority.repositoryResourceKey !== mutationAuthority.repositoryResourceKey
      || terminalAuthority.repositoryIdentity !== mutationAuthority.repositoryIdentity
      || terminalAuthority.repositoryMountKey !== mutationAuthority.repositoryMountKey
      || terminalAuthority.observedRevision !== mutationAuthority.observedRevision) {
      return Response.json({ error: "SPACE_MUTATION_AUTHORITY_STALE" }, { status: 409 })
    }
  } catch (error) {
    const fileBindingStale = error instanceof WorkspaceFileOperationBindingError
    return Response.json({ error: fileBindingStale
      ? error.code === "WORKSPACE_REPOSITORY_UNAVAILABLE" ? error.code : "WORKSPACE_FILE_REF_STALE"
      : error instanceof SpaceMutationAuthorityError ? "SPACE_MUTATION_AUTHORITY_STALE" : "SPACE_MUTATION_AUTHORITY_UNAVAILABLE" }, {
      status: fileBindingStale ? error.code === "WORKSPACE_REPOSITORY_UNAVAILABLE" ? 503 : 409
        : error instanceof SpaceMutationAuthorityError ? 409 : 503,
    })
  }

  const model = typeof body.model === "string" && body.model ? body.model : LOCAL_MODEL
  const args = [
    "-m", "sea", "worker",
    "--root", projectRoot,
    "--base-url", LOCAL_ENDPOINT,
    "--model", model,
    "--api", "ollama",
    "--task", task,
    "--target", resolved.relative,
    // The compile check is Python-specific; this repository is TypeScript, so verification comes
    // from the caller's test command instead of from a check that could never pass here.
    "--no-compile",
  ]
  if (typeof body.test === "string" && body.test.trim()) args.push("--test", body.test.trim())

  // Every value above is either a constant or a validated path/model name, and no shell is involved,
  // so the task text cannot become anything other than a single argument.
  const child = spawn(PYTHON, args, { cwd: SEA_ROOT, shell: false, windowsHide: true })
  child.stdin.end()

  let settled = false
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)) } catch { /* reader gone */ }
      }
      const finish = (event: Record<string, unknown>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        send(event)
        try { controller.close() } catch { /* already closed */ }
      }

      send({ type: "started", file: resolved.relative, model, fileRef: selectedFile.fileRef })
      void recordLoomStart({
        userId: session.user.id,
        kind: "edit",
        subject: resolved.relative!,
        metadata: { model, provider: "local", task: task.slice(0, 500) },
      })

      const timer = setTimeout(() => {
        child.kill()
        finish({ type: "done", reason: "TIMEOUT" })
      }, EDIT_TIMEOUT_MS)

      // The adapter prints one JSON receipt at the end; stderr carries its progress. Both are
      // forwarded so the operator sees the attempt unfold instead of waiting on a silent process.
      let stdout = ""
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8") })
      child.stderr.on("data", (chunk: Buffer) => send({ type: "progress", text: chunk.toString("utf8") }))
      child.on("error", (error) => finish({ type: "done", reason: String(error?.message ?? "SEA_UNAVAILABLE") }))
      child.on("close", (code) => {
        let receipt: unknown = null
        try { receipt = JSON.parse(stdout) } catch { receipt = null }
        // An unparseable receipt is reported as such: claiming success from a zero exit code while
        // the outcome is unknown is exactly how a half-applied edit gets called done.
        // The adapter's verdict is the evidence for this change; it is recorded before the stream
        // closes so a reader can see whether edits verified or the workspace was restored.
        void recordLoomEvidence({ userId: session.user.id, subject: resolved.relative!, receipt: receipt as Record<string, unknown> | null })
        void recordLoomEnd({
          userId: session.user.id,
          kind: "edit",
          subject: resolved.relative!,
          outcome: { code, model, success: (receipt as { success?: boolean } | null)?.success ?? null },
        })
        finish({ type: "done", reason: null, code, receipt, raw: receipt === null ? stdout.slice(0, 2000) : undefined })
      })

      request.signal.addEventListener("abort", () => {
        child.kill()
        finish({ type: "done", reason: "CANCELLED" })
      })
    },
    cancel() {
      child.kill()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  })
}
