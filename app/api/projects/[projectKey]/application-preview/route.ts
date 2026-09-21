import { applicationReply, resolveApplicationRouteContext } from "@/lib/applications/application-route-context"
import { readApplicationPreview } from "@/lib/applications/application-runtime"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(_request: Request, context: { params: Promise<{ projectKey: string }> }) {
  const resolved = await resolveApplicationRouteContext((await context.params).projectKey)
  if (!resolved.ok) return resolved.response
  try {
    const html = await readApplicationPreview(resolved.context.application)
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; sandbox allow-scripts",
      "referrer-policy": "no-referrer" } })
  } catch (error) {
    return applicationReply({ error: "APPLICATION_PREVIEW_UNAVAILABLE" }, error instanceof Error && error.message === "APPLICATION_RUNTIME_NOT_RUNNING" ? 409 : 503)
  }
}
