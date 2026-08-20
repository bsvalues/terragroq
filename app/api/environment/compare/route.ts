import { environmentWorldService } from "@/lib/environment/server"
import { authenticatedUserId, environmentError, NO_STORE_HEADERS, readEnvironmentJson } from "@/app/api/environment/http"

export async function POST(request: Request) {
  const userId = await authenticatedUserId()
  if (!userId) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE_HEADERS })
  let body: { leftWorldId?: unknown; rightWorldId?: unknown }
  try {
    body = await readEnvironmentJson(request) as { leftWorldId?: unknown; rightWorldId?: unknown }
  } catch (error) {
    return environmentError(error)
  }
  if (!body || typeof body !== "object" || typeof body.leftWorldId !== "string" || typeof body.rightWorldId !== "string") {
    return Response.json({ error: "WORLD_IDS_REQUIRED" }, { status: 400, headers: NO_STORE_HEADERS })
  }
  try {
    const reply = await environmentWorldService.compare(userId, {
      leftWorldId: body.leftWorldId,
      rightWorldId: body.rightWorldId,
    })
    return Response.json(reply, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return environmentError(error)
  }
}
