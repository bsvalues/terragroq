import { loadOrCreateOwnedSpace, saveOwnedSpace } from "@/lib/environment/space-persistence"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { admitWorkspaceApp, williamOsOrigin } from "@/lib/environment/workspace-app"
import { resolveTerraFusionWorkspaceBinding, type WorkspaceProjectBinding } from "@/lib/projects/workspace-project-binding"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const CANONICAL_WILLIAMOS_URL = process.env.BETTER_AUTH_URL?.trim() || null
const MAX_SPACE_BYTES = 256_000

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

function validWorldId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0")
}

async function admittedAppUrl(request: Request, binding: WorkspaceProjectBinding): Promise<string | null> {
  const admission = await admitWorkspaceApp(
    binding.workspaceAppUrl,
    williamOsOrigin(CANONICAL_WILLIAMOS_URL, request.url),
  )
  return admission.ok ? admission.url : null
}

function bindSpine<T extends { spine: { projectId: number | null; projectName: string | null } }>(
  result: T,
  binding: WorkspaceProjectBinding,
): T {
  return {
    ...result,
    spine: {
      ...result.spine,
      projectId: binding.projectId,
      projectName: binding.projectName,
    },
  }
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const requested = new URL(request.url).searchParams.get("worldId")
  if (requested !== null && !validWorldId(requested)) return reply({ error: "WORLD_ID_INVALID" }, 400)

  try {
    const resolved = await resolveTerraFusionWorkspaceBinding(session.user.id)
    if (!resolved.ok) return reply({ error: resolved.error }, 503)
    const binding = resolved.binding
    const workspaceAppUrl = await admittedAppUrl(request, binding)
    const result = await loadOrCreateOwnedSpace({
      userId: session.user.id,
      worldId: requested,
      workspaceAppUrl,
      projectRootIdentity: binding.repositoryIdentity,
      newWorldId: crypto.randomUUID,
    })
    return result ? reply(bindSpine(result, binding)) : reply({ error: "WORLD_NOT_FOUND" }, 404)
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
    const resolved = await resolveTerraFusionWorkspaceBinding(session.user.id)
    if (!resolved.ok) return reply({ error: resolved.error }, 503)
    const binding = resolved.binding
    const workspaceAppUrl = await admittedAppUrl(request, binding)
    const result = await saveOwnedSpace({
      userId: session.user.id,
      worldId: body.worldId,
      space: body.space,
      workspaceAppUrl,
    })
    return result ? reply(bindSpine(result, binding)) : reply({ error: "WORLD_NOT_FOUND" }, 404)
  } catch (error) {
    const reason = error instanceof Error && /^(SPACE_|WORLD_)/.test(error.message)
      ? error.message
      : "SPACE_PERSISTENCE_UNAVAILABLE"
    return reply({ error: reason }, reason === "SPACE_PERSISTENCE_UNAVAILABLE" ? 503 : 400)
  }
}
