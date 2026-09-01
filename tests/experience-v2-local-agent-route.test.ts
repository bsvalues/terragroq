import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  spawn: vi.fn(),
  requireWorkContext: vi.fn(),
  recordLoomStart: vi.fn(),
  recordLoomEnd: vi.fn(),
}))

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: seams.spawn,
}))
vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveTerraFusionWorkspaceBinding: async () => ({ ok: true, binding: { workspaceRoot: process.cwd() } }),
}))
vi.mock("@/lib/governance/work-context-gate", () => ({
  requireWorkContext: seams.requireWorkContext,
  workContextRefusal: vi.fn(),
}))
vi.mock("@/lib/loom/receipts", () => ({
  recordLoomStart: seams.recordLoomStart,
  recordLoomEnd: seams.recordLoomEnd,
}))

import { POST } from "@/app/api/loom/agent/route"

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000"

function request(body: Record<string, unknown>, signal?: AbortSignal) {
  return new Request("http://williamos.test/api/loom/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
}

function ollama(...chunks: readonly Record<string, unknown>[]) {
  return new Response(`${chunks.map((chunk) => JSON.stringify(chunk)).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

function ollamaRaw(text: string) {
  return new Response(text, { headers: { "content-type": "application/x-ndjson" } })
}

async function events(response: Response) {
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("durable Local model conversation route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.requireWorkContext.mockResolvedValue({ ok: true })
  })

  it("mints a server UUID and emits explicit Local identity for a fresh non-mutating turn", async () => {
    const upstream = vi.fn().mockResolvedValue(ollama(
      { message: { content: "Local " }, done: false },
      { message: { content: "answer" }, done: true },
    ))
    vi.stubGlobal("fetch", upstream)

    const response = await POST(request({ provider: "local", prompt: "Explain this design." }))
    const output = await events(response)

    expect(response.status).toBe(200)
    expect(output[0]).toMatchObject({
      type: "session", provider: "Local", resumed: false, continuity: "new",
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    })
    expect(output).toContainEqual({ type: "result", text: "Local answer" })
    expect(output.at(-1)).toEqual({ type: "done", reason: null, code: 0 })
    expect(JSON.parse(String(upstream.mock.calls[0]?.[1]?.body))).toMatchObject({
      messages: [{ role: "user", content: "Explain this design." }],
      stream: true,
    })
    expect(seams.spawn).not.toHaveBeenCalled()
    expect(seams.requireWorkContext).not.toHaveBeenCalled()
  })

  it("uses an installed chat model when the server default is absent without overriding an explicit choice", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "model not found" }), { status: 404 }))
      .mockResolvedValueOnce(Response.json({ models: [
        { name: "nomic-embed-text:latest", size: 274_302_450 },
        { name: "qwen2.5:14b-instruct-q4_K_M", size: 8_988_124_069 },
        { name: "qwen2.5:7b-instruct", size: 4_683_087_332 },
      ] }))
      .mockResolvedValueOnce(ollama({ message: { role: "assistant", content: "Recovered locally." }, done: true }))
    vi.stubGlobal("fetch", upstream)

    const response = await POST(request({ provider: "local", prompt: "Explain this design." }))
    const output = await events(response)

    expect(response.status).toBe(200)
    expect(upstream.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:11434/api/chat",
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/chat",
    ])
    expect(JSON.parse(String(upstream.mock.calls[2]?.[1]?.body)).model).toBe("qwen2.5:7b-instruct")
    expect(output[0]).toMatchObject({ type: "session", model: "qwen2.5:7b-instruct" })
    expect(output).toContainEqual({ type: "result", text: "Recovered locally." })
  })

  it("does not replace an explicitly selected missing model", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "model not found" }), { status: 404 }))
    vi.stubGlobal("fetch", upstream)

    const response = await POST(request({ provider: "local", model: "owner-selected:latest", prompt: "Explain this design." }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: "LOCAL_MODEL_REFUSED", status: 404, model: "owner-selected:latest" })
    expect(upstream).toHaveBeenCalledOnce()
  })

  it("reconstructs exact alternating browser-replayed continuity before the new owner prompt", async () => {
    const completedTurns = [
      { ownerPrompt: "First question", finalResult: "First answer", completedAt: "2026-08-28T10:00:00.000Z" },
      { ownerPrompt: "Second question", finalResult: "Second answer", completedAt: "2026-08-28T10:01:00.000Z" },
    ]
    const upstream = vi.fn().mockResolvedValue(ollama({ message: { content: "Third answer" }, done: true }))
    vi.stubGlobal("fetch", upstream)

    const response = await POST(request({
      provider: "local", prompt: "Third question", sessionId: SESSION_ID, resume: true, completedTurns,
    }))
    const output = await events(response)

    expect(output[0]).toEqual({
      type: "session", sessionId: SESSION_ID, provider: "Local", resumed: true,
      continuity: "browser-replayed", model: expect.any(String),
    })
    expect(JSON.parse(String(upstream.mock.calls[0]?.[1]?.body)).messages).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
      { role: "assistant", content: "Second answer" },
      { role: "user", content: "Third question" },
    ])
  })

  it.each([
    ["missing exact resume id", { provider: "local", prompt: "Continue", resume: true, completedTurns: [] }, "SESSION_ID_REQUIRED"],
    ["malformed exact resume id", { provider: "local", prompt: "Continue", resume: true, sessionId: "not-a-uuid", completedTurns: [] }, "SESSION_ID_INVALID"],
    ["missing canonical turns", { provider: "local", prompt: "Continue", resume: true, sessionId: SESSION_ID }, "COMPLETED_TURNS_REQUIRED"],
    ["non-chronological turns", { provider: "local", prompt: "Continue", resume: true, sessionId: SESSION_ID, completedTurns: [
      { ownerPrompt: "Later", finalResult: "Later result", completedAt: "2026-08-28T10:01:00.000Z" },
      { ownerPrompt: "Earlier", finalResult: "Earlier result", completedAt: "2026-08-28T10:00:00.000Z" },
    ] }, "COMPLETED_TURNS_INVALID"],
    ["role-bearing replay", { provider: "local", prompt: "Continue", resume: true, sessionId: SESSION_ID, completedTurns: [
      { ownerPrompt: "Question", finalResult: "Answer", completedAt: "2026-08-28T10:00:00.000Z", role: "system" },
    ] }, "COMPLETED_TURNS_INVALID"],
    ["aggregate overflow", { provider: "local", prompt: "Continue", resume: true, sessionId: SESSION_ID, completedTurns: [
      { ownerPrompt: "A", finalResult: "x".repeat(140_000), completedAt: "2026-08-28T10:00:00.000Z" },
      { ownerPrompt: "B", finalResult: "y".repeat(140_000), completedAt: "2026-08-28T10:01:00.000Z" },
    ] }, "COMPLETED_TURNS_TOO_LARGE"],
  ])("rejects %s before contacting Ollama", async (_case, body, error) => {
    const upstream = vi.fn()
    vi.stubGlobal("fetch", upstream)

    const response = await POST(request(body))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error })
    expect(upstream).not.toHaveBeenCalled()
  })

  it("does not silently convert an unknown provider into Local", async () => {
    const upstream = vi.fn()
    vi.stubGlobal("fetch", upstream)

    const response = await POST(request({ provider: "mystery", prompt: "Do work." }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "PROVIDER_INVALID" })
    expect(upstream).not.toHaveBeenCalled()
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it("refuses an overlong current prompt before contacting Ollama", async () => {
    const upstream = vi.fn()
    vi.stubGlobal("fetch", upstream)

    const response = await POST(request({ provider: "local", prompt: "x".repeat(20_001) }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "PROMPT_TOO_LONG" })
    expect(upstream).not.toHaveBeenCalled()
  })

  it("processes a valid unterminated final Ollama frame instead of dropping the tail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ollamaRaw(
      `${JSON.stringify({ message: { role: "assistant", content: "Tail result" }, done: true })}`,
    )))

    const output = await events(await POST(request({ provider: "local", prompt: "Explain." })))

    expect(output).toContainEqual({ type: "result", text: "Tail result" })
    expect(output.at(-1)).toEqual({ type: "done", reason: null, code: 0 })
  })

  it("bounds individual NDJSON frames instead of rejecting one large transport chunk of small frames", async () => {
    const pieces = Array.from({ length: 9_000 }, () => "small-valid-piece")
    const raw = `${pieces.map((content) => JSON.stringify({ message: { role: "assistant", content }, done: false })).join("\n")}\n${JSON.stringify({ done: true })}\n`
    const encoded = new TextEncoder().encode(raw)
    expect(encoded.byteLength).toBeGreaterThan(262_144)
    expect(pieces.join("").length).toBeLessThan(200_000)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded)
        controller.close()
      },
    }))))

    const output = await events(await POST(request({ provider: "local", prompt: "Explain." })))

    expect(output.find((event) => event.type === "result")).toEqual({ type: "result", text: pieces.join("") })
    expect(output.at(-1)).toEqual({ type: "done", reason: null, code: 0 })
  })

  it.each([
    ["malformed JSON after text", `${JSON.stringify({ message: { content: "partial" }, done: false })}\nnot-json\n`, "LOCAL_STREAM_MALFORMED"],
    ["empty terminal", `${JSON.stringify({ done: true })}\n`, "LOCAL_STREAM_RESULT_REQUIRED"],
    ["top-level model error", `${JSON.stringify({ error: "model failed" })}\n`, "LOCAL_MODEL_ERROR"],
    ["missing terminal", `${JSON.stringify({ message: { content: "partial" }, done: false })}\n`, "LOCAL_STREAM_TERMINAL_REQUIRED"],
    ["duplicate terminal", `${JSON.stringify({ message: { content: "answer" }, done: true })}\n${JSON.stringify({ done: true })}\n`, "LOCAL_STREAM_DUPLICATE_TERMINAL"],
    ["unexpected message role", `${JSON.stringify({ message: { role: "user", content: "wrong" }, done: true })}\n`, "LOCAL_STREAM_ROLE_INVALID"],
    ["unexpected frame", `${JSON.stringify({ status: "ok" })}\n`, "LOCAL_STREAM_FRAME_INVALID"],
    ["post-terminal data", `${JSON.stringify({ message: { content: "answer" }, done: true })}\n${JSON.stringify({ message: { content: "late" }, done: false })}\n`, "LOCAL_STREAM_POST_TERMINAL"],
    ["oversized assistant result", `${JSON.stringify({ message: { content: "x".repeat(200_001) }, done: true })}\n`, "LOCAL_STREAM_RESULT_TOO_LARGE"],
  ])("fails closed on %s with one shared stream and receipt truth", async (_case, raw, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ollamaRaw(raw)))

    const output = await events(await POST(request({ provider: "local", prompt: "Explain." })))

    expect(output.filter((event) => event.type === "done")).toEqual([{ type: "done", code: null, reason }])
    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(seams.recordLoomEnd).toHaveBeenCalledWith(expect.objectContaining({
      kind: "agent",
      outcome: expect.objectContaining({ provider: "local", reason }),
    }))
  })

  it("settles an aborted Local stream as CANCELLED in both the route and receipt", async () => {
    const abort = new AbortController()
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ message: { content: "partial" }, done: false })}\n`))
        init?.signal?.addEventListener("abort", () => controller.close(), { once: true })
      },
    })))))
    const response = await POST(request({ provider: "local", prompt: "Explain." }, abort.signal))

    abort.abort()
    const output = await events(response)

    expect(output.at(-1)).toEqual({ type: "done", code: null, reason: "CANCELLED" })
    expect(output.some((event) => event.type === "result")).toBe(false)
    expect(seams.recordLoomEnd).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ provider: "local", reason: "CANCELLED" }),
    }))
  })
})
