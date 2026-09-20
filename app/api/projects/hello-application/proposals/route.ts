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
import { resolveHelloExecutionRoute } from "@/lib/hello-application/execution-routing.mjs"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 7200

const MAX_REQUEST_BODY_BYTES = 16_384
const PROGRESS_STAGES = new Set([
  "accepted",
  "workspace_ready",
  "resident_started",
  "resident_finished",
  "validation_started",
  "ready_for_review",
])
const TERMINAL_ERROR_CODES = new Set([
  "HELLO_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
  "HELLO_PROPOSAL_BASE_INVALID",
  "HELLO_PROPOSAL_CANONICAL_DIRTY",
  "HELLO_PROPOSAL_COMMIT_INVALID",
  "HELLO_PROPOSAL_DIFF_INVALID",
  "HELLO_PROPOSAL_IGNORED_PATH_REFUSED",
  "HELLO_PROPOSAL_NO_CHANGE",
  "HELLO_PROPOSAL_PATCH_INVALID",
  "HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH",
  "HELLO_PROPOSAL_PATCH_SIZE_REFUSED",
  "HELLO_PROPOSAL_PATH_REFUSED",
  "HELLO_PROPOSAL_POLICY_INVALID",
  "HELLO_PROPOSAL_RECEIPT_INVALID",
  "HELLO_PROPOSAL_RENAME_REFUSED",
  "HELLO_PROPOSAL_REPOSITORY_INVALID",
  "HELLO_PROPOSAL_REQUEST_INVALID",
  "HELLO_PROPOSAL_RESIDENT_EVIDENCE_INVALID",
  "HELLO_PROPOSAL_RESIDENT_HEAD_MUTATED",
  "HELLO_PROPOSAL_RESIDENT_TIMEOUT",
  "HELLO_PROPOSAL_SOURCE_SIZE_REFUSED",
  "HELLO_PROPOSAL_VALIDATION_FAILED",
  "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH",
  "HELLO_PROPOSAL_WORKSPACE_FILE_INVALID",
  "HELLO_PROPOSAL_WORKTREE_CLEANUP_FAILED",
  "HELLO_PROPOSAL_WORKTREE_INVALID",
  "HELLO_CEREBRAS_EXECUTION_FAILED",
  "HELLO_CEREBRAS_REQUEST_INVALID",
  "HELLO_CEREBRAS_RESPONSE_INVALID",
  "HELLO_CEREBRAS_TIMEOUT",
  "HELLO_CEREBRAS_UNAVAILABLE",
  "EXTERNAL_API_AUTH_FAILURE",
  "EXTERNAL_API_COST_EVIDENCE_MISSING",
  "EXTERNAL_API_INCOMPLETE_RESPONSE",
  "EXTERNAL_API_INSUFFICIENT_CREDIT",
  "EXTERNAL_API_KEY_MISSING",
  "EXTERNAL_API_MALFORMED_RESPONSE",
  "EXTERNAL_API_OUTAGE",
  "EXTERNAL_API_RATE_LIMIT",
  "EXTERNAL_API_TIMEOUT",
  "EXTERNAL_EGRESS_REFUSED",
  "SPEND_CAP_EXCEEDS_CEILING",
])

const invalidRequest = () => Response.json({ error: "HELLO_PROPOSAL_REQUEST_INVALID" }, {
  status: 400,
  headers: { "cache-control": "no-store" },
})

type ProposalRequest = Readonly<{
  requestText: string
  executionRoute?: string
  externalEgressApproved?: true
}>

function proposalRequest(value: unknown): ProposalRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const keys = Object.keys(value).sort()
  const local = keys.length === 1 && keys[0] === "requestText"
  const external = keys.length === 3
    && keys[0] === "executionRoute" && keys[1] === "externalEgressApproved" && keys[2] === "requestText"
  if (!local && !external) return null
  const requestText = (value as { requestText?: unknown }).requestText
  if (typeof requestText !== "string") return null
  const trimmed = requestText.trim()
  if (!trimmed || trimmed.length > 2_000 || trimmed.includes("\0")) return null
  if (local) return { requestText: trimmed }
  const externalValue = value as { executionRoute?: unknown; externalEgressApproved?: unknown }
  if (typeof externalValue.executionRoute !== "string" || externalValue.externalEgressApproved !== true) return null
  try {
    const selected = resolveHelloExecutionRoute(externalValue.executionRoute, {
      externalEnabled: process.env.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED,
      externalEgressApproved: true,
    })
    if (!selected.external) return null
  } catch { return null }
  return {
    requestText: trimmed,
    executionRoute: externalValue.executionRoute,
    externalEgressApproved: true,
  }
}

function terminalErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "HELLO_PROPOSAL_FAILED"
  const separator = error.message.indexOf(":")
  const code = separator === -1 ? error.message : error.message.slice(0, separator)
  return TERMINAL_ERROR_CODES.has(code) ? code : "HELLO_PROPOSAL_FAILED"
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
  const proposalInput = proposalRequest(parsed.value)
  if (!proposalInput) return invalidRequest()

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
          ...proposalInput,
          onProgress,
        })).then(
          (proposal) => finish({ type: "proposal", proposal }),
          (error) => finish({ type: "error", error: terminalErrorCode(error) }),
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
