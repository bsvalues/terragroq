import { EventEmitter } from "node:events"
import { PassThrough, Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import {
  AppServerTimeoutError,
  CodexAppServerClient,
  createCodexChildEnvironment,
  sanitizeAppServerText,
} from "@/scripts/hermes-bridge/app-server-client.mjs"

class FakeProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  writes: string[] = []
  killed = false
  stdin = new Writable({
    write: (chunk, _encoding, done) => {
      this.writes.push(String(chunk))
      done()
    },
  })

  send(message: unknown) {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  messages() {
    return this.writes.flatMap((write) => write.trim().split("\n")).filter(Boolean).map((line) => JSON.parse(line))
  }

  kill() {
    this.killed = true
    return true
  }
}

function setup(options: Record<string, unknown> = {}) {
  const process = new FakeProcess()
  const spawn = vi.fn(() => process)
  const client = new CodexAppServerClient({ spawn, command: "codex", args: ["app-server", "--stdio"], ...options })
  return { client, process, spawn }
}

async function connect(client: CodexAppServerClient, process: FakeProcess) {
  const pending = client.connect()
  const initialize = process.messages()[0]
  process.send({ id: initialize.id, result: { userAgent: "fake" } })
  await pending
}

describe("CodexAppServerClient", () => {
  it("passes only host and keyring discovery variables to the Codex child", () => {
    expect(createCodexChildEnvironment({
      PATH: "tools", USERPROFILE: "C:/Users/owner", APPDATA: "C:/Users/owner/AppData/Roaming",
      CODEX_HOME: "C:/Users/owner/.codex", DATABASE_URL: "postgresql://secret", BETTER_AUTH_SECRET: "secret",
      GH_TOKEN: "secret", OPENAI_API_KEY: "secret",
    }, { platform: "linux" })).toEqual({
      PATH: "tools", USERPROFILE: "C:/Users/owner", APPDATA: "C:/Users/owner/AppData/Roaming",
      CODEX_HOME: "C:/Users/owner/.codex",
    })
  })

  it("prefers the stable native PowerShell path without broadening the child environment", () => {
    expect(createCodexChildEnvironment({
      PATH: "C:\\Windows\\System32", USERPROFILE: "C:/Users/owner", DATABASE_URL: "secret",
    }, { platform: "win32", existsSync: () => true })).toEqual({
      PATH: "C:\\Program Files\\PowerShell\\7;C:\\Windows\\System32",
      USERPROFILE: "C:/Users/owner",
    })
  })

  it("redacts opaque Authorization bearer and basic credential values", () => {
    expect(sanitizeAppServerText("Authorization: Bearer opaque-value-123456")).toBe("[REDACTED]")
    expect(sanitizeAppServerText("Authorization: Basic Zm9vOmJhcg==")).toBe("[REDACTED]")
  })
  it("spawns the stdio App Server and frames initialize as one JSON object per line", async () => {
    const { client, process, spawn } = setup()
    await connect(client, process)

    expect(spawn).toHaveBeenCalledWith("codex", ["app-server", "--stdio"], expect.objectContaining({
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: expect.any(Object),
    }))
    expect(process.writes.every((write) => write.endsWith("\n"))).toBe(true)
    expect(process.messages()).toEqual([
      expect.objectContaining({ id: 1, method: "initialize" }),
      { method: "initialized" },
    ])
  })

  it("rejects pending RPCs when the App Server exits cleanly before replying", async () => {
    const { client, process } = setup()
    const pending = client.connect()
    process.emit("exit", 0, null)
    await expect(pending).rejects.toThrow("Codex App Server exited (0)")
  })

  it("correlates requests once and ignores duplicate or unknown responses", async () => {
    const { client, process } = setup()
    await connect(client, process)

    const first = client.request("thread/start", {})
    const second = client.resumeThread("thread-old")
    const [start, resume] = process.messages().slice(-2)
    process.send({ id: resume.id, result: { thread: { id: "thread-old" } } })
    process.send({ id: resume.id, result: { thread: { id: "wrong-duplicate" } } })
    process.send({ id: 999, result: { ignored: true } })
    process.send({ id: start.id, result: { thread: { id: "thread-new" } } })

    await expect(first).resolves.toEqual({ thread: { id: "thread-new" } })
    await expect(second).resolves.toBe("thread-old")
  })

  it("starts a thread and captures only sanitized terminal turn data", async () => {
    const notifications: unknown[] = []
    const { client, process } = setup({ onNotification: (event: unknown) => notifications.push(event) })
    await connect(client, process)

    const threadPromise = client.startThread({ cwd: "C:/repo" })
    const threadRequest = process.messages().at(-1)
    process.send({ id: threadRequest.id, result: { thread: { id: "thread-1" } } })
    await expect(threadPromise).resolves.toBe("thread-1")

    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "do work" })
    const turnRequest = process.messages().at(-1)
    expect(turnRequest.params.input).toEqual([{ type: "text", text: "do work", text_elements: [] }])
    process.send({ id: turnRequest.id, result: { turn: { id: "turn-1", status: "inProgress" } } })
    await Promise.resolve()
    process.send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", delta: "token=super-secret-value" } })
    process.send({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "completed",
          error: null,
          items: [{ type: "agentMessage", id: "m1", text: "done sk-live-secret-token-12345678" }],
        },
      },
    })

    const result = await resultPromise
    expect(result).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      finalText: "done [REDACTED]",
      error: null,
    })
    expect(JSON.stringify({ result, notifications })).not.toContain("super-secret-value")
    expect(JSON.stringify({ result, notifications })).not.toContain("sk-live-secret")
  })

  it("assembles the terminal agent message from streamed deltas", async () => {
    const { client, process } = setup()
    await connect(client, process)
    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "work" })
    const request = process.messages().at(-1)
    process.send({ id: request.id, result: { turn: { id: "turn-delta", status: "inProgress" } } })
    await Promise.resolve()
    process.send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-delta", delta: "HELLO" } })
    process.send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-delta", delta: "_WORLD" } })
    process.send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-delta", status: "completed", items: [] } } })
    await expect(resultPromise).resolves.toMatchObject({ finalText: "HELLO_WORLD" })
  })

  it("correlates a completion that omits the top-level threadId", async () => {
    const { client, process } = setup()
    await connect(client, process)
    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "work" })
    const request = process.messages().at(-1)
    process.send({ id: request.id, result: { turn: { id: "turn-no-thread", status: "inProgress" } } })
    await Promise.resolve()
    await Promise.resolve()
    process.send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-no-thread", delta: "DONE" } })
    process.send({ method: "turn/completed", params: { turn: { id: "turn-no-thread", status: "completed", items: [] } } })
    await expect(resultPromise).resolves.toMatchObject({ threadId: "thread-1", finalText: "DONE" })
  })

  it("interrupts and rejects a turn on timeout", async () => {
    vi.useFakeTimers()
    const { client, process } = setup({ timeoutMs: 25 })
    await connect(client, process)

    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "wait" })
    const turnRequest = process.messages().at(-1)
    process.send({ id: turnRequest.id, result: { turn: { id: "turn-timeout", status: "inProgress" } } })
    await Promise.resolve()
    const rejection = expect(resultPromise).rejects.toBeInstanceOf(AppServerTimeoutError)
    await vi.advanceTimersByTimeAsync(25)

    await rejection
    expect(process.messages()).toContainEqual({
      id: expect.any(Number),
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-timeout" },
    })
    vi.useRealTimers()
  })

  it("times out while awaiting the initial turn/start response", async () => {
    vi.useFakeTimers()
    const { client, process } = setup({ timeoutMs: 25 })
    await connect(client, process)
    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "wait" })
    const rejection = expect(resultPromise).rejects.toBeInstanceOf(AppServerTimeoutError)
    await vi.advanceTimersByTimeAsync(25)
    await rejection
    vi.useRealTimers()
  })

  it("uses one timeout budget across startup and execution", async () => {
    vi.useFakeTimers()
    const { client, process } = setup({ timeoutMs: 25, now: () => Date.now() })
    await connect(client, process)
    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "wait" })
    const request = process.messages().at(-1)
    await vi.advanceTimersByTimeAsync(15)
    process.send({ id: request.id, result: { turn: { id: "turn-budget", status: "inProgress" } } })
    await Promise.resolve()
    await Promise.resolve()
    const rejection = expect(resultPromise).rejects.toBeInstanceOf(AppServerTimeoutError)
    await vi.advanceTimersByTimeAsync(10)
    await rejection
    vi.useRealTimers()
  })

  it("interrupts and rejects a turn when its abort signal is cancelled", async () => {
    const { client, process } = setup()
    await connect(client, process)
    const controller = new AbortController()

    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "wait", signal: controller.signal })
    const turnRequest = process.messages().at(-1)
    process.send({ id: turnRequest.id, result: { turn: { id: "turn-cancel", status: "inProgress" } } })
    await Promise.resolve()
    await Promise.resolve()
    const rejection = expect(resultPromise).rejects.toMatchObject({ code: "APP_SERVER_CANCELLED" })
    controller.abort()

    await rejection
    expect(process.messages()).toContainEqual({
      id: expect.any(Number),
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-cancel" },
    })
  })

  it("rejects approval requests as a typed wall without capturing request details", async () => {
    const { client, process } = setup()
    await connect(client, process)

    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "work" })
    const turnRequest = process.messages().at(-1)
    process.send({ id: turnRequest.id, result: { turn: { id: "turn-wall", status: "inProgress" } } })
    await Promise.resolve()
    process.send({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { command: "echo raw-token-should-not-be-captured" },
    })

    await expect(resultPromise).rejects.toMatchObject({
      code: "APP_SERVER_APPROVAL_REQUIRED",
      method: "item/commandExecution/requestApproval",
    })
    expect(process.messages().at(-1)).toEqual({
      id: "approval-1",
      error: { code: -32001, message: "APP_SERVER_APPROVAL_REQUIRED" },
    })
    expect(JSON.stringify(process.messages().at(-1))).not.toContain("raw-token")
  })

  it("rejects user-input requests as a distinct typed wall", async () => {
    const { client, process } = setup()
    await connect(client, process)

    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "work" })
    const turnRequest = process.messages().at(-1)
    process.send({ id: turnRequest.id, result: { turn: { id: "turn-input", status: "inProgress" } } })
    await Promise.resolve()
    process.send({ id: "input-1", method: "item/tool/requestUserInput", params: { questions: [] } })

    await expect(resultPromise).rejects.toMatchObject({
      code: "APP_SERVER_USER_INPUT_REQUIRED",
      method: "item/tool/requestUserInput",
    })
  })

  it("interrupts connector and web tool items without retaining their arguments", async () => {
    const { client, process } = setup()
    await connect(client, process)
    const resultPromise = client.runTurn({ threadId: "thread-1", prompt: "work" })
    const turnRequest = process.messages().at(-1)
    process.send({ id: turnRequest.id, result: { turn: { id: "turn-tool", status: "inProgress" } } })
    await Promise.resolve()
    process.send({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-tool", item: { type: "mcpToolCall", arguments: { token: "not-retained" } } },
    })
    await expect(resultPromise).rejects.toMatchObject({ code: "APP_SERVER_EXTERNAL_TOOL_WALL", method: "mcpToolCall" })
    expect(JSON.stringify(process.messages().at(-1))).not.toContain("not-retained")
  })

  it("contains no codex exec or rejected runtime-operator path", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(
      new URL("../scripts/hermes-bridge/app-server-client.mjs", import.meta.url),
      "utf8",
    ))
    expect(source).not.toMatch(/codex\s+exec|scripts[\\/]runtime-operator/i)
  })
})
