import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireWorkContext: vi.fn(),
  workContextRefusal: vi.fn(),
  recordLoomStart: vi.fn(),
  recordLoomEnd: vi.fn(),
  poolQuery: vi.fn(),
  connect: vi.fn(),
  readAccount: vi.fn(),
  startThread: vi.fn(),
  resumeThread: vi.fn(),
  runTurn: vi.fn(),
  close: vi.fn(),
  sanitize: vi.fn(),
  onConstruct: vi.fn(),
  clientOptions: [] as unknown[],
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/work-context-gate", () => ({
  requireWorkContext: seams.requireWorkContext,
  workContextRefusal: seams.workContextRefusal,
}))
vi.mock("@/lib/loom/receipts", () => ({
  recordLoomStart: seams.recordLoomStart,
  recordLoomEnd: seams.recordLoomEnd,
}))
vi.mock("@/lib/db", () => ({ pool: { query: seams.poolQuery } }))
vi.mock("@/scripts/hermes-bridge/app-server-client.mjs", () => ({
  CodexAppServerClient: class {
    constructor(options: unknown) {
      seams.clientOptions.push(options)
      seams.onConstruct(options)
    }
    connect = seams.connect
    readAccount = seams.readAccount
    startThread = seams.startThread
    resumeThread = seams.resumeThread
    runTurn = seams.runTurn
    close = seams.close
  },
  sanitizeAppServerText: (value: unknown) => seams.sanitize(value),
}))

import { POST } from "@/app/api/loom/codex/route"
import { loomCodexThreadDescriptor } from "@/lib/loom/threads"

