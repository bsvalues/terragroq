import { describe, expect, it } from "vitest"

import {
  assertBoundedSpend,
  assertExternalEgressAllowed,
  callExternalModelApi,
  externalApiAdmissionRecords,
} from "../scripts/execution-fabric/external-model-api.mjs"

const packet = (tier) => ({ securityTier: tier, digest: "sha256:abc" })

describe("Tier 3 — external model-API adapter (governed, replaceable)", () => {
  it("sovereign data never egresses: S3/S4 and missing tiers are refused", () => {
    expect(assertExternalEgressAllowed(packet("S1"))).toBe(true)
    expect(assertExternalEgressAllowed(packet("S2"))).toBe(true)
    expect(() => assertExternalEgressAllowed(packet("S3"))).toThrow(/EXTERNAL_EGRESS_REFUSED:tier=S3/)
    expect(() => assertExternalEgressAllowed(packet("S4"))).toThrow(/EXTERNAL_EGRESS_REFUSED/)
    expect(() => assertExternalEgressAllowed(packet(undefined))).toThrow(/tier=missing/)
    expect(() => assertExternalEgressAllowed({ securityTier: "S1", sovereignData: true })).toThrow(/sovereign-flagged/)
  })

  it("no implicit cost: a missing or non-positive cap is refused; over the hard ceiling is refused", () => {
    expect(assertBoundedSpend({ maxCostUsd: 0.05, hardCeilingUsd: 1.0 })).toBe(true)
    expect(() => assertBoundedSpend({})).toThrow(/SPEND_CAP_REQUIRED/)
    expect(() => assertBoundedSpend({ maxCostUsd: 0 })).toThrow(/SPEND_CAP_REQUIRED/)
    expect(() => assertBoundedSpend({ maxCostUsd: -1 })).toThrow(/SPEND_CAP_REQUIRED/)
    expect(() => assertBoundedSpend({ maxCostUsd: 5, hardCeilingUsd: 1.0 })).toThrow(/SPEND_CAP_EXCEEDS_CEILING/)
  })

  it("a bounded call returns content + a cost-bearing receipt bound to the context digest", async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200, text: async () => JSON.stringify({
        model: "moonshotai/kimi-k2", provider: "openrouter",
        choices: [{ message: { content: "placed answer" } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost_usd: 0.0012 },
      }) }
    }
    const result = await callExternalModelApi({
      baseUrl: "https://openrouter.ai/api/v1", apiKey: "test-key", model: "moonshotai/kimi-k2",
      messages: [{ role: "user", content: "hi" }], contextPackage: packet("S1"),
      spendPolicy: { maxCostUsd: 0.05, hardCeilingUsd: 1.0 }, fetchImpl,
    })
    expect(result.content).toBe("placed answer")
    expect(result.receipt.overBudget).toBe(false)
    expect(result.receipt.contextDigest).toBe("sha256:abc")
    expect(result.usage.totalTokens).toBe(150)
    // the key goes in a header only, never the URL/body
    expect(calls[0].url).not.toContain("test-key")
    expect(calls[0].init.headers.authorization).toBe("Bearer test-key")
  })

  it("an over-budget reported cost is recorded, not hidden", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
      choices: [{ message: { content: "x" } }], usage: { cost_usd: 0.09 },
    }) })
    const result = await callExternalModelApi({
      baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m", messages: [],
      contextPackage: packet("S2"), spendPolicy: { maxCostUsd: 0.05, hardCeilingUsd: 1.0 }, fetchImpl,
    })
    expect(result.receipt.overBudget).toBe(true)
  })

  it("402 / 429 are typed billing/availability refusals (not architectural failures)", async () => {
    const makeFetch = (status) => async () => ({ ok: false, status, text: async () => "nope" })
    await expect(callExternalModelApi({ baseUrl: "u", apiKey: "k", model: "m", messages: [], contextPackage: packet("S1"), spendPolicy: { maxCostUsd: 0.01 }, fetchImpl: makeFetch(402) })).rejects.toThrow(/EXTERNAL_API_INSUFFICIENT_CREDIT/)
    await expect(callExternalModelApi({ baseUrl: "u", apiKey: "k", model: "m", messages: [], contextPackage: packet("S1"), spendPolicy: { maxCostUsd: 0.01 }, fetchImpl: makeFetch(429) })).rejects.toThrow(/EXTERNAL_API_RATE_LIMIT/)
  })

  it("S3 content is refused BEFORE any network call", async () => {
    let called = false
    const fetchImpl = async () => { called = true; return { ok: true, status: 200, text: async () => "{}" } }
    await expect(callExternalModelApi({ baseUrl: "u", apiKey: "k", model: "m", messages: [], contextPackage: packet("S3"), spendPolicy: { maxCostUsd: 0.01 }, fetchImpl })).rejects.toThrow(/EXTERNAL_EGRESS_REFUSED/)
    expect(called).toBe(false)
  })

  it("a missing key is refused before any network call", async () => {
    let called = false
    const fetchImpl = async () => { called = true; return { ok: true, status: 200, text: async () => "{}" } }
    await expect(callExternalModelApi({ baseUrl: "u", apiKey: "", model: "m", messages: [], contextPackage: packet("S1"), spendPolicy: { maxCostUsd: 0.01 }, fetchImpl })).rejects.toThrow(/EXTERNAL_API_KEY_MISSING/)
    expect(called).toBe(false)
  })

  it("admission records come out CANDIDATE + EXTERNAL_MODEL_API (registry-shaped, not special)", () => {
    const { node, provider } = externalApiAdmissionRecords({ providerKey: "openrouter", baseUrl: "https://openrouter.ai/api/v1", displayName: "OpenRouter" })
    expect(node.kind).toBe("external-api")
    expect(node.executionClass).toBe("EXTERNAL_MODEL_API")
    expect(provider.class).toBe("EXTERNAL_API")
    expect(provider.admission).toBe("CANDIDATE")
  })
})
