import {
  createDefaultSpace,
  browserSpaceStorageKey,
  createOwnedProjectSpace,
  listOwnedProjectSpaces,
  loadOrCreateOwnedSpace,
  saveOwnedSpace,
  type WorkspaceProject,
} from "@/lib/environment/space-persistence"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { admitWorkspaceApp, williamOsOrigin } from "@/lib/environment/workspace-app"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type CanonicalWorkspaceProjectKey,
  type WorkspaceProjectBinding,
} from "@/lib/projects/workspace-project-binding"
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

function canonicalProjectKey(value: unknown): CanonicalWorkspaceProjectKey | null {
  if (value === undefined || value === null) return "terrafusion"
  return value === "terrafusion" || value === "williamos" ? value : null
}

async function admittedAppUrl(request: Request, binding: WorkspaceProjectBinding): Promise<string | null> {
  const admission = await admitWorkspaceApp(
    binding.workspaceAppUrl,
    williamOsOrigin(CANONICAL_WILLIAMOS_URL, request.url),
  )
  return admission.ok ? admission.url : null
}

async function collectionMetadata(input: Readonly<{
  userId: string
  project: WorkspaceProject
  workspaceAppUrl: string | null
  current: { worldId: string; name: string; space: unknown }
}>) {
  try {
    return {
      spaces: await listOwnedProjectSpaces({
        userId: input.userId, project: input.project,
        workspaceAppUrl: input.workspaceAppUrl, current: input.current,
      }),
      collectionAvailable: true as const,
    }
  } catch {
    return {
      spaces: [{ ...input.current, updatedAt: new Date(0).toISOString() }],
      collectionAvailable: false as const,
      collectionReason: "SPACE_COLLECTION_UNAVAILABLE" as const,
    }
  }
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const requested = new URL(request.url).searchParams.get("worldId")
  if (requested !== null && !validWorldId(requested)) return reply({ error: "WORLD_ID_INVALID" }, 400)
  const projectKey = canonicalProjectKey(new URL(request.url).searchParams.get("projectKey"))
  if (!projectKey) return reply({ error: "SPACE_PROJECT_INVALID" }, 400)

  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
  if (!projectBinding.ok) return reply({ error: projectBinding.error }, 503)
  const binding = projectBinding.binding

  const workspaceAppUrl = await admittedAppUrl(request, binding)
  try {
    const result = await loadOrCreateOwnedSpace({
      userId: session.user.id,
      worldId: requested,
      workspaceAppUrl,
      project: binding.project,
      newWorldId: crypto.randomUUID,
    })
    if (!result) return reply({ error: "WORLD_NOT_FOUND" }, 404)
    const collection = await collectionMetadata({ userId: session.user.id, project: binding.project, workspaceAppUrl, current: result })
    return reply({
      ...result,
      storage: "server",
      ...collection,
      multiSpaceAvailable: true,
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, binding.project.identity),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "SPACE_PERSISTENCE_UNAVAILABLE"
    if (reason === "SPACE_PROJECT_MISMATCH") return reply({ error: reason }, 400)
    if (requested !== null) return reply({ error: "SPACE_PERSISTENCE_UNAVAILABLE" }, 503)
    // A missing optional persistence relation must not strand the primary browser experience.
    // The client persists this truthful, project-bound fallback in browser storage and labels it.
    const fallback = createDefaultSpace(workspaceAppUrl, binding.project.name)
    return reply({
      worldId: "browser-local",
      name: binding.project.name,
      space: fallback,
      project: binding.project,
      storage: "browser",
      browserStorageKey: browserSpaceStorageKey(session.user.id, binding.project.identity),
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, binding.project.identity),
      spaces: [{ worldId: "browser-local", name: binding.project.name, space: fallback, updatedAt: new Date(0).toISOString() }],
      multiSpaceAvailable: false,
    })
  }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const parsed = await readBoundedJson(request, 2_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  const body = parsed.value as { name?: unknown; projectKey?: unknown }
  const projectKey = canonicalProjectKey(body.projectKey)
  if (!projectKey) return reply({ error: "SPACE_PROJECT_INVALID" }, 400)
  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
  if (!projectBinding.ok) return reply({ error: projectBinding.error }, 503)
  const binding = projectBinding.binding
  try {
    const workspaceAppUrl = await admittedAppUrl(request, binding)
    const result = await createOwnedProjectSpace({
      userId: session.user.id,
      project: binding.project,
      name: body.name,
      workspaceAppUrl,
      newWorldId: crypto.randomUUID,
    })
    const collection = await collectionMetadata({ userId: session.user.id, project: binding.project, workspaceAppUrl, current: result })
    return reply({
      ...result, storage: "server", ...collection, multiSpaceAvailable: true,
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, binding.project.identity),
    }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "SPACE_NAME_INVALID") return reply({ error: message }, 400)
    if (message === "SPACE_LIMIT_REACHED") return reply({ error: message }, 409)
    return reply({ error: "SPACE_PERSISTENCE_UNAVAILABLE" }, 503)
  }
}

export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const parsed = await readBoundedJson(request, MAX_SPACE_BYTES)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  const body = parsed.value as { worldId?: unknown; space?: unknown; projectKey?: unknown }
  if (!validWorldId(body.worldId)) return reply({ error: "WORLD_ID_INVALID" }, 400)
  const projectKey = canonicalProjectKey(body.projectKey)
  if (!projectKey) return reply({ error: "SPACE_PROJECT_INVALID" }, 400)

  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
  if (!projectBinding.ok) return reply({ error: projectBinding.error }, 503)
  const binding = projectBinding.binding

  try {
    const workspaceAppUrl = await admittedAppUrl(request, binding)
    const result = await saveOwnedSpace({
      userId: session.user.id,
      worldId: body.worldId,
      space: body.space,
      workspaceAppUrl,
      project: binding.project,
    })
    return result ? reply(result) : reply({ error: "WORLD_NOT_FOUND" }, 404)
  } catch (error) {
    const reason = error instanceof Error && /^(SPACE_|WORLD_)/.test(error.message)
      ? error.message
      : "SPACE_PERSISTENCE_UNAVAILABLE"
    return reply({ error: reason }, reason === "SPACE_PERSISTENCE_UNAVAILABLE" ? 503 : 400)
  }
}
