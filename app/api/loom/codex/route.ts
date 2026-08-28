import path from "node:path"

import { getSession } from "@/lib/session"
import { requireWorkContext, workContextRefusal } from "@/lib/governance/work-context-gate"
import { recordLoomEnd, recordLoomStart } from "@/lib/loom/receipts"
import { loomCodexThreadDescriptor } from "@/lib/loom/threads"
import {
  CodexAppServerClient,
  sanitizeAppServerText,
} from "@/scripts/hermes-bridge/app-server-client.mjs"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PROJECT_ROOT = path.resolve(process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd())
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAX_PROMPT_CHARS = 32_000
const MAX_DELTA_CHARS = 16_000
const MAX_STREAM_CHARS = 128_000
const MAX_RESULT_CHARS = 128_000
const TURN_TIMEOUT_MS = 60 * 60_000

type CodexClient = InstanceType<typeof CodexAppServerClient>

function sameWorkspace(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function failureReason(error: unknown): string {
  const candidate = error as { code?: unknown; usageLimit?: unknown } | null
  if (candidate?.usageLimit === true) return "USAGE_LIMIT_EXCEEDED"
  const code = typeof candidate?.code === "string" ? candidate.code : ""
  if (code === "APP_SERVER_CANCELLED") return "CANCELLED"
  if (code === "CODEX_AUTH_REQUIRED") return code
  const allowed = new Set([
    "APP_SERVER_APPROVAL_REQUIRED",
    "APP_SERVER_USER_INPUT_REQUIRED",
    "APP_SERVER_UNSUPPORTED_REQUEST",
    "APP_SERVER_EXTERNAL_TOOL_WALL",
    "APP_SERVER_TIMEOUT",
    "APP_SERVER_FRAME_LIMIT",
    "APP_SERVER_TURN_FAILED",
    "APP_SERVER_TURN_INTERRUPTED",
  ])
  return allowed.has(code) ? code : "CODEX_UNAVAILABLE"
}

/**
 * Run one real Codex App Server Builder turn in this exact checkout.
 *
 * The App Server client is reused directly because its request and tool walls are the accepted
 * provider boundary. This route adds only product-session identity, streaming and receipts; it does
 * not route the user through HERMES or create a second agent loop.
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
  if (prompt.length > MAX_PROMPT_CHARS) {
    return Response.json({ error: "PROMPT_TOO_LONG" }, { status: 400 })
  }

  const resuming = body.resume === true
  const requestedId = typeof body.sessionId === "string" && SESSION_ID.test(body.sessionId)
    ? body.sessionId
    : null
  if (resuming && !requestedId) {
    return Response.json({ error: "SESSION_ID_REQUIRED" }, { status: 400 })
  }

  const context = await requireWorkContext()
  if (!context.ok) return workContextRefusal(context)

  if (resuming) {
    const descriptor = await loomCodexThreadDescriptor(requestedId!)
    if (!descriptor) {
      return Response.json(
        { error: "THREAD_NOT_FOUND" },
        { status: 403, headers: { "cache-control": "no-store" } },
      )
    }
    if (descriptor.owner !== session.user.id) {
      return Response.json(
        { error: "THREAD_NOT_YOURS" },
        { status: 403, headers: { "cache-control": "no-store" } },
      )
    }
    if (descriptor.provider !== "Codex"
      || descriptor.mode !== "delegate"
      || descriptor.workspace === null
      || !sameWorkspace(descriptor.workspace, PROJECT_ROOT)) {
      return Response.json(
        { error: "THREAD_DESCRIPTOR_MISMATCH" },
        { status: 403, headers: { "cache-control": "no-store" } },
      )
    }
  }

  const encoder = new TextEncoder()
  let client: CodexClient | null = null
  const turnAbort = new AbortController()
  let streamedCharacters = 0
  let terminal = false
  let sessionSent = false
  let clientClosed = false
  const closeClient = () => {
    if (clientClosed) return
    clientClosed = true
    client?.close()
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: Record<string, unknown>) => {
        if (terminal && frame.type !== "done") return
        try { controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`)) } catch { /* reader left */ }
      }
      const done = (reason: string | null, code: number | null) => {
        if (terminal) return
        terminal = true
        send({ type: "done", reason, code })
        try { controller.close() } catch { /* already closed */ }
      }

      const onNotification = (notification: { method?: unknown; params?: unknown }) => {
        if (terminal || !sessionSent || notification.method !== "item/agentMessage/delta") return
        const params = notification.params && typeof notification.params === "object"
          ? notification.params as Record<string, unknown>
          : null
        const sanitized = sanitizeAppServerText(params?.delta).slice(0, MAX_DELTA_CHARS)
        const remaining = Math.max(0, MAX_STREAM_CHARS - streamedCharacters)
        const text = sanitized.slice(0, remaining)
        if (!text) return
        streamedCharacters += text.length
        send({ type: "delta", text })
      }

      void (async () => {
        let threadId: string | null = requestedId
        let recordedReady = false
        try {
          client = new CodexAppServerClient({
            cwd: PROJECT_ROOT,
            timeoutMs: TURN_TIMEOUT_MS,
            onNotification,
          })
          await client.connect()
          const account = await client.readAccount()
          if (account.requiresOpenaiAuth === true) {
            throw Object.assign(new Error("Codex authentication is unavailable"), { code: "CODEX_AUTH_REQUIRED" })
          }
          if (resuming) {
            const restored = await client.resumeThread(requestedId!, {
              cwd: PROJECT_ROOT,
              approvalPolicy: "never",
              sandbox: "workspace-write",
            })
            if (restored !== requestedId) throw Object.assign(new Error("Codex resumed a different thread"), { code: "THREAD_DESCRIPTOR_MISMATCH" })
            threadId = restored
          } else {
            threadId = await client.startThread({
              cwd: PROJECT_ROOT,
              approvalPolicy: "never",
              sandbox: "workspace-write",
              ephemeral: false,
            })
            if (typeof threadId !== "string" || !SESSION_ID.test(threadId)) {
              throw Object.assign(new Error("Codex returned an invalid thread id"), { code: "APP_SERVER_UNSUPPORTED_REQUEST" })
            }
          }
          if (threadId === null) {
            throw Object.assign(new Error("Codex did not return a thread id"), { code: "APP_SERVER_UNSUPPORTED_REQUEST" })
          }
          const durableThreadId = threadId

          sessionSent = true
          send({ type: "session", sessionId: durableThreadId, provider: "Codex", mode: "delegate", resumed: resuming })
          const turn = await client.runTurn({
            threadId: durableThreadId,
            prompt,
            turn: {
              approvalPolicy: "never",
              runtimeWorkspaceRoots: [PROJECT_ROOT],
              sandboxPolicy: {
                type: "workspaceWrite",
                writableRoots: [PROJECT_ROOT],
                networkAccess: true,
                excludeTmpdirEnvVar: true,
                excludeSlashTmp: true,
              },
            },
            timeoutMs: TURN_TIMEOUT_MS,
            signal: turnAbort.signal,
          })
          if (turn.threadId !== durableThreadId || turn.status !== "completed" || typeof turn.finalText !== "string") {
            throw Object.assign(new Error("Codex returned an invalid terminal result"), { code: "APP_SERVER_TURN_FAILED" })
          }
          const result = sanitizeAppServerText(turn.finalText).slice(0, MAX_RESULT_CHARS)
          if (!result) {
            throw Object.assign(new Error("Codex completed without a result"), { code: "APP_SERVER_TURN_FAILED" })
          }

          // This is the durable descriptor. A failed first turn must not create a resumable session.
          await recordLoomStart({
            userId: session.user.id,
            kind: "agent",
            subject: durableThreadId,
            metadata: {
              provider: "Codex",
              mode: "delegate",
              workspace: PROJECT_ROOT,
              resumed: resuming,
              external: true,
              metered: true,
            },
          })
          recordedReady = true
          await recordLoomEnd({
            userId: session.user.id,
            kind: "agent",
            subject: durableThreadId,
            outcome: { provider: "Codex", mode: "delegate", code: 0, reason: null },
          })
          send({ type: "result", text: result })
          done(null, 0)
        } catch (error) {
          const reason = failureReason(error)
          if (threadId) {
            try {
              await recordLoomEnd({
                userId: session.user.id,
                kind: "agent",
                subject: threadId,
                outcome: {
                  provider: "Codex",
                  mode: "delegate",
                  code: null,
                  reason,
                  descriptorPersisted: recordedReady,
                },
              })
            } catch { /* the NDJSON outcome must still settle truthfully */ }
          }
          done(reason, null)
        } finally {
          closeClient()
        }
      })()
    },
    cancel() {
      // Abort first: runTurn translates it into turn/interrupt while the transport is still open.
      turnAbort.abort()
      closeClient()
    },
  })

  if (request.signal.aborted) turnAbort.abort()
  else request.signal.addEventListener("abort", () => turnAbort.abort(), { once: true })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  })
}
