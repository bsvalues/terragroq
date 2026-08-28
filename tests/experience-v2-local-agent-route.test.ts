import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  spawn: vi.fn(),
  requireWorkContext: vi.fn(),
  recordLoomStart: vi.fn(),
  recordLoomEnd: vi.fn(),
}))

vi.mock("node:child_process", () => ({ spawn: seams.spawn }))
vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
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
})
