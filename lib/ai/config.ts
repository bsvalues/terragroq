// Central model/inference registry for WilliamOS.
//
// R1A (#638): chat inference no longer routes through the Vercel AI Gateway. The app depends
// only on a generic OpenAI-compatible inference endpoint (WILLIAMOS_AI_BASE_URL); today it
// targets a sovereign local Ollama, tomorrow a policy router / vLLM / distributed inference —
// with no application rewrite and NO silent external fallback (doctrine RULE-0005).
//
// R1B (#638) resolved by the embedding bake-off: the sovereign embedding model + vector
// dimension are snowflake-arctic-embed2 / 1024-d, served on the same sovereign endpoint as chat.

export const INFERENCE_BASE_URL =
  process.env.WILLIAMOS_AI_BASE_URL?.trim() || "http://127.0.0.1:11434/v1"

export const CHAT_MODEL = process.env.WILLIAMOS_AI_MODEL?.trim() || "llama3.2:3b"

// Sovereign embedding (#638): local model on WILLIAMOS_AI_BASE_URL. No Vercel/OpenAI gateway.
export const EMBEDDING_MODEL =
  process.env.WILLIAMOS_EMBEDDING_MODEL?.trim() || "snowflake-arctic-embed2"
export const EMBEDDING_DIMENSIONS = 1024

export const RUNTIME = {
  chatModel: CHAT_MODEL,
  embeddingModel: EMBEDDING_MODEL,
  inferenceBaseUrl: INFERENCE_BASE_URL,
  gateway: "williamos-openai-compatible",
} as const
