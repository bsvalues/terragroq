import { routeUniversalIntent } from "@/lib/intent/router"
import { getUserId } from "@/lib/session"

const MAX_INTENT_LENGTH = 2000

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function POST(request: Request) {
  try {
    await getUserId()
  } catch {
    return json({ error: "Unauthorized" }, 401)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  const intent =
    payload && typeof payload === "object" && "intent" in payload
      ? (payload as { intent: unknown }).intent
      : null
  if (typeof intent !== "string" || !intent.trim() || intent.length > MAX_INTENT_LENGTH) {
    return json({ error: `intent must be 1-${MAX_INTENT_LENGTH} characters` }, 400)
  }

  return json(routeUniversalIntent(intent))
}
