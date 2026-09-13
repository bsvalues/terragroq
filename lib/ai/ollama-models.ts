export type OllamaChatModelResolution = Readonly<{
  model: string | null
  available: boolean
  detail: "LOCAL_INFERENCE_UNAVAILABLE" | "LOCAL_CHAT_MODEL_UNAVAILABLE" | null
}>

export type OllamaExactModelResolution = Readonly<{
  model: string | null
  available: boolean
  detail: "LOCAL_INFERENCE_UNAVAILABLE" | "LOCAL_MODEL_UNAVAILABLE" | null
}>

export type OllamaModel = Readonly<{ name: string; size: number }>

export type OllamaModelInventory = Readonly<{
  available: boolean
  models: readonly OllamaModel[]
  detail: "LOCAL_INFERENCE_UNAVAILABLE" | null
}>

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

export function normalizeOllamaModelName(value: string): string {
  const name = value.trim()
  if (!name) return name
  const lastSlash = name.lastIndexOf("/")
  const lastColon = name.lastIndexOf(":")
  return lastColon > lastSlash ? name : `${name}:latest`
}

function installedModels(value: unknown): readonly OllamaModel[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const raw = (value as { models?: unknown }).models
  if (!Array.isArray(raw) || raw.length > 1_000) return []
  return raw.flatMap((entry): OllamaModel[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const candidate = entry as { name?: unknown; size?: unknown }
    const name = typeof candidate.name === "string" ? candidate.name.trim() : ""
    if (!name || name.length > 500 || name.includes("\0")) return []
    const size = typeof candidate.size === "number" && Number.isFinite(candidate.size) && candidate.size >= 0
      ? candidate.size : Number.POSITIVE_INFINITY
    return [{ name, size }]
  })
}

/** Read only the inventory Ollama reports as installed; never downloads or crosses providers. */
export async function readOllamaModelInventory(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaModelInventory> {
  let response: Response
  try {
    response = await fetchImpl(tagsUrl(baseUrl), { cache: "no-store", signal: AbortSignal.timeout(5_000) })
  } catch {
    return { available: false, models: [], detail: "LOCAL_INFERENCE_UNAVAILABLE" }
  }
  if (!response.ok) return { available: false, models: [], detail: "LOCAL_INFERENCE_UNAVAILABLE" }

  try {
    return { available: true, models: installedModels(await response.json()), detail: null }
  } catch {
    return { available: false, models: [], detail: "LOCAL_INFERENCE_UNAVAILABLE" }
  }
}

export function resolveOllamaChatModelFromInventory(
  inventory: OllamaModelInventory,
  preferred: string,
): OllamaChatModelResolution {
  if (!inventory.available) return { model: null, available: false, detail: "LOCAL_INFERENCE_UNAVAILABLE" }
  const models = inventory.models
    .filter((entry) => !/embed/i.test(entry.name))
    .sort((left, right) => left.size - right.size || left.name.localeCompare(right.name))
  if (models.length === 0) return { model: null, available: false, detail: "LOCAL_CHAT_MODEL_UNAVAILABLE" }
  const normalizedPreferred = normalizeOllamaModelName(preferred)
  const selected = models.find((entry) => normalizeOllamaModelName(entry.name) === normalizedPreferred) ?? models[0]
  return { model: selected.name, available: true, detail: null }
}

export function resolveOllamaExactModelFromInventory(
  inventory: OllamaModelInventory,
  configured: string,
): OllamaExactModelResolution {
  if (!inventory.available) return { model: null, available: false, detail: "LOCAL_INFERENCE_UNAVAILABLE" }
  const normalizedConfigured = normalizeOllamaModelName(configured)
  const selected = inventory.models.find((entry) => normalizeOllamaModelName(entry.name) === normalizedConfigured)
  return selected
    ? { model: selected.name, available: true, detail: null }
    : { model: null, available: false, detail: "LOCAL_MODEL_UNAVAILABLE" }
}

/** Resolve only among chat models Ollama reports as installed; never downloads or crosses providers. */
export async function resolveOllamaChatModel(
  baseUrl: string,
  preferred: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaChatModelResolution> {
  return resolveOllamaChatModelFromInventory(await readOllamaModelInventory(baseUrl, fetchImpl), preferred)
}
