import { loadOwnedCrossRepositoryChangeSet } from "@/lib/environment/cross-repository-change-set"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

function validWorldId(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const worldId = new URL(request.url).searchParams.get("worldId")
  if (!validWorldId(worldId)) return reply({ error: "WORLD_ID_INVALID" }, 400)
  try {
    const result = await loadOwnedCrossRepositoryChangeSet(session.user.id, worldId)
    return result ? reply(result) : reply({ error: "WORLD_NOT_FOUND" }, 404)
  } catch {
    return reply({ error: "CHANGE_SET_UNAVAILABLE" }, 503)
  }
}
