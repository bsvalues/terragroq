import {
  createDefaultSpace,
  browserSpaceStorageKey,
  createOwnedProjectSpace,
  listOwnedProjectSpaces,
  loadOrCreateOwnedSpace,
  saveOwnedSpace,
  workspaceProjectFromRoot,
} from "@/lib/environment/space-persistence"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { admitWorkspaceApp, williamOsOrigin } from "@/lib/environment/workspace-app"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const WORKSPACE_APP_URL = process.env.WILLIAMOS_WORKSPACE_APP_URL?.trim() || null
const CANONICAL_WILLIAMOS_URL = process.env.BETTER_AUTH_URL?.trim() || null
const WORKSPACE_PROJECT = workspaceProjectFromRoot(
  process.env.WILLIAMOS_PROJECT_ROOT?.trim() || process.cwd(),
  process.env.WILLIAMOS_PROJECT_NAME,
)
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

  const workspaceAppUrl = await admittedAppUrl(request)
  try {
    const result = await loadOrCreateOwnedSpace({
      userId: session.user.id,
      worldId: requested,
      workspaceAppUrl,
      project: WORKSPACE_PROJECT,
      newWorldId: crypto.randomUUID,
    })
    if (!result) return reply({ error: "WORLD_NOT_FOUND" }, 404)
    const spaces = await listOwnedProjectSpaces({
      userId: session.user.id, project: WORKSPACE_PROJECT, workspaceAppUrl,
    })
    return reply({
      ...result,
      spaces,
      multiSpaceAvailable: true,
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, WORKSPACE_PROJECT.identity),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "SPACE_PERSISTENCE_UNAVAILABLE"
    if (reason === "SPACE_PROJECT_MISMATCH") return reply({ error: reason }, 400)
    if (requested !== null) return reply({ error: "SPACE_PERSISTENCE_UNAVAILABLE" }, 503)
    // A missing optional persistence relation must not strand the primary browser experience.
    // The client persists this truthful, project-bound fallback in browser storage and labels it.
    const fallback = createDefaultSpace(workspaceAppUrl)
    return reply({
      worldId: "browser-local",
      name: WORKSPACE_PROJECT.name,
      space: fallback,
      project: WORKSPACE_PROJECT,
      storage: "browser",
      browserStorageKey: browserSpaceStorageKey(session.user.id, WORKSPACE_PROJECT.identity),
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, WORKSPACE_PROJECT.identity),
      spaces: [{ worldId: "browser-local", name: WORKSPACE_PROJECT.name, space: fallback, updatedAt: new Date(0).toISOString() }],
      multiSpaceAvailable: false,
    })
  }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const parsed = await readBoundedJson(request, 2_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  const body = parsed.value as { name?: unknown }
  try {
    const workspaceAppUrl = await admittedAppUrl(request)
    const result = await createOwnedProjectSpace({
      userId: session.user.id,
      project: WORKSPACE_PROJECT,
      name: body.name,
      workspaceAppUrl,
      newWorldId: crypto.randomUUID,
    })
    const spaces = await listOwnedProjectSpaces({ userId: session.user.id, project: WORKSPACE_PROJECT, workspaceAppUrl })
    return reply({
      ...result, spaces, multiSpaceAvailable: true,
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, WORKSPACE_PROJECT.identity),
    }, 201)
  } catch (error) {
    const reason = error instanceof Error && error.message === "SPACE_NAME_INVALID"
      ? error.message : "SPACE_PERSISTENCE_UNAVAILABLE"
    return reply({ error: reason }, reason === "SPACE_NAME_INVALID" ? 400 : 503)
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
      project: WORKSPACE_PROJECT,
    })
    return result ? reply(result) : reply({ error: "WORLD_NOT_FOUND" }, 404)
  } catch (error) {
    const reason = error instanceof Error && /^(SPACE_|WORLD_)/.test(error.message)
      ? error.message
      : "SPACE_PERSISTENCE_UNAVAILABLE"
    return reply({ error: reason }, reason === "SPACE_PERSISTENCE_UNAVAILABLE" ? 503 : 400)
  }
}
