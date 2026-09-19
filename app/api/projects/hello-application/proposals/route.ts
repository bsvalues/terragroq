import {
  createHelloApplicationProposal,
  listHelloApplicationProposals,
} from "@/lib/hello-application/proposal-service.mjs"
import {
  helloProposalError,
  resolveHelloProposalRouteContext,
} from "@/lib/hello-application/proposal-route-context"
import { guardHelloApplicationMutation } from "@/lib/hello-application/mutation-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 1800

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
  if (rejection) return rejection
  const resolved = await resolveHelloProposalRouteContext()
  if (!resolved.ok) return resolved.response
  try {
    const proposal = await createHelloApplicationProposal({
      repositoryRoot: resolved.context.repositoryRoot,
      runtimeRoot: resolved.context.runtimeRoot,
      requestedBy: resolved.context.userId,
    })
    return Response.json({ proposal }, { status: 201, headers: { "cache-control": "no-store" } })
  } catch (error) {
    return helloProposalError(error)
  }
}
