// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AgentThread } from "@/components/loom/agent-thread"
import { WorkbenchContextProvider } from "@/components/workbench/workbench-context"

const SESSION_ID = "723e4567-e89b-42d3-a456-426614174000"

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn()
})

function ndjson(...events: readonly (Record<string, unknown> | string)[]): Response {
  return new Response(`${events.map((event) => typeof event === "string" ? event : JSON.stringify(event)).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

function localTurn(result: string, reason: string | null = null, resumed = false) {
  return ndjson(
    { type: "session", sessionId: SESSION_ID, provider: "Local", resumed, continuity: resumed ? "browser-replayed" : "new" },
    { type: "delta", text: result },
    { type: "result", text: result },
    { type: "done", reason, code: reason ? null : 0 },
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function submit(text: string) {
  fireEvent.change(screen.getByPlaceholderText("What do you want done?"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy())
}

describe("Loom Local conversation continuity", () => {
  it("sends the selected WilliamOS project for server-derived Workroom grounding", async () => {
    const agentBodies: Record<string, unknown>[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/loom/models") return Response.json({ models: [], default: "" })
      agentBodies.push(JSON.parse(String(init?.body)))
      return localTurn("WilliamOS context")
    }))
    render(
      <WorkbenchContextProvider value={{
        focusThread: () => undefined,
        selectedProject: { id: 7, key: "williamos", name: "WilliamOS" },
      }}>
        <AgentThread />
      </WorkbenchContextProvider>,
    )

    await submit("Identify this project")

    expect(agentBodies[0]).toMatchObject({ projectKey: "williamos", provider: "local" })
  })

  it("replays the prior canonical completed Local turn on the second request without changing the first request shape", async () => {
    const agentBodies: Record<string, unknown>[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/loom/models") return Response.json({ models: [], default: "" })
      agentBodies.push(JSON.parse(String(init?.body)))
      return agentBodies.length === 1 ? localTurn("First canonical answer") : localTurn("Second canonical answer")
    }))
    render(<AgentThread />)

    await submit("First owner prompt")
    await submit("Second owner prompt")

    expect(agentBodies[0]).toEqual({ prompt: "First owner prompt", sessionId: null, resume: false, provider: "local", model: "" })
    expect(agentBodies[1]).toEqual({
      prompt: "Second owner prompt",
      sessionId: SESSION_ID,
      resume: true,
      provider: "local",
      model: "",
      completedTurns: [{
        ownerPrompt: "First owner prompt",
        finalResult: "First canonical answer",
        completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }],
    })
  })

  it.each([
    ["malformed", ndjson(
      { type: "session", sessionId: SESSION_ID, provider: "Local", resumed: false, continuity: "new" },
      "not-json",
      { type: "result", text: "must not persist" },
      { type: "done", reason: null, code: 0 },
    )],
    ["failed", localTurn("must not persist", "LOCAL_MODEL_ERROR")],
    ["cancelled", localTurn("must not persist", "CANCELLED")],
  ])("does not replay a %s Local turn as canonical history", async (_case, firstResponse) => {
    const agentBodies: Record<string, unknown>[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/loom/models") return Response.json({ models: [], default: "" })
      agentBodies.push(JSON.parse(String(init?.body)))
      return agentBodies.length === 1 ? firstResponse : localTurn("Recovery answer")
    }))
    render(<AgentThread />)

    await submit("Unsettled owner prompt")
    await submit("Recovery prompt")

    expect(agentBodies[1]).toMatchObject({ provider: "local", resume: true, completedTurns: [] })
  })

  it("keeps only the newest twenty canonical Local turns, matching the route count bound", async () => {
    const agentBodies: Record<string, unknown>[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/loom/models") return Response.json({ models: [], default: "" })
      agentBodies.push(JSON.parse(String(init?.body)))
      return localTurn(`answer-${agentBodies.length}`, null, agentBodies.length > 1)
    }))
    render(<AgentThread />)

    for (let turn = 1; turn <= 22; turn += 1) await submit(`prompt-${turn}`)

    const replay = agentBodies[21].completedTurns as Array<Record<string, unknown>>
    expect(replay).toHaveLength(20)
    expect(replay[0]).toMatchObject({ ownerPrompt: "prompt-2", finalResult: "answer-2" })
    expect(replay.at(-1)).toMatchObject({ ownerPrompt: "prompt-21", finalResult: "answer-21" })
  })

  it("prunes the oldest Local turn when canonical replay JSON would exceed 262 KiB", async () => {
    const agentBodies: Record<string, unknown>[] = []
    const largeResults = ["x".repeat(131_000), "y".repeat(131_000), "settled"]
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/loom/models") return Response.json({ models: [], default: "" })
      agentBodies.push(JSON.parse(String(init?.body)))
      const index = agentBodies.length - 1
      return ndjson(
        { type: "session", sessionId: SESSION_ID, provider: "Local", resumed: index > 0, continuity: index > 0 ? "browser-replayed" : "new" },
        { type: "result", text: largeResults[index] },
        { type: "done", reason: null, code: 0 },
      )
    }))
    render(<AgentThread />)

    await submit("first")
    await submit("second")
    await submit("third")

    const replay = agentBodies[2].completedTurns as Array<Record<string, unknown>>
    expect(new TextEncoder().encode(JSON.stringify(replay)).byteLength).toBeLessThanOrEqual(262_144)
    expect(replay).toHaveLength(1)
    expect(replay[0]).toMatchObject({ ownerPrompt: "second", finalResult: largeResults[1] })
  })
})
