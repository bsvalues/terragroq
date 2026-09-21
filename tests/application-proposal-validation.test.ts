import fs from "node:fs"
import { EventEmitter } from "node:events"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { cerebrasCredentialBridgeReady, invokeCredentialBridge, runCerebrasApplicationTurn } from "@/lib/applications/cerebras-turn.mjs"
import { assertProposalSecretFree } from "@/lib/applications/proposal-secrets.mjs"
import { validateApplicationProposalInContainer } from "@/lib/applications/proposal-validation.mjs"
import { runCerebrasHelloChange } from "@/scripts/execution-fabric/cerebras-hello-change.mjs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function workspace() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "application-proposal-validation-"))
  roots.push(runtimeRoot)
  const workspacePath = path.join(runtimeRoot, "worktrees", "focus-board-proposal")
  for (const relative of ["web/page.html", "assets/theme.css", "client/main.js", "test/application.test.mjs"]) {
    const target = path.join(workspacePath, ...relative.split("/"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `content:${relative}\n`)
  }
  return { runtimeRoot, workspacePath }
}

const application = {
  manifest: {
    schemaVersion: 1,
    id: "focus-board",
    displayName: "Focus Board",
    adapter: "static-web-v1",
    source: { document: "web/page.html", styles: "assets/theme.css", script: "client/main.js", test: "test/application.test.mjs" },
    ai: { writablePaths: ["web/page.html", "assets/theme.css", "client/main.js"] },
  },
  manifestDigest: "a".repeat(64),
}

describe("application proposal secret boundary", () => {
  it("rejects explicit outbound and inbound secret sentinels without echoing them", () => {
    for (const value of [
      { requestText: "WILLIAMOS_SECRET_SENTINEL_DO_NOT_EGRESS" },
      { content: "CEREBRAS_API_KEY=classified-value" },
      { content: "-----BEGIN PRIVATE KEY-----" },
      { content: "sk-live-abcdefghijklmnopqrstuvwxyz123456" },
    ]) {
      expect(() => assertProposalSecretFree(value)).toThrow("APPLICATION_PROPOSAL_SECRET_DETECTED")
    }
    expect(() => assertProposalSecretFree({ requestText: "Add a reset button", content: "const tokenCount = 2" })).not.toThrow()
  })
})

