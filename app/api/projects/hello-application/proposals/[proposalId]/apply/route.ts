import { applyHelloApplicationProposal } from "@/lib/hello-application/proposal-service.mjs"
import {
  helloProposalError,
  resolveHelloProposalRouteContext,
} from "@/lib/hello-application/proposal-route-context"
import { guardHelloApplicationMutation } from "@/lib/hello-application/mutation-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(
  request: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  const rejection = guardHelloApplicationMutation(request)
  if (rejection) return rejection
  const resolved = await resolveHelloProposalRouteContext()
  if (!resolved.ok) return resolved.response
  const { proposalId } = await context.params
  try {
    const proposal = await applyHelloApplicationProposal({
      repositoryRoot: resolved.context.repositoryRoot,
      runtimeRoot: resolved.context.runtimeRoot,
      requestedBy: resolved.context.userId,
      proposalId,
    })
    return Response.json({ proposal }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return helloProposalError(error)
  }
}
