// Central model configuration for WilliamOS.
// Uses the Vercel AI Gateway (zero-config) via model id strings.

export const CHAT_MODEL = "openai/gpt-5-mini"
export const EMBEDDING_MODEL = "openai/text-embedding-3-small" // 1536 dims
export const EMBEDDING_DIMENSIONS = 1536

export const RUNTIME = {
  provider: "Vercel AI Gateway",
  chatModel: CHAT_MODEL,
  embeddingModel: EMBEDDING_MODEL,
} as const
