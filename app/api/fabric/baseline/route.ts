import { getSession } from "@/lib/session"
import { readRegistry, runAllBaselines, type NodeRecord } from "@/lib/fabric/run-baseline.mjs"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * The owner-facing entry to the baseline gate. The gate itself lives in `lib/fabric/run-baseline.mjs`
 * so an agent can run it headlessly (`npm run fabric:baseline`) without a browser session -- this
 * route is one caller of that gate, not the gate.
 */
export async function POST() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let registry: Record<string, NodeRecord>
  try {
    registry = await readRegistry()
  } catch {
    return Response.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503 })
  }

  return Response.json(await runAllBaselines(registry), { headers: { "cache-control": "no-store" } })
}
