import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const RETIRED = {
  error: "LEGACY_WORK_CONTEXT_RECEIPT_RETIRED",
  detail: "Delivery authority comes from an existing Space-bound assignment; this endpoint cannot mint it.",
} as const

/**
 * Work context is no longer manufactured for a lane or pull request. The active Space owns it and
 * the delivery boundary can only seal an assignment that WilliamOS already persisted before work.
 */
export async function POST() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  return Response.json(RETIRED, { status: 410, headers: { "cache-control": "no-store" } })
}

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  return Response.json(RETIRED, { status: 410, headers: { "cache-control": "no-store" } })
}
