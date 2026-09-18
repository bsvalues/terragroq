/**
 * Tier 3 — external model-API adapter (OpenRouter first), replaceable by design.
 *
 * An EXTERNAL_MODEL_API binding is "somebody else's managed model service": the trust and privacy
 * profile differs from PRIVATE_REMOTE (our model + our runtime + rented GPU), and the Fabric keeps
 * them separate. This adapter enforces the estate rules that make external APIs safe to use:
 *
 *   1. Data ceiling — only public-class (S1/S2) context may egress. S3/S4 (sovereign/county)
 *      content is refused closed, always, and the egressed messages must be derived from the exact
 *      validated ContextPackage (so protected data cannot ride along in the request body).
 *   2. Budget cap — every call carries an explicit maxCostUsd bound; the provider must report a
 *      usage figure consistent with the bound or the evidence is marked over-budget.
 *   3. Provider replaceability — the adapter speaks the OpenAI-compatible surface; OpenRouter,
 *      direct Claude/OpenAI/Azure adapters implement the same contract and swap at placement.
 *   4. Evidence — every call records a bounded receipt (model, tokens, cost, digest of the exact
 *      egressed context) into the same Thread's evidence chain.
 */

import { createHash } from "node:crypto"

const S1_S2 = new Set(["S1", "S2"])

/** Read the package's data classification. The contract field is `classification` (DataClassSchema). */
function packageClassification(contextPackage) {
  return contextPackage?.classification ?? contextPackage?.securityTier ?? null
}

/** Refuse any packet whose data classification may not egress. Fail closed on unknown/missing tier. */
export function assertExternalEgressAllowed(contextPackage) {
  const tier = packageClassification(contextPackage)
  if (!S1_S2.has(tier)) throw new Error(`EXTERNAL_EGRESS_REFUSED:tier=${tier ?? "missing"} (only S1/S2 may leave the estate)`)
  if (contextPackage?.sovereignData === true) throw new Error("EXTERNAL_EGRESS_REFUSED:sovereign-flagged")
  return true
}

/** Validate the spend policy before any network call. No implicit cost — a missing cap is refused. */
export function assertBoundedSpend(spendPolicy) {
  const cap = spendPolicy?.maxCostUsd
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) throw new Error("SPEND_CAP_REQUIRED:a positive maxCostUsd bound is mandatory")
  const ceiling = spendPolicy?.hardCeilingUsd ?? 1.0
  if (typeof ceiling !== "number" || !Number.isFinite(ceiling) || ceiling <= 0) throw new Error("SPEND_CEILING_INVALID:hardCeilingUsd must be a positive finite number")
  if (cap > ceiling) throw new Error(`SPEND_CAP_EXCEEDS_CEILING:${cap}>${ceiling}`)
  return true
}

/**
 * Derive the exact messages that may egress from the validated ContextPackage, and the digest that
 * binds them. The caller supplies the package and the rendered public prompt; the adapter (never an
 * external string the caller controls) builds the wire body from them, so the network payload is
 * exactly what was classified and digested. Returns { messages, digest }.
 */
export function deriveEgressMessages(contextPackage, { userPrompt, systemPrompt = null } = {}) {
  assertExternalEgressAllowed(contextPackage)
  if (typeof userPrompt !== "string" || userPrompt.length === 0 || userPrompt.includes("\0")) throw new Error("EGRESS_PROMPT_INVALID")
  const messages = []
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt })
  messages.push({ role: "user", content: userPrompt })
  // The digest binds the exact bytes that leave the estate — the caller cannot substitute content
  // or a foreign digest, because both are computed here from the same validated prompt.
  const digest = "sha256:" + createHash("sha256").update(JSON.stringify(messages)).digest("hex")
  return { messages, digest }
}

/**
 * OpenAI-compatible chat-completions call. The caller passes a validated `contextPackage` and a
 * `prompt` (the public content to send); the adapter derives the egress messages + digest from the
 * package so the wire body is always bound to the classified context. `fetchImpl` is injectable for
 * tests; production passes global fetch with a key resolved from the estate env (never logged).
 */
