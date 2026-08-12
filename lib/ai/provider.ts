import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

import { INFERENCE_BASE_URL } from "@/lib/ai/config"

// Generic OpenAI-compatible inference seam (R1A, #638). The application knows only that it
// speaks the OpenAI wire format to WILLIAMOS_AI_BASE_URL — there is no Vercel AI Gateway, no
// external OpenAI default, and no silent fallback. A sovereign local endpoint (Ollama) needs no
// real key, so a placeholder keeps the client happy; set WILLIAMOS_AI_API_KEY only for an
// endpoint that requires one.
export const williamosInference = createOpenAICompatible({
  name: "williamos-inference",
  baseURL: INFERENCE_BASE_URL,
  apiKey: process.env.WILLIAMOS_AI_API_KEY?.trim() || "williamos-local",
})
