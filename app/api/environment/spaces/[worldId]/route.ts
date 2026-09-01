import {
  removeOwnedProjectSpace,
} from "@/lib/environment/space-persistence"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type CanonicalWorkspaceProjectKey,
} from "@/lib/projects/workspace-project-binding"
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

function canonicalProjectKey(value: string | null): CanonicalWorkspaceProjectKey | null {
  if (value === null) return "terrafusion"
  return value === "terrafusion" || value === "williamos" ? value : null
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ worldId: string }> },
) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const { worldId } = await context.params
  if (!validWorldId(worldId)) return reply({ error: "WORLD_ID_INVALID" }, 400)
  const projectKey = canonicalProjectKey(new URL(request.url).searchParams.get("projectKey"))
  if (!projectKey) return reply({ error: "SPACE_PROJECT_INVALID" }, 400)
  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
  if (!projectBinding.ok) return reply({ error: projectBinding.error }, 503)
  try {
    const removed = await removeOwnedProjectSpace({
      userId: session.user.id,
      project: projectBinding.binding.project,
      worldId,
    })
    return reply(removed)
  } catch (error) {
    const reason = error instanceof Error ? error.message : "SPACE_REMOVAL_UNAVAILABLE"
    if (reason === "WORLD_NOT_FOUND") return reply({ error: reason }, 404)
    if (reason === "SPACE_PROJECT_MISMATCH") return reply({ error: reason }, 400)
    if (reason === "SPACE_LAST_PROJECT_SPACE") return reply({ error: reason }, 409)
    return reply({ error: "SPACE_REMOVAL_UNAVAILABLE" }, 503)
  }
}
