import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { createHash } from "node:crypto"

/**
 * Tier 3 qualification runner: ONE tiny bounded evaluation call through the governed external-API
 * adapter — ContextPackage (S1) -> placement adapter -> provider -> model -> result -> evidence
 * receipt, under a hard spend cap. The key is resolved from an environment variable at runtime and
 * never printed or persisted.
 *
 * Usage:
 *   node scripts/execution-fabric/qualify-external-api-binding.mjs \
 *     --base-url https://openrouter.ai/api/v1 --key-env OPENROUTER_API_KEY \
 *     --model moonshotai/kimi-k2 --max-cost 0.01 --evidence-dir C:/HermesLab/tier3-evidence
 */
import { callExternalModelApi } from "./external-model-api.mjs"

const args = process.argv.slice(2)
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null }
const baseUrl = arg("base-url")
const keyEnv = arg("key-env")
const model = arg("model")
const maxCost = Number(arg("max-cost") ?? "0.01")
const evidenceDir = arg("evidence-dir")
if (!baseUrl || !keyEnv || !model || !evidenceDir) {
  console.error("USAGE: qualify-external-api-binding.mjs --base-url URL --key-env ENV_NAME --model ID --max-cost USD --evidence-dir DIR")
  process.exit(2)
}
const apiKey = process.env[keyEnv]
if (!apiKey) { console.log(`NO_KEY: environment variable ${keyEnv} is unset — cannot qualify`); process.exit(3) }

// A real S1 ContextPackage: a public-knowledge probe. The digest binds the evidence to this exact input.
const prompt = "In one sentence: what does a database index do?"
const contextPackage = { securityTier: "S1", digest: "sha256:" + createHash("sha256").update(prompt).digest("hex") }
const spendPolicy = { maxCostUsd: maxCost, hardCeilingUsd: 0.05 }

try {
  const result = await callExternalModelApi({
    baseUrl, apiKey, model,
    messages: [{ role: "user", content: prompt }],
    contextPackage, spendPolicy, maxTokens: 64,
  })
  fs.mkdirSync(evidenceDir, { recursive: true })
  const file = path.join(evidenceDir, `qualification-${model.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`)
  fs.writeFileSync(file, JSON.stringify({ ...result, request: { baseUrl, model, securityTier: "S1", maxCostUsd: maxCost } }, null, 2))
  console.log("LIVE_CALL_OK model=", result.model, "tokens=", JSON.stringify(result.usage))
  console.log("ANSWER:", result.content.slice(0, 160).replace(/\n/g, " "))
  console.log("EVIDENCE:", file)
} catch (error) {
  // Typed refusals (credit/rate/HTTP) are real qualification evidence, not architectural failure.
  console.log("LIVE_CALL_REFUSED:", error.code ?? String(error).slice(0, 120))
  process.exit(4)
}
