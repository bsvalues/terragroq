import {
  createApplicationProposal,
  listApplicationProposals,
  reconcileApplicationProposalCreateIntents,
} from "@/lib/applications/application-proposal-service.mjs"
import { applicationCerebrasCapability, cerebrasCredentialBridgeReady } from "@/lib/applications/cerebras-turn.mjs"
import { resolveApplicationExecutionRoute } from "@/lib/applications/execution-routing.mjs"
import { applicationReply, guardApplicationMutation } from "@/lib/applications/application-route-context"
import {
  applicationProposalError,
  applicationProposalErrorCode,
  resolveApplicationProposalRouteContext,
} from "@/lib/applications/application-proposal-route-context"
import { readBoundedJson } from "@/lib/environment/line-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 7200

const MAX_REQUEST_BODY_BYTES = 16_384
const PROGRESS_STAGES = new Set(["accepted", "workspace_ready", "resident_started", "resident_finished", "validation_started", "ready_for_review"])
type ProposalRequest = Readonly<{ requestText: string; executionRoute?: string; externalEgressApproved?: true }>

const invalidRequest = () => applicationReply({ error: "APPLICATION_PROPOSAL_REQUEST_INVALID" }, 400)

function proposalRequest(value: unknown): ProposalRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const keys = Object.keys(value).sort()
  const implicitLocal = keys.length === 1 && keys[0] === "requestText"
  const selectedRoute = keys.length === 2 && keys.join(",") === "executionRoute,requestText"
  const external = keys.length === 3 && keys.join(",") === "executionRoute,externalEgressApproved,requestText"
  if (!implicitLocal && !selectedRoute && !external) return null
  const requestText = (value as { requestText?: unknown }).requestText
  if (typeof requestText !== "string") return null
  const trimmed = requestText.trim()
  if (!trimmed || trimmed.length > 2_000 || trimmed.includes("\0")) return null
  if (implicitLocal) return { requestText: trimmed }
  const selected = value as { executionRoute?: unknown; externalEgressApproved?: unknown }
  if (typeof selected.executionRoute !== "string") return null
  const route = resolveApplicationExecutionRoute(selected.executionRoute, {
    externalEnabled: process.env.WILLIAMOS_APPLICATION_CEREBRAS_ROUTING_ENABLED
      ?? process.env.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED,
    externalEgressApproved: external ? selected.externalEgressApproved === true : false,
  })
  if (external !== route.external || (external && selected.externalEgressApproved !== true)) return null
  return route.external
    ? { requestText: trimmed, executionRoute: selected.executionRoute, externalEgressApproved: true }
    : { requestText: trimmed, executionRoute: selected.executionRoute }
}

export async function GET(_request: Request, context: { params: Promise<{ projectKey: string }> }) {
  const resolved = await resolveApplicationProposalRouteContext((await context.params).projectKey)
  if (!resolved.ok) return resolved.response
  try {
    await reconcileApplicationProposalCreateIntents({
      application: resolved.context.application,
      runtimeRoot: resolved.context.runtimeRoot,
    })
    return applicationReply({ proposals: listApplicationProposals({
      applicationId: resolved.context.application.manifest.id,
      runtimeRoot: resolved.context.runtimeRoot,
      requestedBy: resolved.context.userId,
    }) })
  } catch (error) { return applicationProposalError(error) }
}

export async function POST(request: Request, context: { params: Promise<{ projectKey: string }> }) {
  const rejected = guardApplicationMutation(request)
  if (rejected) return rejected.status === 413 ? invalidRequest() : rejected
  const resolved = await resolveApplicationProposalRouteContext((await context.params).projectKey)
  if (!resolved.ok) return resolved.response
  const parsed = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES)
  if (!parsed.ok) return invalidRequest()
  let input
  try { input = proposalRequest(parsed.value) }
  catch (error) { return applicationProposalError(error) }
  if (!input) return invalidRequest()
  if (input.externalEgressApproved === true
    && (!applicationCerebrasCapability(resolved.context.application).available
      || !await cerebrasCredentialBridgeReady())) {
    return applicationReply({ error: "APPLICATION_EXECUTION_ROUTE_UNAVAILABLE" }, 503)
  }

  const encoder = new TextEncoder()
  let writable = true
  let terminal = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (record: Record<string, unknown>) => {
        if (!writable) return
        try { controller.enqueue(encoder.encode(`${JSON.stringify(record)}\n`)) } catch { writable = false }
      }
      const finish = (record: Record<string, unknown>) => {
        if (terminal) return
        terminal = true
        enqueue(record)
        if (!writable) return
        writable = false
        try { controller.close() } catch { /* reader already left */ }
      }
      const onProgress = (event: unknown) => {
        if (terminal || !writable || !event || typeof event !== "object") return
        const { stage, detail, at } = event as { stage?: unknown; detail?: unknown; at?: unknown }
        if (typeof stage === "string" && PROGRESS_STAGES.has(stage) && typeof detail === "string" && typeof at === "string") {
          enqueue({ type: "progress", stage, detail, at })
        }
      }
      queueMicrotask(() => {
        void Promise.resolve().then(() => createApplicationProposal({
          application: resolved.context.application,
          runtimeRoot: resolved.context.runtimeRoot,
          requestedBy: resolved.context.userId,
          ...input,
          onProgress,
        })).then(
          (proposal) => finish({ type: "proposal", proposal }),
          (error) => finish({ type: "error", error: applicationProposalErrorCode(error) }),
        )
      })
    },
    cancel() { writable = false },
  })
  return new Response(stream, { headers: {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "x-accel-buffering": "no",
  } })
}
