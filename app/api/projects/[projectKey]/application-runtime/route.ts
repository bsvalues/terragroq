import { applicationReply, guardApplicationMutation, resolveApplicationRouteContext } from "@/lib/applications/application-route-context"
import { getApplicationRuntime, startApplicationRuntime, stopApplicationRuntime } from "@/lib/applications/application-runtime"
import { getBuildProvenance } from "@/lib/build-provenance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ projectKey: string }> }
async function action(request: Request, context: Context, method: "get" | "start" | "stop") {
  if (method !== "get") { const rejected = guardApplicationMutation(request); if (rejected) return rejected }
  const resolved = await resolveApplicationRouteContext((await context.params).projectKey)
  if (!resolved.ok) return resolved.response
  // No request body is part of the runtime policy. Reject it before any runtime action.
  if (method !== "get" && request.body !== null) return applicationReply({ error: "APPLICATION_REQUEST_INVALID" }, 400)
  try {
    const application = resolved.context.application
    const value = await ({ get: getApplicationRuntime, start: startApplicationRuntime, stop: stopApplicationRuntime }[method])(application)
    return applicationReply({ runtime: value, truth: { runtimeBuild: getBuildProvenance(), activeProjectHead: application.head } })
  } catch { return applicationReply({ error: "APPLICATION_RUNTIME_UNAVAILABLE" }, 503) }
}
export const GET = (request: Request, context: Context) => action(request, context, "get")
export const POST = (request: Request, context: Context) => action(request, context, "start")
export const DELETE = (request: Request, context: Context) => action(request, context, "stop")
