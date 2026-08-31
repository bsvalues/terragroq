import { readCodexContinuation } from "@/lib/loom/codex-continuation"
import { codexContinuationDependencies } from "@/lib/loom/codex-continuation-runtime"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  const worldId = new URL(request.url).searchParams.get("worldId")?.trim() ?? ""
  if (!worldId || worldId.length > 200 || worldId.includes("\0")) {
    return Response.json({ error: "WORLD_ID_REQUIRED" }, { status: 400 })
  }
  try {
    const continuation = await readCodexContinuation(
      session.user.id,
      worldId,
      codexContinuationDependencies,
    )
    return Response.json(continuation, { headers: { "cache-control": "no-store" } })
  } catch {
    return Response.json({ error: "CODEX_CONTINUATION_UNAVAILABLE" }, { status: 503 })
  }
}
