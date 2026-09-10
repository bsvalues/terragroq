import { getSession } from "@/lib/session"
import { LOCAL_ENDPOINT, LOCAL_MODEL } from "@/lib/loom/providers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Which local models are actually installed right now.
 *
 * The model was hardcoded, which meant pulling a better one changed nothing the operator could see
 * and the workroom kept answering with whatever was compiled in. The list is read from the running
 * local runtime instead, so a model becomes usable the moment it finishes downloading -- no rebuild,
 * no redeploy, no code change.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  try {
    const response = await fetch(`${LOCAL_ENDPOINT}/api/tags`, { cache: "no-store" })
    if (!response.ok) {
      return Response.json({ models: [], default: LOCAL_MODEL, error: "LOCAL_RUNTIME_REFUSED" }, { status: 200 })
    }
    const payload = (await response.json()) as {
      models?: Array<{ name?: string; size?: number; details?: { parameter_size?: string; context_length?: number } }>
    }
    const installed = (payload.models ?? [])
      // Embedding models cannot hold a conversation; offering one would look like a broken chat.
      .filter((model) => typeof model.name === "string" && !/embed/i.test(model.name))
      .map((model) => ({
        name: model.name as string,
        parameters: model.details?.parameter_size ?? null,
        context: model.details?.context_length ?? null,
        gigabytes: typeof model.size === "number" ? Math.round((model.size / 1e9) * 10) / 10 : null,
        bytes: typeof model.size === "number" && Number.isFinite(model.size) ? model.size : Number.POSITIVE_INFINITY,
      }))
    const defaultModel = installed.some((model) => model.name === LOCAL_MODEL)
      ? LOCAL_MODEL
      : [...installed].sort((left, right) => left.bytes - right.bytes || left.name.localeCompare(right.name))[0]?.name ?? LOCAL_MODEL
    const models = installed
      .map((model) => ({
        name: model.name,
        parameters: model.parameters,
        context: model.context,
        gigabytes: model.gigabytes,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return Response.json({ models, default: defaultModel }, { headers: { "cache-control": "no-store" } })
  } catch {
    // A stopped local runtime is reported as such rather than as an empty list, which would read as
    // "you have no models" and send the operator looking in the wrong place.
    return Response.json({ models: [], default: LOCAL_MODEL, error: "LOCAL_RUNTIME_UNAVAILABLE" }, { status: 200 })
  }
}
