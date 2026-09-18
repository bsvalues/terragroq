import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { runCerebrasSmoke } from "../scripts/execution-fabric/cerebras-smoke.mjs"
import { CEREBRAS_BASE_URL, CEREBRAS_CATALOG_URL } from "../scripts/execution-fabric/external-model-api.mjs"

const model = "fixture-model"
const environment = { WILLIAMOS_CEREBRAS_ENABLED: "true", CEREBRAS_API_KEY: "fixture-not-a-real-key" }
const catalog = { data: [{ id: model, deprecated: false, pricing: { prompt: "0.000001", completion: "0.000002" },
  capabilities: { tools: false, structured_outputs: false, json_mode: false, reasoning: false, vision: false } }] }
const completion = { model, choices: [{ message: { content: "fixture-response-content" } }],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }
const transport = (body: unknown = completion, status = 200) => vi.fn(async (url: string) => ({
  ok: status < 400 || url === CEREBRAS_CATALOG_URL,
  status: url === CEREBRAS_CATALOG_URL ? 200 : status,
  json: async () => url === CEREBRAS_CATALOG_URL ? catalog : body,
}))

describe("WilliamOS-owned one-shot Cerebras invocation", () => {
  it("stays disabled or credentialless without any metadata or inference call", async () => {
    const fetchImpl = transport()
    expect((await runCerebrasSmoke({ model, environment: {}, fetchImpl })).code).toBe("EXTERNAL_PROVIDER_DISABLED")
    expect((await runCerebrasSmoke({ model, environment: { WILLIAMOS_CEREBRAS_ENABLED: "true" }, fetchImpl })).code).toBe("EXTERNAL_API_KEY_MISSING")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("makes exactly one bounded synthetic inference and returns metadata only", async () => {
    const fetchImpl = transport()
    const receipt = await runCerebrasSmoke({ model, environment, fetchImpl })
    expect(receipt).toMatchObject({ status: "SUCCEEDED", code: "CEREBRAS_SMOKE_OK", provider: "cerebras",
      requestedModel: model, actualModel: model, promptTokens: 10, completionTokens: 2, totalTokens: 12 })
    expect(receipt.calculatedCostUsd).toBeCloseTo(0.000014)
    expect(receipt.durationMs).toBeGreaterThanOrEqual(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.filter(([url]) => url === `${CEREBRAS_BASE_URL}/chat/completions`)).toHaveLength(1)
    const [, init] = fetchImpl.mock.calls[1] as unknown as [string, { body: string }]
    const wire = JSON.parse(init.body)
    expect(wire.max_tokens).toBe(32)
    expect(wire.messages).toHaveLength(1)
    expect(typeof wire.messages[0].content).toBe("string")
    expect(JSON.stringify(receipt)).not.toContain(environment.CEREBRAS_API_KEY)
    expect(JSON.stringify(receipt)).not.toContain(wire.messages[0].content)
    expect(JSON.stringify(receipt)).not.toContain("fixture-response-content")
    expect(JSON.stringify(receipt)).not.toContain("authorization")
  })

  it("caps total cost at one cent and never retries a typed provider failure", async () => {
    const fetchImpl = transport({ unexpected: "fixture-sensitive-response" }, 429)
    const receipt = await runCerebrasSmoke({ model, environment, fetchImpl })
    expect(receipt).toMatchObject({ status: "FAILED", code: "EXTERNAL_API_RATE_LIMIT", calculatedCostUsd: null })
    expect(receipt.durationMs).toBeGreaterThanOrEqual(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(receipt)).not.toContain("fixture-sensitive-response")
    expect(JSON.stringify(receipt)).not.toContain(environment.CEREBRAS_API_KEY)
    const expensive = vi.fn(async (url: string) => ({ ok: true, status: 200,
      json: async () => url === CEREBRAS_CATALOG_URL ? {
        data: [{ ...catalog.data[0], pricing: { prompt: "1", completion: "1" } }],
      } : completion }))
    expect((await runCerebrasSmoke({ model, environment, fetchImpl: expensive })).status).toBe("FAILED")
    expect(expensive).toHaveBeenCalledTimes(1)
  })

  it("the CLI refuses a missing key without network or sensitive output", () => {
    const script = path.join(process.cwd(), "scripts", "execution-fabric", "cerebras-smoke.mjs")
    const result = spawnSync(process.execPath, [script, "--model", model], { encoding: "utf8",
      env: { ...process.env, WILLIAMOS_CEREBRAS_ENABLED: "true", CEREBRAS_API_KEY: "" } })
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "FAILED", code: "EXTERNAL_API_KEY_MISSING" })
    expect(result.stderr).toBe("")
  })

  it("local handoff requires hidden interaction and clears both variables in finally", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts", "execution-fabric", "invoke-cerebras-smoke.ps1"), "utf8")
    expect(source).toContain("Read-Host -Prompt \"Cerebras API key (local, hidden)\" -AsSecureString")
    expect(source).toContain("ZeroFreeBSTR")
    expect(source).toMatch(/finally\s*\{[\s\S]*Remove-Item Env:CEREBRAS_API_KEY[\s\S]*Remove-Item Env:WILLIAMOS_CEREBRAS_ENABLED/)
    expect(source).not.toContain(".env.local")
  })
})
