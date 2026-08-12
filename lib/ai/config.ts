// Central model/inference registry for WilliamOS.
//
// R1A (#638): chat inference no longer routes through the Vercel AI Gateway. The app depends
// only on a generic OpenAI-compatible inference endpoint (WILLIAMOS_AI_BASE_URL); today it
// targets a sovereign local Ollama, tomorrow a policy router / vLLM / distributed inference —
// with no application rewrite and NO silent external fallback (doctrine RULE-0005).
//
// R1B (#638) is intentionally NOT resolved here: the sovereign embedding model + vector
// dimension are HELD pending a current-generation embedding bake-off. The EMBEDDING_* values
// below are the pre-existing ones and MUST NOT be treated as the sovereign choice.

export const INFERENCE_BASE_URL =
  process.env.WILLIAMOS_AI_BASE_URL?.trim() || "http://127.0.0.1:11434/v1"

export const CHAT_MODEL = process.env.WILLIAMOS_AI_MODEL?.trim() || "llama3.2:3b"

// R1B PENDING — sovereign embedding model + dimension not yet selected (bake-off first).
export const EMBEDDING_MODEL =
  process.env.WILLIAMOS_EMBEDDING_MODEL?.trim() || "openai/text-embedding-3-small"
export const EMBEDDING_DIMENSIONS = 1536

export const RUNTIME = {
  chatModel: CHAT_MODEL,
  embeddingModel: EMBEDDING_MODEL,
  inferenceBaseUrl: INFERENCE_BASE_URL,
  gateway: "williamos-openai-compatible",
} as const
