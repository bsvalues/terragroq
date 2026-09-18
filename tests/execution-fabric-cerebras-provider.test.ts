import { describe, expect, it, vi } from "vitest"
import { callCerebrasModelApi, CEREBRAS_BASE_URL, CEREBRAS_CATALOG_URL } from "../scripts/execution-fabric/external-model-api.mjs"

const key = "fixture-key-not-real"
const model = "fixture-model"
const catalog = { data: [
  { id: model, deprecated: false, pricing: { prompt: "0.000001", completion: "0.000002" },
    capabilities: { tools: true, parallel_tool_calls: true, structured_outputs: true, json_mode: true, reasoning: true, vision: false } },
  { id: "provider-reported-model", deprecated: false, pricing: { prompt: "0.000003", completion: "0.000004" },
    capabilities: { tools: false, parallel_tool_calls: false, structured_outputs: false, json_mode: false, reasoning: false, vision: false } },
] }
const answer = { model, choices: [{ finish_reason: "stop", message: { content: "fixture-answer" } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }
const response = (body: unknown, status = 200, retryAfter?: string) => ({ ok: status < 400, status,
  headers: { get: () => retryAfter ?? null }, json: async () => body })
const transport = (answerBody: unknown = answer, status = 200, retryAfter?: string) => vi.fn(async (url: string) =>
  url === CEREBRAS_CATALOG_URL ? response(catalog) : response(answerBody, status, retryAfter))
const request = (fetchImpl: unknown, extra: Record<string, unknown> = {}) => ({ enabled: true, apiKey: key, model,
  prompt: "fixture-public-input", contextPackage: { classification: "S1" },
  spendPolicy: { maxCostUsd: 0.01 }, fetchImpl, ...extra }) as unknown as Parameters<typeof callCerebrasModelApi>[0]

const deniedPackages: Array<[Record<string, unknown>, string]> = [
  [{}, "unknown"], [{ classification: "S3" }, "protected"], [{ classification: "S4" }, "county"],
  [{ classification: "S1", countyData: true }, "county"], [{ classification: "S1", pacsData: true }, "PACS"],
  [{ classification: "S1", pii: true }, "PII"], [{ classification: "S1", credentials: true }, "credential"],
  [{ classification: "S1", localOnly: true }, "local-only"], [{ classification: "S1", confidential: true }, "confidential"],
    [{ classification: "S2" }, "unattested S2"],
]

describe("optional Cerebras Tier 3 adapter (mock transport only)", () => {
  it("is disabled by default and missing credentials never contact even the public catalog", async () => {
    const fetchImpl = transport()
    await expect(callCerebrasModelApi({ ...request(fetchImpl), enabled: false })).rejects.toMatchObject({ code: "EXTERNAL_PROVIDER_DISABLED" })
    await expect(callCerebrasModelApi({ ...request(fetchImpl), apiKey: "" })).rejects.toMatchObject({ code: "EXTERNAL_API_KEY_MISSING" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(deniedPackages)("denies %s (%s) before transport", async (contextPackage) => {
    const fetchImpl = transport()
    await expect(callCerebrasModelApi(request(fetchImpl, { contextPackage }))).rejects.toMatchObject({ code: "EXTERNAL_EGRESS_REFUSED" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("turns a null context package into a typed refusal before transport", async () => {
    const fetchImpl = transport()
    await expect(callCerebrasModelApi(request(fetchImpl, { contextPackage: null }))).rejects.toMatchObject({ code: "EXTERNAL_EGRESS_REFUSED" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(["person@example.test", "123-45-6789", "Authorization: sensitive-value"])("rejects sensitive input before transport", async prompt => {
    const fetchImpl = transport()
    await expect(callCerebrasModelApi(request(fetchImpl, { prompt }))).rejects.toMatchObject({ code: "EXTERNAL_EGRESS_REFUSED" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([{ classification: "S1" }, { classification: "S2", synthetic: true },
    { classification: "S2", sanitizedForExternalProcessing: true }])("allows approved low-risk package %s", async contextPackage => {
    const fetchImpl = transport()
    const result = await callCerebrasModelApi(request(fetchImpl, { contextPackage }))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ provider: "cerebras", requestedProvider: "cerebras", requestedModel: model,
      model, content: "fixture-answer", usage: { totalTokens: 12 } })
    expect(result.usage.costUsd).toBeCloseTo(0.000014)
    expect(result.receipt.contextDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, { headers: { authorization: string }, signal: AbortSignal, body: string }]
    expect(url).toBe(`${CEREBRAS_BASE_URL}/chat/completions`)
    expect(init.headers.authorization).toBe(`Bearer ${key}`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body)).toEqual({ model, messages: [{ role: "user", content: "fixture-public-input" }], max_tokens: 256, stream: false })
    expect(JSON.stringify(result)).not.toContain(key)
    expect(JSON.stringify(result.receipt)).not.toContain("fixture-public-input")
  })

  it("passes structured output and tool calls only when catalog advertises them", async () => {
    const fetchImpl = transport({ ...answer, choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [
      { id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }] } }] })
    const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }]
    const result = await callCerebrasModelApi(request(fetchImpl, {
      responseFormat: { type: "json_schema", json_schema: { name: "result", strict: true,
        schema: { type: "object", properties: {}, additionalProperties: false } } }, tools, parallelToolCalls: true,
    }))
    expect(result.toolCalls?.[0].function.name).toBe("lookup")
    const body = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, { body: string }])[1].body)
    expect(body.parallel_tool_calls).toBe(true)
    expect(body.response_format.type).toBe("json_schema")
  })

  it("validates JSON object and schema responses before completing", async () => {
    const schemaFormat = { type: "json_schema", json_schema: { name: "result", strict: true,
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } }
    const valid = transport({ ...answer, choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })
    expect((await callCerebrasModelApi(request(valid, { responseFormat: schemaFormat }))).content).toBe('{"ok":true}')
    for (const [responseFormat, content] of [
      [{ type: "json_object" }, "not-json"],
      [{ type: "json_object" }, "[]"],
      [schemaFormat, '{"ok":"wrong"}'],
    ] as const) {
      const fetchImpl = transport({ ...answer, choices: [{ finish_reason: "stop", message: { content } }] })
      await expect(callCerebrasModelApi(request(fetchImpl, { responseFormat })))
        .rejects.toMatchObject({ code: "EXTERNAL_API_MALFORMED_RESPONSE" })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    }
    const unsupported = transport()
    await expect(callCerebrasModelApi(request(unsupported, { responseFormat: { type: "json_schema",
      json_schema: { schema: { type: "not-a-schema-type" } } } })))
      .rejects.toMatchObject({ code: "EXTERNAL_API_UNSUPPORTED_CAPABILITY" })
    expect(unsupported).not.toHaveBeenCalled()
  })

  it("snapshots tool and output options before asynchronous catalog discovery", async () => {
    let releaseCatalog: (() => void) | undefined
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve })
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === CEREBRAS_CATALOG_URL) { await catalogGate; return response(catalog) }
      return response({ ...answer, choices: [{ finish_reason: "stop", message: { content: "{}" } }] })
    })
    const tools = [{ type: "function", function: { name: "lookup", description: "initial", parameters: { type: "object" } } }]
    const responseFormat = { type: "json_object", marker: "initial" }
    const pending = callCerebrasModelApi(request(fetchImpl, { tools, responseFormat }))
    tools[0].function.description = "changed-after-validation"
    responseFormat.marker = "changed-after-validation"
    releaseCatalog?.()
    await pending
    const body = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, { body: string }])[1].body)
    expect(body.tools[0].function.description).toBe("initial")
    expect(body.response_format.marker).toBe("initial")
  })

  it("keeps requested and actual model distinct without retaining content in the receipt", async () => {
    const fetchImpl = transport({ ...answer, model: "provider-reported-model" })
    const result = await callCerebrasModelApi(request(fetchImpl))
    expect(result.requestedModel).toBe(model)
    expect(result.model).toBe("provider-reported-model")
    expect(result.usage.costUsd).toBeCloseTo(0.000038)
    expect(JSON.stringify(result.receipt)).not.toContain("fixture-public-input")
    expect(JSON.stringify(result.receipt)).not.toContain("fixture-answer")
    expect(JSON.stringify(result.receipt)).not.toContain(key)
  })

  it("refuses a substituted model that lacks a requested capability", async () => {
    const fetchImpl = transport({ ...answer, model: "provider-reported-model",
      choices: [{ finish_reason: "stop", message: { content: "{}" } }] })
    await expect(callCerebrasModelApi(request(fetchImpl, { responseFormat: { type: "json_schema",
      json_schema: { name: "result", schema: { type: "object" } } } })))
      .rejects.toMatchObject({ code: "EXTERNAL_API_UNSUPPORTED_CAPABILITY" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("fails unsupported models, capabilities, modes, and unbudgeted calls without inference", async () => {
    for (const extra of [{ model: "unlisted" }, { modality: "image" }, { mode: "batch" }, { mode: "file" },
      { reasoningEffort: "low" },
      { spendPolicy: {} }, { spendPolicy: { maxCostUsd: 0.000001 } }]) {
      const fetchImpl = transport()
      await expect(callCerebrasModelApi(request(fetchImpl, extra))).rejects.toThrow()
      expect(fetchImpl.mock.calls.every(([url]) => url === CEREBRAS_CATALOG_URL)).toBe(true)
    }
    const fetchImpl = transport()
    catalog.data[0].capabilities.tools = false
    try {
      await expect(callCerebrasModelApi(request(fetchImpl, { tools: [{ type: "function", function: { name: "lookup" } }] }))).rejects.toMatchObject({ code: "EXTERNAL_API_UNSUPPORTED_CAPABILITY" })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally { catalog.data[0].capabilities.tools = true }
    const sensitiveOptions = transport()
    await expect(callCerebrasModelApi(request(sensitiveOptions, { tools: [{ type: "function", function: {
      name: "lookup", description: "Authorization: fixture-sensitive-value" } }] }))).rejects.toMatchObject({ code: "EXTERNAL_EGRESS_REFUSED" })
    expect(sensitiveOptions).not.toHaveBeenCalled()
  })

  it("reserves for a more expensive catalog model before paid inference", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url !== CEREBRAS_CATALOG_URL) throw new Error("inference must not run")
      return response({ data: [catalog.data[0], { ...catalog.data[1], pricing: { prompt: "0.01", completion: "0.01" } }] })
    })
    await expect(callCerebrasModelApi(request(fetchImpl))).rejects.toMatchObject({ code: "SPEND_CAP_EXCEEDS_CEILING" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("rejects inconsistent provider token totals", async () => {
    const fetchImpl = transport({ ...answer, usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 999 } })
    await expect(callCerebrasModelApi(request(fetchImpl))).rejects.toMatchObject({ code: "EXTERNAL_API_MALFORMED_RESPONSE" })
  })

  it.each(["length", "content_filter"])("rejects a %s finish reason before certifying completion", async finish_reason => {
    const fetchImpl = transport({ ...answer, choices: [{ finish_reason, message: { content: "partial" } }] })
    await expect(callCerebrasModelApi(request(fetchImpl))).rejects.toMatchObject({ code: "EXTERNAL_API_INCOMPLETE_RESPONSE" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("rejects unsolicited, empty, and undeclared tool-call completions", async () => {
    const declared = [{ type: "function", function: { name: "lookup" } }]
    const toolCall = { id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }
    for (const [choice, tools] of [
      [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [toolCall] } }, undefined],
      [{ finish_reason: "stop", message: { content: null, tool_calls: [] } }, declared],
      [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ ...toolCall,
        function: { name: "other", arguments: "{}" } }] } }, declared],
      [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ ...toolCall,
        function: { name: "lookup", arguments: "not-json" } }] } }, declared],
    ] as const) {
      const fetchImpl = transport({ ...answer, choices: [choice] })
      const error = await callCerebrasModelApi(request(fetchImpl, { tools })).catch(e => e)
      expect(error.code).toBe("EXTERNAL_API_MALFORMED_RESPONSE")
      expect(error.message).not.toContain("not-json")
    }
  })

  it("rejects parallel returned tool calls unless explicitly enabled", async () => {
    const tools = [{ type: "function", function: { name: "lookup" } }]
    const call = { id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }
    const fetchImpl = transport({ ...answer, choices: [{ finish_reason: "tool_calls", message: { content: null,
      tool_calls: [call, { ...call, id: "call_2" }] } }] })
    await expect(callCerebrasModelApi(request(fetchImpl, { tools, parallelToolCalls: false })))
      .rejects.toMatchObject({ code: "EXTERNAL_API_MALFORMED_RESPONSE" })
    expect((await callCerebrasModelApi(request(fetchImpl, { tools, parallelToolCalls: true }))).toolCalls)
      .toHaveLength(2)
  })

  it.each([[401, "EXTERNAL_API_AUTH_FAILURE"], [403, "EXTERNAL_API_AUTH_FAILURE"],
    [429, "EXTERNAL_API_RATE_LIMIT"], [503, "EXTERNAL_API_OUTAGE"]])("maps HTTP %i without response leakage or retries", async (status, code) => {
    const fetchImpl = transport({ unsafe: "fixture-sensitive-response" }, status, "3")
    const error = await callCerebrasModelApi(request(fetchImpl)).catch(e => e)
    expect(error.code).toBe(code)
    expect(error.message).not.toContain("fixture-sensitive-response")
    expect(error.message).not.toContain(key)
    if (status === 429) expect(error.retryAfterSeconds).toBe(3)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("maps timeout, cancellation and malformed response without carrying transport errors", async () => {
    const timeoutFetch = vi.fn(async (url: string, init: { signal: AbortSignal }) => {
      if (url === CEREBRAS_CATALOG_URL) return response(catalog)
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("fixture-sensitive-response"))))
    })
    await expect(callCerebrasModelApi(request(timeoutFetch, { timeoutMs: 5 }))).rejects.toMatchObject({ code: "EXTERNAL_API_TIMEOUT" })
    const bodyTimeoutFetch = vi.fn(async (url: string, init: { signal: AbortSignal }) =>
      url === CEREBRAS_CATALOG_URL ? response(catalog) : {
        ...response(null), json: () => new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () => reject(new Error("fixture-sensitive-response")))),
      })
    const bodyTimeoutError = await callCerebrasModelApi(request(bodyTimeoutFetch, { timeoutMs: 5 })).catch(e => e)
    expect(bodyTimeoutError.code).toBe("EXTERNAL_API_TIMEOUT")
    expect(bodyTimeoutError.message).not.toContain("fixture-sensitive-response")
    expect(bodyTimeoutFetch).toHaveBeenCalledTimes(2)
    const cancelled = new AbortController(); cancelled.abort()
    await expect(callCerebrasModelApi(request(transport(), { signal: cancelled.signal }))).rejects.toMatchObject({ code: "EXTERNAL_API_CANCELLED" })
    await expect(callCerebrasModelApi(request(transport({ choices: [] })))).rejects.toMatchObject({ code: "EXTERNAL_API_MALFORMED_RESPONSE" })
  })
})
