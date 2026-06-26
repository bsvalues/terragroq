// Central model registry for WilliamOS. All inference runs through the
// Vercel AI Gateway, so these are plain gateway model strings.

export const CHAT_MODEL = "openai/gpt-5-mini"
export const EMBEDDING_MODEL = "openai/text-embedding-3-small" // 1536 dims
export const EMBEDDING_DIMENSIONS = 1536

// Surfaced to the UI so the operator can see runtime provenance.
export const RUNTIME = {
  chatModel: CHAT_MODEL,
  embeddingModel: EMBEDDING_MODEL,
  gateway: "vercel-ai-gateway",
} as const
