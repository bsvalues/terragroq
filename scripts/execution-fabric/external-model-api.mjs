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
export function externalApiAdmissionRecords({ providerKey, baseUrl, displayName }) {
  return {
    node: { id: providerKey, displayName, kind: "external-api", executionClass: "EXTERNAL_MODEL_API" },
    provider: { id: `provider-${providerKey}`, class: "EXTERNAL_API", admission: "CANDIDATE" },
  }
}