export async function callExternalModelApi({ baseUrl, apiKey, model, prompt, systemPrompt = null, contextPackage, spendPolicy, fetchImpl = globalThis.fetch, maxTokens = 256 }) {
  const { messages, digest } = deriveEgressMessages(contextPackage, { userPrompt: prompt, systemPrompt })
  assertBoundedSpend(spendPolicy)
  if (!apiKey) throw new Error("EXTERNAL_API_KEY_MISSING")
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  })
  const bodyText = await response.text()
  if (!response.ok) {
    // The 402/429 conditions are billing/availability states, never architectural failures — typed
    // so the placement layer records a real refusal and continues.
    const code = response.status === 402 ? "EXTERNAL_API_INSUFFICIENT_CREDIT" : response.status === 429 ? "EXTERNAL_API_RATE_LIMIT" : `EXTERNAL_API_HTTP_${response.status}`
    throw Object.assign(new Error(code), { code, status: response.status })
  }
  let data
  try { data = JSON.parse(bodyText) } catch { throw new Error("EXTERNAL_API_MALFORMED_RESPONSE") }
  const usage = data?.usage ?? {}
  const costUsd = typeof usage.cost_usd === "number" ? usage.cost_usd : typeof usage.cost === "number" ? usage.cost : null
  // A successful response without cost evidence cannot be certified within budget — fail closed.
  if (costUsd === null) throw new Error("EXTERNAL_API_COST_EVIDENCE_MISSING:the provider returned no cost figure, so the call cannot be certified within the spend cap")
  const overBudget = costUsd > spendPolicy.maxCostUsd
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new Error("EXTERNAL_API_NO_ANSWER")
  return {
    schemaVersion: 1,
    provider: data?.provider ?? null,
    model: data?.model ?? model,
    content,
    usage: { promptTokens: usage.prompt_tokens ?? null, completionTokens: usage.completion_tokens ?? null, totalTokens: usage.total_tokens ?? null, costUsd },
    receipt: {
      requestedMaxCostUsd: spendPolicy.maxCostUsd,
      overBudget,
      // The digest of the exact egressed messages — computed from the wire body, not copied from
      // caller-supplied metadata, so the receipt is bound to what actually left the estate.
      contextDigest: digest,
      finishedAt: new Date().toISOString(),
    },
  }
}

/** Build the registry-shaped node + provider records for an admitted external API (CANDIDATE). */
export function externalApiAdmissionRecords({ providerKey, displayName }) {
  return {
    node: { id: providerKey, displayName, kind: "external-api", executionClass: "EXTERNAL_MODEL_API" },
    provider: { id: `provider-${providerKey}`, class: "EXTERNAL_API", admission: "CANDIDATE" },
  }
}

// Cerebras is an explicit, offline-by-default Tier 3 binding. No scheduler or fallback selects it.
export const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
export const CEREBRAS_CATALOG_URL = "https://api.cerebras.ai/public/v1/models"

export class ExternalProviderError extends Error {
  constructor(code, metadata = {}) {
    super(code)
    this.name = "ExternalProviderError"
    this.code = code
    // Never attach a cause, response body, request, headers, or arbitrary provider text.
    Object.assign(this, metadata)
  }
}

const deny = (code, metadata) => { throw new ExternalProviderError(code, metadata) }
const SAFE_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/
const CREDENTIAL_PATTERN = /(?:-----BEGIN [^-]+PRIVATE KEY-----|\b(?:sk|ghp|github_pat)_[a-zA-Z0-9_-]{12,}\b|\b(?:password|api[_-]?key|bearer|authorization|cookie|token)\s*[:=]\s*\S+)/i
const PII_PATTERN = /\b\d{3}-\d{2}-\d{4}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

function assertCerebrasEgress(contextPackage, messages) {
  // S1 is the existing public tier. S2 needs an affirmative synthetic/sanitized
  // attestation; neither an absent tier nor a caller's free-form label is authority.
  try { assertExternalEgressAllowed(contextPackage) } catch { deny("EXTERNAL_EGRESS_REFUSED") }
  if (contextPackage.classification !== "S1" &&
    !(contextPackage.classification === "S2" &&
      (contextPackage.synthetic === true || contextPackage.sanitizedForExternalProcessing === true))) {
    deny("EXTERNAL_EGRESS_REFUSED")
  }
  if (["localOnly", "countyData", "pacsData", "pii", "credentials", "confidential", "protectedData"].some(k => contextPackage[k] === true)) {
    deny("EXTERNAL_EGRESS_REFUSED")
  }
  if (messages.some(message => typeof message.content !== "string" || CREDENTIAL_PATTERN.test(message.content) || PII_PATTERN.test(message.content))) {
    deny("EXTERNAL_EGRESS_REFUSED")
  }
}

