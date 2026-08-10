import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  buildHermesLoopbackRequest,
  executeHermesLoopbackInference,
} from "../scripts/execution-fabric/adapters/hermes-loopback-inference.mjs"

const promptBytes = fs.readFileSync(path.join(process.cwd(), "config/execution-fabric/task-prompts/hermes-loopback-local-inference-v1.txt"))
const promptSha256 = crypto.createHash("sha256").update(promptBytes).digest("hex")
const template = {
  id: "hermes-loopback-local-inference-v1",
  canonical_node: "hermes-node",
  endpoint: "http://127.0.0.1:11434/api/generate",
  model: "llama3.2:3b",
  prompt_sha256: promptSha256,
  expected_marker: "HERMES_DISPATCH_001_OK",
  maximum_calls: 1,
  timeout_seconds: 60,
  resource_ceilings: {
    maximum_gpu_vram_bytes: 6_442_450_944,
    prompt_limit_bytes: 1024,
    response_limit_bytes: 65_536,
  },
  redirect_policy: "error",
  stream: false,
}

describe("Execution Fabric HERMES loopback inference adapter", () => {
  it("constructs one exact loopback request with no caller-controlled execution field", () => {
    const request = buildHermesLoopbackRequest({ template, promptBytes, trustedIdentity: "resident-hermes@hermes-node" })
    expect(request.endpoint).toBe("http://127.0.0.1:11434/api/generate")
    expect(JSON.parse(request.body.toString("utf8"))).toEqual({
      model: "llama3.2:3b",
      options: { num_predict: 32, temperature: 0 },
      prompt: promptBytes.toString("utf8"),
      stream: false,
    })
  })

  it("performs one bounded call and accepts only the exact marker", async () => {
    const responseBytes = Buffer.from(JSON.stringify({
      model: "llama3.2:3b",
      response: "HERMES_DISPATCH_001_OK",
      done: true,
    }))
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      redirected: false,
      arrayBuffer: async () => responseBytes,
    }))
    const result = await executeHermesLoopbackInference({
      template,
      promptBytes,
      trustedIdentity: "resident-hermes@hermes-node",
      fetchImpl,
      clock: () => Date.parse("2026-08-10T17:00:00.000Z"),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/generate")
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error" })
    expect(result).toMatchObject({
      status: "COMPLETE",
      calls_performed: 1,
      scheduler_state: "OFF",
      autonomous_dispatch: false,
    })
  })

  it.each([
    ["wrong identity", { trustedIdentity: "operator@omen" }, "HERMES_IDENTITY_MISMATCH"],
    ["wrong node", { template: { ...template, canonical_node: "aegis" } }, "HERMES_TEMPLATE_INVALID"],
    ["external endpoint", { template: { ...template, endpoint: "https://example.invalid/api/generate" } }, "HERMES_TEMPLATE_INVALID"],
    ["wrong model", { template: { ...template, model: "other" } }, "HERMES_TEMPLATE_INVALID"],
    ["changed prompt", { promptBytes: Buffer.from("different") }, "HERMES_PROMPT_DIGEST_MISMATCH"],
  ])("rejects %s", (_name, overrides, code) => {
    expect(() => buildHermesLoopbackRequest({
      template,
      promptBytes,
      trustedIdentity: "resident-hermes@hermes-node",
      ...overrides,
    })).toThrowError(expect.objectContaining({ code }))
  })

  it("rejects redirects, oversized output, wrong response model, and missing marker", async () => {
    const run = (value: unknown, extra = {}) => executeHermesLoopbackInference({
      template,
      promptBytes,
      trustedIdentity: "resident-hermes@hermes-node",
      fetchImpl: async () => ({
        status: 200,
        redirected: false,
        arrayBuffer: async () => Buffer.from(JSON.stringify(value)),
        ...extra,
      }),
    })
    await expect(run({ model: "llama3.2:3b", response: "wrong", done: true }))
      .rejects.toMatchObject({ code: "HERMES_EXPECTED_MARKER_MISSING" })
    await expect(run({ model: "other", response: "HERMES_DISPATCH_001_OK", done: true }))
      .rejects.toMatchObject({ code: "HERMES_RESPONSE_SHAPE_INVALID" })
    await expect(run({ model: "llama3.2:3b", response: "HERMES_DISPATCH_001_OK", done: true }, { redirected: true }))
      .rejects.toMatchObject({ code: "HERMES_RESPONSE_REJECTED" })
    await expect(executeHermesLoopbackInference({
      template,
      promptBytes,
      trustedIdentity: "resident-hermes@hermes-node",
      fetchImpl: async () => ({ status: 200, redirected: false, arrayBuffer: async () => Buffer.alloc(65_537) }),
    })).rejects.toMatchObject({ code: "HERMES_RESPONSE_SIZE_INVALID" })
  })
})
