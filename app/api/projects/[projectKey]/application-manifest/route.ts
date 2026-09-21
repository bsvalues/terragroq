import { applicationReply, resolveApplicationRouteContext } from "@/lib/applications/application-route-context"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectKey: string }> },
) {
  const resolved = await resolveApplicationRouteContext((await context.params).projectKey)
  if (!resolved.ok) return resolved.response
  const { manifest, manifestDigest, head } = resolved.context.application
  return applicationReply({ manifest, manifestDigest, head })
}
