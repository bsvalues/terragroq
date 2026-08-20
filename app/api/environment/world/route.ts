import { environmentWorldService } from "@/lib/environment/server"
import { authenticatedUserId, NO_STORE_HEADERS } from "@/app/api/environment/http"

export async function GET(request: Request) {
  const userId = await authenticatedUserId()
  if (!userId) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE_HEADERS })
  const worldId = new URL(request.url).searchParams.get("worldId")
  const world = await environmentWorldService.load(userId, worldId)
  if (!world) return Response.json({ error: "WORLD_NOT_FOUND" }, { status: 404, headers: NO_STORE_HEADERS })
  return Response.json({ world }, { headers: NO_STORE_HEADERS })
}
