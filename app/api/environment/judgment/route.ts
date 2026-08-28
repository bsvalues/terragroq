import { CHAT_MODEL, INFERENCE_BASE_URL } from "@/lib/ai/config"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import {
  loadOwnedWorkingWorld,
  saveOwnedJudgment,
} from "@/lib/environment/space-persistence"
import {
  deriveWilliamSafetyFacts,
  requestWilliamJudgment,
  williamJudgmentBasisFingerprint,
} from "@/lib/environment/william-judgment"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 120

const MAX_JUDGMENT_BYTES = 4_096

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

function validWorldId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0")
}

export async function POST(request: Request) {
  const rejection = guardLineRequest(request)
  if (rejection) return reply({ error: rejection.error }, rejection.status)

  let session: Awaited<ReturnType<typeof getSession>> = null
  try { session = await getSession() } catch { session = null }
  if (!session?.user) return reply({ error: "UNAUTHENTICATED" }, 401)

  const parsed = await readBoundedJson(request, MAX_JUDGMENT_BYTES)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  const worldId = (parsed.value as { worldId?: unknown }).worldId
  if (!validWorldId(worldId)) return reply({ error: "WORLD_ID_INVALID" }, 400)

  let world
  try {
    world = await loadOwnedWorkingWorld(session.user.id, worldId)
  } catch {
    return reply({ error: "WORLD_PERSISTENCE_UNAVAILABLE" }, 503)
  }
  if (!world) return reply({ error: "WORLD_NOT_FOUND" }, 404)

  try {
    const judgment = await requestWilliamJudgment(world, {
      baseUrl: INFERENCE_BASE_URL,
      model: CHAT_MODEL,
      apiKey: process.env.WILLIAMOS_AI_API_KEY?.trim() || null,
    })
    await saveOwnedJudgment({
      userId: session.user.id,
      worldId,
      judgment,
      expectedBasisFingerprint: williamJudgmentBasisFingerprint(world),
    })
    return reply({ judgment, safetyFacts: deriveWilliamSafetyFacts(world) })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "JUDGMENT_INFERENCE_UNAVAILABLE"
    if (reason === "WORLD_NOT_FOUND") return reply({ error: reason }, 404)
    if (reason === "WORLD_PERSISTENCE_BUSY") return reply({ error: reason }, 409)
    if (reason === "JUDGMENT_BASIS_STALE") return reply({ error: reason }, 409)
    if (/^JUDGMENT_(OUTPUT|RECOMMENDATION|RATIONALE|BASIS|CONFIDENCE)/.test(reason)) {
      return reply({ error: reason }, 502)
    }
    if (reason === "JUDGMENT_INFERENCE_UNAVAILABLE") return reply({ error: reason }, 503)
    return reply({ error: "WORLD_PERSISTENCE_UNAVAILABLE" }, 503)
  }
}
