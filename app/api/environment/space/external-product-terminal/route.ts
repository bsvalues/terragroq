import { finalizeExternalProductTerminalOutcome } from "@/lib/environment/external-product-terminal-settlement"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

const CONFLICTS = new Set([
  "PRODUCT_TERMINAL_CONTEXT_STALE",
  "PRODUCT_TERMINAL_AUTHORITY_REVOKED",
  "PRODUCT_TERMINAL_CONFLICT",
  "PRODUCT_TERMINAL_PROVENANCE_INVALID",
])

export async function POST(request: Request): Promise<Response> {
  const rejection = guardLineRequest(request)
  if (rejection) return reply({ error: rejection.error }, rejection.status)
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) return reply(
    { error: owner.failure, detail: owner.detail },
    owner.failure === "NOT_OWNER" ? 403 : 409,
  )
  const parsed = await readBoundedJson(request, 2_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)
    || Object.keys(parsed.value).length !== 1
    || typeof (parsed.value as Record<string, unknown>).worldId !== "string"
    || !(parsed.value as Record<string, unknown>).worldId
    || String((parsed.value as Record<string, unknown>).worldId).length > 200
    || String((parsed.value as Record<string, unknown>).worldId).includes("\0")) {
    return reply({ error: "PRODUCT_TERMINAL_REQUEST_INVALID" }, 400)
  }
  try {
    return reply(await finalizeExternalProductTerminalOutcome({
      userId: session.user.id,
      worldId: String((parsed.value as Record<string, unknown>).worldId),
    }))
  } catch (error) {
    const code = error instanceof Error ? error.message : "PRODUCT_TERMINAL_UNAVAILABLE"
    if (code === "WORLD_NOT_FOUND") return reply({ error: code }, 404)
    if (CONFLICTS.has(code)) return reply({ error: code }, 409)
    return reply({ error: "PRODUCT_TERMINAL_UNAVAILABLE" }, 503)
  }
}
