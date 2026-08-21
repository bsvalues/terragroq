import { environmentWorldService } from "@/lib/environment/server"
import { authenticatedUserId, environmentError, NO_STORE_HEADERS } from "@/app/api/environment/http"
import { exceedsLineCap, guardLineRequest, isMalformedWorldId, readBoundedJson } from "@/lib/environment/line-guard"

export async function POST(request: Request) {
  // Preserve main's CSRF and streaming body-limit wall before session or model work.
  const rejection = guardLineRequest(request)
  if (rejection) {
    return Response.json({ error: rejection.error }, { status: rejection.status, headers: NO_STORE_HEADERS })
  }

  const userId = await authenticatedUserId()
  if (!userId) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE_HEADERS })

  const parsed = await readBoundedJson(request)
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.status, headers: NO_STORE_HEADERS })
  }
  const body = parsed.value as { text?: unknown; worldId?: unknown }
  if (!body || typeof body !== "object" || typeof body.text !== "string") {
    return Response.json({ error: "MESSAGE_REQUIRED" }, { status: 400, headers: NO_STORE_HEADERS })
  }
  if (exceedsLineCap(body.text)) {
    return Response.json({ error: "MESSAGE_TOO_LARGE" }, { status: 413, headers: NO_STORE_HEADERS })
  }
  if (isMalformedWorldId(body.worldId)) {
    return Response.json({ error: "INVALID_WORLD_ID" }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const reply = await environmentWorldService.submitLine(userId, {
      text: body.text,
      worldId: typeof body.worldId === "string" && body.worldId ? body.worldId : null,
    })
    return Response.json(reply, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return environmentError(error)
  }
}
