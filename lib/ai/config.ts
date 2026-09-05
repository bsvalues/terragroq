// Central model/inference registry for WilliamOS.
//
// R1A (#638): chat inference no longer routes through the Vercel AI Gateway. The app depends
// only on a generic OpenAI-compatible inference endpoint (WILLIAMOS_AI_BASE_URL); today it
// targets a sovereign local Ollama, tomorrow a policy router / vLLM / distributed inference —
// with no application rewrite and NO silent external fallback (doctrine RULE-0005).
//
// County Development is stricter: its endpoint is validated as loopback before the AI SDK can be
// constructed. A remote URL is a boot/configuration failure, never a fallback path.

import {
  COUNTY_DEVELOPMENT_DEFAULT_CHAT_MODEL,
  COUNTY_DEVELOPMENT_DEFAULT_EMBEDDING_MODEL,
  isCountyDevelopmentProfile,
  resolveInferenceBaseUrl,
} from "@/lib/deployment/profile"

const countyDevelopment = isCountyDevelopmentProfile()

export const INFERENCE_BASE_URL = resolveInferenceBaseUrl(process.env.WILLIAMOS_AI_BASE_URL)

export const CHAT_MODEL = process.env.WILLIAMOS_AI_MODEL?.trim()
  || (countyDevelopment ? COUNTY_DEVELOPMENT_DEFAULT_CHAT_MODEL : "llama3.2:3b")

// Sovereign embedding (#638): local model on WILLIAMOS_AI_BASE_URL. No Vercel/OpenAI gateway.
export const EMBEDDING_MODEL = process.env.WILLIAMOS_EMBEDDING_MODEL?.trim()
  || COUNTY_DEVELOPMENT_DEFAULT_EMBEDDING_MODEL
export const EMBEDDING_DIMENSIONS = 1024

export const RUNTIME = {
  chatModel: CHAT_MODEL,
  embeddingModel: EMBEDDING_MODEL,
  inferenceBaseUrl: INFERENCE_BASE_URL,
  gateway: countyDevelopment ? "williamos-county-loopback" : "williamos-openai-compatible",
} as const
