import { getApplicationProposal, rejectApplicationProposal } from "@/lib/applications/application-proposal-service.mjs"
import { applicationReply, guardApplicationMutation } from "@/lib/applications/application-route-context"
import { applicationProposalError, resolveApplicationProposalRouteContext } from "@/lib/applications/application-proposal-route-context"
import { readBoundedJson } from "@/lib/environment/line-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const MAX_REJECTION_BODY_BYTES = 2_048
const invalidRejection = () => applicationReply({ error: "APPLICATION_PROPOSAL_REJECTION_INVALID" }, 400)

function rejectionReason(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== "reason") return null
  const reason = (value as { reason?: unknown }).reason
  if (typeof reason !== "string" || /[\u0000-\u001f\u007f\u2028\u2029]/.test(reason)) return null
  const trimmed = reason.trim()
  return trimmed && trimmed.length <= 500 ? trimmed : null
}

type Context = { params: Promise<{ projectKey: string; proposalId: string }> }
export async function GET(_request: Request, context: Context) {
  const params = await context.params
  const resolved = await resolveApplicationProposalRouteContext(params.projectKey)
  if (!resolved.ok) return resolved.response
  try {
    return applicationReply({ proposal: getApplicationProposal({
      applicationId: resolved.context.application.manifest.id,
      runtimeRoot: resolved.context.runtimeRoot,
      proposalId: params.proposalId,
      requestedBy: resolved.context.userId,
    }) })
  } catch (error) { return applicationProposalError(error) }
}

export async function PATCH(request: Request, context: Context) {
  const rejected = guardApplicationMutation(request)
  if (rejected) return rejected.status === 413 ? invalidRejection() : rejected
  const params = await context.params
  const resolved = await resolveApplicationProposalRouteContext(params.projectKey)
  if (!resolved.ok) return resolved.response
  const parsed = await readBoundedJson(request, MAX_REJECTION_BODY_BYTES)
  if (!parsed.ok) return invalidRejection()
  const reason = rejectionReason(parsed.value)
  if (!reason) return invalidRejection()
  try {
    return applicationReply({ proposal: await rejectApplicationProposal({
      application: resolved.context.application,
      runtimeRoot: resolved.context.runtimeRoot,
      proposalId: params.proposalId,
      requestedBy: resolved.context.userId,
      reason,
    }) })
  } catch (error) { return applicationProposalError(error) }
}
