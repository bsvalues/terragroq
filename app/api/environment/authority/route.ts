import { getSession } from "@/lib/session"
import { projectSovereignAuthority } from "@/lib/environment/sovereign-authority-surface"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * The sovereign Git authority state, read live from the integration record of the lab authority
 * (see lib/environment/sovereign-authority-surface.ts for the no-second-source discipline).
 *
 * Read-only and owner-gated, the same class as /api/environment/capability and /api/environment/
 * execution: it starts, advances, settles, or approves nothing. It exists because the doctrine's
 * central distinction — product completion and mirror synchronization are separate facts — was
 * enforced and recorded invisibly. A rule the owner cannot see is a rule the owner cannot govern.
 *
 * A missing or unreadable record is reported as its typed reason, never as an empty history: an
 * empty list would read as "nothing was ever promoted", which is the worst possible wrong answer.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  try {
    const projection = await projectSovereignAuthority()
    return Response.json(projection)
  } catch (error) {
    const detail = String(error instanceof Error ? error.message : error)
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "AUTHORITY_SURFACE_UNAVAILABLE"
    return Response.json({ error: code, detail }, { status: 503 })
  }
}
