import { getUserId } from "@/lib/session"
import {
  councilRequestSchema,
  conveneCouncil,
  CouncilContextError,
  CouncilInferenceError,
} from "@/lib/environment/council"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import { loadOwnedWorkingWorld } from "@/lib/environment/space-persistence"

export const maxDuration = 300

export async function POST(request: Request) {
  const rejection = guardLineRequest(request)
  if (rejection) return Response.json({ error: rejection.error }, { status: rejection.status })

  let userId: string
  try {
    userId = await getUserId()
  } catch {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  const parsedBody = await readBoundedJson(request)
  if (!parsedBody.ok) return Response.json({ error: parsedBody.error }, { status: parsedBody.status })

  const parsedRequest = councilRequestSchema.safeParse(parsedBody.value)
  if (!parsedRequest.success) {
    return Response.json({ error: "INVALID_COUNCIL_REQUEST" }, { status: 400 })
  }

  let world
  try {
    world = await loadOwnedWorkingWorld(userId, parsedRequest.data.worldId)
  } catch {
    return Response.json({ error: "WORLD_PERSISTENCE_UNAVAILABLE" }, { status: 503 })
  }
  if (!world) return Response.json({ error: "WORLD_NOT_FOUND" }, { status: 404 })

  try {
    const session = await conveneCouncil(parsedRequest.data, world)
    return Response.json({ session })
  } catch (error) {
    if (error instanceof CouncilContextError) {
      return Response.json({ error: "COUNCIL_CONTEXT_MISMATCH" }, { status: 409 })
    }
    if (error instanceof CouncilInferenceError) {
      return Response.json({ error: "COUNCIL_INFERENCE_FAILED", detail: error.message }, { status: 502 })
    }
    return Response.json({ error: "COUNCIL_INFERENCE_FAILED", detail: "Council inference failed." }, { status: 502 })
  }
}
