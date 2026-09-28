import { getSession } from "@/lib/session"
import { projectComputeCapabilities } from "@/lib/environment/capability-inventory-surface"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * The capability inventory, read live from the same modules dispatch enforces (see
 * lib/environment/capability-inventory-surface.ts for why no second registry exists).
 *
 * Read-only and owner-gated, in the same class as /api/environment/execution: it can start,
 * advance, settle, or approve nothing. It exists because the records that decide where compute
 * runs were invisible on the owner surface — a capability nobody can see is a capability nobody
 * can govern, and the estate has been burned by enforcement outrunning visibility.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  try {
    const projection = await projectComputeCapabilities()
    return Response.json(projection)
  } catch (error) {
    // The failure is reported as itself. An inventory that silently returns empty would look
    // exactly like "no capabilities exist", which is the worst possible wrong answer here.
    return Response.json(
      { error: "CAPABILITY_SURFACE_UNAVAILABLE", detail: String(error instanceof Error ? error.message : error) },
      { status: 503 },
    )
  }
}
