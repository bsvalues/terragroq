/**
 * Tier 3 — external model-API adapter (OpenRouter first), replaceable by design.
 *
 * An EXTERNAL_MODEL_API binding is "somebody else's managed model service": the trust and privacy
 * profile differs from PRIVATE_REMOTE (our model + our runtime + rented GPU), and the Fabric keeps
 * them separate. This adapter enforces the estate rules that make external APIs safe to use:
 *
 *   1. Data ceiling — only public-class (S1/S2) context may egress. S3/S4 (sovereign/county)
 *      content is refused closed, always.
 *   2. Budget cap — every call carries an explicit maxCostUsd bound; the provider must report a
 *      usage figure consistent with the bound or the evidence is marked over-budget.
 *   3. Provider replaceability — the adapter speaks the OpenAI-compatible surface; OpenRouter,
 *      direct Claude/OpenAI/Azure adapters implement the same contract and swap at placement.
 *   4. Evidence — every call records a bounded receipt (model, tokens, cost, digest of the exact
 *      context) into the same Thread's evidence chain.
 */

const S1_S2 = new Set(["S1", "S2"])

/** Refuse any packet whose security tier may not egress. Fail closed on unknown/missing tier. */
export function assertExternalEgressAllowed(contextPackage) {
  const tier = contextPackage?.securityTier
  if (!S1_S2.has(tier)) throw new Error(`EXTERNAL_EGRESS_REFUSED:tier=${tier ?? "missing"} (only S1/S2 may leave the estate)`)
  if (contextPackage?.sovereignData === true) throw new Error("EXTERNAL_EGRESS_REFUSED:sovereign-flagged")
  return true
}

/** Validate the spend policy before any network call. No implicit cost — a missing cap is refused. */
export function assertBoundedSpend(spendPolicy) {
  const cap = spendPolicy?.maxCostUsd
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) throw new Error("SPEND_CAP_REQUIRED:a positive maxCostUsd bound is mandatory")
  if (cap > (spendPolicy?.hardCeilingUsd ?? 1.0)) throw new Error(`SPEND_CAP_EXCEEDS_CEILING:${cap}>${spendPolicy.hardCeilingUsd}`)
  return true
}

/**
 * OpenAI-compatible chat-completions call. `fetchImpl` is injectable for tests; the production
 * caller passes global fetch with a key resolved from the estate env (never inlined, never logged).
 */
export async function callExternalModelApi({ baseUrl, apiKey, model, messages, contextPackage, spendPolicy, fetchImpl = globalThis.fetch, maxTokens = 256 }) {
  assertExternalEgressAllowed(contextPackage)
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
  const overBudget = costUsd !== null && costUsd > spendPolicy.maxCostUsd
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
      contextDigest: contextPackage?.digest ?? null,
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
