import { spawn } from "node:child_process"


import { getSession } from "@/lib/session"
import { resolveLoomOperation } from "@/lib/loom/operations"
import { recordLoomEnd, recordLoomStart } from "@/lib/loom/receipts"
import { requireWorkContext, workContextRefusal } from "@/lib/governance/work-context-gate"

export const dynamic = "force-dynamic"
// Node runtime, not edge: this streams the output of a real process on this machine.
export const runtime = "nodejs"

const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()
const MAX_OUTPUT_BYTES = 2_000_000

/**
 * Run one catalogued operation and stream its output to the browser as it happens.
 *
 * This is the transport the cockpit never had. Every existing surface renders rows some background
 * process wrote earlier, which is why the application can only report and never work: with no way to
 * stream, the best a page can do is poll a summary. Here the operator sees the same bytes the machine
 * is producing, at the moment it produces them, and closing the tab kills the process.
 *
 * Safety comes from the catalogue, not from parsing: the request names an id, the argv is a constant
 * in this repository, and nothing is executed through a shell. There is no place for operator text to
 * become part of a command.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let body: { operation?: unknown; confirmed?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }

  const resolution = resolveLoomOperation(body.operation, { confirmed: body.confirmed === true })
  if (!resolution.ok || !resolution.operation) {
    return Response.json({ error: resolution.refusal }, { status: resolution.refusal === "UNKNOWN_OPERATION" ? 404 : 409 })
  }
  const operation = resolution.operation

  // Reading repository state or tailing a log proves nothing and changes nothing; restarting the
  // cockpit does. The gate follows the operation's own mutating flag rather than a second list that
  // could drift away from it.
  if (operation.mutating) {
    const context = await requireWorkContext()
    if (!context.ok) return workContextRefusal(context)
  }

  const command = operation.command === "node" ? process.execPath : operation.command
  const child = spawn(command, [...operation.args], {
    cwd: operation.scope === "project" ? PROJECT_ROOT : PROJECT_ROOT,
    shell: false,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  })

  let bytes = 0
  let settled = false
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // The reader is gone; the abort handler below stops the process.
        }
      }

      const finish = (event: Record<string, unknown>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // Recorded on every exit path -- timeout, output cap, cancel, crash and success alike -- so
        // an operation cannot end without leaving a trace of how it ended.
        void recordLoomEnd({
          userId: session.user.id,
          kind: "operation",
          subject: operation.id,
          outcome: { code: event.code ?? null, reason: event.reason ?? null, mutating: operation.mutating },
        })
        send(event)
        try { controller.close() } catch { /* already closed */ }
      }

      send({ type: "started", operation: operation.id, label: operation.label, mutating: operation.mutating })
      void recordLoomStart({
        userId: session.user.id,
        kind: "operation",
        subject: operation.id,
        metadata: { scope: operation.scope, mutating: operation.mutating },
      })

      // A runaway process must not be able to fill memory or run forever unattended.
      const timer = setTimeout(() => {
        child.kill()
        finish({ type: "exit", code: null, reason: "TIMEOUT" })
      }, operation.timeoutMs)

      const forward = (channel: "stdout" | "stderr") => (chunk: Buffer) => {
        if (settled) return
        bytes += chunk.length
        if (bytes > MAX_OUTPUT_BYTES) {
          child.kill()
          finish({ type: "exit", code: null, reason: "OUTPUT_LIMIT" })
          return
        }
        send({ type: channel, text: chunk.toString("utf8") })
      }

      child.stdout.on("data", forward("stdout"))
      child.stderr.on("data", forward("stderr"))
      child.on("error", (error) => finish({ type: "exit", code: null, reason: String(error?.message ?? "SPAWN_FAILED") }))
      child.on("close", (code) => finish({ type: "exit", code, reason: null }))

      // Closing the tab, navigating away, or hitting stop kills the process rather than orphaning it.
      request.signal.addEventListener("abort", () => {
        child.kill()
        finish({ type: "exit", code: null, reason: "CANCELLED" })
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
      // Without this a buffering proxy would hold the output back and defeat the entire point.
      "x-accel-buffering": "no",
    },
  })
}

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  const { LOOM_OPERATIONS } = await import("@/lib/loom/operations")
  return Response.json({
    operations: LOOM_OPERATIONS.map(({ id, label, intent, scope, mutating }) => ({ id, label, intent, scope, mutating })),
  })
}