function request(body: Record<string, unknown>, signal?: AbortSignal) {
  return new Request("http://williamos.test/api/loom/codex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
}

async function events(response: Response) {
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

describe("durable Codex delegate route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.clientOptions.length = 0
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.requireWorkContext.mockResolvedValue({ ok: true })
    seams.workContextRefusal.mockReturnValue(Response.json({ error: "FAILED_CONTEXT_NOT_PROVEN" }, { status: 409 }))
    seams.connect.mockResolvedValue(undefined)
    seams.sanitize.mockImplementation((value: unknown) => String(value ?? "")
      .replace(/token-[A-Za-z0-9._-]+/gi, "[REDACTED]"))
    seams.readAccount.mockResolvedValue({ authType: "chatgpt", email: "owner@example.test", requiresOpenaiAuth: false })
    seams.recordLoomStart.mockResolvedValue(undefined)
    seams.recordLoomEnd.mockResolvedValue(undefined)
    seams.startThread.mockResolvedValue("codex-thread-1")
    seams.resumeThread.mockResolvedValue("codex-thread-1")
    seams.runTurn.mockResolvedValue({
      threadId: "codex-thread-1",
      turnId: "turn-1",
      status: "completed",
      finalText: "Implemented the selected change.",
    })
    seams.poolQuery.mockResolvedValue({
      rows: [{ userId: "owner-1", metadata: { provider: "Codex", mode: "delegate", workspace: process.cwd(), committed: true } }],
    })
  })

  it("starts one exact-workspace non-ephemeral Codex Builder turn and emits one strict settlement", async () => {
    const response = await POST(request({ prompt: "Implement the selected change." }))
    const output = await events(response)

    expect(response.status).toBe(200)
    expect(seams.requireWorkContext).toHaveBeenCalledOnce()
    expect(seams.connect).toHaveBeenCalledOnce()
    expect(seams.readAccount).toHaveBeenCalledOnce()
    expect(seams.startThread).toHaveBeenCalledWith({
      cwd: expect.stringMatching(/experience-v2-codex-session$/),
      approvalPolicy: "never",
      sandbox: "workspace-write",
      ephemeral: false,
    })
    expect(seams.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "codex-thread-1",
      prompt: "Implement the selected change.",
      turn: expect.objectContaining({
        approvalPolicy: "never",
        sandboxPolicy: expect.objectContaining({ type: "workspaceWrite" }),
      }),
    }))
    expect(output).toEqual([
      { type: "session", sessionId: "codex-thread-1", provider: "Codex", mode: "delegate", resumed: false },
      { type: "result", text: "Implemented the selected change." },
      { type: "done", reason: null, code: 0 },
    ])
    expect(seams.recordLoomStart).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1",
      kind: "agent",
      subject: "codex-thread-1",
      metadata: expect.objectContaining({ provider: "Codex", mode: "delegate" }),
    }))
    expect(seams.recordLoomEnd).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ provider: "Codex", mode: "delegate", code: 0, reason: null }),
    }))
    expect(seams.close).toHaveBeenCalledOnce()
  })

  it("streams only bounded sanitized agent deltas before the canonical result", async () => {
    seams.runTurn.mockImplementationOnce(async () => {
      const options = seams.clientOptions[0]
      const notify = (options as { onNotification?: (frame: unknown) => void }).onNotification
      notify?.({ method: "item/agentMessage/delta", params: { delta: "token-supersecret" } })
      notify?.({ method: "item/commandExecution/outputDelta", params: { delta: "private command output" } })
      return {
        threadId: "codex-thread-1", turnId: "turn-1", status: "completed",
        finalText: "Implemented the selected change.",
      }
    })

    const response = await POST(request({ prompt: "Work." }))
    const output = await events(response)

    expect(output).toContainEqual({ type: "delta", text: "[REDACTED]" })
    expect(output[0]).toMatchObject({ type: "session" })
    expect(JSON.stringify(output)).not.toContain("private command output")
    expect(output.filter((event) => event.type === "result")).toHaveLength(1)
    expect(output.filter((event) => event.type === "done")).toHaveLength(1)
  })

  it("bounds both streamed deltas and the canonical result", async () => {
    seams.runTurn.mockImplementationOnce(async () => {
      const options = seams.clientOptions[0]
      const notify = (options as { onNotification?: (frame: unknown) => void }).onNotification
      for (let index = 0; index < 10; index += 1) {
        notify?.({ method: "item/agentMessage/delta", params: { delta: "d".repeat(20_000) } })
      }
      return {
        threadId: "codex-thread-1", turnId: "turn-1", status: "completed",
        finalText: "r".repeat(200_000),
      }
    })

    const output = await events(await POST(request({ prompt: "Work." })))
    const streamed = output.filter((event) => event.type === "delta").map((event) => event.text).join("")
    const result = output.find((event) => event.type === "result")

    expect(streamed).toHaveLength(128_000)
    expect(result.text).toHaveLength(128_000)
  })

  it("resumes only an owner-bound Codex delegate in the exact workspace", async () => {
    const response = await POST(request({
      prompt: "Continue.",
      sessionId: "codex-thread-1",
      resume: true,
    }))
    const output = await events(response)

    expect(response.status).toBe(200)
    expect(seams.poolQuery).toHaveBeenCalledWith(expect.stringContaining("loom_codex_ready"), ["codex-thread-1"])
    expect(seams.resumeThread).toHaveBeenCalledWith("codex-thread-1", {
      cwd: expect.stringMatching(/experience-v2-codex-session$/),
      approvalPolicy: "never",
      sandbox: "workspace-write",
    })
    expect(seams.startThread).not.toHaveBeenCalled()
    expect(output[0]).toEqual({
      type: "session", sessionId: "codex-thread-1", provider: "Codex", mode: "delegate", resumed: true,
    })
  })

  it.each([
    ["unknown", [], "THREAD_NOT_FOUND"],
    ["another owner", [{ userId: "owner-2", metadata: { provider: "Codex", mode: "delegate", workspace: process.cwd(), committed: true } }], "THREAD_NOT_YOURS"],
    ["Claude", [{ userId: "owner-1", metadata: { provider: "Claude", mode: "delegate", workspace: process.cwd(), committed: true } }], "THREAD_DESCRIPTOR_MISMATCH"],
    ["review", [{ userId: "owner-1", metadata: { provider: "Codex", mode: "review", workspace: process.cwd(), committed: true } }], "THREAD_DESCRIPTOR_MISMATCH"],
    ["different workspace", [{ userId: "owner-1", metadata: { provider: "Codex", mode: "delegate", workspace: "C:/other", committed: true } }], "THREAD_DESCRIPTOR_MISMATCH"],
  ])("refuses a %s descriptor before connecting", async (_label, rows, error) => {
    seams.poolQuery.mockResolvedValueOnce({ rows })

    const response = await POST(request({ prompt: "Continue.", sessionId: "codex-thread-1", resume: true }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error })
    expect(seams.connect).not.toHaveBeenCalled()
  })

  it("fails closed before connecting when authentication, prompt, or work context is absent", async () => {
    seams.getSession.mockResolvedValueOnce(null)
    expect((await POST(request({ prompt: "Work." }))).status).toBe(401)

    expect((await POST(request({ prompt: "  " }))).status).toBe(400)

    seams.requireWorkContext.mockResolvedValueOnce({ ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN" })
    expect((await POST(request({ prompt: "Work." }))).status).toBe(409)
    expect(seams.connect).not.toHaveBeenCalled()
  })

  it("reports missing Codex sign-in as a typed product failure without persisting a session", async () => {
    seams.readAccount.mockResolvedValueOnce({ authType: null, email: null, requiresOpenaiAuth: true })

    const response = await POST(request({ prompt: "Work." }))
    const output = await events(response)

    expect(output).toEqual([{ type: "done", reason: "CODEX_AUTH_REQUIRED", code: null }])
    expect(seams.startThread).not.toHaveBeenCalled()
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.close).toHaveBeenCalledOnce()
  })

  it("interrupts the active turn on abort, emits no success result, settles once, and always closes", async () => {
    seams.runTurn.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) {
        reject(Object.assign(new Error("cancelled"), { code: "APP_SERVER_CANCELLED" }))
        return
      }
      signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: "APP_SERVER_CANCELLED" })))
    }))
    const abort = new AbortController()
    const response = await POST(request({ prompt: "Work." }, abort.signal))
    abort.abort()

    const output = await events(response)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CANCELLED", code: null })
    expect(output.some((event) => event.type === "result")).toBe(false)
    // An abort can win before thread/start returns. In that case there is no durable subject to
    // receipt, but the stream and provider process must still settle without inventing success.
    if (seams.recordLoomEnd.mock.calls.length > 0) {
      expect(seams.recordLoomEnd).toHaveBeenCalledOnce()
      expect(seams.recordLoomEnd.mock.calls[0][0].outcome).toMatchObject({ code: null, reason: "CANCELLED" })
    }
    expect(seams.close).toHaveBeenCalledOnce()
  })

  it("interrupts before closing when the response reader is cancelled", async () => {
    const order: string[] = []
    seams.runTurn.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) {
        order.push("interrupt")
        reject(Object.assign(new Error("cancelled"), { code: "APP_SERVER_CANCELLED" }))
        return
      }
      signal.addEventListener("abort", () => {
        order.push("interrupt")
        queueMicrotask(() => reject(Object.assign(new Error("cancelled"), { code: "APP_SERVER_CANCELLED" })))
      })
    }))
    seams.close.mockImplementation(() => { order.push("close") })
    const response = await POST(request({ prompt: "Work." }))
    const reader = response.body!.getReader()

    // Read the session frame so turn/start has definitely installed its abort handler.
    await reader.read()
    await reader.cancel()
    await vi.waitFor(() => expect(seams.close).toHaveBeenCalledOnce())

    expect((seams.runTurn.mock.calls[0][0] as { signal: AbortSignal }).signal.aborted).toBe(true)
    expect(order).toEqual(["interrupt", "close"])
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.recordLoomEnd).toHaveBeenCalledOnce()
  })

  it("force-closes a provider that does not settle after response cancellation", async () => {
    vi.useFakeTimers()
    try {
      seams.runTurn.mockImplementationOnce(() => new Promise(() => {}))
      const response = await POST(request({ prompt: "Work." }))
      const reader = response.body!.getReader()
      await reader.read()

      await reader.cancel()
      expect(seams.close).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(seams.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not commit or report success when cancellation lands during the start receipt", async () => {
    const abort = new AbortController()
    seams.recordLoomStart.mockImplementationOnce(async () => { abort.abort() })

    const output = await events(await POST(request({ prompt: "Work." }, abort.signal)))

    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CANCELLED", code: null })
    expect(seams.poolQuery).not.toHaveBeenCalled()
  })

  it("does not enter receipt or success transitions when cancellation lands during sanitization", async () => {
    const abort = new AbortController()
    seams.sanitize.mockImplementationOnce((value: unknown) => {
      abort.abort()
      return String(value ?? "")
    })

    const output = await events(await POST(request({ prompt: "Work." }, abort.signal)))

    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CANCELLED", code: null })
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.poolQuery).not.toHaveBeenCalled()
  })

  it("does not create a committed-ready descriptor when the success end receipt rejects", async () => {
    seams.recordLoomEnd.mockRejectedValueOnce(new Error("ledger unavailable"))

    const output = await events(await POST(request({ prompt: "Work." })))

    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(output.at(-1)).toEqual({ type: "done", reason: "CODEX_RECEIPT_FAILED", code: null })
    expect(seams.recordLoomStart).toHaveBeenCalledOnce()
    expect(seams.poolQuery).not.toHaveBeenCalled()
  })

  it.each([
    [Object.assign(new Error("approval"), { code: "APP_SERVER_APPROVAL_REQUIRED" }), "APP_SERVER_APPROVAL_REQUIRED"],
    [Object.assign(new Error("input"), { code: "APP_SERVER_USER_INPUT_REQUIRED" }), "APP_SERVER_USER_INPUT_REQUIRED"],
    [Object.assign(new Error("tool"), { code: "APP_SERVER_EXTERNAL_TOOL_WALL" }), "APP_SERVER_EXTERNAL_TOOL_WALL"],
    [Object.assign(new Error("You've hit your usage limit token-secret"), { code: "APP_SERVER_TURN_FAILED", usageLimit: true }), "USAGE_LIMIT_EXCEEDED"],
  ])("settles a provider wall truthfully without a result", async (failure, reason) => {
    seams.runTurn.mockRejectedValueOnce(failure)

    const response = await POST(request({ prompt: "Work." }))
    const output = await events(response)

    expect(output.filter((event) => event.type === "result")).toHaveLength(0)
    expect(output.at(-1)).toEqual({ type: "done", reason, code: null })
    expect(JSON.stringify(output)).not.toContain("token-secret")
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.close).toHaveBeenCalledOnce()
  })
})

describe("Codex thread descriptor", () => {
  it("reads owner, provider, mode, and workspace only from the committed-ready event", async () => {
    seams.poolQuery.mockResolvedValueOnce({
      rows: [{ userId: "owner-1", metadata: { provider: "Codex", mode: "delegate", workspace: "C:/workspace", committed: true } }],
    })

    await expect(loomCodexThreadDescriptor("codex-thread-1")).resolves.toEqual({
      owner: "owner-1", provider: "Codex", mode: "delegate", workspace: "C:/workspace",
    })
    expect(seams.poolQuery.mock.calls.at(-1)?.[0]).toContain("loom_codex_ready")
  })

  it("refuses a malformed ready event that was never marked committed", async () => {
    seams.poolQuery.mockResolvedValueOnce({
      rows: [{ userId: "owner-1", metadata: { provider: "Codex", mode: "delegate", workspace: "C:/workspace" } }],
    })

    await expect(loomCodexThreadDescriptor("codex-thread-1")).resolves.toBeNull()
  })
})
