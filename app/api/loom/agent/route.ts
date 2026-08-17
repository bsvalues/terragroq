import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import { getSession } from "@/lib/session"
import { LOCAL_ENDPOINT, LOCAL_MODEL, resolveProvider } from "@/lib/loom/providers"

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

  let body: { prompt?: unknown; sessionId?: unknown; resume?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (!prompt) return Response.json({ error: "PROMPT_REQUIRED" }, { status: 400 })

  // Local is the default and the fallback; going off the machine has to be asked for.
  const provider = resolveProvider((body as { provider?: unknown }).provider)
  if (provider.id === "local") {
    const model = typeof (body as { model?: unknown }).model === "string" ? (body as { model: string }).model : LOCAL_MODEL
    return streamLocal(prompt, request.signal, model)
  }

  // The id is validated rather than trusted: it reaches a command line, and only this shape can.
  const requested = typeof body.sessionId === "string" && SESSION_ID.test(body.sessionId) ? body.sessionId : null
  const resuming = requested !== null && body.resume === true
  const sessionId = requested ?? randomUUID()

  const args = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    // Edits land in the working tree where the operator can see and revert them; this is a
    // development workspace under version control, not a production host.
    "--permission-mode", "acceptEdits",
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

      send({ type: "session", sessionId, resumed: resuming })

      const timer = setTimeout(() => {
        child.kill()
        finish({ type: "done", reason: "TIMEOUT" })
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

/**
 * Answer with the model running on this machine.
 *
 * Ollama already streams NDJSON, so its chunks are re-shaped into the same events the browser
 * consumes from the cloud path -- the workroom should not care which model is talking, and the
 * operator should not have to learn two transcript formats to compare them.
 */
async function streamLocal(prompt: string, signal: AbortSignal, model: string): Promise<Response> {
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
        send({ type: "done", reason: null, code: 0 })
      } catch (error) {
        send({ type: "done", reason: String((error as Error)?.message ?? "LOCAL_STREAM_FAILED") })
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
