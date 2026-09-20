import {
  getHelloApplicationProposal,
  rejectHelloApplicationProposal,
} from "@/lib/hello-application/proposal-service.mjs"
import {
  helloProposalError,
  resolveHelloProposalRouteContext,
} from "@/lib/hello-application/proposal-route-context"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { guardHelloApplicationMutation } from "@/lib/hello-application/mutation-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_REJECTION_BODY_BYTES = 2_048

const invalidRejection = () => Response.json({ error: "HELLO_PROPOSAL_REJECTION_INVALID" }, {
  status: 400,
  headers: { "cache-control": "no-store" },
})

function rejectionReason(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== "reason") return null
  const reason = (value as { reason?: unknown }).reason
  if (typeof reason !== "string" || /[\u0000-\u001f\u007f\u2028\u2029]/.test(reason)) return null
  const trimmed = reason.trim()
  return trimmed && trimmed.length <= 500 ? trimmed : null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  const resolved = await resolveHelloProposalRouteContext()
  if (!resolved.ok) return resolved.response
  const { proposalId } = await context.params
  try {
    const proposal = getHelloApplicationProposal({
      runtimeRoot: resolved.context.runtimeRoot,
      proposalId,
      requestedBy: resolved.context.userId,
    })
    return Response.json({ proposal }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return helloProposalError(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  const rejection = guardHelloApplicationMutation(request)
  if (rejection) return rejection.status === 413 ? invalidRejection() : rejection
  const resolved = await resolveHelloProposalRouteContext()
  if (!resolved.ok) return resolved.response
  const parsed = await readBoundedJson(request, MAX_REJECTION_BODY_BYTES)
  if (!parsed.ok) return invalidRejection()
  const reason = rejectionReason(parsed.value)
  if (!reason) return invalidRejection()
  const { proposalId } = await context.params
  try {
    const proposal = rejectHelloApplicationProposal({
      repositoryRoot: resolved.context.repositoryRoot,
      runtimeRoot: resolved.context.runtimeRoot,
      requestedBy: resolved.context.userId,
      proposalId,
      reason,
    })
    return Response.json({ proposal }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return helloProposalError(error)
  }
}
