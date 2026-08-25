import { loadOrCreateOwnedSpace, saveOwnedSpace } from "@/lib/environment/space-persistence"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { admitWorkspaceApp, williamOsOrigin } from "@/lib/environment/workspace-app"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const WORKSPACE_APP_URL = process.env.WILLIAMOS_WORKSPACE_APP_URL?.trim() || null
const CANONICAL_WILLIAMOS_URL = process.env.BETTER_AUTH_URL?.trim() || null
const MAX_SPACE_BYTES = 256_000

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

function validWorldId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0")
}

async function admittedAppUrl(request: Request): Promise<string | null> {
  const admission = await admitWorkspaceApp(
    WORKSPACE_APP_URL,
    williamOsOrigin(CANONICAL_WILLIAMOS_URL, request.url),
  )
  return admission.ok ? admission.url : null
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const requested = new URL(request.url).searchParams.get("worldId")
  if (requested !== null && !validWorldId(requested)) return reply({ error: "WORLD_ID_INVALID" }, 400)

  try {
    const workspaceAppUrl = await admittedAppUrl(request)
    const result = await loadOrCreateOwnedSpace({
      userId: session.user.id,
      worldId: requested,
      workspaceAppUrl,
      newWorldId: crypto.randomUUID,
    })
    return result ? reply(result) : reply({ error: "WORLD_NOT_FOUND" }, 404)
  } catch {
    return reply({ error: "SPACE_PERSISTENCE_UNAVAILABLE" }, 503)
  }
}

export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const parsed = await readBoundedJson(request, MAX_SPACE_BYTES)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  const body = parsed.value as { worldId?: unknown; space?: unknown }
  if (!validWorldId(body.worldId)) return reply({ error: "WORLD_ID_INVALID" }, 400)

  try {
    const workspaceAppUrl = await admittedAppUrl(request)
    const result = await saveOwnedSpace({
      userId: session.user.id,
      worldId: body.worldId,
      space: body.space,
      workspaceAppUrl,
    })
    return result ? reply(result) : reply({ error: "WORLD_NOT_FOUND" }, 404)
  } catch (error) {
    const reason = error instanceof Error && /^(SPACE_|WORLD_)/.test(error.message)
      ? error.message
      : "SPACE_PERSISTENCE_UNAVAILABLE"
    return reply({ error: reason }, reason === "SPACE_PERSISTENCE_UNAVAILABLE" ? 503 : 400)
  }
}