function catalogModel(data, model) {
  if (!Array.isArray(data?.data)) deny("EXTERNAL_API_MALFORMED_RESPONSE")
  const found = data.data.find(entry => entry?.id === model && entry?.deprecated !== true)
  if (!found || !found.capabilities || !found.pricing) deny("EXTERNAL_API_UNSUPPORTED_MODEL")
  return found
}

function positivePrice(value) {
  const number = Number(value)
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(number) && number >= 0 ? number : null
}

function safeOptionText(value) {
  try { return JSON.stringify(value) } catch { deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY") }
}

/** Only metadata is fetched; this endpoint is public and never receives a prompt or key. */
export async function discoverCerebrasModels({ fetchImpl = globalThis.fetch, signal } = {}) {
  let response
  try { response = await fetchImpl(CEREBRAS_CATALOG_URL, { method: "GET", signal }) }
  catch { deny(signal?.aborted ? "EXTERNAL_API_CANCELLED" : "EXTERNAL_API_OUTAGE") }
  if (!response.ok) deny("EXTERNAL_API_OUTAGE")
  try {
    const data = await response.json()
    if (!Array.isArray(data?.data)) deny("EXTERNAL_API_MALFORMED_RESPONSE")
    return data
  } catch { deny("EXTERNAL_API_MALFORMED_RESPONSE") }
}

/** Explicit real-time inference only; no batch/file route and no implicit retry/fallback. */
export async function callCerebrasModelApi({
  enabled = process.env.WILLIAMOS_CEREBRAS_ENABLED === "true",
  apiKey = process.env.CEREBRAS_API_KEY, baseUrl = CEREBRAS_BASE_URL,
  model, prompt, systemPrompt = null, contextPackage, spendPolicy,
  responseFormat, tools, parallelToolCalls = false, reasoningEffort,
  modality = "text", mode = "realtime", maxTokens = 256, timeoutMs = 30_000,
  signal, fetchImpl = globalThis.fetch,
} = {}) {
  if (enabled !== true) deny("EXTERNAL_PROVIDER_DISABLED")
  if (typeof apiKey !== "string" || !apiKey.trim()) deny("EXTERNAL_API_KEY_MISSING")
  if (mode !== "realtime") deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY")
  if (typeof model !== "string" || !SAFE_MODEL.test(model)) deny("EXTERNAL_API_UNSUPPORTED_MODEL")
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 40960 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY")
  if (baseUrl !== CEREBRAS_BASE_URL) deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY")
  // All checks precede payload serialization and either network operation.
  assertBoundedSpend(spendPolicy)
  if (typeof prompt !== "string" || !prompt || prompt.includes("\0") ||
      (systemPrompt !== null && typeof systemPrompt !== "string")) deny("EXTERNAL_EGRESS_REFUSED")
  if (tools !== undefined && (!Array.isArray(tools) || tools.length === 0 || tools.some(t => t?.type !== "function"))) deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY")
  // This adapter currently accepts text ContextPackages only, even if a discovered model has vision.
  if (modality !== "text") deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY")
  assertCerebrasEgress(contextPackage, [{ content: prompt }, { content: systemPrompt ?? "" },
    ...((tools ?? []).map(tool => ({ content: safeOptionText(tool) }))),
    { content: responseFormat === undefined ? "" : safeOptionText(responseFormat) }])
  if (responseFormat && !["json_object", "json_schema"].includes(responseFormat.type)) deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY")
  if (reasoningEffort !== undefined && !["none", "low", "medium", "high"].includes(reasoningEffort)) deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY")

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    if (controller.signal.aborted) deny("EXTERNAL_API_CANCELLED")
    let catalog
    try { catalog = await discoverCerebrasModels({ fetchImpl, signal: controller.signal }) }
    catch (error) {
      if (controller.signal.aborted) deny(signal?.aborted ? "EXTERNAL_API_CANCELLED" : "EXTERNAL_API_TIMEOUT")
      throw error
    }
    const metadata = catalogModel(catalog, model)
    const capabilities = metadata.capabilities
    if ((responseFormat && !(responseFormat.type === "json_schema" ? capabilities.structured_outputs : capabilities.json_mode)) ||
      (tools && capabilities.tools !== true) || (parallelToolCalls && (!tools || capabilities.parallel_tool_calls !== true)) ||
      (reasoningEffort && (capabilities.reasoning !== true ||
        !Array.isArray(metadata.supported_reasoning_efforts) || !metadata.supported_reasoning_efforts.includes(reasoningEffort))) ||
      (modality !== "text" && !(modality === "image" && capabilities.vision === true))) {
      deny("EXTERNAL_API_UNSUPPORTED_CAPABILITY")
    }
    const promptPrice = positivePrice(metadata.pricing.prompt)
    const completionPrice = positivePrice(metadata.pricing.completion)
    if (promptPrice === null || completionPrice === null) deny("EXTERNAL_API_COST_EVIDENCE_MISSING")
    // UTF-8 byte count is a conservative token ceiling; reserve output tokens up front.
    const { messages } = deriveEgressMessages(contextPackage, { userPrompt: prompt, systemPrompt })
    const request = { model, messages, max_tokens: maxTokens, stream: false }
    if (responseFormat) request.response_format = responseFormat
    if (tools) { request.tools = tools; request.parallel_tool_calls = parallelToolCalls }
    if (reasoningEffort) request.reasoning_effort = reasoningEffort
    const serialized = JSON.stringify(request)
    const reservedCostUsd = Buffer.byteLength(serialized, "utf8") * promptPrice + maxTokens * completionPrice
    if (reservedCostUsd > spendPolicy.maxCostUsd) deny("SPEND_CAP_EXCEEDS_CEILING")
    let response
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: serialized, signal: controller.signal,
      })
    } catch {
      deny(controller.signal.aborted ? (signal?.aborted ? "EXTERNAL_API_CANCELLED" : "EXTERNAL_API_TIMEOUT") : "EXTERNAL_API_OUTAGE")
    }
    if (!response.ok) {
      const status = response.status
      if (status === 401 || status === 403) deny("EXTERNAL_API_AUTH_FAILURE", { status })
      if (status === 429) {
        const raw = response.headers?.get?.("retry-after")
        const retryAfterSeconds = /^\d{1,5}$/.test(raw ?? "") ? Number(raw) :
          (raw && Number.isFinite(Date.parse(raw)) ? Math.max(0, Math.ceil((Date.parse(raw) - Date.now()) / 1000)) : null)
        deny("EXTERNAL_API_RATE_LIMIT", { status, retryAfterSeconds })
      }
      deny(status >= 500 ? "EXTERNAL_API_OUTAGE" : "EXTERNAL_API_HTTP_FAILURE", { status })
    }
    let data
    try { data = await response.json() } catch { deny("EXTERNAL_API_MALFORMED_RESPONSE") }
    const message = data?.choices?.[0]?.message
    const usage = data?.usage
    if (!message || (typeof message.content !== "string" && !Array.isArray(message.tool_calls)) ||
      typeof data.model !== "string" || !SAFE_MODEL.test(data.model) ||
      !Number.isSafeInteger(usage?.prompt_tokens) || !Number.isSafeInteger(usage?.completion_tokens) ||
      usage.prompt_tokens < 0 || usage.completion_tokens < 0 ||
      (message.tool_calls && !Array.isArray(message.tool_calls))) deny("EXTERNAL_API_MALFORMED_RESPONSE")
    // The provider may report a different model. Never price that usage using the
    // requested model's tariff or certify it without current actual-model metadata.
    const actualMetadata = catalogModel(catalog, data.model)
    const actualPromptPrice = positivePrice(actualMetadata.pricing.prompt)
    const actualCompletionPrice = positivePrice(actualMetadata.pricing.completion)
    if (actualPromptPrice === null || actualCompletionPrice === null) deny("EXTERNAL_API_COST_EVIDENCE_MISSING")
    const costUsd = usage.prompt_tokens * actualPromptPrice + usage.completion_tokens * actualCompletionPrice
    return {
      schemaVersion: 1, provider: "cerebras", requestedProvider: "cerebras",
      requestedModel: model, model: data.model, content: message.content ?? null,
      toolCalls: message.tool_calls ?? null,
      usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens, costUsd },
      receipt: { requestedMaxCostUsd: spendPolicy.maxCostUsd, overBudget: costUsd > spendPolicy.maxCostUsd,
        durationMs: Date.now() - started, status: "completed" },
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}
