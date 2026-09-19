import { getHelloApplicationProposal } from "@/lib/hello-application/proposal-service.mjs"
import {
  helloProposalError,
  resolveHelloProposalRouteContext,
} from "@/lib/hello-application/proposal-route-context"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

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
