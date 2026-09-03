import {
  readCodexContinuation,
  type CodexContinuationRepositoryIdentity,
} from "@/lib/loom/codex-continuation"
import { codexContinuationDependenciesForProjectRoot } from "@/lib/loom/codex-continuation-runtime"
import { loadOwnedWorkingWorld } from "@/lib/environment/space-persistence"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type WorkspaceProjectBinding,
} from "@/lib/projects/workspace-project-binding"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const WORKSPACE_ROOT_RESOURCE = "williamos-workspace-root:v1:"

function worldMatchesWorkspaceProject(
  world: NonNullable<Awaited<ReturnType<typeof loadOwnedWorkingWorld>>>,
  binding: WorkspaceProjectBinding,
): boolean {
  return world.spine.projectId === binding.projectId
    && world.spine.projectName === binding.projectName
    && world.resources.includes(`${WORKSPACE_ROOT_RESOURCE}${binding.project.identity}`)
}

function repositoryMatches(
  repository: CodexContinuationRepositoryIdentity,
  binding: WorkspaceProjectBinding,
): boolean {
  return repository.projectIdentity === binding.project.identity
    && repository.repositoryResourceKey === binding.repositoryKey
    && repository.repositoryIdentity === binding.repositoryIdentity
    && repository.repositoryMountKey === binding.repositoryMountKey
    && repository.observedRevision === binding.observedRevision
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  const url = new URL(request.url)
  const queryKeys = [...url.searchParams.keys()].sort().join("\0")
  if (queryKeys !== "projectKey\0worldId"
    || url.searchParams.getAll("worldId").length !== 1
    || url.searchParams.getAll("projectKey").length !== 1) {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }
  const worldId = url.searchParams.get("worldId")?.trim() ?? ""
  if (!worldId || worldId.length > 200 || worldId.includes("\0")) {
    return Response.json({ error: "WORLD_ID_REQUIRED" }, { status: 400 })
  }
  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, url.searchParams.get("projectKey"))
  if (!projectBinding.ok) {
    return Response.json({ error: projectBinding.error }, { status: 503 })
  }
  try {
    const world = await loadOwnedWorkingWorld(session.user.id, worldId)
    if (!world) return Response.json({ error: "WORLD_NOT_FOUND" }, { status: 404 })
    if (!worldMatchesWorkspaceProject(world, projectBinding.binding)) {
      return Response.json({ error: "WORLD_PROJECT_MISMATCH" }, { status: 409 })
    }
    const continuation = await readCodexContinuation(session.user.id, worldId,
      codexContinuationDependenciesForProjectRoot(projectBinding.binding.workspaceRoot, async (repository) => {
        const resolved = await resolveCanonicalWorkspaceProjectBinding(
          session.user.id,
          projectBinding.binding.projectKey,
          undefined,
          repository.repositoryResourceKey,
        )
        return resolved.ok && repositoryMatches(repository, resolved.binding)
          ? resolved.binding.workspaceRoot
          : null
      }))
    return Response.json(continuation, { headers: { "cache-control": "no-store" } })
  } catch {
    return Response.json({ error: "CODEX_CONTINUATION_UNAVAILABLE" }, { status: 503 })
  }
}