describe("generic Cerebras application turn", () => {
  it("advertises bridge readiness only for the exact secret-free READY proof", async () => {
    const probe = (stdout: string, code = 0) => {
      const child = new EventEmitter() as any
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = vi.fn()
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(stdout))
        child.emit("close", code)
      })
      return child
    }
    const resolveAssets = () => ({
      powershell: "C:\\Windows\\powershell.exe",
      probe: "C:\\fixed\\test-cerebras-credential-ready.ps1",
    })
    await expect(cerebrasCredentialBridgeReady({}, { resolveAssets, spawn: () => probe("READY") })).resolves.toBe(true)
    await expect(cerebrasCredentialBridgeReady({}, { resolveAssets, spawn: () => probe("READY secret") })).resolves.toBe(false)
    await expect(cerebrasCredentialBridgeReady({}, { resolveAssets, spawn: () => probe("UNAVAILABLE", 1) })).resolves.toBe(false)
  })

  it("bounds an early credential-bridge stdin failure", async () => {
    const child = new EventEmitter() as any
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = new EventEmitter()
    child.kill = vi.fn()
    child.stdin.end = () => queueMicrotask(() => child.stdin.emit("error", Object.assign(new Error("pipe closed"), { code: "EPIPE" })))

    await expect(invokeCredentialBridge({ schemaVersion: 2 }, {
      resolveBridge: () => path.join(process.cwd(), "bridge.ps1"),
      spawn: () => child,
      timeoutMs: 1_000,
    })).rejects.toThrow("APPLICATION_CEREBRAS_UNAVAILABLE")
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it("authors a schema-v2 generic envelope without a hard-coded Hello path", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      if (String(input).endsWith("/public/v1/models")) {
        return Response.json({ data: [{
          id: "qwen-3.8-27b",
          capabilities: { structured_outputs: true, json_mode: true, tools: true, parallel_tool_calls: true, reasoning: true },
          supported_reasoning_efforts: [],
          pricing: { prompt: "0.00000099", completion: "0.00000149" },
        }] })
      }
      return Response.json({
        model: "qwen-3.8-27b",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          edits: [{ path: "client/main.js", find: "content:client/main.js", replace: "reset:ready" }],
        }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      })
    }
    const result = await runCerebrasHelloChange({
      apiKey: "test-key",
      fetchImpl: fetchImpl as typeof fetch,
      payload: {
        schemaVersion: 2,
        application: {
          id: "focus-board",
          displayName: "Focus Board",
          manifestDigest: "a".repeat(64),
          writablePaths: ["web/page.html", "assets/theme.css", "client/main.js"],
        },
        model: "qwen-3.8-27b",
        requestText: "Add a reset button",
        files: [
          { path: "web/page.html", content: "content:web/page.html\n" },
          { path: "assets/theme.css", content: "content:assets/theme.css\n" },
          { path: "client/main.js", content: "content:client/main.js\n" },
        ],
      },
    })
    expect(result).toEqual(expect.objectContaining({
      schemaVersion: 2,
      code: "CEREBRAS_APPLICATION_CHANGE_OK",
      applicationId: "focus-board",
      manifestDigest: "a".repeat(64),
      changes: [{ path: "client/main.js", content: "reset:ready\n" }],
    }))
  })

  it("binds the versioned envelope to literal application identity and the exact writable set", async () => {
    const { workspacePath } = workspace()
    let observed: any
    const result = await runCerebrasApplicationTurn({
      application,
      workspacePath,
      requestText: "Add a reset button",
      model: "qwen-3.8-27b",
      invoke: async (payload: unknown) => {
        observed = payload
        return {
          schemaVersion: 2,
          status: "SUCCEEDED",
          code: "CEREBRAS_APPLICATION_CHANGE_OK",
          provider: "cerebras",
          applicationId: "focus-board",
          manifestDigest: "a".repeat(64),
          requestedModel: "qwen-3.8-27b",
          actualModel: "qwen-3.8-27b",
          changes: [{ path: "client/main.js", content: "document.body.dataset.reset = 'ready'\n" }],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          calculatedCostUsd: 0.001,
          requestedMaxCostUsd: 0.03,
          contextDigest: `sha256:${"b".repeat(64)}`,
          durationMs: 12,
        }
      },
    })

    expect(observed).toEqual({
      schemaVersion: 2,
      application: {
        id: "focus-board",
        displayName: "Focus Board",
        manifestDigest: "a".repeat(64),
        writablePaths: ["web/page.html", "assets/theme.css", "client/main.js"],
      },
      model: "qwen-3.8-27b",
      requestText: "Add a reset button",
      files: [
        { path: "web/page.html", content: "content:web/page.html\n" },
        { path: "assets/theme.css", content: "content:assets/theme.css\n" },
        { path: "client/main.js", content: "content:client/main.js\n" },
      ],
    })
    expect(fs.readFileSync(path.join(workspacePath, "client/main.js"), "utf8")).toContain("reset")
    expect(result).toEqual(expect.objectContaining({ model: "qwen-3.8-27b", executionNode: "cerebras-api" }))
  })

  it("refuses malicious provider paths and secret-bearing provider content", async () => {
    const run = async (change: { path: string; content: string }) => {
      const { workspacePath } = workspace()
      return runCerebrasApplicationTurn({
        application,
        workspacePath,
        requestText: "Change one file",
        model: "qwen-3.8-27b",
        invoke: async () => ({
          schemaVersion: 2, status: "SUCCEEDED", code: "CEREBRAS_APPLICATION_CHANGE_OK", provider: "cerebras",
          applicationId: "focus-board", manifestDigest: "a".repeat(64), requestedModel: "qwen-3.8-27b", actualModel: "qwen-3.8-27b",
          changes: [change], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, calculatedCostUsd: 0,
          requestedMaxCostUsd: 0.03, contextDigest: `sha256:${"b".repeat(64)}`, durationMs: 1,
        }),
      })
    }
    await expect(run({ path: ".williamos/application.json", content: "{}" })).rejects.toThrow("APPLICATION_CEREBRAS_RESPONSE_INVALID")
    await expect(run({ path: "client/main.js", content: "WILLIAMOS_SECRET_SENTINEL_INBOUND" })).rejects.toThrow("APPLICATION_PROPOSAL_SECRET_DETECTED")
  })
})

