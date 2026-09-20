import {
  DEFAULT_HELLO_EXECUTION_ROUTE,
  listHelloExecutionRoutes,
} from "@/lib/hello-application/execution-routing.mjs"
import {
  helloProposalError,
  resolveHelloProposalRouteContext,
} from "@/lib/hello-application/proposal-route-context"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const resolved = await resolveHelloProposalRouteContext()
  if (!resolved.ok) return resolved.response
  try {
    return Response.json({
      schemaVersion: 1,
      defaultRoute: DEFAULT_HELLO_EXECUTION_ROUTE,
      routes: listHelloExecutionRoutes(),
    }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return helloProposalError(error)
  }
}
