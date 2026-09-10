import {
  assimilateOwnedSpaceOutcome,
  type SpaceOutcomeAssimilationResult,
} from "@/lib/environment/space-outcome-assimilation"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

function validWorldId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0")
}

export async function POST(request: Request): Promise<Response> {
  const rejection = guardLineRequest(request)
  if (rejection) return reply({ error: rejection.error }, rejection.status)
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const parsed = await readBoundedJson(request, 2_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return reply({ error: "REQUEST_FIELDS_INVALID" }, 400)
  }
  const body = parsed.value as Record<string, unknown>
  if (Object.keys(body).length !== 1 || !Object.prototype.hasOwnProperty.call(body, "worldId")) {
    return reply({ error: "REQUEST_FIELDS_INVALID" }, 400)
  }
  if (!validWorldId(body.worldId)) return reply({ error: "WORLD_ID_INVALID" }, 400)
  try {
    const result: SpaceOutcomeAssimilationResult = await assimilateOwnedSpaceOutcome({
      userId: session.user.id,
      worldId: body.worldId,
    })
    if (result.status === "WORLD_NOT_FOUND") return reply(result, 404)
    if (result.status === "MISSING_AUTHORITY" || result.status === "SPACE_ALREADY_BOUND") return reply(result, 409)
    if (result.status === "SPACE_PERSISTENCE_BUSY" || result.status === "SPACE_AUTHORITY_UNAVAILABLE") {
      return reply(result, 503)
    }
    return reply(result)
  } catch {
    return reply({ error: "SPACE_OUTCOME_ASSIMILATION_UNAVAILABLE" }, 503)
  }
}
