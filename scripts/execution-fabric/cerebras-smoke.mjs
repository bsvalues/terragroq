/** Explicit one-shot Tier 3 Cerebras smoke. No admission, routing, or fallback. */
import path from "node:path"
import { fileURLToPath } from "node:url"

import { callCerebrasModelApi, ExternalProviderError } from "./external-model-api.mjs"

const MAX_COST_USD = 0.01
const MAX_TOKENS = 32
// This public synthetic probe contains no estate context or user-supplied content.
const SYNTHETIC_PROBE = "Return only the word ready."

export async function runCerebrasSmoke({ model, environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const started = Date.now()
  try {
    const result = await callCerebrasModelApi({
      enabled: environment.WILLIAMOS_CEREBRAS_ENABLED === "true",
      apiKey: environment.CEREBRAS_API_KEY,
      model,
      prompt: SYNTHETIC_PROBE,
      contextPackage: { classification: "S2", synthetic: true },
      spendPolicy: { maxCostUsd: MAX_COST_USD, hardCeilingUsd: MAX_COST_USD },
      maxTokens: MAX_TOKENS,
      timeoutMs: 30_000,
      fetchImpl,
    })
    return {
      status: result.receipt.overBudget ? "FAILED" : "SUCCEEDED",
      code: result.receipt.overBudget ? "SPEND_CAP_EXCEEDED" : "CEREBRAS_SMOKE_OK",
      provider: "cerebras",
      requestedModel: result.requestedModel,
      actualModel: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      calculatedCostUsd: result.usage.costUsd,
      durationMs: result.receipt.durationMs,
    }
  } catch (error) {
    return {
      status: "FAILED",
      code: error instanceof ExternalProviderError ? error.code : "CEREBRAS_SMOKE_FAILED",
      provider: "cerebras",
      // Do not echo unvalidated CLI input; a pasted credential could look like a model ID.
      requestedModel: null,
      actualModel: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      calculatedCostUsd: null,
      durationMs: Date.now() - started,
    }
  }
}

function requestedModel(argv) {
  return argv.length === 2 && argv[0] === "--model" ? argv[1] : null
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await runCerebrasSmoke({ model: requestedModel(process.argv.slice(2)) })
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
  if (receipt.status !== "SUCCEEDED") process.exitCode = 1
}
