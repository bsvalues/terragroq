import { NO_STORE_HEADERS } from "@/app/api/environment/http"

export const dynamic = "force-dynamic"

/** Public, non-secret receipt used to prove that client routing reaches the exact isolated preview. */
export async function GET() {
  const worldId = process.env.WILLIAMOS_PREVIEW_WORLD_ID
  const head = process.env.WILLIAMOS_PREVIEW_HEAD
  const port = Number(process.env.WILLIAMOS_PREVIEW_PORT)
  if (!worldId || !/^[0-9a-f]{40}$/.test(head ?? "") || !Number.isInteger(port)) {
    return Response.json({ error: "PREVIEW_IDENTITY_UNAVAILABLE" }, { status: 503, headers: NO_STORE_HEADERS })
  }
  return Response.json({ worldId, head, port }, { headers: NO_STORE_HEADERS })
}
