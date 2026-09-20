import {
  createHelloApplicationProposal,
  listHelloApplicationProposals,
} from "@/lib/hello-application/proposal-service.mjs"
import {
  helloProposalError,
  resolveHelloProposalRouteContext,
} from "@/lib/hello-application/proposal-route-context"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { guardHelloApplicationMutation } from "@/lib/hello-application/mutation-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 1800

const MAX_REQUEST_BODY_BYTES = 16_384
const PROGRESS_STAGES = new Set([
  "accepted",
  "workspace_ready",
  "resident_started",
  "resident_finished",
  "validation_started",
  "ready_for_review",
])

const invalidRequest = () => Response.json({ error: "HELLO_PROPOSAL_REQUEST_INVALID" }, {
  status: 400,
  headers: { "cache-control": "no-store" },
})

function proposalRequestText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== "requestText") return null
  const requestText = (value as { requestText?: unknown }).requestText
  if (typeof requestText !== "string") return null
  const trimmed = requestText.trim()
  return trimmed && trimmed.length <= 2_000 && !trimmed.includes("\0") ? trimmed : null
}

export async function GET() {
  const resolved = await resolveHelloProposalRouteContext()
  if (!resolved.ok) return resolved.response
  try {
    return Response.json({
      proposals: listHelloApplicationProposals({
        runtimeRoot: resolved.context.runtimeRoot,
        requestedBy: resolved.context.userId,
      }),
    }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return helloProposalError(error)
  }
}

export async function POST(request: Request) {
  const rejection = guardHelloApplicationMutation(request)
  if (rejection) return rejection.status === 413 ? invalidRequest() : rejection
  const resolved = await resolveHelloProposalRouteContext()
  if (!resolved.ok) return resolved.response
  const parsed = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES)
  if (!parsed.ok) return invalidRequest()
  const requestText = proposalRequestText(parsed.value)
  if (!requestText) return invalidRequest()

  const encoder = new TextEncoder()
  let writable = true
  let terminal = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (record: Record<string, unknown>) => {
        if (!writable) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(record)}\n`))
        } catch {
          writable = false
        }
      }
      const finish = (record: Record<string, unknown>) => {
        if (terminal) return
        terminal = true
        enqueue(record)
        if (!writable) return
        writable = false
        try { controller.close() } catch { /* The reader already left. */ }
      }
      const onProgress = (event: unknown) => {
        if (terminal || !writable || !event || typeof event !== "object") return
        const { stage, detail, at } = event as { stage?: unknown; detail?: unknown; at?: unknown }
        if (typeof stage !== "string" || !PROGRESS_STAGES.has(stage)
          || typeof detail !== "string" || typeof at !== "string") return
        enqueue({ type: "progress", stage, detail, at })
      }

      queueMicrotask(() => {
        void Promise.resolve().then(() => createHelloApplicationProposal({
          repositoryRoot: resolved.context.repositoryRoot,
          runtimeRoot: resolved.context.runtimeRoot,
          requestedBy: resolved.context.userId,
          requestText,
          onProgress,
        })).then(
          (proposal) => finish({ type: "proposal", proposal }),
          () => finish({ type: "error", error: "HELLO_PROPOSAL_FAILED" }),
        )
      })
    },
    cancel() {
      // The resident proposal continues independently; cancellation only stops response writes.
      writable = false
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  })
}
