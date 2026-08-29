import { getUserId } from "@/lib/session"
import {
  councilRequestSchema,
  conveneCouncil,
  CouncilContextError,
  CouncilInferenceError,
} from "@/lib/environment/council"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import {
  loadOwnedCouncilHistory,
  loadOwnedWorkingWorld,
  saveOwnedCouncilDisposition,
  saveOwnedCouncilSession,
} from "@/lib/environment/space-persistence"
import { z } from "zod"

export const maxDuration = 300

const dispositionRequestSchema = z.object({
  worldId: councilRequestSchema.shape.worldId,
  sessionId: z.string().trim().min(1).max(200),
  sessionCreatedAt: z.string().datetime({ offset: true }),
  direction: z.enum(["approve", "reject", "request-changes"]),
}).strict()

export async function GET(request: Request) {
  let userId: string
  try {
    userId = await getUserId()
  } catch {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }
  const worldId = new URL(request.url).searchParams.get("worldId")
  if (!worldId || !councilRequestSchema.shape.worldId.safeParse(worldId).success) {
    return Response.json({ error: "INVALID_WORLD_ID" }, { status: 400 })
  }
  try {
    const history = await loadOwnedCouncilHistory(userId, worldId)
    if (!history) return Response.json({ error: "WORLD_NOT_FOUND" }, { status: 404 })
    return Response.json({ history })
  } catch {
    return Response.json({ error: "WORLD_PERSISTENCE_UNAVAILABLE" }, { status: 503 })
  }
}

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
    try {
      await saveOwnedCouncilSession({ userId, worldId: parsedRequest.data.worldId, session })
    } catch {
      return Response.json({ error: "COUNCIL_PERSISTENCE_UNAVAILABLE" }, { status: 503 })
    }
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

export async function PATCH(request: Request) {
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
  const parsed = dispositionRequestSchema.safeParse(parsedBody.value)
  if (!parsed.success) return Response.json({ error: "INVALID_COUNCIL_DISPOSITION" }, { status: 400 })

  try {
    const session = await saveOwnedCouncilDisposition({
      userId,
      ...parsed.data,
      recordedAt: new Date().toISOString(),
    })
    return Response.json({ session })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "WORLD_NOT_FOUND" || code === "COUNCIL_SESSION_NOT_FOUND") {
      return Response.json({ error: code }, { status: 404 })
    }
    if (code === "COUNCIL_SESSION_STALE" || code === "COUNCIL_DISPOSITION_CONFLICT") {
      return Response.json({ error: code }, { status: 409 })
    }
    return Response.json({ error: "COUNCIL_PERSISTENCE_UNAVAILABLE" }, { status: 503 })
  }
}
