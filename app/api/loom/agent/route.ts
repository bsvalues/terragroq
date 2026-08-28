import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import fs from "node:fs/promises"

import { getSession } from "@/lib/session"
import { LOCAL_ENDPOINT, LOCAL_MODEL, resolveProvider } from "@/lib/loom/providers"
import { recordLoomEnd, recordLoomStart } from "@/lib/loom/receipts"
import { assertThreadResume, loomThreadDescriptor } from "@/lib/loom/threads"
import { resolveRealWorkspacePath } from "@/lib/loom/workspace"
import { requireWorkContext, workContextRefusal } from "@/lib/governance/work-context-gate"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()
const AGENT_BIN = process.env.WILLIAMOS_AGENT_BIN ?? "claude"
const AGENT_TIMEOUT_MS = 60 * 60_000
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Work with the agent, inside the cockpit, on the real checkout.
 *
 * The mistake this replaces was building an agent-shaped page: buttons that ran fixed commands and
 * called it a workroom. The operator does not want a menu, he wants to say what he wants and watch
 * it happen against his actual files -- which is what the agent already installed on this machine
 * does. So this hosts that agent rather than imitating it: the CLI runs in the project directory and
 * its event stream is forwarded to the browser verbatim.
 *
 * Threads are durable because the session id is ours, not the CLI's: we mint it, pass it in, and the
 * same id resumes the same conversation later with its history and rationale intact.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let body: {
    prompt?: unknown
    sessionId?: unknown
    resume?: unknown
    mode?: unknown
    path?: unknown
    focus?: unknown
    provider?: unknown
    model?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }

  const reviewMode = body.mode === "review"
  let reviewPath: string | null = null
  let reviewFocus: string | null = null
  let prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""

  if (reviewMode) {
    const resolved = await resolveRealWorkspacePath(PROJECT_ROOT, body.path, fs.realpath)
    if (!resolved.ok || !resolved.absolute || !resolved.relative || resolved.relative === ".") {
      return Response.json({ error: resolved.refusal ?? "PATH_INVALID" }, { status: 400 })
    }
    if ([...resolved.relative].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })) {
      return Response.json({ error: "PATH_INVALID" }, { status: 400 })
    }
    try {
      const target = await fs.stat(resolved.absolute)
      if (!target.isFile()) {
        return Response.json({ error: "REVIEW_FILE_REQUIRED" }, { status: 400 })
      }
    } catch {
      return Response.json({ error: "REVIEW_FILE_REQUIRED" }, { status: 400 })
    }
    if (body.focus !== undefined && typeof body.focus !== "string") {
      return Response.json({ error: "FOCUS_INVALID" }, { status: 400 })
    }
    const focus = typeof body.focus === "string" ? body.focus.trim() : ""
    if (focus.length > 2_000) {
      return Response.json({ error: "FOCUS_TOO_LONG" }, { status: 400 })
    }
    reviewPath = resolved.relative
    reviewFocus = focus || null
    prompt = [
      `Review the selected workspace file: ${reviewPath}`,
      ...(reviewFocus ? [`Focus: ${reviewFocus}`] : []),
      "Perform a mechanically read-only code review. Inspect this file and only the relevant read-only context.",
      "Report actionable findings first, ordered by severity, with exact file and line references.",
      "Identify correctness, security, reliability, and regression risks. If there are no findings, say so explicitly.",
      "Do not edit files, run commands, or mutate the workspace.",
    ].join("\n\n")
  } else if (!prompt) {
    return Response.json({ error: "PROMPT_REQUIRED" }, { status: 400 })
  }

  // Local is the default and the fallback; going off the machine has to be asked for.
  const provider = resolveProvider(reviewMode ? "cloud" : body.provider)
  if (provider.id === "local") {
    const model = typeof (body as { model?: unknown }).model === "string" ? (body as { model: string }).model : LOCAL_MODEL
    return streamLocal(prompt, request.signal, model, session.user.id)
  }

  // The id is validated rather than trusted: it reaches a command line, and only this shape can.
  const requested = typeof body.sessionId === "string" && SESSION_ID.test(body.sessionId) ? body.sessionId : null
  if (reviewMode && body.resume === true && requested === null) {
    return Response.json({ error: "SESSION_ID_REQUIRED" }, { status: 400 })
  }
  const resuming = requested !== null && body.resume === true
  const sessionId = requested ?? randomUUID()
  const priorThread = resuming && requested ? await loomThreadDescriptor(requested) : null

  // Shape is not ownership. Resuming replays a thread's whole history, so the id has to belong to
  // the caller -- otherwise anyone holding another operator's id can read their conversation.
  const resume = assertThreadResume({
    resuming,
    owner: priorThread?.owner ?? null,
    userId: session.user.id,
  })
  if (!resume.ok) {
    return Response.json({ error: resume.failure, detail: resume.detail }, { status: 403, headers: { "cache-control": "no-store" } })
  }
  if (reviewMode && resuming && (priorThread?.mode !== "review" || priorThread.path !== reviewPath)) {
    return Response.json({ error: "THREAD_DESCRIPTOR_MISMATCH" }, { status: 403, headers: { "cache-control": "no-store" } })
  }

  // Generic cloud turns spawn the CLI with acceptEdits against the real checkout, which makes them
  // the most powerful mutation surface in the application -- strictly broader than /api/loom/edit.
  // Selected-file review is separately constrained to a read-only tool set below, so requiring write
  // authority for it would make the receipt lie about what the turn can do. The local path above is
  // also deliberately ungated because it only produces text.
  if (!reviewMode) {
    const context = await requireWorkContext()
    if (!context.ok) return workContextRefusal(context)
  }

  const args = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    // Review is mechanically read-only. Generic agent turns retain their existing builder tools.
    "--permission-mode", reviewMode ? "plan" : "acceptEdits",
    ...(reviewMode ? ["--tools", "Read,Grep,Glob"] : []),
    resuming ? "--resume" : "--session-id", sessionId,
    prompt,
  ]

  // An API key in the environment silently outranks the operator's signed-in subscription, so the
  // agent bills a pay-as-you-go account instead of the plan he already pays for -- and fails with
  // "credit balance too low" while perfectly good credentials sit unused. The cockpit runs as the
  // operator, so it uses the operator's login.
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN

  const child = spawn(AGENT_BIN, args, {
    cwd: PROJECT_ROOT,
    shell: false,
    windowsHide: true,
    env,
  })

  // The prompt is passed as an argument, but --print still waits on stdin and then fails the turn.
  // Closing it immediately tells the CLI there is nothing coming.
  child.stdin.end()

  let settled = false
  let terminate: ((reason: "TIMEOUT" | "CANCELLED") => void) | null = null
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
        void recordLoomEnd({
          userId: session.user.id,
          kind: "agent",
          subject: sessionId,
          outcome: {
            provider: provider.id,
            external: provider.external,
            ...(reviewMode ? { mode: "review", path: reviewPath } : {}),
            code: event.code ?? null,
            reason: event.reason ?? null,
          },
        })
        send(event)
        try { controller.close() } catch { /* already closed */ }
      }
      terminate = (reason) => {
        if (settled) return
        // Settle the durable outcome before kill can synchronously or asynchronously emit close.
        // Otherwise close(0) can overwrite an explicit cancellation with a false success receipt.
        finish({ type: "done", reason })
        child.kill()
      }

      send({ type: "session", sessionId, resumed: resuming })
      // An external turn is the case the doctrine cares most about: the receipt names the provider
      // and records that work left the machine.
      void recordLoomStart({
        userId: session.user.id,
        kind: "agent",
        subject: sessionId,
        metadata: {
          provider: provider.id,
          external: provider.external,
          metered: provider.metered,
          resumed: resuming,
          ...(reviewMode ? { mode: "review", path: reviewPath, focus: reviewFocus } : {}),
        },
      })

      const timer = setTimeout(() => {
        terminate?.("TIMEOUT")
      }, AGENT_TIMEOUT_MS)

      // The CLI emits one JSON object per line. Chunks split lines, so partials are buffered and
      // only complete lines are forwarded -- a half-parsed event would look like agent output.
      let buffer = ""
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8")
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          try { send({ type: "event", event: JSON.parse(line) }) } catch { send({ type: "raw", text: line }) }
        }
      })
      child.stderr.on("data", (chunk: Buffer) => send({ type: "stderr", text: chunk.toString("utf8") }))
      child.on("error", (error) => finish({ type: "done", reason: String(error?.message ?? "AGENT_UNAVAILABLE") }))
      child.on("close", (code) => finish({ type: "done", reason: null, code }))

      request.signal.addEventListener("abort", () => {
        terminate?.("CANCELLED")
      })
    },
    cancel() {
      terminate?.("CANCELLED")
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

/**
 * Answer with the model running on this machine.
 *
 * Ollama already streams NDJSON, so its chunks are re-shaped into the same events the browser
 * consumes from the cloud path -- the workroom should not care which model is talking, and the
 * operator should not have to learn two transcript formats to compare them.
 */
async function streamLocal(prompt: string, signal: AbortSignal, model: string, userId: string): Promise<Response> {
  const encoder = new TextEncoder()

  let upstream: Response
  try {
    upstream = await fetch(`${LOCAL_ENDPOINT}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // An unknown name is rejected by the local runtime itself, which already knows exactly which
      // models exist -- duplicating that list here would only let the two disagree.
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: true }),
      signal,
    })
  } catch {
    // Naming the model and the endpoint matters: "the local model is not running" is actionable,
    // where a bare failure sends the operator looking for a bug in the cockpit.
    return Response.json({ error: "LOCAL_MODEL_UNAVAILABLE", model, endpoint: LOCAL_ENDPOINT }, { status: 503 })
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "LOCAL_MODEL_REFUSED", status: upstream.status, model }, { status: 503 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)) } catch { /* reader gone */ }
      }
      send({ type: "session", sessionId: null, resumed: false, provider: "local", model })
      // The provider doctrine requires selection to be visible AND recorded; local turns are
      // receipted exactly like external ones so the trail shows which of the two answered.
      void recordLoomStart({ userId, kind: "agent", subject: model, metadata: { provider: "local", external: false, metered: false } })

      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let text = ""
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            let chunk: { message?: { content?: string }; done?: boolean }
            try { chunk = JSON.parse(line) } catch { continue }
            const piece = chunk.message?.content
            if (piece) {
              text += piece
              // Tokens arrive one at a time; the browser renders the growing answer as it forms.
              send({ type: "delta", text: piece })
            }
          }
        }
        send({ type: "event", event: { type: "assistant", message: { content: [{ type: "text", text }] } } })
        void recordLoomEnd({ userId, kind: "agent", subject: model, outcome: { provider: "local", code: 0, characters: text.length } })
        send({ type: "done", reason: null, code: 0 })
      } catch (error) {
        const reason = String((error as Error)?.message ?? "LOCAL_STREAM_FAILED")
        void recordLoomEnd({ userId, kind: "agent", subject: model, outcome: { provider: "local", reason } })
        send({ type: "done", reason })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
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
