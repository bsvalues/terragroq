export type OllamaChatModelResolution = Readonly<{
  model: string | null
  available: boolean
  detail: "LOCAL_INFERENCE_UNAVAILABLE" | "LOCAL_CHAT_MODEL_UNAVAILABLE" | null
}>

type OllamaModel = Readonly<{ name: string; size: number }>

export function isLoopbackInferenceBase(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1"
  } catch {
    return false
  }
}

function tagsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = "/api/tags"
  url.search = ""
  url.hash = ""
  return url.toString()
}

function installedChatModels(value: unknown): readonly OllamaModel[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const raw = (value as { models?: unknown }).models
  if (!Array.isArray(raw) || raw.length > 1_000) return []
  return raw.flatMap((entry): OllamaModel[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const candidate = entry as { name?: unknown; size?: unknown }
    const name = typeof candidate.name === "string" ? candidate.name.trim() : ""
    if (!name || name.length > 500 || name.includes("\0") || /embed/i.test(name)) return []
    const size = typeof candidate.size === "number" && Number.isFinite(candidate.size) && candidate.size >= 0
      ? candidate.size : Number.POSITIVE_INFINITY
    return [{ name, size }]
  }).sort((left, right) => left.size - right.size || left.name.localeCompare(right.name))
}

/** Resolve only among models Ollama reports as installed; never downloads or crosses providers. */
export async function resolveOllamaChatModel(
  baseUrl: string,
  preferred: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaChatModelResolution> {
  let response: Response
  try {
    response = await fetchImpl(tagsUrl(baseUrl), { cache: "no-store", signal: AbortSignal.timeout(5_000) })
  } catch {
    return { model: null, available: false, detail: "LOCAL_INFERENCE_UNAVAILABLE" }
  }
  if (!response.ok) return { model: null, available: false, detail: "LOCAL_INFERENCE_UNAVAILABLE" }

  let models: readonly OllamaModel[]
  try {
    models = installedChatModels(await response.json())
  } catch {
    return { model: null, available: false, detail: "LOCAL_INFERENCE_UNAVAILABLE" }
  }
  if (models.length === 0) return { model: null, available: false, detail: "LOCAL_CHAT_MODEL_UNAVAILABLE" }
  const selected = models.find((entry) => entry.name === preferred) ?? models[0]
  return { model: selected.name, available: true, detail: null }
}
