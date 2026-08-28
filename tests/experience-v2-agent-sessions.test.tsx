// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AgentSessionStrip,
  useExperienceAgentSessions,
  type ProviderNeutralAgentSessionController,
} from "@/components/workspace-shell/agent-sessions"
import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"
import type { WorldWorker } from "@/lib/environment/working-world"

const OWNER_SCOPE = "owner-1"
const WORLD_SCOPE = "terrafusion"

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor(props: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Source content" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  },
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function ndjson(...events: readonly Record<string, unknown>[]): Response {
  return new Response(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

function workspaceResponse(storage: "browser" | "server" = "browser") {
  const space = {
    ...defaultSpace(), selectedPath: "src/app.ts", activeWindowId: "editor" as const,
    editor: { openFiles: ["src/app.ts", "src/other.ts"], panes: [{ id: "primary" as const, activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }], activePaneId: "primary" as const },
  }
  return Response.json({ worldId: storage === "server" ? "server-world" : "browser-world", space: spaceToServer(space), spine: EMPTY_SPINE, project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage, browserStorageKey: storage === "browser" ? "codex-delegate-test" : null })
}

function Harness({ worker = null, ownerScope = OWNER_SCOPE, worldScope = WORLD_SCOPE, worldId = "world-1" }: { worker?: WorldWorker | null; ownerScope?: string; worldScope?: string; worldId?: string | null }) {
  const controller = useExperienceAgentSessions({ ownerScope, worldScope, worldId, worker })
  expose = controller
  return (
    <AgentSessionStrip
      sessions={controller.sessions}
      runningSessionId={controller.activeSessionId}
      runningProvider={controller.activeProvider}
      onStop={controller.stop}
    />
  )
}

let expose: ProviderNeutralAgentSessionController | null = null

describe("Experience V2 real agent sessions", () => {
  it("migrates the legacy v1 descriptor into a selected bounded collection without claiming it is live", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      sessionId,
      role: "Reviewer",
      provider: "Claude",
      assignment: "Review src/app.ts",
      reviewPath: "src/app.ts",
      updatedAt: "2026-08-27T16:05:00.000Z",
    }))

    render(<Harness />)

    await waitFor(() => expect(expose!.savedSessions).toHaveLength(1))
    expect(expose!.selectedSessionKey).toBe(`Claude:${sessionId}`)
    expect(expose!.sessions).toEqual([expect.objectContaining({ id: `Claude:${sessionId}`, truth: "resume-unverified", status: "resume unverified" })])
    expect(JSON.parse(String(window.localStorage.getItem(key)))).toEqual({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${sessionId}`,
      sessions: [{
        schemaVersion: 1,
        sessionId,
        role: "Reviewer",
        provider: "Claude",
        assignment: "Review src/app.ts",
        reviewPath: "src/app.ts",
        updatedAt: "2026-08-27T16:05:00.000Z",
        completedTurns: [],
      }],
    })
  })

  it("upserts a completed session without replacing unrelated durable sessions and persists only canonical transcript truth", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const priorId = "123e4567-e89b-42d3-a456-426614174000"
    const nextId = "323e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      selectedSessionId: priorId,
      sessions: [{ schemaVersion: 1, sessionId: priorId, role: "Reviewer", provider: "Claude", assignment: "Review src/old.ts", reviewPath: "src/old.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [] }],
    }))
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: nextId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "delta", text: "ephemeral delta" },
      { type: "result", text: "Canonical final result" },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(1))

    act(() => expose!.selectSession(null))
    await act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/new.ts", prompt: "Owner canonical prompt" })
    })

    const stored = JSON.parse(String(window.localStorage.getItem(key)))
    expect(stored.selectedSessionKey).toBe(`Codex:${nextId}`)
    expect(stored.sessions).toHaveLength(2)
    expect(stored.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([priorId, nextId])
    expect(stored.sessions[1].completedTurns).toEqual([{ ownerPrompt: "Owner canonical prompt", finalResult: "Canonical final result", completedAt: expect.any(String) }])
    expect(JSON.stringify(stored)).not.toContain("ephemeral delta")
    expect(JSON.stringify(stored)).not.toContain("stderr")
    expect(JSON.stringify(stored)).not.toContain("reasoning")
  })

  it("persists the exact selected restored session and exposes only its canonical final result for inspection", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const firstId = "123e4567-e89b-42d3-a456-426614174000"
    const secondId = "223e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      selectedSessionId: firstId,
      sessions: [
        { schemaVersion: 1, sessionId: firstId, role: "Builder", provider: "Claude", assignment: "src/first.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [{ ownerPrompt: "First prompt", finalResult: "First final", completedAt: "2026-08-27T16:05:00.000Z" }] },
        { schemaVersion: 1, sessionId: secondId, role: "Builder", provider: "Codex", assignment: "src/second.ts", updatedAt: "2026-08-27T16:06:00.000Z", completedTurns: [{ ownerPrompt: "Second prompt", finalResult: "Second final", completedAt: "2026-08-27T16:06:00.000Z" }] },
      ],
    }))
    render(<Harness />)
    await waitFor(() => expect(expose!.sessions).toHaveLength(2))

    act(() => expose!.selectSession(`Codex:${secondId}`))

    expect(expose!.selectedSessionKey).toBe(`Codex:${secondId}`)
    expect(expose!.sessions.find((session) => session.id === `Codex:${secondId}`)?.lastResult).toBe("Second final")
    expect(JSON.parse(String(window.localStorage.getItem(key))).selectedSessionKey).toBe(`Codex:${secondId}`)
  })

  it("keeps a restored Codex transcript inspectable when missing authority fails resume closed with 409", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessionId = "codex-thread-owned-snapshot"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      selectedSessionId: sessionId,
      sessions: [{
        schemaVersion: 1,
        sessionId,
        role: "Builder",
        provider: "Codex",
        assignment: "src/app.ts",
        updatedAt: "2026-08-27T16:05:00.000Z",
        completedTurns: [{ ownerPrompt: "Fix it", finalResult: "Prior canonical result", completedAt: "2026-08-27T16:05:00.000Z" }],
      }],
    }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing work context", { status: 409 })))
    render(<Harness />)
    await waitFor(() => expect(expose!.sessions).toHaveLength(1))

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Continue safely" })
    })).rejects.toThrow("AGENT_START_REFUSED:409")

    expect(expose!.sessions).toEqual([expect.objectContaining({
      id: `Codex:${sessionId}`,
      truth: "resume-unverified",
      lastResult: "Prior canonical result",
    })])
    expect(JSON.parse(String(window.localStorage.getItem(key))).sessions).toHaveLength(1)
  })

  it("does not promote an unverified restored session to live when its resume attempt is stopped", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, sessionId, role: "Builder", provider: "Claude", assignment: "src/app.ts", updatedAt: "2026-08-27T16:05:00.000Z" }))
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))
    }))
    render(<Harness />)
    await waitFor(() => expect(expose!.sessions[0]).toMatchObject({ id: `Claude:${sessionId}`, truth: "resume-unverified" }))

    let turn!: Promise<unknown>
    act(() => { turn = expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "src/app.ts", prompt: "Continue." }) })
    await waitFor(() => expect(requestSignal?.aborted).toBe(false))
    act(() => expose!.stop())

    await expect(turn).rejects.toMatchObject({ name: "AbortError" })
    expect(expose!.sessions[0]).toMatchObject({ id: `Claude:${sessionId}`, truth: "resume-unverified" })
    expect(expose!.descriptorState).toBe("unverified")
  })

  it("resumes only the selected exact provider mode and path while preserving every other session", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const reviewId = "123e4567-e89b-42d3-a456-426614174000"
    const builderId = "223e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      selectedSessionId: reviewId,
      sessions: [
        { schemaVersion: 1, sessionId: reviewId, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts", reviewPath: "src/app.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [] },
        { schemaVersion: 1, sessionId: builderId, role: "Builder", provider: "Claude", assignment: "src/other.ts", updatedAt: "2026-08-27T16:06:00.000Z", completedTurns: [] },
      ],
    }))
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: reviewId, resumed: true },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: reviewId, result: "Verified review" } },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(2))

    await act(async () => {
      await expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts", onReviewComplete: () => undefined })
    })

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ sessionId: reviewId, resume: true, path: "src/app.ts", mode: "review" })
    expect(expose!.savedSessions).toHaveLength(2)
    expect(expose!.sessions).toHaveLength(2)
    expect(expose!.sessions.find((session) => session.id === `Claude:${reviewId}`)).toMatchObject({ truth: "live" })
    expect(expose!.sessions.find((session) => session.id === `Claude:${builderId}`)).toMatchObject({ truth: "resume-unverified" })
  })

  it("keeps Claude and Codex sessions with the same provider-local id independently selectable and resumable", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sharedId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${sharedId}`,
      sessions: [
        { schemaVersion: 1, sessionId: sharedId, role: "Builder", provider: "Claude", assignment: "src/claude.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [] },
        { schemaVersion: 1, sessionId: sharedId, role: "Builder", provider: "Codex", assignment: "src/codex.ts", updatedAt: "2026-08-27T16:06:00.000Z", completedTurns: [] },
      ],
    }))
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: sharedId, provider: "Codex", mode: "delegate", resumed: true },
      { type: "result", text: "Codex resumed independently" },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.sessions).toHaveLength(2))

    act(() => expose!.selectSession(`Codex:${sharedId}`))
    await act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/codex.ts", prompt: "Continue Codex" })
    })

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ sessionId: sharedId, resume: true })
    expect(expose!.savedSessions).toHaveLength(2)
    expect(expose!.sessions.map((session) => session.id)).toEqual([`Claude:${sharedId}`, `Codex:${sharedId}`])
    expect(JSON.parse(String(window.localStorage.getItem(key))).selectedSessionKey).toBe(`Codex:${sharedId}`)
  })

  it("migrates a v1 Claude session then upserts a Codex session with the same provider-local id", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sharedId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, sessionId: sharedId, role: "Builder", provider: "Claude", assignment: "src/claude.ts", updatedAt: "2026-08-27T16:05:00.000Z" }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: sharedId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "result", text: "Codex same-id result" },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)
    await waitFor(() => expect(expose!.selectedSessionKey).toBe(`Claude:${sharedId}`))
    act(() => expose!.selectSession(null))

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/codex.ts", prompt: "Start Codex" })
    })

    expect(expose!.savedSessions.map((session) => `${session.provider}:${session.sessionId}`)).toEqual([`Claude:${sharedId}`, `Codex:${sharedId}`])
  })

  it("removes only the refused provider identity when another provider owns the same local id", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sharedId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${sharedId}`,
      sessions: [
        { schemaVersion: 1, sessionId: sharedId, role: "Builder", provider: "Claude", assignment: "src/shared.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [] },
        { schemaVersion: 1, sessionId: sharedId, role: "Builder", provider: "Codex", assignment: "src/shared.ts", updatedAt: "2026-08-27T16:06:00.000Z", completedTurns: [] },
      ],
    }))
    const fetcher = vi.fn().mockResolvedValue(new Response("gone", { status: 403 }))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(2))

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "src/shared.ts", prompt: "Resume Claude" })
    })).rejects.toThrow("AGENT_START_REFUSED:403")

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ sessionId: sharedId, resume: true })
    cleanup()
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions.map((session) => `${session.provider}:${session.sessionId}`)).toEqual([`Codex:${sharedId}`]))
    expect(expose!.sessions).toEqual([expect.objectContaining({ id: `Codex:${sharedId}`, truth: "resume-unverified" })])
  })

  it("fails closed when a provider unexpectedly reuses an existing id for a fresh session", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, sessionId, role: "Builder", provider: "Claude", assignment: "src/old.ts", updatedAt: "2026-08-27T16:05:00.000Z" }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, resumed: false },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "collision" } },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(1))
    act(() => expose!.selectSession(null))

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "src/new.ts", prompt: "Start fresh" })
    })).rejects.toThrow("AGENT_STREAM_INVALID")
    expect(expose!.savedSessions).toHaveLength(1)
  })

  it("prunes the globally oldest completed turns until the aggregate collection fits its byte ceiling", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessions = Array.from({ length: 12 }, (_, sessionIndex) => ({
      schemaVersion: 1,
      sessionId: `codex-session-${sessionIndex}`,
      role: "Builder",
      provider: "Codex",
      assignment: `src/${sessionIndex}.ts`,
      updatedAt: `2026-08-27T16:${String(sessionIndex).padStart(2, "0")}:00.000Z`,
      completedTurns: Array.from({ length: 20 }, (_, turnIndex) => ({
        ownerPrompt: `prompt-${sessionIndex}-${turnIndex}`,
        finalResult: `${sessionIndex}-${turnIndex}-${"x".repeat(2_000)}`,
        completedAt: `2026-08-27T${String(sessionIndex).padStart(2, "0")}:${String(turnIndex).padStart(2, "0")}:00.000Z`,
      })),
    }))
    window.localStorage.setItem(key, JSON.stringify({ schemaVersion: 3, selectedSessionKey: "Codex:codex-session-11", sessions }))

    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(12))

    const persisted = String(window.localStorage.getItem(key))
    expect(new TextEncoder().encode(persisted).byteLength).toBeLessThanOrEqual(262_144)
    expect(persisted).not.toContain("prompt-0-0")
    expect(persisted).toContain("prompt-11-19")
  })

  it("keeps the prior collection and UI verdict when localStorage quota rejects a successful turn", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const priorId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, sessionId: priorId, role: "Builder", provider: "Claude", assignment: "src/prior.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [{ ownerPrompt: "prior", finalResult: "prior result", completedAt: "2026-08-27T16:05:00.000Z" }] }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: "223e4567-e89b-42d3-a456-426614174000", resumed: false },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: "223e4567-e89b-42d3-a456-426614174000", result: "new result" } },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(1))
    act(() => expose!.selectSession(null))
    const storedBefore = window.localStorage.getItem(key)
    const durableStorage = window.localStorage
    vi.stubGlobal("localStorage", {
      getItem: durableStorage.getItem.bind(durableStorage),
      removeItem: durableStorage.removeItem.bind(durableStorage),
      clear: durableStorage.clear.bind(durableStorage),
      key: durableStorage.key.bind(durableStorage),
      get length() { return durableStorage.length },
      setItem() { throw new DOMException("quota", "QuotaExceededError") },
    })

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "src/new.ts", prompt: "new prompt" })
    })).rejects.toThrow("AGENT_SESSION_PERSISTENCE_FAILED")

    expect(window.localStorage.getItem(key)).toBe(storedBefore)
    expect(expose!.savedSessions).toEqual([expect.objectContaining({ sessionId: priorId, assignment: "src/prior.ts" })])
    expect(expose!.sessions).toEqual([expect.objectContaining({ id: `Claude:${priorId}`, truth: "resume-unverified", lastResult: "prior result" })])
  })

  it("requires a fresh provider choice and cancels stale Delegate intent when selection changes", async () => {
    const sessionId = "323e4567-e89b-42d3-a456-426614174000"
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse("server"))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, spine: EMPTY_SPINE, judgment: null }))
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/diff?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/other.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/codex" && init?.method === "POST") return Promise.resolve(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
        { type: "delta", text: "Working from src/app.ts." },
        { type: "result", text: "Completed the captured assignment." },
        { type: "done", code: 0, reason: null },
      ))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.click(screen.getByRole("button", { name: "Delegate" }))
    expect(screen.getByRole("group", { name: "Choose agent provider" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Codex" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Claude" })).toBeTruthy()
    const line = screen.getByRole("form", { name: "The Line" })
    expect((within(line).getByRole("button", { name: "Delegate" }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Codex" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Fix the selected defect." } })
    fireEvent.click(screen.getByRole("tab", { name: "other.ts" }))
    await waitFor(() => expect(screen.queryByRole("form", { name: "The Line" })).toBeNull())
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/loom/codex")).toBe(false)

    expect(screen.getByText("src/other.ts")).toBeTruthy()
  })

  it("refreshes the exact promoted file and diff after a successful Codex delegation", async () => {
    const sessionId = "323e4567-e89b-42d3-a456-426614174000"
    let sourceReads = 0
    let diffReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse("server"))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, spine: EMPTY_SPINE, judgment: null }))
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        sourceReads += 1
        return Promise.resolve(Response.json({
          kind: "file", path: "src/app.ts",
          content: sourceReads === 1 ? "export const version = 1\n" : "export const version = 2\n",
          modifiedAt: sourceReads === 1 ? "2026-08-28T12:00:00.000Z" : "2026-08-28T12:01:00.000Z",
        }))
      }
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({
        kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z",
      }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: diffReads === 1 ? "" : "+export const version = 2" }))
      }
      if (url === "/api/loom/codex" && init?.method === "POST") return Promise.resolve(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
        { type: "result", text: "Updated src/app.ts." },
        { type: "done", code: 0, reason: null },
      ))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    expect((await screen.findByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const version = 1\n")

    fireEvent.click(screen.getByRole("button", { name: "Delegate" }))
    fireEvent.click(screen.getByRole("button", { name: "Codex" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Update the selected file." } })
    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Delegate" }))

    await waitFor(() => expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const version = 2\n"))
    expect(sourceReads).toBeGreaterThanOrEqual(2)
    expect(diffReads).toBeGreaterThanOrEqual(2)
  })

  it("restores canonical session inspection and excludes unverified hints from live Mission Control", async () => {
    const sessionId = "codex-restored-thread"
    const key = "williamos:agent-session:browser-world:c%3A%2Frepos%2Fterrafusion"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      selectedSessionId: null,
      sessions: [{
        schemaVersion: 1,
        sessionId,
        role: "Builder",
        provider: "Codex",
        assignment: "src/app.ts",
        updatedAt: "2026-08-27T16:05:00.000Z",
        completedTurns: [{ ownerPrompt: "Fix it", finalResult: "Restored canonical result", completedAt: "2026-08-27T16:05:00.000Z" }],
      }],
    }))
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    const restored = await screen.findByRole("button", { name: /Builder · Codex · src\/app.ts/i })
    fireEvent.click(restored)

    expect(JSON.parse(String(window.localStorage.getItem(key))).selectedSessionKey).toBe(`Codex:${sessionId}`)
    expect(screen.getByText("Restored canonical result")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Open Mission Control" }))
    const mission = screen.getByRole("dialog", { name: "Mission Control" })
    expect(within(mission).getAllByText("No active agents")).toHaveLength(2)
    expect(within(mission).queryByText(/Codex/)).toBeNull()
  })

  it("starts a fresh Codex Builder through the Codex route and persists provider-bound truth", async () => {
    const sessionId = "323e4567-e89b-42d3-a456-426614174000"
    const seen: Record<string, unknown>[] = []
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "delta", text: "Inspecting the selected file." },
      { type: "result", text: "Implemented the requested change." },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)

    await act(async () => {
      await expose!.runAgentTurn({
        provider: "Codex",
        role: "Builder",
        assignment: "src/app.ts",
        prompt: "Selected file: src/app.ts\nOwner request: Fix the defect.",
        onEvent: (event) => seen.push({ ...event }),
      })
    })

    expect(screen.getByRole("button", { name: /Builder · Codex · src\/app.ts/i })).toBeTruthy()
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      worldId: "world-1",
      prompt: "Selected file: src/app.ts\nOwner request: Fix the defect.",
      sessionId: null,
      resume: false,
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/loom/codex")
    expect(seen).toEqual([
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "delta", text: "Inspecting the selected file." },
      { type: "result", text: "Implemented the requested change." },
      { type: "done", code: 0, reason: null },
    ])
    expect(JSON.parse(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")!)).toMatchObject({
      schemaVersion: 3,
      selectedSessionKey: `Codex:${sessionId}`,
      sessions: [{ sessionId, role: "Builder", provider: "Codex", assignment: "src/app.ts" }],
    })
  })

  it("locks a restored Codex session to Codex when it resumes", async () => {
    const sessionId = "323e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 1,
      sessionId,
      role: "Builder",
      provider: "Codex",
      assignment: "src/app.ts",
      updatedAt: "2026-08-28T18:00:00.000Z",
    }))
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: true },
      { type: "result", text: "Continued the existing Codex thread." },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    await act(async () => {
      await expose!.runAgentTurn({
        provider: "Codex",
        role: "Builder",
        assignment: "src/app.ts",
        prompt: "Continue.",
      })
    })

    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/loom/codex")
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      worldId: "world-1",
      prompt: "Continue.",
      sessionId,
      resume: true,
    })
    expect(expose!.durableSession?.provider).toBe("Codex")
  })

  it("accepts and restores the exact Codex route thread-id contract", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessionId = "codex-thread-1"
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
        { type: "result", text: "Started the real Codex thread." },
        { type: "done", code: 0, reason: null },
      ))
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: true },
        { type: "result", text: "Resumed the real Codex thread." },
        { type: "done", code: 0, reason: null },
      ))
    vi.stubGlobal("fetch", fetcher)
    const first = render(<Harness />)

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Start." })
    })
    expect(JSON.parse(String(window.localStorage.getItem(key)))).toMatchObject({ selectedSessionKey: `Codex:${sessionId}`, sessions: [{ sessionId, provider: "Codex" }] })
    first.unmount()
    render(<Harness />)
    await waitFor(() => expect(expose!.savedDescriptor?.sessionId).toBe(sessionId))

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Continue." })
    })
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ sessionId, resume: true })
    expect(expose!.durableSession?.sessionId).toBe(sessionId)
  })

  it("starts fresh rather than sending a Claude descriptor to Codex", async () => {
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 1,
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      role: "Builder",
      provider: "Claude",
      assignment: "Prior Claude work",
      updatedAt: "2026-08-28T18:00:00.000Z",
    }))
    const sessionId = "323e4567-e89b-42d3-a456-426614174000"
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "result", text: "Fresh Codex work." },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "New work", prompt: "Start." })
    })

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ sessionId: null, resume: false })
    expect(expose!.durableSession?.provider).toBe("Codex")
  })

  it.each([
    [
      "a duplicate session",
      [
        { type: "session", sessionId: "323e4567-e89b-42d3-a456-426614174000", provider: "Codex", mode: "delegate", resumed: false },
        { type: "session", sessionId: "323e4567-e89b-42d3-a456-426614174000", provider: "Codex", mode: "delegate", resumed: false },
        { type: "result", text: "Looks successful." },
        { type: "done", code: 0, reason: null },
      ],
    ],
    [
      "a missing canonical result",
      [
        { type: "session", sessionId: "323e4567-e89b-42d3-a456-426614174000", provider: "Codex", mode: "delegate", resumed: false },
        { type: "done", code: 0, reason: null },
      ],
    ],
    [
      "a frame after terminal",
      [
        { type: "session", sessionId: "323e4567-e89b-42d3-a456-426614174000", provider: "Codex", mode: "delegate", resumed: false },
        { type: "result", text: "Looks successful." },
        { type: "done", code: 0, reason: null },
        { type: "delta", text: "late" },
      ],
    ],
  ])("fails closed on Codex protocol with %s", async (_case, frames) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(...frames)))
    render(<Harness />)

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work." })
    })).rejects.toThrow("AGENT_STREAM_INVALID")

    expect(expose!.sessions).toEqual([])
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it("labels Stop with the active Codex provider and aborts its request", async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
    }))
    render(<Harness />)

    let turn!: Promise<unknown>
    act(() => {
      turn = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work." })
    })
    fireEvent.click(await screen.findByRole("button", { name: "Stop Codex turn" }))

    await expect(turn).rejects.toMatchObject({ name: "AbortError" })
    expect(signal?.aborted).toBe(true)
  })

  it("surfaces Codex authentication unavailability without creating a session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "done", code: null, reason: "CODEX_AUTH_REQUIRED" },
    )))
    render(<Harness />)

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work." })
    })).rejects.toThrow("AGENT_TURN_FAILED:CODEX_AUTH_REQUIRED")

    expect(expose!.sessions).toEqual([])
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it("sends only the persisted Space identity and task request to the Codex mutation route", async () => {
    const sessionId = "323e4567-e89b-42d3-a456-426614174000"
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "result", text: "Completed." },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness worldId="world-authorized" />)

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work." })
    })

    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("x-williamos-work-context")).toBe(false)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      worldId: "world-authorized",
      prompt: "Work.",
      sessionId: null,
      resume: false,
    })
  })

  it("surfaces a useful server-derived authority refusal without fabricating ready Codex truth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: "CODEX_ASSIGNMENT_PATH_OUT_OF_SCOPE",
      detail: "That file is outside the current writable scope, so I didn't dispatch it.",
    }, { status: 409 })))
    render(<Harness />)

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work." })
    })).rejects.toThrow("That file is outside the current writable scope, so I didn't dispatch it.")
    expect(expose!.sessions).toEqual([])
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it("refuses a Codex request locally when no persisted Space identity exists", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<Harness worldId={null} />)

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work." })
    })).rejects.toThrow("AGENT_SPACE_REQUIRED")
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("cancels a stale Codex turn when the owner or workspace scope changes", async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: "323e4567-e89b-42d3-a456-426614174000", provider: "Codex", mode: "delegate", resumed: false })}\n`))
      },
    }))))
    const view = render(<Harness />)
    let turn!: Promise<unknown>
    act(() => {
      turn = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work." })
    })
    await waitFor(() => expect(expose!.activeProvider).toBe("Codex"))

    view.rerender(<Harness ownerScope="owner-2" worldScope="other-project" />)

    await expect(turn).rejects.toMatchObject({ name: "AbortError" })
    await waitFor(() => expect(expose!.sessions).toEqual([]))
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
    expect(window.localStorage.getItem("williamos:agent-session:owner-2:other-project")).toBeNull()
  })

  it("prevents an old stopped turn from clearing or overwriting a newer provider turn", async () => {
    let settleOldRead!: (value: ReadableStreamReadResult<Uint8Array>) => void
    const oldReader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => { settleOldRead = resolve })),
      cancel: vi.fn().mockResolvedValue(undefined),
    }
    const encoder = new TextEncoder()
    let claudeStream!: ReadableStreamDefaultController<Uint8Array>
    const claudeResponse = new Response(new ReadableStream<Uint8Array>({ start(controller) { claudeStream = controller } }))
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => oldReader } })
      .mockResolvedValueOnce(claudeResponse)
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)

    let oldTurn!: Promise<unknown>
    act(() => { oldTurn = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "old.ts", prompt: "Old." }) })
    fireEvent.click(await screen.findByRole("button", { name: "Stop Codex turn" }))
    let newTurn!: Promise<unknown>
    act(() => { newTurn = expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "new.ts", prompt: "New." }) })
    await screen.findByRole("button", { name: "Stop Claude turn" })

    settleOldRead({ done: true, value: undefined })
    await expect(oldTurn).rejects.toMatchObject({ name: "AbortError" })
    expect(expose!.activeProvider).toBe("Claude")
    expect(screen.getByRole("button", { name: "Stop Claude turn" })).toBeTruthy()

    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    for (const frame of [
      { type: "session", sessionId, resumed: false },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "New provider won." } },
      { type: "done", code: 0, reason: null },
    ]) claudeStream.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
    claudeStream.close()
    await act(async () => { await newTurn })

    expect(expose!.durableSession).toMatchObject({ provider: "Claude", assignment: "new.ts" })
    expect(JSON.parse(String(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")))).toMatchObject({ sessions: [{ provider: "Claude", assignment: "new.ts" }] })
  })

  it("allows bounded Claude diagnostics after Delegate result without changing success truth", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, resumed: false },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Canonical delegate result" } },
      { type: "stderr", text: "Claude transport cleanup diagnostic" },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)

    await act(async () => {
      await expose!.runClaudeTurn({ role: "Builder", assignment: "src/app.ts", prompt: "Work." })
    })
    expect(expose!.durableSession).toMatchObject({ provider: "Claude", assignment: "src/app.ts" })
  })

  it("allows bounded Claude diagnostics after Review result without replacing its report", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, resumed: false },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Canonical review report" } },
      { type: "stderr", text: "Claude transport cleanup diagnostic" },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)
    let report = ""

    await act(async () => {
      await expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts", onReviewComplete: (text) => { report = text } })
    })
    expect(report).toBe("Canonical review report")
  })

  it("shows a visible Stop control during a Claude turn and aborts its active request", async () => {
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
    }))
    render(<Harness />)

    let turn!: Promise<unknown>
    act(() => {
      turn = expose!.runClaudeTurn({ role: "Builder", assignment: "Change src/app.ts", prompt: "Make the change." })
    })

    const stop = await screen.findByRole("button", { name: "Stop Claude turn" })
    expect(requestSignal?.aborted).toBe(false)
    fireEvent.click(stop)

    await expect(turn).rejects.toMatchObject({ name: "AbortError" })
    expect(requestSignal?.aborted).toBe(true)
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop Claude turn" })).toBeNull())
  })

  it("projects only the live World Spine worker and never invents provider sessions", () => {
    render(<Harness worker={{ lane: "review", state: "reviewing", since: "2026-08-27T16:00:00Z" }} />)

    expect(screen.getByRole("button", { name: /Worker · review lane/i })).toBeTruthy()
    expect(screen.getByText("reviewing · live world state")).toBeTruthy()
    expect(screen.queryByText(/Codex|Claude|HERMES/)).toBeNull()
  })

  it("creates a real Claude session from the streamed route response and persists its descriptor", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, resumed: false },
      { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "I changed the selected file." }] } } },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "I changed the selected file." } },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)

    await act(async () => {
      await expose!.runClaudeTurn({ role: "Builder", assignment: "Change src/app.ts", prompt: "Make the selected change." })
    })

    expect(screen.getByRole("button", { name: /Builder · Claude/i })).toBeTruthy()
    expect(screen.getByText("ready · resumable session")).toBeTruthy()
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      prompt: "Make the selected change.",
      provider: "cloud",
      sessionId: null,
      resume: false,
    })
    expect(JSON.parse(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")!)).toMatchObject({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${sessionId}`,
      sessions: [{ sessionId, role: "Builder", provider: "Claude", assignment: "Change src/app.ts" }],
    })
  })

  it("shows a restored descriptor as unverified until resume succeeds", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 1,
      sessionId,
      role: "Reviewer",
      provider: "Claude",
      assignment: "Review src/app.ts",
      updatedAt: "2026-08-27T16:05:00.000Z",
    }))
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, resumed: true },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Continued the review." } },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)

    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))
    expect(expose!.savedDescriptor?.sessionId).toBe(sessionId)
    expect(screen.getByRole("button", { name: /Reviewer · Claude/i })).toBeTruthy()
    expect(screen.getByText("resume unverified · saved transcript · server verification required")).toBeTruthy()
    await act(async () => {
      await expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", prompt: "Continue the review." })
    })

    expect(screen.getByRole("button", { name: /Reviewer · Claude/i })).toBeTruthy()
    expect(screen.getByText("ready · resumable session")).toBeTruthy()
    expect(expose!.descriptorState).toBe("verified")
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      prompt: "Continue the review.",
      provider: "cloud",
      sessionId,
      resume: true,
    })
  })

  it("refuses malformed browser state instead of rendering a fake durable session", async () => {
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 1,
      sessionId: "not-a-session-id",
      role: "Builder",
      provider: "Claude",
      assignment: "Pretend this is live",
      updatedAt: "not-a-date",
    }))

    render(<Harness />)

    await waitFor(() => expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull())
    expect(screen.queryByText(/Claude/)).toBeNull()
  })

  it.each([
    [{ type: "done", code: 1, reason: null }, "AGENT_TURN_FAILED:EXIT_1"],
    [{ type: "done", code: null, reason: "TIMEOUT" }, "AGENT_TURN_FAILED:TIMEOUT"],
  ])("does not persist or project a fresh session when its final outcome fails", async (done, failure) => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, resumed: false },
      done,
    )))
    render(<Harness />)

    await expect(act(async () => {
      await expose!.runClaudeTurn({ role: "Builder", assignment: "Change src/app.ts", prompt: "Make the change." })
    })).rejects.toThrow(failure)

    expect(screen.queryByRole("button", { name: /Builder · Claude/i })).toBeNull()
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it("does not restore another owner's descriptor for the same world", async () => {
    window.localStorage.setItem("williamos:agent-session:owner-2:terrafusion", JSON.stringify({
      schemaVersion: 1,
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      role: "Builder",
      provider: "Claude",
      assignment: "Private owner-2 work",
      updatedAt: "2026-08-27T16:05:00.000Z",
    }))

    render(<Harness />)

    await waitFor(() => expect(expose!.descriptorState).toBe("none"))
    expect(expose!.savedDescriptor).toBeNull()
    expect(screen.queryByText(/Claude/)).toBeNull()
  })

  it("preserves an unrelated restored descriptor when a fresh assignment is refused", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      role: "Builder",
      provider: "Claude",
      assignment: "Old work",
      updatedAt: "2026-08-27T16:05:00.000Z",
    }))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("refused", { status: 403 }))
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: "223e4567-e89b-42d3-a456-426614174000", resumed: false },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: "223e4567-e89b-42d3-a456-426614174000", result: "Started fresh." } },
        { type: "done", code: 0, reason: null },
      ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    await expect(act(async () => {
      await expose!.runClaudeTurn({ role: "Builder", assignment: "New work", prompt: "Continue." })
    })).rejects.toThrow("AGENT_START_REFUSED:403")

    expect(JSON.parse(String(window.localStorage.getItem(key)))).toMatchObject({
      selectedSessionKey: "Claude:123e4567-e89b-42d3-a456-426614174000",
      sessions: [{ assignment: "Old work" }],
    })
    await act(async () => {
      await expose!.runClaudeTurn({ role: "Builder", assignment: "Fresh work", prompt: "Start fresh." })
    })
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      sessionId: null,
      resume: false,
    })
  })

  it("retains a verified descriptor after a recoverable failed turn", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const descriptor = {
      schemaVersion: 1,
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      role: "Builder",
      provider: "Claude",
      assignment: "Existing work",
      updatedAt: "2026-08-27T16:05:00.000Z",
    }
    window.localStorage.setItem(key, JSON.stringify(descriptor))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: descriptor.sessionId, resumed: true },
      { type: "done", code: null, reason: "TIMEOUT" },
    )))
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    await expect(act(async () => {
      await expose!.runClaudeTurn({ role: "Builder", assignment: "Existing work", prompt: "Continue." })
    })).rejects.toThrow("AGENT_TURN_FAILED:TIMEOUT")

    expect(JSON.parse(String(window.localStorage.getItem(key)))).toEqual({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${descriptor.sessionId}`,
      sessions: [{ ...descriptor, completedTurns: [] }],
    })
  })

  it("resumes Review only from a matching Reviewer and captured-path descriptor", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, sessionId, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts", reviewPath: "src/app.ts", updatedAt: "2026-08-27T16:05:00.000Z" }))
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, resumed: true },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Review report" } },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    let report = ""
    await act(async () => {
      await expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts", focus: "Security", onReviewComplete: (text) => { report = text } })
    })

    expect(report).toBe("Review report")
    expect(expose!.sessions[0]).toMatchObject({ mode: "review", reviewPath: "src/app.ts" })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ mode: "review", path: "src/app.ts", focus: "Security", provider: "cloud", sessionId, resume: true })
  })

  it.each([
    ["Builder", "src/app.ts"],
    ["Reviewer", "src/other.ts"],
  ])("starts Review fresh rather than resuming a %s/%s descriptor", async (role, reviewPath) => {
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({ schemaVersion: 1, sessionId: "123e4567-e89b-42d3-a456-426614174000", role, provider: "Claude", assignment: "Prior work", reviewPath, updatedAt: "2026-08-27T16:05:00.000Z" }))
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: "223e4567-e89b-42d3-a456-426614174000", resumed: false },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: "223e4567-e89b-42d3-a456-426614174000", result: "Fresh review" } },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    await act(async () => {
      await expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts", onReviewComplete: () => undefined })
    })

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ sessionId: null, resume: false })
  })

  it("rejects a resumed Review whose outer session does not echo the exact requested session", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({ schemaVersion: 1, sessionId, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts", reviewPath: "src/app.ts", updatedAt: "2026-08-27T16:05:00.000Z" }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: "223e4567-e89b-42d3-a456-426614174000", resumed: true },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: "223e4567-e89b-42d3-a456-426614174000", result: "Wrong thread" } },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    await expect(act(async () => {
      await expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts", onReviewComplete: () => undefined })
    })).rejects.toThrow("AGENT_REVIEW_STREAM_INVALID")
    expect(expose!.sessions).toEqual([expect.objectContaining({ id: `Claude:${sessionId}`, truth: "resume-unverified" })])
  })
})