describe("contained generic proposal validation", () => {
  it("uses the fixed test command, a readonly no-network mount, and a secret-free child environment", async () => {
    const { runtimeRoot, workspacePath } = workspace()
    const calls: Array<{ args: string[]; env: Record<string, string | undefined> }> = []
    const commandRunner = async (_command: string, args: string[], options: any) => {
      calls.push({ args, env: options.env })
      if (args[0] === "image") return { code: 0, stdout: `sha256:${"c".repeat(64)}\n`, stderr: "" }
      if (args[0] === "run") return { code: 0, stdout: "tests passed\n", stderr: "" }
      return { code: 1, stdout: "", stderr: `Error response from daemon: No such container: ${args.at(-1)}` }
    }
    const prior = process.env.WILLIAMOS_SECRET_SENTINEL_ENV
    process.env.WILLIAMOS_SECRET_SENTINEL_ENV = "DO_NOT_INHERIT"
    try {
      const validation = await validateApplicationProposalInContainer({
        application,
        runtimeRoot,
        workspacePath,
        validatorPolicy: { image: "validator:owned", imageId: `sha256:${"c".repeat(64)}`, dockerConfig: "C:\\owned-docker" },
        commandRunner,
      })
      expect(validation).toEqual({ status: "passed", command: "node --test test/application.test.mjs", output: "tests passed" })
      const run = calls.find(({ args }) => args[0] === "run")!
      expect(run.args).toEqual(expect.arrayContaining(["--network", "none", "--read-only", "--cap-drop", "ALL", "--entrypoint", "node", "--test", "test/application.test.mjs"]))
      expect(run.args.find((entry) => entry.startsWith("type=bind"))).toContain("readonly")
      expect(JSON.stringify(run.env)).not.toContain("DO_NOT_INHERIT")
    } finally {
      if (prior === undefined) delete process.env.WILLIAMOS_SECRET_SENTINEL_ENV
      else process.env.WILLIAMOS_SECRET_SENTINEL_ENV = prior
    }
  })

  it("detects validation-time source mutation", async () => {
    const { runtimeRoot, workspacePath } = workspace()
    await expect(validateApplicationProposalInContainer({
      application,
      runtimeRoot,
      workspacePath,
      validatorPolicy: { image: "validator:owned", imageId: `sha256:${"c".repeat(64)}`, dockerConfig: "C:\\owned-docker" },
      commandRunner: async (_command: string, args: string[]) => {
        if (args[0] === "image") return { code: 0, stdout: `sha256:${"c".repeat(64)}\n`, stderr: "" }
        if (args[0] === "run") {
          fs.writeFileSync(path.join(workspacePath, "client/main.js"), "tampered\n")
          return { code: 0, stdout: "passed", stderr: "" }
        }
        return { code: 1, stdout: "", stderr: `Error response from daemon: No such container: ${args.at(-1)}` }
      },
    })).rejects.toThrow("APPLICATION_PROPOSAL_VALIDATION_HASH_MISMATCH")
  })
})
