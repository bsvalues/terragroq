import { RUNTIME, EMBEDDING_DIMENSIONS, INFERENCE_BASE_URL } from "@/lib/ai/config"

// Single source of truth for model/runtime provenance. Both the HTTP endpoint
// (GET /api/copilot/runtime) and the /runtime page read from this builder so
// every shell — web, PWA, Tauri tray — sees identical provenance.
//
// Authority: read-only. This reports the runtime; it never selects or mutates
// it. Per doctrine RULE-0005 ("No silent model fallback") the runtime is
// explicit-only: there is NO silent external fallback, so `fallback` is always
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
  // Provider provenance is the sovereign inference endpoint host — the app is provider-agnostic
  // and speaks the OpenAI wire format to WILLIAMOS_AI_BASE_URL (no cloud gateway).
  let provider: string
  try {
    provider = new URL(INFERENCE_BASE_URL).host
  } catch {
    provider = "local"
  }

  return {
    chatModel: RUNTIME.chatModel,
    embeddingModel: RUNTIME.embeddingModel,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    gateway: RUNTIME.gateway,
    provider,
    fallback: false,
    fallbackPolicy:
      "explicit-runtime-only — no silent external fallback (doctrine RULE-0005)",
    source: "lib/ai/config.ts",
    ts: new Date().toISOString(),
  }
}
