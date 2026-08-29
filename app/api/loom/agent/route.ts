import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import fs from "node:fs/promises"

import { getSession } from "@/lib/session"
import { resolveOllamaChatModel } from "@/lib/ai/ollama-models"
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
const MAX_LOCAL_COMPLETED_TURNS = 20
const MAX_LOCAL_REPLAY_BYTES = 262_144
const MAX_LOCAL_RESULT_BYTES = 200_000
const MAX_LOCAL_FRAME_BYTES = 262_144

type LocalCompletedTurn = Readonly<{
  ownerPrompt: string
  finalResult: string
  completedAt: string
}>

type LocalStreamState = {
  text: string
  textBytes: number
  terminalSeen: boolean
  failure: string | null
}

function localText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && text.length <= max && !text.includes("\0") ? text : null
}

function parseLocalCompletedTurns(value: unknown): { ok: true; turns: readonly LocalCompletedTurn[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "COMPLETED_TURNS_REQUIRED" }
  if (value.length > MAX_LOCAL_COMPLETED_TURNS) return { ok: false, error: "COMPLETED_TURNS_INVALID" }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_LOCAL_REPLAY_BYTES) {
    return { ok: false, error: "COMPLETED_TURNS_TOO_LARGE" }
  }
  const turns: LocalCompletedTurn[] = []
  let priorTime = Number.NEGATIVE_INFINITY
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "COMPLETED_TURNS_INVALID" }
    const candidate = raw as Record<string, unknown>
    if (Object.keys(candidate).sort().join("\0") !== "completedAt\0finalResult\0ownerPrompt") {
      return { ok: false, error: "COMPLETED_TURNS_INVALID" }
    }
    const ownerPrompt = localText(candidate.ownerPrompt, 20_000)
    const finalResult = localText(candidate.finalResult, 200_000)
    const completedAt = typeof candidate.completedAt === "string" && Number.isFinite(Date.parse(candidate.completedAt))
      ? candidate.completedAt : null
    const completedTime = completedAt ? Date.parse(completedAt) : Number.NaN
    if (!ownerPrompt || !finalResult || !completedAt || completedTime <= priorTime) {
      return { ok: false, error: "COMPLETED_TURNS_INVALID" }
    }
    priorTime = completedTime
    turns.push({ ownerPrompt, finalResult, completedAt })
  }
  return { ok: true, turns }
}

