import { listApplicationExecutionRoutes, DEFAULT_APPLICATION_EXECUTION_ROUTE } from "@/lib/applications/execution-routing.mjs"
import { applicationCerebrasCapability } from "@/lib/applications/cerebras-turn.mjs"
import { applicationReply } from "@/lib/applications/application-route-context"
import { applicationProposalError, resolveApplicationProposalRouteContext } from "@/lib/applications/application-proposal-route-context"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ projectKey: string }> }) {
  const resolved = await resolveApplicationProposalRouteContext((await context.params).projectKey)
  if (!resolved.ok) return resolved.response
  try {
    return applicationReply({
      schemaVersion: 1,
      defaultRoute: DEFAULT_APPLICATION_EXECUTION_ROUTE,
      routes: listApplicationExecutionRoutes({
        externalCapability: applicationCerebrasCapability(resolved.context.application).available,
      }),
    })
  } catch (error) { return applicationProposalError(error) }
}
