import { spawn } from "node:child_process"

import { getSession } from "@/lib/session"
import { LOCAL_ENDPOINT, LOCAL_MODEL } from "@/lib/loom/providers"
import { resolveWorkspacePath } from "@/lib/loom/workspace"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()
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

  let body: { path?: unknown; task?: unknown; model?: unknown; test?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }

  const task = typeof body.task === "string" ? body.task.trim() : ""
  if (!task) return Response.json({ error: "TASK_REQUIRED" }, { status: 400 })

  const resolved = resolveWorkspacePath(PROJECT_ROOT, body.path)
  if (!resolved.ok || !resolved.relative) {
    return Response.json({ error: resolved.refusal ?? "PATH_INVALID" }, { status: 400 })
  }

  const model = typeof body.model === "string" && body.model ? body.model : LOCAL_MODEL
  const args = [
    "-m", "sea", "worker",
    "--root", PROJECT_ROOT,
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

      send({ type: "started", file: resolved.relative, model })

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
