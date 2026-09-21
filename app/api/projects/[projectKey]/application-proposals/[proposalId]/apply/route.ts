import { applyApplicationProposal } from "@/lib/applications/application-proposal-service.mjs"
import { applicationReply, guardApplicationMutation } from "@/lib/applications/application-route-context"
import { applicationProposalError, resolveApplicationProposalRouteContext } from "@/lib/applications/application-proposal-route-context"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request, context: { params: Promise<{ projectKey: string; proposalId: string }> }) {
  const rejected = guardApplicationMutation(request)
  if (rejected) return rejected
  const params = await context.params
  const resolved = await resolveApplicationProposalRouteContext(params.projectKey)
  if (!resolved.ok) return resolved.response
  if (request.body !== null) return applicationReply({ error: "APPLICATION_PROPOSAL_REQUEST_INVALID" }, 400)
  try {
    return applicationReply({ proposal: await applyApplicationProposal({
      application: resolved.context.application,
      runtimeRoot: resolved.context.runtimeRoot,
      proposalId: params.proposalId,
      requestedBy: resolved.context.userId,
    }) })
  } catch (error) { return applicationProposalError(error) }
}
