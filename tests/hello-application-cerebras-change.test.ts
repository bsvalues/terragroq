import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { runCerebrasHelloChange } from "@/scripts/execution-fabric/cerebras-hello-change.mjs"
import {
  resolveCerebrasCredentialBridge,
  runCerebrasHelloTurn,
} from "@/lib/hello-application/cerebras-turn.mjs"

const allowedPaths = [
  "examples/hello-application/src/app.js",
  "examples/hello-application/src/index.html",
  "examples/hello-application/src/styles.css",
] as const

const roots: string[] = []

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hello-cerebras-"))
  roots.push(root)
  for (const relative of allowedPaths) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `original:${relative}\n`)
  }
  return root
}

function catalog() {
  const capabilities = {
    structured_outputs: true,
    json_mode: true,
    tools: true,
    parallel_tool_calls: false,
    reasoning: true,
  }
  return {
    data: [
      { id: "gpt-oss-120b", capabilities, supported_reasoning_efforts: [], pricing: { prompt: "0.00000035", completion: "0.00000075" } },
      { id: "qwen-3.8-27b", capabilities: { ...capabilities, parallel_tool_calls: true }, supported_reasoning_efforts: [], pricing: { prompt: "0.00000099", completion: "0.00000149" } },
    ],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Cerebras Hello Application change", () => {
  it("resolves the credential bridge from the deployed source root rather than the bundled module URL", () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hello-cerebras-source-"))
    roots.push(sourceRoot)
    const wrapper = path.join(sourceRoot, "scripts", "execution-fabric", "invoke-cerebras-hello-change.ps1")
    fs.mkdirSync(path.dirname(wrapper), { recursive: true })
    fs.writeFileSync(wrapper, "# governed test wrapper\n")

    expect(resolveCerebrasCredentialBridge({ applicationRoot: sourceRoot })).toBe(fs.realpathSync(wrapper))
  })

  it("requests one structured, cost-bounded edit from the selected exact model", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/public/v1/models")) return Response.json(catalog())
      const request = JSON.parse(String(init?.body))
      expect(request.model).toBe("qwen-3.8-27b")
      expect(request.max_tokens).toBe(6_144)
      expect(request.response_format.json_schema.strict).toBe(true)
      expect(request.messages.at(-1).content).toContain("examples/hello-application/src/app.js")
      return Response.json({
        model: "qwen-3.8-27b",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          changes: [{ path: allowedPaths[0], content: "export const routed = true\n" }],
        }) } }],
        usage: { prompt_tokens: 500, completion_tokens: 80, total_tokens: 580 },
      })
    })

    const result = await runCerebrasHelloChange({
      apiKey: "test-key",
      fetchImpl: fetchImpl as typeof fetch,
      payload: {
        schemaVersion: 1,
        model: "qwen-3.8-27b",
        requestText: "Add a routed marker",
        files: allowedPaths.map((relative) => ({ path: relative, content: `source:${relative}\n` })),
      },
    })

    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "SUCCEEDED",
      code: "CEREBRAS_HELLO_CHANGE_OK",
      provider: "cerebras",
      requestedModel: "qwen-3.8-27b",
      actualModel: "qwen-3.8-27b",
      changes: [{ path: allowedPaths[0], content: "export const routed = true\n" }],
      usage: { promptTokens: 500, completionTokens: 80, totalTokens: 580 },
    })
    expect(result.calculatedCostUsd).toBeCloseTo(0.0006142, 10)
    expect(result.requestedMaxCostUsd).toBe(0.03)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("refuses provider model substitution before returning any change", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/public/v1/models")) return Response.json(catalog())
      return Response.json({
        model: "gpt-oss-120b",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          changes: [{ path: allowedPaths[0], content: "substituted\n" }],
        }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      })
    })

    const result = await runCerebrasHelloChange({
      apiKey: "test-key",
      fetchImpl: fetchImpl as typeof fetch,
      payload: {
        schemaVersion: 1,
        model: "qwen-3.8-27b",
        requestText: "Change one file",
        files: allowedPaths.map((relative) => ({ path: relative, content: "source\n" })),
      },
    })

    expect(result).toEqual(expect.objectContaining({
      status: "FAILED",
      code: "CEREBRAS_HELLO_MODEL_MISMATCH",
      changes: [],
    }))
  })

  it("applies only a validated allowlisted response to the isolated workspace", async () => {
    const root = workspace()
    const invoke = vi.fn(async () => ({
      schemaVersion: 1,
      status: "SUCCEEDED",
      code: "CEREBRAS_HELLO_CHANGE_OK",
      provider: "cerebras",
      requestedModel: "gpt-oss-120b",
      actualModel: "gpt-oss-120b",
      changes: [
        { path: allowedPaths[0], content: "export const cerebras = true\n" },
        { path: allowedPaths[2], content: ".cerebras { color: green; }\n" },
      ],
      usage: { promptTokens: 20, completionTokens: 30, totalTokens: 50 },
      calculatedCostUsd: 0.00003,
      requestedMaxCostUsd: 0.03,
      contextDigest: `sha256:${"a".repeat(64)}`,
      durationMs: 12,
    }))

    const result = await runCerebrasHelloTurn({
      workspacePath: root,
      requestText: "Make a two-file change",
      model: "gpt-oss-120b",
      allowedPaths,
      invoke,
    })

    expect(fs.readFileSync(path.join(root, allowedPaths[0]), "utf8")).toBe("export const cerebras = true\n")
    expect(fs.readFileSync(path.join(root, allowedPaths[2]), "utf8")).toBe(".cerebras { color: green; }\n")
    expect(fs.readFileSync(path.join(root, allowedPaths[1]), "utf8")).toBe(`original:${allowedPaths[1]}\n`)
    expect(result).toMatchObject({
      model: "gpt-oss-120b",
      executionNode: "cerebras-api",
      ignoredPathsCreated: [],
    })
    expect(result.threadId).toMatch(/^cerebras-[0-9a-f-]{36}$/)
    expect(result.turnId).toMatch(/^turn-[0-9a-f-]{36}$/)
  })

  it("leaves every file unchanged when the provider response escapes scope", async () => {
    const root = workspace()
    const before = Object.fromEntries(allowedPaths.map((relative) => [relative, fs.readFileSync(path.join(root, relative), "utf8")]))
    const invoke = vi.fn(async () => ({
      schemaVersion: 1,
      status: "SUCCEEDED",
      code: "CEREBRAS_HELLO_CHANGE_OK",
      provider: "cerebras",
      requestedModel: "gpt-oss-120b",
      actualModel: "gpt-oss-120b",
      changes: [{ path: "owner-note.txt", content: "escape\n" }],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      calculatedCostUsd: 0.00001,
      requestedMaxCostUsd: 0.03,
      contextDigest: `sha256:${"b".repeat(64)}`,
      durationMs: 1,
    }))

    await expect(runCerebrasHelloTurn({
      workspacePath: root,
      requestText: "Escape",
      model: "gpt-oss-120b",
      allowedPaths,
      invoke,
    })).rejects.toThrow("HELLO_CEREBRAS_RESPONSE_INVALID")

    for (const relative of allowedPaths) {
      expect(fs.readFileSync(path.join(root, relative), "utf8")).toBe(before[relative])
    }
    expect(fs.existsSync(path.join(root, "owner-note.txt"))).toBe(false)
  })

  it("refuses a symlinked allowlisted source before egress or any write", async () => {
    const root = workspace()
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hello-cerebras-outside-"))
    roots.push(outsideRoot)
    const outside = path.join(outsideRoot, "outside.js")
    fs.writeFileSync(outside, "outside-original\n")
    const linked = path.join(root, allowedPaths[0])
    fs.unlinkSync(linked)
    fs.symlinkSync(outside, linked, "file")
    const invoke = vi.fn()

    await expect(runCerebrasHelloTurn({
      workspacePath: root,
      requestText: "Change the linked file",
      model: "gpt-oss-120b",
      allowedPaths,
      invoke,
    })).rejects.toThrow("HELLO_CEREBRAS_REQUEST_INVALID")

    expect(invoke).not.toHaveBeenCalled()
    expect(fs.readFileSync(outside, "utf8")).toBe("outside-original\n")
  })
})