function reduceLocalFrame(state: LocalStreamState, line: string): string | null {
  if (!line.trim() || state.failure) return null
  if (state.terminalSeen) {
    try {
      const late = JSON.parse(line) as { done?: unknown }
      state.failure = late && typeof late === "object" && late.done === true
        ? "LOCAL_STREAM_DUPLICATE_TERMINAL"
        : "LOCAL_STREAM_POST_TERMINAL"
    } catch {
      state.failure = "LOCAL_STREAM_POST_TERMINAL"
    }
    return null
  }
  let frame: unknown
  try { frame = JSON.parse(line) } catch {
    state.failure = "LOCAL_STREAM_MALFORMED"
    return null
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    state.failure = "LOCAL_STREAM_FRAME_INVALID"
    return null
  }
  const candidate = frame as Record<string, unknown>
  if (candidate.error !== undefined) {
    state.failure = "LOCAL_MODEL_ERROR"
    return null
  }
  if (typeof candidate.done !== "boolean") {
    state.failure = "LOCAL_STREAM_FRAME_INVALID"
    return null
  }
  let piece: string | null = null
  if (candidate.message !== undefined) {
    if (!candidate.message || typeof candidate.message !== "object" || Array.isArray(candidate.message)) {
      state.failure = "LOCAL_STREAM_FRAME_INVALID"
      return null
    }
    const message = candidate.message as Record<string, unknown>
    if (message.role !== undefined && message.role !== "assistant") {
      state.failure = "LOCAL_STREAM_ROLE_INVALID"
      return null
    }
    if (typeof message.content !== "string") {
      state.failure = "LOCAL_STREAM_FRAME_INVALID"
      return null
    }
    piece = message.content
    state.textBytes += new TextEncoder().encode(piece).byteLength
    if (state.textBytes > MAX_LOCAL_RESULT_BYTES || state.text.length + piece.length > MAX_LOCAL_RESULT_BYTES) {
      state.failure = "LOCAL_STREAM_RESULT_TOO_LARGE"
      return null
    }
    state.text += piece
  } else if (candidate.done !== true) {
    state.failure = "LOCAL_STREAM_FRAME_INVALID"
    return null
  }
  if (candidate.done === true) state.terminalSeen = true
  return piece
}

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
    completedTurns?: unknown
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

  if (!reviewMode && body.provider !== "local" && body.provider !== "cloud") {
    return Response.json({ error: "PROVIDER_INVALID" }, { status: 400 })
  }
  const provider = resolveProvider(reviewMode ? "cloud" : body.provider)
  if (provider.id === "local") {
    if (!localText(prompt, 20_000)) {
      return Response.json({ error: prompt ? "PROMPT_TOO_LONG" : "PROMPT_REQUIRED" }, { status: 400 })
    }
    const resuming = body.resume === true
    let sessionId: string = randomUUID()
    let completedTurns: readonly LocalCompletedTurn[] = []
    if (resuming) {
      if (body.sessionId === undefined || body.sessionId === null) {
        return Response.json({ error: "SESSION_ID_REQUIRED" }, { status: 400 })
      }
      if (typeof body.sessionId !== "string" || !SESSION_ID.test(body.sessionId)) {
        return Response.json({ error: "SESSION_ID_INVALID" }, { status: 400 })
      }
      const parsed = parseLocalCompletedTurns(body.completedTurns)
      if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
      sessionId = body.sessionId
      completedTurns = parsed.turns
    }
    const requestedModel = typeof body.model === "string" ? body.model.trim() : ""
    const model = requestedModel || LOCAL_MODEL
    return streamLocal(prompt, request.signal, model, session.user.id, sessionId, resuming, completedTurns, !requestedModel)
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
async function streamLocal(
  prompt: string,
  signal: AbortSignal,
  model: string,
  userId: string,
  sessionId: string,
  resuming: boolean,
  completedTurns: readonly LocalCompletedTurn[],
  mayResolveDefault: boolean,
): Promise<Response> {
  const encoder = new TextEncoder()

  let upstream: Response
  let selectedModel = model
  const requestTurn = (candidate: string) => fetch(`${LOCAL_ENDPOINT}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // An unknown explicit name is rejected by the local runtime itself. Only an absent compiled
    // default may be replaced with another model Ollama proves is already installed.
    body: JSON.stringify({
      model: candidate,
      messages: [
        ...completedTurns.flatMap((turn) => [
          { role: "user", content: turn.ownerPrompt },
          { role: "assistant", content: turn.finalResult },
        ]),
        { role: "user", content: prompt },
      ],
      stream: true,
    }),
    signal,
  })
  try {
    upstream = await requestTurn(selectedModel)
    if (upstream.status === 404 && mayResolveDefault) {
      const installed = await resolveOllamaChatModel(LOCAL_ENDPOINT, selectedModel)
      if (installed.available && installed.model && installed.model !== selectedModel) {
        selectedModel = installed.model
        upstream = await requestTurn(selectedModel)
      }
    }
  } catch {
    // Naming the model and the endpoint matters: "the local model is not running" is actionable,
    // where a bare failure sends the operator looking for a bug in the cockpit.
    return Response.json({ error: "LOCAL_MODEL_UNAVAILABLE", model: selectedModel, endpoint: LOCAL_ENDPOINT }, { status: 503 })
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "LOCAL_MODEL_REFUSED", status: upstream.status, model: selectedModel }, { status: 503 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)) } catch { /* reader gone */ }
      }
      send({
        type: "session",
        sessionId,
        resumed: resuming,
        provider: "Local",
        continuity: resuming ? "browser-replayed" : "new",
        model: selectedModel,
      })
      // The provider doctrine requires selection to be visible AND recorded; local turns are
      // receipted exactly like external ones so the trail shows which of the two answered.
      void recordLoomStart({
        userId,
        kind: "agent",
        subject: sessionId,
        metadata: { provider: "local", external: false, metered: false, resumed: resuming, continuity: resuming ? "browser-replayed" : "new", model: selectedModel },
      })

      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      const state: LocalStreamState = { text: "", textBytes: 0, terminalSeen: false, failure: null }
      let failure: string | null = null
      try {
        read: for (;;) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError")
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (encoder.encode(line).byteLength > MAX_LOCAL_FRAME_BYTES) {
              state.failure = "LOCAL_STREAM_FRAME_TOO_LARGE"
              break read
            }
            const piece = reduceLocalFrame(state, line)
            // Tokens arrive one at a time; the browser renders the growing answer as it forms.
            if (piece) send({ type: "delta", text: piece })
            if (state.failure) break read
          }
          if (encoder.encode(buffer).byteLength > MAX_LOCAL_FRAME_BYTES) {
            state.failure = "LOCAL_STREAM_FRAME_TOO_LARGE"
            break
          }
        }
        if (!state.failure) {
          buffer += decoder.decode()
          if (buffer.trim()) {
            if (encoder.encode(buffer).byteLength > MAX_LOCAL_FRAME_BYTES) state.failure = "LOCAL_STREAM_FRAME_TOO_LARGE"
            else {
              const piece = reduceLocalFrame(state, buffer)
              if (piece) send({ type: "delta", text: piece })
            }
          }
        }
        if (signal.aborted) throw new DOMException("Aborted", "AbortError")
        if (state.failure) failure = state.failure
        else if (!state.terminalSeen) failure = "LOCAL_STREAM_TERMINAL_REQUIRED"
        else if (!localText(state.text, MAX_LOCAL_RESULT_BYTES)) failure = "LOCAL_STREAM_RESULT_REQUIRED"
      } catch (error) {
        failure = signal.aborted || (error as Error)?.name === "AbortError" ? "CANCELLED" : "LOCAL_STREAM_FAILED"
      }
      try {
        if (failure) {
          void reader.cancel()
          void recordLoomEnd({ userId, kind: "agent", subject: sessionId, outcome: { provider: "local", reason: failure } })
          send({ type: "done", reason: failure, code: null })
        } else {
          const result = localText(state.text, MAX_LOCAL_RESULT_BYTES)!
          send({ type: "result", text: result })
          void recordLoomEnd({ userId, kind: "agent", subject: sessionId, outcome: { provider: "local", code: 0, characters: result.length } })
          send({ type: "done", reason: null, code: 0 })
        }
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
