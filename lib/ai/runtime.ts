import { RUNTIME, EMBEDDING_DIMENSIONS } from "@/lib/ai/config"

// Single source of truth for model/runtime provenance. Both the HTTP endpoint
// (GET /api/copilot/runtime) and the /runtime page read from this builder so
// every shell — web, PWA, Tauri tray — sees identical provenance.
//
// Authority: read-only. This reports the runtime; it never selects or mutates
// it. Per doctrine RULE-0005 ("No silent model fallback") the runtime is
// explicit-only: there is NO silent cloud fallback, so `fallback` is always
// reported as false and `fallbackPolicy` states the governing rule.

export type RuntimeStatus = {
  chatModel: string
  embeddingModel: string
  embeddingDimensions: number
  gateway: string
  provider: string
  fallback: false
  fallbackPolicy: string
  source: "lib/ai/config.ts"
  ts: string
}

export function buildRuntimeStatus(): RuntimeStatus {
  // Derive the provider namespace from the gateway model string (e.g. "openai").
  const provider = RUNTIME.chatModel.includes("/")
    ? RUNTIME.chatModel.split("/")[0]
    : "unknown"

  return {
    chatModel: RUNTIME.chatModel,
    embeddingModel: RUNTIME.embeddingModel,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    gateway: RUNTIME.gateway,
    provider,
    fallback: false,
    fallbackPolicy:
      "explicit-runtime-only — no silent cloud fallback (doctrine RULE-0005)",
    source: "lib/ai/config.ts",
    ts: new Date().toISOString(),
  }
}
