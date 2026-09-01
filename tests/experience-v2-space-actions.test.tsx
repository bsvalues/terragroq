// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const CLAUDE_REVIEW_ID = "123e4567-e89b-42d3-a456-426614174000"
const LOCAL_ID = "223e4567-e89b-42d3-a456-426614174000"
const SESSION_KEY = "williamos:agent-session:world-a:c%3A%2Frepos%2Fterrafusion"

vi.mock("next/dynamic", () => ({
  default: () => function Editor() { return <textarea aria-label="Source content" readOnly /> },
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Experience V2 selected Space actions", () => {
  it("summarizes the exact Space in one click without exposing a second editable prompt", async () => {
    const serverSpace = spaceToServer({
      ...defaultSpace(1440, 900, "world-a", "TerraFusion"),
      activeWindowId: null,
    })
    const requests: Record<string, unknown>[] = []
    let resolveSummary!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-08-30T05:00:00.000Z" })
      }
      if (url === "/api/environment/line") {
        requests.push(JSON.parse(String(init?.body)))
        return new Promise<Response>((resolve) => { resolveSummary = resolve })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Summarize" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    const input = within(line).getByRole("textbox", { name: "The Line" }) as HTMLInputElement
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(input.value).toBe("")
    expect(input.disabled).toBe(true)
    expect(within(line).getByText("Exact current Space · server-grounded · read-only")).toBeTruthy()
    expect((within(line).getByRole("button", { name: "Working" }) as HTMLButtonElement).disabled).toBe(true)
    expect(requests[0]).toEqual({
      worldId: "world-a",
      text: "Summarize this exact current Space.",
      lineContext: "space-summary",
    })
    resolveSummary(Response.json({ worldId: "world-a", say: "Grounded summary", surfaces: [], spine: EMPTY_SPINE }))
    expect(await screen.findByText("Grounded summary")).toBeTruthy()
    fireEvent.submit(within(line).getByRole("form", { name: "The Line" }))
    expect(requests).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    const genericLine = screen.getByRole("dialog", { name: "The Line" })
    const genericInput = within(genericLine).getByRole("textbox", { name: "The Line" })
    fireEvent.change(genericInput, { target: { value: "A separate ordinary question." } })
    fireEvent.click(within(genericLine).getByRole("button", { name: "Send" }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toEqual({ worldId: "world-a", text: "A separate ordinary question." })
  })

  it("keeps a pending summary bound to its exact Space by refusing cross-Space re-entry", async () => {
    const worldA = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "Alpha"), activeWindowId: null })
    const worldB = spaceToServer({ ...defaultSpace(1440, 900, "world-b", "Beta"), activeWindowId: null })
    const spaces = [
      { worldId: "world-a", name: "Alpha", space: worldA, updatedAt: "2026-08-30T05:00:00.000Z" },
      { worldId: "world-b", name: "Beta", space: worldB, updatedAt: "2026-08-30T05:01:00.000Z" },
    ]
    let resolveSummary!: (response: Response) => void
    let betaReads = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "Alpha", space: worldA, spaces, multiSpaceAvailable: true,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/environment/space?worldId=world-b" && !init?.method) {
        betaReads += 1
        return Response.json({
          worldId: "world-b", name: "Beta", space: worldB, spaces, multiSpaceAvailable: true,
          project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server", spine: EMPTY_SPINE,
        })
      }
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-08-30T05:01:00.000Z" })
      }
      if (url === "/api/environment/line") return new Promise<Response>((resolve) => { resolveSummary = resolve })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Summarize" }))
    await waitFor(() => expect(resolveSummary).toBeTypeOf("function"))
    fireEvent.click(screen.getByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    expect(await screen.findByText("Finish or stop active work before switching Spaces.")).toBeTruthy()
    expect(betaReads).toBe(0)

    resolveSummary(Response.json({ worldId: "world-a", say: "EXACT ALPHA SUMMARY", surfaces: [], spine: EMPTY_SPINE }))
    expect(await screen.findByText("EXACT ALPHA SUMMARY")).toBeTruthy()
    expect(betaReads).toBe(0)
  })

  it("truthfully disables Continue when this Space has no durable session", async () => {
    const requests: string[] = []
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push(url)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const unavailable = await screen.findByRole("button", { name: "Continue unavailable" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(screen.getByText("No durable session exists in this Space; use Delegate.")).toBeTruthy()
    expect(requests).not.toContain("/api/environment/line")
  })

  it.each([
    ["corrupt", "{not-json", "Saved durable sessions are corrupt, so Continue cannot verify an exact session."],
    ["oversized", "x".repeat(262_145), "Saved durable sessions exceed the safe storage limit, so Continue cannot verify an exact session."],
    ["partial", JSON.stringify({ schemaVersion: 3, selectedSessionKey: null, sessions: [
      { schemaVersion: 1, sessionId: LOCAL_ID, role: "Thinker", provider: "Local", assignment: "Conversation", updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [] },
      { schemaVersion: 1, sessionId: "codex-partial", role: "Builder", provider: "Codex", assignment: "Broken", target: { kind: "file", path: "./unsafe" }, updatedAt: "2026-08-30T05:19:00.000Z", completedTurns: [] },
    ] }), "Saved durable-session collection integrity is partial, so Continue cannot verify an exact session."],
  ] as const)("describes %s durable-session storage truthfully instead of claiming no session exists", async (_state, stored, message) => {
    window.localStorage.setItem(SESSION_KEY, stored)
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const unavailable = await screen.findByRole("button", { name: "Continue unavailable" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    await waitFor(() => expect(unavailable.title).toBe(message))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByText("No durable session exists in this Space; use Delegate.")).toBeNull()
  })

  it("describes unavailable durable-session storage truthfully instead of claiming no session exists", async () => {
    const availableStorage = window.localStorage
    vi.stubGlobal("localStorage", {
      get length() { return availableStorage.length },
      clear: () => availableStorage.clear(),
      getItem: (key: string) => {
        if (key === SESSION_KEY) throw new DOMException("blocked", "SecurityError")
        return availableStorage.getItem(key)
      },
      key: (index: number) => availableStorage.key(index),
      removeItem: (key: string) => availableStorage.removeItem(key),
      setItem: (key: string, value: string) => availableStorage.setItem(key, value),
    })
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const message = "Durable-session storage is unavailable, so Continue cannot verify an exact session."
    const unavailable = await screen.findByRole("button", { name: "Continue unavailable" }) as HTMLButtonElement
    await waitFor(() => expect(unavailable.title).toBe(message))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByText("No durable session exists in this Space; use Delegate.")).toBeNull()
  })

  it("continues the exact selected durable Reviewer instead of a newer session and appends its transcript", async () => {
    const newerLocal = {
      schemaVersion: 1, sessionId: LOCAL_ID, role: "Thinker", provider: "Local", assignment: "Conversation",
      updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }
    const selectedReviewer = {
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts",
      reviewPath: "src/app.ts", updatedAt: "2026-08-30T05:10:00.000Z",
      completedTurns: [{ ownerPrompt: "Review it.", finalResult: "Saved review", completedAt: "2026-08-30T05:10:00.000Z" }],
    }
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      schemaVersion: 3, selectedSessionKey: `Claude:${CLAUDE_REVIEW_ID}`, sessions: [newerLocal, selectedReviewer],
    }))
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return new Response(`${[
          { type: "session", sessionId: CLAUDE_REVIEW_ID, provider: "Claude", mode: "review", resumed: true },
          { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: CLAUDE_REVIEW_ID, result: "Continued selected review." } },
          { type: "done", code: 0, reason: null },
        ].map((frame) => JSON.stringify(frame)).join("\n")}\n`)
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    expect(within(line).getByText("Continue · Reviewer · Claude · Review src/app.ts · verification pending")).toBeTruthy()
    const input = within(line).getByRole("textbox", { name: "The Line" })
    fireEvent.change(input, { target: { value: "Recheck the exact owner boundary." } })
    fireEvent.click(within(line).getByRole("button", { name: "Continue session" }))

    expect(await within(line).findByText("Continued selected review.")).toBeTruthy()
    expect(requests).toEqual([{ url: "/api/loom/agent", body: {
      mode: "review", path: "src/app.ts", focus: "Recheck the exact owner boundary.", provider: "cloud",
      sessionId: CLAUDE_REVIEW_ID, resume: true,
    } }])
    expect(JSON.parse(String(window.localStorage.getItem(SESSION_KEY))).sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: CLAUDE_REVIEW_ID,
        completedTurns: [
          expect.objectContaining({ finalResult: "Saved review" }),
          expect.objectContaining({ finalResult: "Continued selected review." }),
        ],
      }),
      expect.objectContaining({ sessionId: LOCAL_ID, completedTurns: [] }),
    ]))
  })

  it("chooses the deterministic most-recent session when no valid durable selection exists", async () => {
    const first = "323e4567-e89b-42d3-a456-426614174000"
    const second = "423e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ schemaVersion: 3, selectedSessionKey: null, sessions: [
      { schemaVersion: 1, sessionId: second, role: "Builder", provider: "Claude", assignment: "Second lexical key", updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [] },
      { schemaVersion: 1, sessionId: first, role: "Builder", provider: "Claude", assignment: "First lexical key", updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [] },
    ] }))
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    expect(screen.getByText("Continue · Builder · Claude · First lexical key · verification pending")).toBeTruthy()
  })

  it("focuses an already-running candidate without dispatching a duplicate turn", async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ schemaVersion: 3, selectedSessionKey: `Local:${LOCAL_ID}`, sessions: [{
      schemaVersion: 1, sessionId: LOCAL_ID, role: "Thinker", provider: "Local", assignment: "Conversation",
      updatedAt: "2026-08-30T05:20:00.000Z",
      completedTurns: [{ ownerPrompt: "Think.", finalResult: "Saved thought", completedAt: "2026-08-30T05:20:00.000Z" }],
    }] }))
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const agentRequests: Record<string, unknown>[] = []
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        agentRequests.push(JSON.parse(String(init.body)))
        return new Response(new ReadableStream<Uint8Array>({ start(value) {
          controller = value
          value.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: LOCAL_ID, provider: "Local", mode: "delegate", resumed: true, continuity: "browser-replayed" })}\n`))
        } }))
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Keep thinking." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))
    await screen.findByRole("button", { name: "Stop Local Thinker turn" })
    fireEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    expect(screen.getByText("Local conversation · no workspace mutation")).toBeTruthy()
    expect(agentRequests).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Pause" }))
  })

  it("reattaches to a pending Reviewer without invalidating its presentation owner and shows natural settlement", async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ schemaVersion: 3, selectedSessionKey: `Claude:${CLAUDE_REVIEW_ID}`, sessions: [{
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts",
      reviewPath: "src/app.ts", updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }] }))
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const agentRequests: Record<string, unknown>[] = []
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        agentRequests.push(JSON.parse(String(init.body)))
        return new Response(new ReadableStream<Uint8Array>({ start(value) {
          controller = value
          value.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: CLAUDE_REVIEW_ID, provider: "Claude", mode: "review", resumed: true })}\n`))
        } }))
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Recheck it." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))
    await screen.findByRole("button", { name: "Stop Claude Reviewer turn" })
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByText("Reviewer · Claude · src/app.ts · read-only")).toBeTruthy()
    expect(agentRequests).toHaveLength(1)

    controller.enqueue(encoder.encode(`${JSON.stringify({ type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: CLAUDE_REVIEW_ID, result: "Natural Reviewer settlement." } })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
    controller.close()

    expect(await screen.findByText("Natural Reviewer settlement.")).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop Claude Reviewer turn" })).toBeNull())
    const send = screen.getByRole("button", { name: "Send to Reviewer" }) as HTMLButtonElement
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "A next exact question." } })
    await waitFor(() => expect(send.disabled).toBe(false))
    expect(agentRequests).toHaveLength(1)
  })
})
