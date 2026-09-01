// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AgentSessionStrip,
  loadSavedAgentSessionProjection,
  projectMissionAgentSessions,
  useExperienceAgentSessions,
  type ExperienceAgentSession,
  type ProviderNeutralAgentSessionController,
} from "@/components/workspace-shell/agent-sessions"
import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"
import type { ProjectedWorldWorkerSession } from "@/lib/environment/world-execution"

const OWNER_SCOPE = "owner-1"
const WORLD_SCOPE = "terrafusion"
const ASSIGNMENT_HASH = "a".repeat(64)

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor(props: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Source content" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  },
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

async function openWilliamConversation() {
  fireEvent.click(await screen.findByRole("button", { name: "Open William conversation" }))
  return screen.findByRole("complementary", { name: "William conversation" })
}

function Harness({ executionSession = null, ownerScope = OWNER_SCOPE, worldScope = WORLD_SCOPE, worldId = "world-1", autoContinue = false, onAutoContinuation }: { executionSession?: ProjectedWorldWorkerSession | null; ownerScope?: string; worldScope?: string; worldId?: string | null; autoContinue?: boolean; onAutoContinuation?: (continuation: Readonly<{ status: string; selectedPath?: string; task?: string }>) => void | Promise<void> }) {
  const controller = useExperienceAgentSessions({ ownerScope, worldScope, worldId, executionSession, autoContinue, onAutoContinuation })
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
  it("restores and starts a pending server continuation after reload", async () => {
    const onAutoContinuation = vi.fn()
    const fetcher = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith("/api/loom/codex/continuation")) {
        return Promise.resolve(Response.json({
          status: "NEXT_ASSIGNMENT",
          selectedPath: "src/other.ts",
          task: "Continue the bound Work Order in src/other.ts.",
        }))
      }
      return Promise.resolve(ndjson(
        { type: "session", sessionId: "codex-restored-next", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/other.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "continuation", status: "WORK_ORDER_PATHS_COMPLETE" },
        { type: "result", text: "Restored continuation completed." },
        { type: "done", code: 0, reason: null },
      ))
    })
    vi.stubGlobal("fetch", fetcher)

    render(<Harness autoContinue onAutoContinuation={onAutoContinuation} />)

    await waitFor(() => expect(expose!.savedSessions).toEqual([
      expect.objectContaining({ sessionId: "codex-restored-next", target: { kind: "file", path: "src/other.ts" } }),
    ]))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(onAutoContinuation).toHaveBeenCalledWith({ status: "WORK_ORDER_PATHS_COMPLETE" })
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("/api/loom/codex/continuation?worldId=world-1")
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ automatic: true })
  })

  it("starts a restored automatic assignment as a fresh session even when an older saved session matches its path", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: "Codex:codex-old-other",
      sessions: [{
        schemaVersion: 1,
        sessionId: "codex-old-other",
        role: "Builder",
        provider: "Codex",
        assignment: "src/other.ts",
        target: { kind: "file", path: "src/other.ts" },
        updatedAt: "2026-08-30T05:00:00.000Z",
        completedTurns: [],
      }],
    }))
    const fetcher = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/loom/codex/continuation")) {
        return Promise.resolve(Response.json({
          status: "NEXT_ASSIGNMENT",
          selectedPath: "src/other.ts",
          task: "Continue the current Work Order in src/other.ts.",
        }))
      }
      return Promise.resolve(ndjson(
        { type: "session", sessionId: "codex-fresh-other", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/other.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "continuation", status: "WORK_ORDER_PATHS_COMPLETE" },
        { type: "result", text: "Fresh automatic continuation completed." },
        { type: "done", code: 0, reason: null },
      ))
    })
    vi.stubGlobal("fetch", fetcher)

    render(<Harness autoContinue />)

    await waitFor(() => expect(expose!.savedSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "codex-fresh-other" }),
    ])))
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      automatic: true,
      sessionId: null,
      resume: false,
    })
    expect(expose!.error).toBeNull()
  })

  it("retries a transient continuation read and starts the pending assignment without a reload", async () => {
    let continuationReads = 0
    const fetcher = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/loom/codex/continuation")) {
        continuationReads += 1
        if (continuationReads === 1) return Promise.resolve(Response.json({ error: "TEMPORARY" }, { status: 503 }))
        return Promise.resolve(Response.json({
          status: "NEXT_ASSIGNMENT",
          selectedPath: "src/other.ts",
          task: "Continue after a transient read failure.",
        }))
      }
      return Promise.resolve(ndjson(
        { type: "session", sessionId: "codex-retried-next", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/other.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "continuation", status: "WORK_ORDER_PATHS_COMPLETE" },
        { type: "result", text: "Retried continuation completed." },
        { type: "done", code: 0, reason: null },
      ))
    })
    vi.stubGlobal("fetch", fetcher)

    render(<Harness autoContinue />)

    await waitFor(() => expect(expose!.savedSessions).toEqual([
      expect.objectContaining({ sessionId: "codex-retried-next" }),
    ]), { timeout: 2_000 })
    expect(continuationReads).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("restores and starts a pending continuation during the Strict Mode effect replay", async () => {
    let resolveContinuation!: (response: Response) => void
    const continuationResponse = new Promise<Response>((resolve) => { resolveContinuation = resolve })
    const fetcher = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/loom/codex/continuation")) {
        return continuationResponse
      }
      return Promise.resolve(ndjson(
        { type: "session", sessionId: "codex-strict-next", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/other.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "continuation", status: "WORK_ORDER_PATHS_COMPLETE" },
        { type: "result", text: "Strict continuation completed." },
        { type: "done", code: 0, reason: null },
      ))
    })
    vi.stubGlobal("fetch", fetcher)

    render(<StrictMode><Harness autoContinue /></StrictMode>)

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await act(async () => resolveContinuation(Response.json({
      status: "NEXT_ASSIGNMENT",
      selectedPath: "src/other.ts",
      task: "Continue the bound Work Order in src/other.ts.",
    })))

    await waitFor(() => expect(expose!.savedSessions).toEqual([
      expect.objectContaining({ sessionId: "codex-strict-next" }),
    ]))
    expect(fetcher.mock.calls.filter(([input]) => !String(input).includes("/continuation?"))).toHaveLength(1)
  })

  it("continues a server-derived Codex assignment without another owner action", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: "codex-slice-1", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "continuation", status: "NEXT_ASSIGNMENT", selectedPath: "src/other.ts", task: "Continue the bound Work Order in src/other.ts." },
        { type: "result", text: "First slice complete." },
        { type: "done", code: 0, reason: null },
      ))
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: "codex-slice-2", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/other.ts", assignmentHash: "b".repeat(64) },
        { type: "continuation", status: "WORK_ORDER_PATHS_COMPLETE" },
        { type: "result", text: "Second slice complete." },
        { type: "done", code: 0, reason: null },
      ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.collectionState).toBe("missing"))

    await act(async () => {
      await expose!.runAgentTurn({
        provider: "Codex",
        role: "Builder",
        assignment: "src/app.ts",
        prompt: "Implement the first bounded slice.",
        target: { kind: "file", path: "src/app.ts" },
      })
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      worldId: "world-1",
      automatic: true,
      sessionId: null,
      resume: false,
    })
    expect(expose!.savedSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "codex-slice-1", target: { kind: "file", path: "src/app.ts" } }),
      expect.objectContaining({ sessionId: "codex-slice-2", target: { kind: "file", path: "src/other.ts" } }),
    ]))
  })

  it("waits for the persisted Space selection to reach the visible UI before starting the next assignment", async () => {
    let releaseSelection!: () => void
    const selectionVisible = new Promise<void>((resolve) => { releaseSelection = resolve })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: "codex-visible-1", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "continuation", status: "NEXT_ASSIGNMENT", selectedPath: "src/other.ts", task: "Continue visibly." },
        { type: "result", text: "First slice complete." },
        { type: "done", code: 0, reason: null },
      ))
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: "codex-visible-2", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/other.ts", assignmentHash: "b".repeat(64) },
        { type: "continuation", status: "WORK_ORDER_PATHS_COMPLETE" },
        { type: "result", text: "Second slice complete." },
        { type: "done", code: 0, reason: null },
      ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.collectionState).toBe("missing"))

    let turn!: Promise<unknown>
    act(() => {
      turn = expose!.runAgentTurn({
        provider: "Codex",
        role: "Builder",
        assignment: "src/app.ts",
        prompt: "Implement the first bounded slice.",
        target: { kind: "file", path: "src/app.ts" },
        onContinuation: async (continuation) => {
          if (continuation.status === "NEXT_ASSIGNMENT") await selectionVisible
        },
      })
    })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    expect(fetcher).toHaveBeenCalledTimes(1)

    releaseSelection()
    await act(async () => { await turn })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("preserves the completed slice when visible Space synchronization blocks continuation", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ndjson(
      { type: "session", sessionId: "codex-sync-blocked", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
      { type: "continuation", status: "NEXT_ASSIGNMENT", selectedPath: "src/other.ts", task: "Continue visibly." },
      { type: "result", text: "The first slice is durably complete." },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.collectionState).toBe("missing"))

    await act(async () => {
      await expose!.runAgentTurn({
        provider: "Codex",
        role: "Builder",
        assignment: "src/app.ts",
        prompt: "Implement the first bounded slice.",
        target: { kind: "file", path: "src/app.ts" },
        onContinuation: async () => { throw new Error("CONTINUATION_SELECTION_MISMATCH") },
      })
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(expose!.savedSessions).toEqual([
      expect.objectContaining({ sessionId: "codex-sync-blocked", completedTurns: [expect.objectContaining({ finalResult: "The first slice is durably complete." })] }),
    ])
    expect(expose!.error).toBe("CODEX_CONTINUATION_UI_SYNC_FAILED")
  })

  it.each([
    {
      label: "Codex Builder",
      descriptor: { schemaVersion: 1, sessionId: "codex-continue", role: "Builder", provider: "Codex", assignment: "Build src/app.ts", target: { kind: "file", path: "src/app.ts" }, updatedAt: "2026-08-30T05:00:00.000Z", completedTurns: [] },
      url: "/api/loom/codex",
      body: { worldId: "world-1", prompt: "Continue exactly.", sessionId: "codex-continue", resume: true },
      events: [
        { type: "session", sessionId: "codex-continue", provider: "Codex", mode: "delegate", resumed: true, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "result", text: "Codex continued." }, { type: "done", code: 0, reason: null },
      ],
    },
    {
      label: "Claude Builder",
      descriptor: { schemaVersion: 1, sessionId: "123e4567-e89b-42d3-a456-426614174000", role: "Builder", provider: "Claude", assignment: "Build interaction", updatedAt: "2026-08-30T05:00:00.000Z", completedTurns: [] },
      url: "/api/loom/agent",
      body: { worldId: "world-1", prompt: "Continue exactly.", provider: "cloud", sessionId: "123e4567-e89b-42d3-a456-426614174000", resume: true },
      events: [
        { type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", provider: "Claude", mode: "delegate", resumed: true },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: "123e4567-e89b-42d3-a456-426614174000", result: "Claude continued." } },
        { type: "done", code: 0, reason: null },
      ],
    },
    {
      label: "Claude Reviewer",
      descriptor: { schemaVersion: 1, sessionId: "223e4567-e89b-42d3-a456-426614174000", role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts", reviewPath: "src/app.ts", updatedAt: "2026-08-30T05:00:00.000Z", completedTurns: [] },
      url: "/api/loom/agent",
      body: { mode: "review", path: "src/app.ts", focus: "Continue exactly.", provider: "cloud", sessionId: "223e4567-e89b-42d3-a456-426614174000", resume: true },
      events: [
        { type: "session", sessionId: "223e4567-e89b-42d3-a456-426614174000", provider: "Claude", mode: "review", resumed: true },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: "223e4567-e89b-42d3-a456-426614174000", result: "Review continued." } },
        { type: "done", code: 0, reason: null },
      ],
    },
    {
      label: "Local Thinker",
      descriptor: { schemaVersion: 1, sessionId: "323e4567-e89b-42d3-a456-426614174000", role: "Thinker", provider: "Local", assignment: "Conversation", updatedAt: "2026-08-30T05:00:00.000Z", completedTurns: [] },
      url: "/api/loom/agent",
      body: { prompt: "Continue exactly.", provider: "local", sessionId: "323e4567-e89b-42d3-a456-426614174000", resume: true, completedTurns: [] },
      events: [
        { type: "session", sessionId: "323e4567-e89b-42d3-a456-426614174000", provider: "Local", mode: "delegate", resumed: true, continuity: "browser-replayed" },
        { type: "result", text: "Local continued." }, { type: "done", code: 0, reason: null },
      ],
    },
    {
      label: "Preview debugger",
      descriptor: { schemaVersion: 1, sessionId: "423e4567-e89b-42d3-a456-426614174000", role: "Preview debugger", provider: "Claude", assignment: "Developer Preview diagnosis", preview: { worldId: "world-1", evidenceFingerprint: ASSIGNMENT_HASH }, updatedAt: "2026-08-30T05:00:00.000Z", completedTurns: [] },
      url: "/api/loom/agent",
      body: { mode: "preview", worldId: "world-1", prompt: "Continue exactly.", provider: "cloud", sessionId: "423e4567-e89b-42d3-a456-426614174000", resume: true },
      events: [
        { type: "session", sessionId: "423e4567-e89b-42d3-a456-426614174000", provider: "Claude", mode: "preview", resumed: true, worldId: "world-1", evidenceFingerprint: ASSIGNMENT_HASH },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: "423e4567-e89b-42d3-a456-426614174000", result: "Preview diagnosis continued." } },
        { type: "done", code: 0, reason: null },
      ],
    },
  ] as const)("continues the exact existing $label through its mode-specific transport", async ({ descriptor, url, body, events }) => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessionKey = `${descriptor.provider}:${descriptor.sessionId}`
    window.localStorage.setItem(key, JSON.stringify({ schemaVersion: 3, selectedSessionKey: sessionKey, sessions: [descriptor] }))
    const fetcher = vi.fn().mockResolvedValue(ndjson(...events))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.selectedSessionKey).toBe(sessionKey))

    await act(async () => { await expose!.continueSession({ sessionKey, prompt: "Continue exactly." }) })

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(url)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(body)
    const stored = JSON.parse(String(window.localStorage.getItem(key)))
    expect(stored.sessions).toEqual([expect.objectContaining({
      provider: descriptor.provider,
      sessionId: descriptor.sessionId,
      completedTurns: [expect.objectContaining({ ownerPrompt: "Continue exactly." })],
    })])
  })

  it("fails a missing or foreign exact Continue candidate before dispatch", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<Harness worldScope="other-space" />)
    await waitFor(() => expect(expose!.collectionState).toBe("missing"))

    await expect(expose!.continueSession({
      sessionKey: "Claude:123e4567-e89b-42d3-a456-426614174000",
      prompt: "Do not start fresh.",
    })).rejects.toThrow("AGENT_CONTINUE_SESSION_UNAVAILABLE")
    expect(fetcher).not.toHaveBeenCalled()
    expect(expose!.savedSessions).toEqual([])
  })

  it("preserves the prior transcript when exact Continue is refused", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const descriptor = {
      schemaVersion: 1, sessionId: "codex-refused-continue", role: "Builder", provider: "Codex", assignment: "Build src/app.ts",
      updatedAt: "2026-08-30T05:00:00.000Z",
      completedTurns: [{ ownerPrompt: "Build.", finalResult: "Saved result", completedAt: "2026-08-30T05:00:00.000Z" }],
    }
    const stored = JSON.stringify({ schemaVersion: 3, selectedSessionKey: "Codex:codex-refused-continue", sessions: [descriptor] })
    window.localStorage.setItem(key, stored)
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "THREAD_DESCRIPTOR_MISMATCH" }, { status: 403 }))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.selectedSessionKey).toBe("Codex:codex-refused-continue"))

    await expect(expose!.continueSession({
      sessionKey: "Codex:codex-refused-continue", prompt: "Continue exactly.",
    })).rejects.toThrow("THREAD_DESCRIPTOR_MISMATCH")

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(key)).toBe(stored)
    expect(expose!.savedSessions).toEqual([expect.objectContaining({ completedTurns: [expect.objectContaining({ finalResult: "Saved result" })] })])
  })

  it("loads bounded inactive-Space session hints read-only and marks every one resume-unverified", () => {
    const first = "123e4567-e89b-42d3-a456-426614174000"
    const second = "223e4567-e89b-42d3-a456-426614174000"
    const key = "williamos:agent-session:space-b:c%3A%2Fproject"
    const stored = JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${first}`,
      sessions: [
        { schemaVersion: 1, sessionId: first, role: "Reviewer", provider: "Claude", assignment: "Review current work", reviewPath: "src/app.ts", updatedAt: "2026-08-29T10:00:00.000Z", completedTurns: [] },
        { schemaVersion: 1, sessionId: second, role: "Thinker", provider: "Local", assignment: "Conversation", updatedAt: "2026-08-29T10:01:00.000Z", completedTurns: [] },
      ],
    })
    window.localStorage.setItem(key, stored)

    const projection = loadSavedAgentSessionProjection("space-b", "c:/project")

    expect(projection.state).toBe("available")
    expect(projection.sessions).toEqual([
      expect.objectContaining({ id: `Claude:${first}`, role: "Reviewer", truth: "resume-unverified", status: "resume unverified" }),
      expect.objectContaining({ id: `Local:${second}`, role: "Thinker", truth: "resume-unverified", status: "resume unverified" }),
    ])
    expect(window.localStorage.getItem(key)).toBe(stored)
  })

  it.each([
    ["missing", null],
    ["corrupt", ""],
    ["corrupt", "{not-json"],
    ["oversized", "x".repeat(262_145)],
  ] as const)("reports %s inactive-Space storage as explicit unknown truth", (state, stored) => {
    const key = "williamos:agent-session:space-b:c%3A%2Fproject"
    if (stored !== null) window.localStorage.setItem(key, stored)

    expect(loadSavedAgentSessionProjection("space-b", "c:/project")).toEqual({ state, sessions: [] })
  })

  it("returns unavailable instead of evaluating a throwing localStorage getter outside its guard", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })

    expect(loadSavedAgentSessionProjection("space-b", "c:/project")).toEqual({ state: "unavailable", sessions: [] })
  })

  it("keeps an oversized current record explicitly unknown without restoring or deleting it", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const oversized = "x".repeat(262_145)
    window.localStorage.setItem(key, oversized)

    render(<Harness />)

    await waitFor(() => expect(expose!.collectionState).toBe("oversized"))
    expect(expose!.sessions).toEqual([])
    expect(window.localStorage.getItem(key)).toBe(oversized)
  })

  it("contains a throwing corrupt-record cleanup and keeps the current session truth unknown", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    window.localStorage.setItem(key, "{bad-json")
    const storagePrototype = Object.getPrototypeOf(window.localStorage) as Storage
    const removeItem = storagePrototype.removeItem
    vi.spyOn(storagePrototype, "removeItem").mockImplementation(function (candidate) {
      if (candidate === key) throw new DOMException("blocked", "SecurityError")
      return removeItem.call(this, candidate)
    })

    render(<Harness />)

    await waitFor(() => expect(expose!.collectionState).toBe("corrupt"))
    expect(expose!.sessions).toEqual([])
    expect(window.localStorage.getItem(key)).toBe("{bad-json")
  })

  it.each(["mixed", "all"] as const)("marks %s skipped migrated descriptors partial instead of reporting a known count", (shape) => {
    const valid = { schemaVersion: 1, sessionId: "codex-valid", role: "Builder", provider: "Codex", assignment: "Valid work", updatedAt: "2026-08-29T10:00:00.000Z", completedTurns: [] }
    const invalid = { schemaVersion: 1, sessionId: "123e4567-e89b-42d3-a456-426614174000", role: "Reviewer", provider: "Claude", assignment: "Invalid target", target: { kind: "file", path: "src/app.ts" }, updatedAt: "2026-08-29T10:01:00.000Z", completedTurns: [] }
    window.localStorage.setItem("williamos:agent-session:space-b:c%3A%2Fproject", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: null,
      sessions: shape === "mixed" ? [valid, invalid] : [invalid],
    }))

    const loaded = loadSavedAgentSessionProjection("space-b", "c:/project")
    expect(loaded.state).toBe("partial")
    expect(loaded.sessions).toEqual(shape === "mixed"
      ? [expect.objectContaining({ id: "Codex:codex-valid", truth: "resume-unverified" })]
      : [])
  })

  it("projects exact live turns ahead of duplicate saved hints with sanitized activity and Local thinking active", () => {
    const sessions: readonly ExperienceAgentSession[] = [
      { id: "Codex:build-1", role: "Builder", providerLabel: "Codex", assignment: "Build workspace", status: "resume unverified", evidence: "saved transcript", truth: "resume-unverified", kind: "durable-session", mode: "delegate" },
      { id: "Codex:build-1", role: "Builder", providerLabel: "Codex", assignment: "Build workspace", status: "working", evidence: "live agent stream", truth: "live", kind: "durable-session", mode: "delegate", presentation: "Builder validating the patch." },
      { id: "Local:123e4567-e89b-42d3-a456-426614174000", role: "Thinker", providerLabel: "Local", assignment: "Conversation", status: "thinking", evidence: "live model response", truth: "live", kind: "durable-session", mode: "delegate", presentation: "<thinking>hidden secret</thinking>" },
      { id: "Claude:223e4567-e89b-42d3-a456-426614174000", role: "Reviewer", providerLabel: "Claude", assignment: "Review current work", status: "resume unverified", evidence: "saved transcript", truth: "resume-unverified", kind: "durable-session", mode: "review" },
      { id: "world-worker:world-1:41:hermes-codex-bridge", role: "HERMES", providerLabel: "Local execution", assignment: "Finish the bounded slice", status: "implementing", evidence: "persisted assignment", truth: "persisted", kind: "world-worker", mode: "delegate" },
      { id: "world-worker:world-1:42:hermes-codex-bridge", role: "HERMES", providerLabel: "Local execution", assignment: "Recover the bounded slice", status: "blocked", evidence: "persisted assignment", truth: "persisted", kind: "world-worker", mode: "delegate" },
    ]

    expect(projectMissionAgentSessions(sessions, true)).toEqual([
      { id: "Codex:build-1", name: "Codex", role: "Builder", activity: "Builder validating the patch.", state: "working", truth: "live" },
      { id: "Local:123e4567-e89b-42d3-a456-426614174000", name: "Local", role: "Thinker", activity: "Conversation", state: "working", truth: "live" },
      { id: "Claude:223e4567-e89b-42d3-a456-426614174000", name: "Claude", role: "Reviewer", activity: "Review current work", state: "waiting", truth: "resume-unverified" },
      { id: "world-worker:world-1:41:hermes-codex-bridge", name: "Local execution", role: "HERMES", activity: "Finish the bounded slice", state: "working", truth: "persisted" },
      { id: "world-worker:world-1:42:hermes-codex-bridge", name: "Local execution", role: "HERMES", activity: "Recover the bounded slice", state: "blocked", truth: "persisted" },
    ])
  })

  it("runs one Codex Builder, Claude Reviewer, and Local Thinker concurrently and preserves out-of-order settlements", async () => {
    const encoder = new TextEncoder()
    const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { provider?: string; mode?: string }
      const lane = String(input) === "/api/loom/codex" ? "Codex" : body.mode === "review" ? "Review" : "Local"
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.set(lane, controller) } })))
    }))
    render(<Harness />)

    let codex!: Promise<unknown>
    act(() => { codex = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Build." }) })
    await waitFor(() => expect(streams.has("Codex")).toBe(true))
    act(() => streams.get("Codex")!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: "codex-concurrent", provider: "Codex", mode: "delegate", resumed: false })}\n`)))

    let review!: Promise<unknown>
    act(() => { review = expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts" }) })
    await waitFor(() => expect(streams.has("Review")).toBe(true))
    const reviewId = "123e4567-e89b-42d3-a456-426614174000"
    act(() => streams.get("Review")!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: reviewId, provider: "Claude", mode: "review", resumed: false })}\n`)))

    let local!: Promise<unknown>
    act(() => { local = expose!.runAgentTurn({ provider: "Local", role: "Thinker", assignment: "Conversation", prompt: "Think." }) })
    await waitFor(() => expect(streams.has("Local")).toBe(true))
    const localId = "223e4567-e89b-42d3-a456-426614174000"
    act(() => streams.get("Local")!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: localId, provider: "Local", mode: "delegate", resumed: false, continuity: "new" })}\n`)))

    await waitFor(() => expect(expose!.activeSessionIds).toEqual([
      "Codex:codex-concurrent", `Claude:${reviewId}`, `Local:${localId}`,
    ]))
    expect(expose!.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "Codex:codex-concurrent", status: "working" }),
      expect.objectContaining({ id: `Claude:${reviewId}`, status: "working" }),
      expect.objectContaining({ id: `Local:${localId}`, status: "thinking" }),
    ]))

    act(() => {
      streams.get("Local")!.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Local settled first." })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams.get("Local")!.close()
    })
    await act(async () => { await local })
    act(() => {
      streams.get("Codex")!.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Codex settled second." })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams.get("Codex")!.close()
    })
    await act(async () => { await codex })
    act(() => {
      streams.get("Review")!.enqueue(encoder.encode(`${JSON.stringify({ type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: reviewId, result: "Review settled last." } })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams.get("Review")!.close()
    })
    await act(async () => { await review })

    const stored = JSON.parse(String(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")))
    expect(stored.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "Codex", completedTurns: [expect.objectContaining({ finalResult: "Codex settled second." })] }),
      expect.objectContaining({ provider: "Claude", completedTurns: [expect.objectContaining({ finalResult: "Review settled last." })] }),
      expect.objectContaining({ provider: "Local", completedTurns: [expect.objectContaining({ finalResult: "Local settled first." })] }),
    ]))
    expect(expose!.activeSessionIds).toEqual([])

    cleanup()
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(3))
    expect(expose!.savedSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "Codex", completedTurns: [expect.objectContaining({ finalResult: "Codex settled second." })] }),
      expect.objectContaining({ provider: "Claude", completedTurns: [expect.objectContaining({ finalResult: "Review settled last." })] }),
      expect.objectContaining({ provider: "Local", completedTurns: [expect.objectContaining({ finalResult: "Local settled first." })] }),
    ]))
  })

  it("stops only the exact selected concurrent session while the other provider continues", async () => {
    const encoder = new TextEncoder()
    const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
    const signals = new Map<string, AbortSignal>()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { mode?: string }
      const lane = String(input) === "/api/loom/codex" ? "Codex" : body.mode === "review" ? "Review" : "Local"
      signals.set(lane, init!.signal as AbortSignal)
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.set(lane, controller) } })))
    }))
    render(<Harness />)
    let codex!: Promise<unknown>
    act(() => { codex = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Build." }) })
    await waitFor(() => expect(streams.has("Codex")).toBe(true))
    act(() => streams.get("Codex")!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: "codex-stop-isolation", provider: "Codex", mode: "delegate", resumed: false })}\n`)))

    const reviewId = "323e4567-e89b-42d3-a456-426614174000"
    let review!: Promise<unknown>
    act(() => { review = expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts" }) })
    await waitFor(() => expect(streams.has("Review")).toBe(true))
    act(() => streams.get("Review")!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: reviewId, provider: "Claude", mode: "review", resumed: false })}\n`)))
    await waitFor(() => expect(expose!.activeSessionIds).toEqual([
      "Codex:codex-stop-isolation",
      `Claude:${reviewId}`,
    ]))
    expect(expose!.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `Claude:${reviewId}`, role: "Reviewer", status: "working", truth: "live" }),
    ]))

    act(() => expose!.stop(`Claude:${reviewId}`))
    await expect(review).rejects.toMatchObject({ name: "AbortError" })
    expect(signals.get("Review")?.aborted).toBe(true)
    expect(signals.get("Codex")?.aborted).toBe(false)
    expect(expose!.activeSessionIds).toEqual(["Codex:codex-stop-isolation"])

    act(() => {
      streams.get("Codex")!.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Writer continued safely." })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams.get("Codex")!.close()
    })
    await act(async () => { await codex })
    expect(expose!.savedSessions).toEqual([
      expect.objectContaining({ provider: "Codex", completedTurns: [expect.objectContaining({ finalResult: "Writer continued safely." })] }),
    ])
  })

  it("keeps a newer exact active-session selection when another turn settles out of order and redirects it", async () => {
    const encoder = new TextEncoder()
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller) } })))
    }))
    render(<Harness />)

    let writer!: Promise<unknown>
    act(() => { writer = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Build." }) })
    await waitFor(() => expect(streams).toHaveLength(1))
    act(() => streams[0]!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: "codex-selection-cas", provider: "Codex", mode: "delegate", resumed: false })}\n`)))

    const reviewId = "623e4567-e89b-42d3-a456-426614174000"
    let review!: Promise<unknown>
    act(() => { review = expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts" }) })
    await waitFor(() => expect(streams).toHaveLength(2))
    act(() => streams[1]!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: reviewId, provider: "Claude", mode: "review", resumed: false })}\n`)))
    await waitFor(() => expect(expose!.activeSessionIds).toContain(`Claude:${reviewId}`))

    act(() => expect(expose!.selectSession(`Claude:${reviewId}`)).toBe(true))
    expect(expose!.selectedSessionKey).toBe(`Claude:${reviewId}`)
    expect(expose!.durableSession).toMatchObject({ provider: "Claude", sessionId: reviewId, role: "Reviewer" })

    act(() => {
      streams[0]!.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Writer settled while Reviewer stayed focused." })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams[0]!.close()
    })
    await act(async () => { await writer })
    expect(expose!.selectedSessionKey).toBe(`Claude:${reviewId}`)
    expect(expose!.durableSession).toMatchObject({ provider: "Claude", sessionId: reviewId, role: "Reviewer" })

    act(() => {
      streams[1]!.enqueue(encoder.encode(`${JSON.stringify({ type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: reviewId, result: "Reviewer settled last." } })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams[1]!.close()
    })
    await act(async () => { await review })
    expect(expose!.selectedSessionKey).toBe(`Claude:${reviewId}`)
    expect(expose!.savedSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "Codex", completedTurns: [expect.objectContaining({ finalResult: "Writer settled while Reviewer stayed focused." })] }),
      expect.objectContaining({ provider: "Claude", sessionId: reviewId, completedTurns: [expect.objectContaining({ finalResult: "Reviewer settled last." })] }),
    ]))

    let redirect!: Promise<unknown>
    act(() => { redirect = expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts", focus: "Redirect exactly." }) })
    await waitFor(() => expect(streams).toHaveLength(3))
    expect(requests[2]).toMatchObject({
      url: "/api/loom/agent",
      body: { mode: "review", sessionId: reviewId, resume: true, path: "src/app.ts", focus: "Redirect exactly." },
    })
    const redirectTurnId = expose!.activeTurns.find((turn) => turn.provider === "Claude" && turn.role === "Reviewer")?.id
    expect(redirectTurnId).toMatch(/^starting-claude-/)
    act(() => expose!.stop(redirectTurnId))
    await expect(redirect).rejects.toMatchObject({ name: "AbortError" })
  })

  it("restores the exact verified durable selection when a selected fresh turn is stopped", async () => {
    const localId = "723e4567-e89b-42d3-a456-426614174000"
    const encoder = new TextEncoder()
    let writerStream!: ReadableStreamDefaultController<Uint8Array>
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: localId, provider: "Local", mode: "delegate", resumed: false, continuity: "new" },
        { type: "result", text: "Verified prior result." },
        { type: "done", code: 0, reason: null },
      ))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { writerStream = controller } })))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await act(async () => { await expose!.runAgentTurn({ provider: "Local", role: "Thinker", assignment: "Conversation", prompt: "Establish prior." }) })
    expect(expose!.selectedSessionKey).toBe(`Local:${localId}`)
    expect(expose!.descriptorState).toBe("verified")

    let writer!: Promise<unknown>
    act(() => { writer = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/new.ts", prompt: "Build new." }) })
    act(() => writerStream.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: "codex-stopped-fresh", provider: "Codex", mode: "delegate", resumed: false })}\n`)))
    await waitFor(() => expect(expose!.activeSessionIds).toContain("Codex:codex-stopped-fresh"))
    act(() => expect(expose!.selectSession("Codex:codex-stopped-fresh")).toBe(true))
    expect(expose!.selectedSessionKey).toBe("Codex:codex-stopped-fresh")

    act(() => expose!.stop("Codex:codex-stopped-fresh"))
    await expect(writer).rejects.toMatchObject({ name: "AbortError" })

    expect(expose!.selectedSessionKey).toBe(`Local:${localId}`)
    expect(expose!.descriptorState).toBe("verified")
    expect(expose!.durableSession).toMatchObject({
      provider: "Local", sessionId: localId,
      completedTurns: [expect.objectContaining({ finalResult: "Verified prior result." })],
    })
    expect(expose!.savedSessions).toEqual([expect.objectContaining({ provider: "Local", sessionId: localId })])
    expect(expose!.sessions.some((session) => session.id === "Codex:codex-stopped-fresh")).toBe(false)
  })

  it("preserves the exact verified prior transcript when its accepted resume is stopped", async () => {
    const sessionId = "codex-verified-resume-stop"
    const encoder = new TextEncoder()
    let resumeStream!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
        { type: "result", text: "Verified prior transcript." },
        { type: "done", code: 0, reason: null },
      ))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { resumeStream = controller } }))))
    render(<Harness />)
    await act(async () => { await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "First." }) })
    const prior = expose!.durableSession

    let resume!: Promise<unknown>
    act(() => { resume = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Continue." }) })
    act(() => resumeStream.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: true })}\n`)))
    await waitFor(() => expect(expose!.activeSessionIds).toContain(`Codex:${sessionId}`))
    act(() => expose!.stop(`Codex:${sessionId}`))
    await expect(resume).rejects.toMatchObject({ name: "AbortError" })

    expect(expose!.selectedSessionKey).toBe(`Codex:${sessionId}`)
    expect(expose!.descriptorState).toBe("verified")
    expect(expose!.durableSession).toEqual(prior)
    expect(expose!.savedSessions).toEqual([expect.objectContaining({
      sessionId,
      completedTurns: [expect.objectContaining({ finalResult: "Verified prior transcript." })],
    })])
  })

  it("clears a selected accepted identity when its terminal failure persisted no durable session", async () => {
    const encoder = new TextEncoder()
    let stream!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } })))))
    render(<Harness />)

    let writer!: Promise<unknown>
    act(() => { writer = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/failing.ts", prompt: "Try." }) })
    act(() => stream.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: "codex-terminal-failure", provider: "Codex", mode: "delegate", resumed: false })}\n`)))
    await waitFor(() => expect(expose!.activeSessionIds).toContain("Codex:codex-terminal-failure"))
    act(() => expect(expose!.selectSession("Codex:codex-terminal-failure")).toBe(true))

    act(() => {
      stream.enqueue(encoder.encode(`${JSON.stringify({ type: "done", code: 1, reason: "PROVIDER_FAILED" })}\n`))
      stream.close()
    })
    await expect(writer).rejects.toThrow("AGENT_TURN_FAILED:PROVIDER_FAILED")

    await waitFor(() => expect(expose!.selectedSessionKey).toBeNull())
    expect(expose!.durableSession).toBeNull()
    expect(expose!.savedDescriptor).toBeNull()
    expect(expose!.descriptorState).toBe("none")
    expect(expose!.savedSessions).toEqual([])
    expect(expose!.sessions).toEqual([])
  })

  it("isolates a provider outage while another exact session continues and settles", async () => {
    const encoder = new TextEncoder()
    let codexStream!: ReadableStreamDefaultController<Uint8Array>
    let codexSignal!: AbortSignal
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/loom/codex") {
        codexSignal = init!.signal as AbortSignal
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { codexStream = controller } })))
      }
      return Promise.resolve(Response.json({ error: "LOCAL_UNAVAILABLE" }, { status: 503 }))
    }))
    render(<Harness />)

    let codex!: Promise<unknown>
    act(() => { codex = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Build." }) })
    act(() => codexStream.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: "codex-outage-isolation", provider: "Codex", mode: "delegate", resumed: false })}\n`)))
    await waitFor(() => expect(expose!.activeSessionIds).toEqual(["Codex:codex-outage-isolation"]))

    await expect(expose!.runAgentTurn({ provider: "Local", role: "Thinker", assignment: "Conversation", prompt: "Think." }))
      .rejects.toThrow("LOCAL_UNAVAILABLE")
    expect(codexSignal.aborted).toBe(false)
    expect(expose!.activeSessionIds).toEqual(["Codex:codex-outage-isolation"])

    act(() => {
      codexStream.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Writer survived the Local outage." })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      codexStream.close()
    })
    await act(async () => { await codex })
    expect(expose!.savedSessions).toEqual([
      expect.objectContaining({ provider: "Codex", completedTurns: [expect.objectContaining({ finalResult: "Writer survived the Local outage." })] }),
    ])
  })

  it("refuses a second turn for the same durable session while its exact resume is active", async () => {
    const sessionId = "codex-same-session"
    const encoder = new TextEncoder()
    let resumeStream!: ReadableStreamDefaultController<Uint8Array>
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
        { type: "result", text: "First turn." },
        { type: "done", code: 0, reason: null },
      ))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { resumeStream = controller } })))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await act(async () => { await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "First." }) })

    let resume!: Promise<unknown>
    act(() => { resume = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Resume." }) })
    act(() => resumeStream.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: true })}\n`)))
    await waitFor(() => expect(expose!.activeSessionIds).toEqual([`Codex:${sessionId}`]))
    expect(expose!.sessions.find((session) => session.id === `Codex:${sessionId}`)).toMatchObject({
      status: "working",
      truth: "live",
      presentation: "Agent is working.",
    })

    await expect(expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Duplicate." }))
      .rejects.toThrow("AGENT_SESSION_ALREADY_RUNNING")
    expect(fetcher).toHaveBeenCalledTimes(2)
    act(() => expose!.stop(`Codex:${sessionId}`))
    await expect(resume).rejects.toMatchObject({ name: "AbortError" })
  })

  it("projects an exact server-accepted restored turn as live while it is running", async () => {
    const sessionId = "codex-restored-live"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Codex:${sessionId}`,
      sessions: [{
        schemaVersion: 1, sessionId, role: "Builder", provider: "Codex", assignment: "src/app.ts",
        updatedAt: "2026-08-29T12:00:00.000Z", completedTurns: [],
      }],
    }))
    const encoder = new TextEncoder()
    let responseStream!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) { responseStream = controller },
    })))))
    render(<Harness />)

    let resume!: Promise<unknown>
    act(() => { resume = expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Continue." }) })
    act(() => responseStream.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: true })}\n`)))

    await waitFor(() => expect(expose!.sessions.find((session) => session.id === `Codex:${sessionId}`)).toMatchObject({
      status: "working",
      truth: "live",
      presentation: "Agent is working.",
    }))
    act(() => expose!.stop(`Codex:${sessionId}`))
    await expect(resume).rejects.toMatchObject({ name: "AbortError" })
  })

  it("keeps all twelve bounded session controls horizontally reachable and selectable", () => {
    const onSelect = vi.fn()
    const sessions = Array.from({ length: 12 }, (_, index) => ({
      id: `Codex:session-${index}`,
      role: "Builder",
      providerLabel: "Codex",
      assignment: `src/session-${index}.ts`,
      status: "resume unverified",
      evidence: "saved transcript · server verification required",
      truth: "resume-unverified" as const,
      kind: "durable-session" as const,
      mode: "delegate" as const,
    }))

    render(<AgentSessionStrip sessions={sessions} onSelect={onSelect} />)

    const strip = screen.getByRole("navigation", { name: "Durable agent sessions" })
    expect(strip.getAttribute("tabindex")).toBe("0")
    expect(strip.style.overflowX).toBe("auto")
    expect(strip.style.flexWrap).toBe("nowrap")
    const buttons = within(strip).getAllByRole("button")
    expect(buttons).toHaveLength(12)
    fireEvent.click(buttons[11])
    expect(onSelect).toHaveBeenCalledWith(sessions[11])
  })

  it("renders three compact truthful levels and bounds long assignments without hiding their full value", () => {
    const longAssignment = "Diagnose the exact TerraFusion developer preview attachment failure while preserving the current source selection and reporting only verified runtime evidence"
    const sessions: readonly ExperienceAgentSession[] = [
      {
        id: "Codex:assignment-builder",
        role: "Builder",
        providerLabel: "Codex",
        assignment: "Implement exact save conflict recovery",
        status: "working",
        evidence: "live agent stream",
        truth: "live",
        kind: "durable-session",
        mode: "delegate",
      },
      {
        id: "Claude:assignment-reviewer",
        role: "Reviewer",
        providerLabel: "Claude",
        assignment: "Review components/workspace-shell/workspace-shell.tsx",
        status: "ready",
        evidence: "verified transcript",
        truth: "verified",
        kind: "durable-session",
        mode: "review",
      },
      {
        id: "Local:assignment-thinker",
        role: "Thinker",
        providerLabel: "Local",
        assignment: longAssignment,
        status: "resume unverified",
        evidence: "saved transcript · server verification required",
        truth: "resume-unverified",
        kind: "durable-session",
        mode: "delegate",
      },
    ]

    render(<AgentSessionStrip sessions={sessions} />)

    for (const session of sessions) {
      const chip = screen.getByRole("button", {
        name: `${session.role} · ${session.providerLabel} · ${session.assignment}`,
      })
      expect(chip.querySelector('[data-agent-session-level="identity"]')?.textContent).toBe(`${session.role} · ${session.providerLabel}`)
      const assignment = chip.querySelector('[data-agent-session-level="assignment"]') as HTMLElement | null
      expect(assignment?.textContent).toBe(session.assignment)
      expect(assignment?.getAttribute("title")).toBe(session.assignment)
      expect(assignment?.className).toContain("truncate")
      expect(chip.querySelector('[data-agent-session-level="truth"]')?.textContent).toBe(`${session.status} · ${session.evidence}`)
      expect(chip.className).toContain("w-48")
      expect(chip.className).toContain("max-w-48")
    }

    expect(screen.getByText("Implement exact save conflict recovery")).toBeTruthy()
    expect(screen.getByText("Review components/workspace-shell/workspace-shell.tsx")).toBeTruthy()
    expect(screen.getByText(longAssignment)).toBeTruthy()
  })

  it("presents and stops each concurrent turn by its exact session identity", () => {
    const onSelect = vi.fn()
    const onStop = vi.fn()
    const sessions = [
      { id: "Codex:writer", role: "Builder", providerLabel: "Codex", assignment: "src/app.ts", status: "working", evidence: "live agent stream", truth: "live" as const, kind: "durable-session" as const, mode: "delegate" as const, presentation: "Agent is working." },
      { id: "Claude:reviewer", role: "Reviewer", providerLabel: "Claude", assignment: "Review src/app.ts", status: "working", evidence: "live agent stream", truth: "live" as const, kind: "durable-session" as const, mode: "review" as const, presentation: "Agent is working." },
      { id: "Local:thinker", role: "Thinker", providerLabel: "Local", assignment: "Conversation", status: "thinking", evidence: "live model response", truth: "live" as const, kind: "durable-session" as const, mode: "delegate" as const, presentation: "Agent is working." },
    ]
    render(<AgentSessionStrip
      sessions={sessions}
      runningTurns={[
        { id: "Codex:writer", provider: "Codex", role: "Builder", sessionId: "writer", presentation: "Agent is working.", descriptor: null },
        { id: "Claude:reviewer", provider: "Claude", role: "Reviewer", sessionId: "reviewer", presentation: "Agent is working.", descriptor: null },
        { id: "Local:thinker", provider: "Local", role: "Thinker", sessionId: "thinker", presentation: "Agent is working.", descriptor: null },
      ]}
      onStop={onStop}
      onSelect={onSelect}
    />)

    fireEvent.click(screen.getByRole("button", { name: "Stop Claude Reviewer turn" }))
    expect(onStop).toHaveBeenCalledWith("Claude:reviewer")
    fireEvent.click(screen.getByRole("button", { name: "Thinker · Local · Conversation" }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "Local:thinker", presentation: "Agent is working." }))
  })

  it("launches the bounded writer, reviewer, and thinker lanes from one live Space", async () => {
    const encoder = new TextEncoder()
    const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
      if ((url === "/api/loom/codex" || url === "/api/loom/agent") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { mode?: string; provider?: string }
        const lane = url === "/api/loom/codex" ? "Codex" : body.mode === "review" ? "Review" : "Local"
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.set(lane, controller) } })))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    const conversation = await openWilliamConversation()

    fireEvent.click(screen.getByRole("button", { name: "Delegate" }))
    fireEvent.click(screen.getByRole("button", { name: "Codex" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Build safely." } })
    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Delegate" }))
    await waitFor(() => expect(streams.has("Codex")).toBe(true))
    act(() => streams.get("Codex")!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: "codex-ui-concurrent", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH })}\n`)))
    await screen.findByRole("button", { name: "Stop Codex Builder turn" })
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))

    fireEvent.click(screen.getByRole("button", { name: "Review" }))
    fireEvent.click(screen.getByRole("button", { name: "Start review" }))
    await waitFor(() => expect(streams.has("Review")).toBe(true))
    const reviewId = "423e4567-e89b-42d3-a456-426614174000"
    act(() => streams.get("Review")!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: reviewId, provider: "Claude", mode: "review", resumed: false })}\n`)))
    await screen.findByRole("button", { name: "Stop Claude Reviewer turn" })

    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Local" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Think alongside them." } })
    const askLocal = within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Ask Local" }) as HTMLButtonElement
    expect(askLocal.disabled).toBe(false)
    fireEvent.click(askLocal)
    await waitFor(() => expect(streams.has("Local")).toBe(true))
    act(() => {
      streams.get("Codex")!.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Writer done first." })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams.get("Codex")!.close()
    })
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop Codex Builder turn" })).toBeNull())
    expect((within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Thinking" }) as HTMLButtonElement).disabled).toBe(true)
    const localId = "523e4567-e89b-42d3-a456-426614174000"
    act(() => streams.get("Local")!.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: localId, provider: "Local", mode: "delegate", resumed: false, continuity: "new" })}\n`)))

    expect(await screen.findByRole("button", { name: "Stop Local Thinker turn" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Builder · Codex · src\/app.ts/i })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Reviewer · Claude · Review src\/app.ts/i }))
    expect(screen.getByText("Reviewer · Claude")).toBeTruthy()
    const pause = screen.getByRole("button", { name: "Pause" })
    fireEvent.click(pause)
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop Claude Reviewer turn" })).toBeNull())
    expect(screen.queryByRole("button", { name: "Stop Codex Builder turn" })).toBeNull()
    expect(screen.getByRole("button", { name: "Stop Local Thinker turn" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Thinker · Local · Conversation/i })).toBeTruthy()

    act(() => {
      streams.forEach((stream, lane) => {
        if (lane === "Review" || lane === "Codex") return
        stream.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Thinker done." })}\n`))
        stream.enqueue(encoder.encode(`${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
        stream.close()
      })
    })
    await waitFor(() => expect(screen.queryByRole("button", { name: /Stop .* turn/ })).toBeNull())
  })

  it("forks only the exact verified idle Claude Builder, preserves its transcript, and resumes the selected child", async () => {
    const sourceId = "123e4567-e89b-42d3-a456-426614174000"
    const childId = "223e4567-e89b-42d3-a456-426614174000"
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: sourceId, resumed: false },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sourceId, result: "Source result" } },
        { type: "done", reason: null, code: 0 },
      ))
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: childId, provider: "Claude", mode: "fork", resumed: false, forkedFrom: sourceId },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: childId, result: "Fork result" } },
        { type: "done", reason: null, code: 0 },
      ))
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: childId, provider: "Claude", mode: "delegate", resumed: true, forkedFrom: sourceId },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: childId, result: "Child continued" } },
        { type: "done", reason: null, code: 0 },
      ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "Original approach", prompt: "Build the source." })
    })
    const key = "williamos:agent-session:owner-1:terrafusion"
    const beforeFork = JSON.parse(String(window.localStorage.getItem(key)))
    const sourceBefore = structuredClone(beforeFork.sessions.find((session: { sessionId: string }) => session.sessionId === sourceId))

    await act(async () => {
      await expose!.forkClaudeSession({
        sourceSessionId: sourceId,
        assignment: "Original approach",
        prompt: "Try the smaller alternative.",
      })
    })

    const afterFork = JSON.parse(String(window.localStorage.getItem(key)))
    expect(afterFork.sessions.find((session: { sessionId: string }) => session.sessionId === sourceId)).toEqual(sourceBefore)
    expect(afterFork.sessions.find((session: { sessionId: string }) => session.sessionId === childId)).toMatchObject({
      provider: "Claude", role: "Builder", assignment: "Original approach", forkedFrom: sourceId,
      completedTurns: [{ ownerPrompt: "Try the smaller alternative.", finalResult: "Fork result" }],
    })
    expect(afterFork.selectedSessionKey).toBe(`Claude:${childId}`)
    expect(expose!.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `Claude:${sourceId}`, truth: "live" }),
      expect.objectContaining({ id: `Claude:${childId}`, truth: "live", forkedFrom: sourceId }),
    ]))

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "Original approach", prompt: "Continue the child." })
    })
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toMatchObject({
      provider: "cloud", sessionId: childId, resume: true, prompt: "Continue the child.",
    })
    const afterResume = JSON.parse(String(window.localStorage.getItem(key)))
    expect(afterResume.sessions.find((session: { sessionId: string }) => session.sessionId === childId)).toMatchObject({
      forkedFrom: sourceId,
      completedTurns: [
        { ownerPrompt: "Try the smaller alternative.", finalResult: "Fork result" },
        { ownerPrompt: "Continue the child.", finalResult: "Child continued" },
      ],
    })

    cleanup()
    render(<Harness />)
    await waitFor(() => expect(expose!.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `Claude:${childId}`, truth: "resume-unverified", forkedFrom: sourceId }),
    ])))
  })

  it("rejects malformed server lineage instead of trusting the restored browser hint", async () => {
    const sourceId = "123e4567-e89b-42d3-a456-426614174000"
    const childId = "223e4567-e89b-42d3-a456-426614174000"
    const key = "williamos:agent-session:owner-1:terrafusion"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${childId}`,
      sessions: [{
        schemaVersion: 1, sessionId: childId, role: "Builder", provider: "Claude",
        assignment: "Forked approach", forkedFrom: sourceId,
        updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [],
      }],
    }))
    const before = window.localStorage.getItem(key)
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: childId, provider: "Claude", mode: "delegate", resumed: true, forkedFrom: childId },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: childId, result: "Should not persist" } },
      { type: "done", reason: null, code: 0 },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    await expect(act(async () => expose!.runAgentTurn({
      provider: "Claude", role: "Builder", assignment: "Forked approach", prompt: "Continue child.",
    }))).rejects.toThrow("AGENT_STREAM_INVALID")
    expect(window.localStorage.getItem(key)).toBe(before)
  })

  it("refuses to fork an unverified restored Claude hint without touching transport or persistence", async () => {
    const sourceId = "123e4567-e89b-42d3-a456-426614174000"
    const key = "williamos:agent-session:owner-1:terrafusion"
    const persisted = JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${sourceId}`,
      sessions: [{
        schemaVersion: 1, sessionId: sourceId, role: "Builder", provider: "Claude",
        assignment: "Original approach", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [],
      }],
    })
    window.localStorage.setItem(key, persisted)
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))

    await expect(act(async () => expose!.forkClaudeSession({
      sourceSessionId: sourceId, assignment: "Original approach", prompt: "Try another path.",
    }))).rejects.toThrow("AGENT_FORK_UNAVAILABLE")
    expect(fetcher).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(key)).toBe(persisted)
  })

  it("materializes no child and leaves the verified source byte-for-byte intact when fork startup fails", async () => {
    const sourceId = "123e4567-e89b-42d3-a456-426614174000"
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId: sourceId, resumed: false },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sourceId, result: "Source result" } },
        { type: "done", reason: null, code: 0 },
      ))
      .mockResolvedValueOnce(ndjson({ type: "done", reason: "FORK_SESSION_ID_INVALID", code: null }))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await act(async () => {
      await expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "Original approach", prompt: "Build source." })
    })
    const key = "williamos:agent-session:owner-1:terrafusion"
    const before = window.localStorage.getItem(key)

    await expect(act(async () => expose!.forkClaudeSession({
      sourceSessionId: sourceId, assignment: "Original approach", prompt: "Diverge.",
    }))).rejects.toThrow("AGENT_TURN_FAILED:FORK_SESSION_ID_INVALID")
    expect(window.localStorage.getItem(key)).toBe(before)
    expect(expose!.sessions).toEqual([expect.objectContaining({ id: `Claude:${sourceId}`, truth: "live" })])
  })

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

  it("projects no prior-Space session on the first render of a new storage scope", async () => {
    const aId = "123e4567-e89b-42d3-a456-426614174000"
    const bId = "223e4567-e89b-42d3-a456-426614174000"
    const descriptor = (sessionId: string, assignment: string) => ({
      schemaVersion: 1, sessionId, role: "Builder", provider: "Claude", assignment,
      updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [],
    })
    window.localStorage.setItem("williamos:agent-session:owner-a:project-a", JSON.stringify({ schemaVersion: 3, selectedSessionKey: `Claude:${aId}`, sessions: [descriptor(aId, "A only")] }))
    window.localStorage.setItem("williamos:agent-session:owner-b:project-b", JSON.stringify({ schemaVersion: 3, selectedSessionKey: `Claude:${bId}`, sessions: [descriptor(bId, "B only")] }))
    const observed: string[][] = []
    function Probe({ ownerScope, worldScope }: { ownerScope: string; worldScope: string }) {
      const controller = useExperienceAgentSessions({ ownerScope, worldScope, worldId: ownerScope, executionSession: null })
      observed.push(controller.sessions.map((session) => session.assignment))
      return <span>{controller.sessions.map((session) => session.assignment).join(",") || "No sessions"}</span>
    }
    const view = render(<Probe ownerScope="owner-a" worldScope="project-a" />)
    await screen.findByText("A only")
    const marker = observed.length

    view.rerender(<Probe ownerScope="owner-b" worldScope="project-b" />)

    expect(observed[marker]).toEqual([])
    await screen.findByText("B only")
    expect(screen.queryByText("A only")).toBeNull()
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

  it("returns a transactional selection verdict and preserves the prior selection when persistence fails", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const firstId = "123e4567-e89b-42d3-a456-426614174000"
    const secondId = "223e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${firstId}`,
      sessions: [
        { schemaVersion: 1, sessionId: firstId, role: "Builder", provider: "Claude", assignment: "src/first.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [] },
        { schemaVersion: 1, sessionId: secondId, role: "Builder", provider: "Claude", assignment: "src/second.ts", updatedAt: "2026-08-27T16:06:00.000Z", completedTurns: [] },
      ],
    }))
    render(<Harness />)
    await waitFor(() => expect(expose!.selectedSessionKey).toBe(`Claude:${firstId}`))
    const durableStorage = window.localStorage
    vi.stubGlobal("localStorage", {
      getItem: durableStorage.getItem.bind(durableStorage),
      removeItem: durableStorage.removeItem.bind(durableStorage),
      clear: durableStorage.clear.bind(durableStorage),
      key: durableStorage.key.bind(durableStorage),
      get length() { return durableStorage.length },
      setItem() { throw new DOMException("quota", "QuotaExceededError") },
    })

    let selected: unknown
    act(() => { selected = expose!.selectSession(`Claude:${secondId}`) })

    expect(selected).toBe(false)
    expect(expose!.selectedSessionKey).toBe(`Claude:${firstId}`)
    expect(JSON.parse(String(window.localStorage.getItem(key))).selectedSessionKey).toBe(`Claude:${firstId}`)
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

  it("refuses to parse or rewrite an oversized aggregate collection during current restore", async () => {
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
    const stored = JSON.stringify({ schemaVersion: 3, selectedSessionKey: "Codex:codex-session-11", sessions })
    window.localStorage.setItem(key, stored)

    render(<Harness />)
    await waitFor(() => expect(expose!.collectionState).toBe("oversized"))

    expect(expose!.savedSessions).toEqual([])
    expect(window.localStorage.getItem(key)).toBe(stored)
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

  it("fails transactionally rather than pruning the just-completed multibyte canonical result and marking it ready", async () => {
    const sessionId = "codex-multibyte-result"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "result", text: "😀".repeat(100_000) },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Codex", role: "Builder", assignment: "src/huge.ts", prompt: "Keep the canonical result." })
    })).rejects.toThrow("AGENT_SESSION_COLLECTION_TOO_LARGE")

    expect(expose!.savedSessions).toEqual([])
    expect(expose!.sessions).toEqual([])
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it("keeps a restored descriptor pending and unverified before a canonical session frame arrives", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 1, sessionId, role: "Builder", provider: "Claude", assignment: "src/app.ts", updatedAt: "2026-08-27T16:05:00.000Z",
    }))
    let resolveFetch!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(1))

    let turn!: Promise<unknown>
    act(() => { turn = expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "src/app.ts", prompt: "Resume." }) })
    await waitFor(() => expect(expose!.activeProvider).toBe("Claude"))

    expect(expose!.sessions).toEqual([expect.objectContaining({
      id: `Claude:${sessionId}`,
      truth: "resume-unverified",
      status: "resume unverified",
      evidence: "saved transcript · server verification required",
    })])
    act(() => expose!.stop())
    resolveFetch(new Response(null, { status: 499 }))
    await expect(turn).rejects.toMatchObject({ name: "AbortError" })
  })

  it("demotes a verified resumed session after a recoverable failed turn while preserving its canonical transcript", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId, resumed: false },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Canonical first result" } },
        { type: "done", code: 0, reason: null },
      ))
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId, resumed: true },
        { type: "done", code: null, reason: "TIMEOUT" },
      ))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await act(async () => {
      await expose!.runClaudeTurn({ role: "Builder", assignment: "src/app.ts", prompt: "Start." })
    })
    expect(expose!.sessions).toEqual([expect.objectContaining({ truth: "live", lastResult: "Canonical first result" })])

    let failure: unknown
    await act(async () => {
      try {
        await expose!.runClaudeTurn({ role: "Builder", assignment: "src/app.ts", prompt: "Resume." })
      } catch (error) {
        failure = error
      }
    })
    expect(failure).toEqual(expect.objectContaining({ message: "AGENT_TURN_FAILED:TIMEOUT" }))

    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ sessionId, resume: true })
    await waitFor(() => expect(expose!.sessions).toEqual([expect.objectContaining({
      id: `Claude:${sessionId}`,
      truth: "resume-unverified",
      status: "resume unverified",
      lastResult: "Canonical first result",
    })]))
    expect(expose!.descriptorState).toBe("unverified")
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
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "delta", text: "Working from src/app.ts." },
        { type: "result", text: "Completed the captured assignment." },
        { type: "done", code: 0, reason: null },
      ))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    const conversation = await openWilliamConversation()

    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Local" }))
    expect(screen.queryByRole("group", { name: "Choose agent provider" })).toBeNull()
    expect(screen.getByText("Local conversation · no workspace mutation")).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "The Line" }).getAttribute("placeholder")).toBe("Ask the Local model")
    expect(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Ask Local" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))

    fireEvent.click(screen.getByRole("button", { name: "Delegate" }))
    expect(screen.getByRole("group", { name: "Choose agent provider" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Codex" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Claude" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Local" })).toBeNull()
    const line = screen.getByRole("form", { name: "The Line" })
    expect((within(line).getByRole("button", { name: "Delegate" }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Codex" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Fix the selected defect." } })
    fireEvent.click(screen.getByRole("tab", { name: "other.ts" }))
    await waitFor(() => expect(screen.queryByRole("form", { name: "The Line" })).toBeNull())
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/loom/codex")).toBe(false)

    expect(screen.getByText("src/other.ts")).toBeTruthy()
  })

  it("pauses only the exact selected running session without persisting a partial turn or leaving an agent Line open", async () => {
    const sessionId = "codex-pause-session"
    const key = "williamos:agent-session:server-world:c%3A%2Frepos%2Fterrafusion"
    const priorTurn = {
      ownerPrompt: "Implement the prior bounded change.",
      finalResult: "Prior canonical result.",
      completedAt: "2026-08-28T12:00:00.000Z",
    }
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Codex:${sessionId}`,
      sessions: [{
        schemaVersion: 1, sessionId, role: "Builder", provider: "Codex", assignment: "General project work",
        updatedAt: priorTurn.completedAt, completedTurns: [priorTurn],
      }],
    }))
    const encoder = new TextEncoder()
    let cancelled = false
    let requestSignal: AbortSignal | undefined
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const agentResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
      cancel() { cancelled = true },
    }))
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
      if (url === "/api/loom/codex" && init?.method === "POST") {
        requestSignal = init.signal ?? undefined
        return Promise.resolve(agentResponse)
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await screen.findByLabelText("Source content")
    fireEvent.click(await screen.findByRole("button", { name: /Builder · Codex · General project work/ }))
    const idlePause = screen.getByRole("button", { name: "Pause unavailable" }) as HTMLButtonElement
    expect(idlePause.disabled).toBe(true)
    expect(idlePause.title).toBe("Only the selected running session can be paused.")

    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Continue the bounded work." } })
    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Delegate" }))
    await screen.findByRole("button", { name: "Stop Codex Builder turn" })
    const preSessionPause = screen.getByRole("button", { name: "Pause unavailable" }) as HTMLButtonElement
    expect(preSessionPause.disabled).toBe(true)
    fireEvent.click(preSessionPause)
    expect(cancelled).toBe(false)
    expect(requestSignal?.aborted).toBe(false)

    act(() => {
      streamController!.enqueue(encoder.encode(`${JSON.stringify({
        type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: true,
        selectedPath: "src/app.ts", assignmentHash: "a".repeat(64),
      })}\n`))
      streamController!.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "Partial work that must not persist." })}\n`))
    })
    const pause = await screen.findByRole("button", { name: "Pause" })
    fireEvent.click(pause)

    await waitFor(() => expect(cancelled).toBe(true))
    expect(requestSignal?.aborted).toBe(true)
    await waitFor(() => expect(screen.queryByRole("form", { name: "The Line" })).toBeNull())
    expect(screen.queryByRole("button", { name: "Stop Codex Builder turn" })).toBeNull()
    expect((screen.getByRole("button", { name: "Pause unavailable" }) as HTMLButtonElement).disabled).toBe(true)
    const stored = JSON.parse(String(window.localStorage.getItem(key)))
    expect(stored.selectedSessionKey).toBe(`Codex:${sessionId}`)
    expect(stored.sessions).toHaveLength(1)
    expect(stored.sessions[0].completedTurns).toEqual([priorTurn])
    expect(stored.sessions[0].completedTurns).not.toContainEqual(expect.objectContaining({ finalResult: expect.stringContaining("Partial work") }))
    expect(screen.getByRole("button", { name: /Builder · Codex · General project work/ })).toBeTruthy()
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
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
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
    expect(await screen.findByText("Updated src/app.ts.")).toBeTruthy()
    expect(sourceReads).toBeGreaterThanOrEqual(2)
    expect(diffReads).toBeGreaterThanOrEqual(2)
    expect(JSON.parse(String(window.localStorage.getItem("williamos:agent-session:server-world:c%3A%2Frepos%2Fterrafusion"))).sessions[0].target).toEqual({
      kind: "file",
      path: "src/app.ts",
    })
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: /Builder · Codex · src\/app.ts/i }))
    expect(screen.getByText("Updated src/app.ts.")).toBeTruthy()
  })

  it("keeps agent work running when The Line closes and fences its late presentation from another Line", async () => {
    const sessionId = "423e4567-e89b-42d3-a456-426614174000"
    const encoder = new TextEncoder()
    let agentStream!: ReadableStreamDefaultController<Uint8Array>
    let requestSignal: AbortSignal | undefined
    let cancelled = false
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { agentStream = controller },
      cancel() { cancelled = true },
    }))
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url === "/api/loom/agent" && init?.method === "POST") {
        requestSignal = init.signal ?? undefined
        return Promise.resolve(response)
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    const conversation = await openWilliamConversation()
    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Local" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Explain the current work." } })
    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Ask Local" }))

    act(() => {
      agentStream.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId, provider: "Local", mode: "delegate", resumed: false, continuity: "new" })}\n`))
      agentStream.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "Validated live progress." })}\n`))
    })
    expect(await screen.findByText("Agent is working.")).toBeTruthy()
    expect(screen.queryByText("Validated live progress.")).toBeNull()
    expect(screen.getByRole("button", { name: "Stop Local Thinker turn" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    expect(requestSignal?.aborted).toBe(false)
    expect(cancelled).toBe(false)

    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Local" }))
    act(() => {
      agentStream.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "Late old-operation progress." })}\n`))
    })
    expect(screen.queryByText("Late old-operation progress.")).toBeNull()

    act(() => {
      agentStream.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Canonical persisted local result." })}\n`))
      agentStream.enqueue(encoder.encode(`${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      agentStream.close()
    })
    const saved = await screen.findByRole("button", { name: /Thinker · Local · Conversation/i })
    const close = screen.queryByRole("button", { name: "Close The Line" })
    if (close) fireEvent.click(close)
    fireEvent.click(saved)
    expect(await screen.findByText("Canonical persisted local result.")).toBeTruthy()
  })

  it("refreshes the committed Codex promotion while surfacing transcript persistence failure", async () => {
    const sessionId = "codex-committed-quota"
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
        return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: sourceReads === 1 ? "export const version = 1\n" : "export const version = 2\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      }
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: diffReads === 1 ? "" : "+export const version = 2" }))
      }
      if (url === "/api/loom/codex" && init?.method === "POST") return Promise.resolve(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "result", text: "The repository mutation committed." },
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
    const durableStorage = window.localStorage
    vi.stubGlobal("localStorage", {
      getItem: durableStorage.getItem.bind(durableStorage), removeItem: durableStorage.removeItem.bind(durableStorage),
      clear: durableStorage.clear.bind(durableStorage), key: durableStorage.key.bind(durableStorage),
      get length() { return durableStorage.length }, setItem() { throw new DOMException("quota", "QuotaExceededError") },
    })

    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Delegate" }))

    await waitFor(() => expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const version = 2\n"))
    expect(diffReads).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("AGENT_SESSION_PERSISTENCE_FAILED")).toBeTruthy()
    expect(window.localStorage.getItem("williamos:agent-session:server-world:c%3A%2Frepos%2Fterrafusion")).toBeNull()
  })

  it.each([
    ["dirty-conflict", true, false, "Codex saved src/app.ts, but Source has newer unsaved edits. Your buffer was preserved."],
    ["failed refresh", false, true, "Codex saved src/app.ts, but Source or Changes could not refresh."],
  ])("keeps the canonical persisted final visible with a separate %s warning", async (_case, makeDirty, failRefresh, warning) => {
    const sessionId = `codex-persisted-${failRefresh ? "failed" : "dirty"}`
    let sourceReads = 0
    let diffReads = 0
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse("server"))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, spine: EMPTY_SPINE, judgment: null }))
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        sourceReads += 1
        if (failRefresh && sourceReads > 1) return Promise.resolve(Response.json({ error: "read failed" }, { status: 500 }))
        return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: sourceReads === 1 ? "export const version = 1\n" : "export const version = 2\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      }
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: diffReads === 1 ? "" : "+export const version = 2" }))
      }
      if (url === "/api/loom/codex" && init?.method === "POST") return Promise.resolve(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "result", text: "The repository mutation committed." },
        { type: "done", code: 0, reason: null },
      ))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))
    render(<WorkspaceShell />)
    const source = await screen.findByLabelText("Source content") as HTMLTextAreaElement
    if (makeDirty) fireEvent.change(source, { target: { value: "owner unsaved buffer\n" } })
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }))
    fireEvent.click(screen.getByRole("button", { name: "Codex" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Update the selected file." } })
    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Delegate" }))

    expect(await screen.findByText((content) => content.includes("The repository mutation committed.") && content.includes(warning))).toBeTruthy()
    expect(diffReads).toBeGreaterThanOrEqual(2)
    const stored = JSON.parse(String(window.localStorage.getItem("williamos:agent-session:server-world:c%3A%2Frepos%2Fterrafusion")))
    expect(stored.sessions[0].completedTurns.at(-1).finalResult).toBe("The repository mutation committed.")
  })

  it.each([
    ["dirty-conflict", true, false, "Codex saved src/app.ts, but Source has newer unsaved edits. Your buffer was preserved. Transcript persistence also failed (AGENT_SESSION_PERSISTENCE_FAILED)."],
    ["failed refresh", false, true, "Codex saved src/app.ts, but Source or Changes could not refresh. Transcript persistence also failed (AGENT_SESSION_PERSISTENCE_FAILED)."],
  ])("surfaces both committed transcript persistence failure and %s", async (_case, makeDirty, failRefresh, expected) => {
    const sessionId = `codex-combined-${failRefresh ? "failed" : "dirty"}`
    let sourceReads = 0
    let diffReads = 0
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse("server"))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, spine: EMPTY_SPINE, judgment: null }))
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        sourceReads += 1
        if (failRefresh && sourceReads > 1) return Promise.resolve(Response.json({ error: "read failed" }, { status: 500 }))
        return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: sourceReads === 1 ? "export const version = 1\n" : "export const version = 2\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      }
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: diffReads === 1 ? "" : "+export const version = 2" }))
      }
      if (url === "/api/loom/codex" && init?.method === "POST") return Promise.resolve(ndjson(
        { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
        { type: "result", text: "The repository mutation committed." },
        { type: "done", code: 0, reason: null },
      ))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))
    render(<WorkspaceShell />)
    const source = await screen.findByLabelText("Source content") as HTMLTextAreaElement
    if (makeDirty) fireEvent.change(source, { target: { value: "owner unsaved buffer\n" } })
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }))
    fireEvent.click(screen.getByRole("button", { name: "Codex" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Update the selected file." } })
    const durableStorage = window.localStorage
    vi.stubGlobal("localStorage", {
      getItem: durableStorage.getItem.bind(durableStorage), removeItem: durableStorage.removeItem.bind(durableStorage),
      clear: durableStorage.clear.bind(durableStorage), key: durableStorage.key.bind(durableStorage),
      get length() { return durableStorage.length }, setItem() { throw new DOMException("quota", "QuotaExceededError") },
    })

    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Delegate" }))

    expect(await screen.findByText(expected)).toBeTruthy()
    expect(diffReads).toBeGreaterThanOrEqual(2)
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe(makeDirty ? "owner unsaved buffer\n" : "export const version = 1\n")
  })

  it("restores canonical session inspection and labels its Mission Control hint saved and unverified", async () => {
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
    expect(within(mission).getByText(/Codex/)).toBeTruthy()
    expect(within(mission).getByText("Saved · resume unverified")).toBeTruthy()
    expect(within(mission).queryByText("No active agents")).toBeNull()
  })

  it.each([
    ["partial", 2],
    ["oversized", 1],
  ] as const)("promotes %s restored truth only after a successful canonical persistence and gives Mission the exact %i-session count", async (initialState, expectedCount) => {
    const key = "williamos:agent-session:browser-world:c%3A%2Frepos%2Fterrafusion"
    if (initialState === "partial") {
      window.localStorage.setItem(key, JSON.stringify({
        schemaVersion: 3,
        selectedSessionKey: null,
        sessions: [
          { schemaVersion: 1, sessionId: "codex-valid", role: "Builder", provider: "Codex", assignment: "Existing valid work", updatedAt: "2026-08-29T10:00:00.000Z", completedTurns: [] },
          { schemaVersion: 1, sessionId: "123e4567-e89b-42d3-a456-426614174000", role: "Reviewer", provider: "Claude", assignment: "Invalid target", target: { kind: "file", path: "src/app.ts" }, updatedAt: "2026-08-29T10:01:00.000Z", completedTurns: [] },
        ],
      }))
    } else {
      window.localStorage.setItem(key, "x".repeat(262_145))
    }
    const localId = "223e4567-e89b-42d3-a456-426614174000"
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/agent" && init?.method === "POST") return Promise.resolve(ndjson(
        { type: "session", sessionId: localId, provider: "Local", mode: "delegate", resumed: false, continuity: "new" },
        { type: "result", text: "Canonical local result." },
        { type: "done", code: 0, reason: null },
      ))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    expect(within(screen.getByRole("dialog", { name: "Mission Control" })).getByText("Agent activity unknown")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Mission Control" }))
    const conversation = await openWilliamConversation()
    fireEvent.click(within(conversation).getByRole("button", { name: "Ask Local" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Establish canonical saved truth." } })
    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Ask Local" }))
    await screen.findByRole("button", { name: /Thinker · Local · Conversation/i })
    fireEvent.click(screen.getByRole("button", { name: "Open Mission Control" }))

    const mission = screen.getByRole("dialog", { name: "Mission Control" })
    expect(within(mission).getByLabelText(`${expectedCount} agent sessions`)).toBeTruthy()
    expect(within(mission).queryByText("Agent activity unknown")).toBeNull()
    expect(within(mission).getByText(/Local/)).toBeTruthy()
    if (initialState === "partial") expect(within(mission).getByText(/Codex/)).toBeTruthy()
    const persisted = JSON.parse(String(window.localStorage.getItem(key))) as { sessions: readonly { sessionId: string }[] }
    expect(persisted.sessions).toHaveLength(expectedCount)
    expect(persisted.sessions.some((session) => session.sessionId === "123e4567-e89b-42d3-a456-426614174000")).toBe(false)
  })

  it("does not focus a clicked restored session when its selection cannot be persisted", async () => {
    const firstId = "codex-first"
    const secondId = "codex-second"
    const key = "williamos:agent-session:browser-world:c%3A%2Frepos%2Fterrafusion"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Codex:${firstId}`,
      sessions: [
        { schemaVersion: 1, sessionId: firstId, role: "Builder", provider: "Codex", assignment: "src/first.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [{ ownerPrompt: "First", finalResult: "First result", completedAt: "2026-08-27T16:05:00.000Z" }] },
        { schemaVersion: 1, sessionId: secondId, role: "Builder", provider: "Codex", assignment: "src/second.ts", updatedAt: "2026-08-27T16:06:00.000Z", completedTurns: [{ ownerPrompt: "Second", finalResult: "Second result", completedAt: "2026-08-27T16:06:00.000Z" }] },
      ],
    }))
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))
    render(<WorkspaceShell />)
    const first = await screen.findByRole("button", { name: /Builder · Codex · src\/first.ts/i })
    const second = screen.getByRole("button", { name: /Builder · Codex · src\/second.ts/i })
    fireEvent.click(first)
    expect(await screen.findByText("First result")).toBeTruthy()
    const durableStorage = window.localStorage
    vi.stubGlobal("localStorage", {
      getItem: durableStorage.getItem.bind(durableStorage), removeItem: durableStorage.removeItem.bind(durableStorage),
      clear: durableStorage.clear.bind(durableStorage), key: durableStorage.key.bind(durableStorage),
      get length() { return durableStorage.length }, setItem() { throw new DOMException("quota", "QuotaExceededError") },
    })

    fireEvent.click(second)

    expect(first.getAttribute("aria-pressed")).toBe("true")
    expect(second.getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByText("First result")).toBeTruthy()
    expect(screen.queryByText("Second result")).toBeNull()
  })

  it("does not open a fresh Delegate flow when clearing the saved selection cannot be persisted", async () => {
    const sessionId = "codex-restored"
    const key = "williamos:agent-session:browser-world:c%3A%2Frepos%2Fterrafusion"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Codex:${sessionId}`,
      sessions: [{ schemaVersion: 1, sessionId, role: "Builder", provider: "Codex", assignment: "src/old.ts", updatedAt: "2026-08-27T16:05:00.000Z", completedTurns: [] }],
    }))
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))
    render(<WorkspaceShell />)
    await screen.findByRole("button", { name: /Builder · Codex · src\/old.ts/i })
    const durableStorage = window.localStorage
    vi.stubGlobal("localStorage", {
      getItem: durableStorage.getItem.bind(durableStorage), removeItem: durableStorage.removeItem.bind(durableStorage),
      clear: durableStorage.clear.bind(durableStorage), key: durableStorage.key.bind(durableStorage),
      get length() { return durableStorage.length }, setItem() { throw new DOMException("quota", "QuotaExceededError") },
    })

    fireEvent.click(screen.getByRole("button", { name: "Delegate" }))

    expect(screen.queryByRole("form", { name: "The Line" })).toBeNull()
    expect(JSON.parse(String(window.localStorage.getItem(key))).selectedSessionKey).toBe(`Codex:${sessionId}`)
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

  it("never forwards provider delta fragments and completes only with the canonical persisted result", async () => {
    const sessionId = "codex-presented-turn"
    const presentations: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "delta", text: "Authoriz" },
      { type: "delta", text: "ation: Bearer secret-token" },
      { type: "delta", text: "<think" },
      { type: "delta", text: "ing>private chain of thought</thinking>" },
      { type: "delta", text: "Inspecting the selected module." },
      { type: "result", text: "Implemented the bounded change." },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)

    await act(async () => {
      await expose!.runAgentTurn({
        provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work.",
        onPresentation: (presentation) => presentations.push({ ...presentation }),
      })
    })

    expect(presentations).toEqual([
      { phase: "working", text: "Agent is working.", provider: "Codex", sessionId },
      { phase: "complete", text: "Implemented the bounded change.", provider: "Codex", sessionId },
    ])
    expect(JSON.stringify(presentations)).not.toContain("Authoriz")
    expect(JSON.stringify(presentations)).not.toContain("secret-token")
    expect(JSON.stringify(presentations)).not.toContain("<think")
    expect(JSON.stringify(presentations)).not.toContain("private chain")
    expect(JSON.stringify(presentations)).not.toContain("Inspecting the selected module.")
  })

  it("never labels a partial provider presentation complete when the turn fails", async () => {
    const sessionId = "codex-failed-presentation"
    const presentations: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false },
      { type: "delta", text: "Partial validated progress." },
      { type: "done", code: null, reason: "TIMEOUT" },
    )))
    render(<Harness />)

    await expect(act(async () => expose!.runAgentTurn({
      provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Work.",
      onPresentation: (presentation) => presentations.push({ ...presentation }),
    }))).rejects.toThrow("AGENT_TURN_FAILED:TIMEOUT")

    expect(presentations.map((presentation) => presentation.phase)).toEqual(["working"])
    expect(presentations).not.toContainEqual(expect.objectContaining({ phase: "complete" }))
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

  it("persists a Local session and verifies the exact restored identity only after browser-replayed continuity succeeds", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const sessionId = "423e4567-e89b-42d3-a456-426614174000"
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId, provider: "Local", mode: "delegate", resumed: false, continuity: "new" },
        { type: "delta", text: "First local answer" },
        { type: "result", text: "First local answer" },
        { type: "done", code: 0, reason: null },
      ))
      .mockResolvedValueOnce(ndjson(
        { type: "session", sessionId, provider: "Local", mode: "delegate", resumed: true, continuity: "browser-replayed" },
        { type: "result", text: "Second local answer" },
        { type: "done", code: 0, reason: null },
      ))
    vi.stubGlobal("fetch", fetcher)
    const first = render(<Harness />)

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Local", role: "Builder", assignment: "Change src/app.ts", prompt: "First local question" })
    })
    expect(expose!.durableSession).toMatchObject({ provider: "Local", sessionId, role: "Thinker", assignment: "Conversation" })
    expect(JSON.parse(String(window.localStorage.getItem(key)))).toMatchObject({
      selectedSessionKey: `Local:${sessionId}`,
      sessions: [{ provider: "Local", sessionId, role: "Thinker", assignment: "Conversation", completedTurns: [{ ownerPrompt: "First local question", finalResult: "First local answer" }] }],
    })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      prompt: "First local question", provider: "local", sessionId: null, resume: false, completedTurns: [],
    })

    first.unmount()
    render(<Harness />)
    await waitFor(() => expect(expose!.descriptorState).toBe("unverified"))
    expect(expose!.sessions).toEqual([expect.objectContaining({ id: `Local:${sessionId}`, truth: "resume-unverified" })])

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Local", role: "Builder", assignment: "Change src/app.ts", prompt: "Second local question" })
    })

    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      provider: "local", sessionId, resume: true,
      completedTurns: [{ ownerPrompt: "First local question", finalResult: "First local answer", completedAt: expect.any(String) }],
    })
    expect(expose!.descriptorState).toBe("verified")
    expect(expose!.sessions).toEqual([expect.objectContaining({ id: `Local:${sessionId}`, truth: "live", lastResult: "Second local answer" })])
  })

  it("accepts bounded whitespace-only Local deltas while requiring a nonempty canonical result", async () => {
    const sessionId = "733e4567-e89b-42d3-a456-426614174000"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Local", mode: "delegate", resumed: false, continuity: "new" },
      { type: "delta", text: " \n\t" },
      { type: "delta", text: "Canonical answer" },
      { type: "result", text: "Canonical answer" },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)

    await act(async () => {
      await expose!.runAgentTurn({ provider: "Local", role: "Thinker", assignment: "Conversation", prompt: "Think locally." })
    })

    expect(expose!.durableSession).toMatchObject({
      provider: "Local",
      sessionId,
      completedTurns: [{ ownerPrompt: "Think locally.", finalResult: "Canonical answer", completedAt: expect.any(String) }],
    })
  })

  it("keeps Local and Claude sessions with the same provider-local UUID as separate durable objects", async () => {
    const sharedId = "523e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Local:${sharedId}`,
      sessions: [
        { schemaVersion: 1, sessionId: sharedId, role: "Builder", provider: "Claude", assignment: "Cloud conversation", updatedAt: "2026-08-28T10:00:00.000Z", completedTurns: [] },
        { schemaVersion: 1, sessionId: sharedId, role: "Thinker", provider: "Local", assignment: "Conversation", updatedAt: "2026-08-28T10:01:00.000Z", completedTurns: [] },
      ],
    }))

    render(<Harness />)

    await waitFor(() => expect(expose!.savedSessions).toHaveLength(2))
    expect(expose!.sessions.map((session) => session.id)).toEqual([`Claude:${sharedId}`, `Local:${sharedId}`])
    expect(expose!.selectedSessionKey).toBe(`Local:${sharedId}`)
  })

  it.each([
    "LOCAL_STREAM_MALFORMED",
    "LOCAL_STREAM_RESULT_REQUIRED",
    "LOCAL_MODEL_ERROR",
    "LOCAL_STREAM_TERMINAL_REQUIRED",
    "LOCAL_STREAM_DUPLICATE_TERMINAL",
    "LOCAL_STREAM_ROLE_INVALID",
    "LOCAL_STREAM_FRAME_INVALID",
    "LOCAL_STREAM_POST_TERMINAL",
    "LOCAL_STREAM_RESULT_TOO_LARGE",
    "CANCELLED",
  ])("does not promote Local failure truth %s into a durable conversation", async (reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId: "723e4567-e89b-42d3-a456-426614174000", provider: "Local", resumed: false, continuity: "new" },
      { type: "done", code: null, reason },
    )))
    render(<Harness />)

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Local", role: "Thinker", assignment: "Conversation", prompt: "Think locally." })
    })).rejects.toThrow(`AGENT_TURN_FAILED:${reason}`)

    expect(expose!.sessions).toEqual([])
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it("shows Stop for a Local turn and aborts without persisting a partial transcript", async () => {
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
      turn = expose!.runAgentTurn({ provider: "Local", role: "Thinker", assignment: "Explain", prompt: "Think locally." })
    })
    fireEvent.click(await screen.findByRole("button", { name: "Stop Local turn" }))

    await expect(turn).rejects.toMatchObject({ name: "AbortError" })
    expect(signal?.aborted).toBe(true)
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it("cancels a Local turn when its exact owner or Space scope becomes stale", async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          type: "session", sessionId: "623e4567-e89b-42d3-a456-426614174000", provider: "Local",
          resumed: false, continuity: "new",
        })}\n`))
      },
    }))))
    const view = render(<Harness />)
    let turn!: Promise<unknown>
    act(() => {
      turn = expose!.runAgentTurn({ provider: "Local", role: "Thinker", assignment: "Explain", prompt: "Think locally." })
    })
    await waitFor(() => expect(expose!.activeProvider).toBe("Local"))

    view.rerender(<Harness ownerScope="owner-2" worldScope="other-space" worldId="world-2" />)

    await expect(turn).rejects.toMatchObject({ name: "AbortError" })
    await waitFor(() => expect(expose!.sessions).toEqual([]))
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
    expect(window.localStorage.getItem("williamos:agent-session:owner-2:other-space")).toBeNull()
  })

  it("refuses an unknown provider locally instead of routing it to the Local endpoint", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)

    await expect(act(async () => {
      await expose!.runAgentTurn({ provider: "Mystery" as never, role: "Thinker", assignment: "Explain", prompt: "Work." })
    })).rejects.toThrow("AGENT_PROVIDER_INVALID")
    expect(fetcher).not.toHaveBeenCalled()
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

  it("projects exact server-derived HERMES execution with stable Space identity beside provider sessions", () => {
    const durableId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: null,
      sessions: [{
        schemaVersion: 1,
        sessionId: durableId,
        role: "Reviewer",
        provider: "Claude",
        assignment: "Review src/world-worker.ts",
        reviewPath: "src/world-worker.ts",
        updatedAt: "2026-08-27T16:00:00.000Z",
        completedTurns: [],
      }],
    }))
    const executionSession: ProjectedWorldWorkerSession = {
      id: "world-worker:world-1:41:hermes-codex-bridge",
      worldId: "world-1",
      workOrderId: 41,
      assignee: "hermes-codex-bridge",
      agent: "codex",
      role: "HERMES",
      providerLabel: "Local execution",
      assignment: "Finish the durable HERMES session",
      status: "reviewing",
      evidence: "tests: 84 passed · PASS",
      observedAt: "2026-08-27T16:00:00Z",
    }
    const mounted = render(<Harness executionSession={executionSession} />)

    const worker = screen.getByRole("button", { name: /HERMES · Local execution · Finish the durable HERMES session/i })
    expect(worker).toBeTruthy()
    expect(within(worker).getByTitle("Finish the durable HERMES session").textContent).toBe("Finish the durable HERMES session")
    expect(within(worker).getByText("reviewing · tests: 84 passed · PASS")).toBeTruthy()
    expect(expose!.sessions).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "world-worker:world-1:41:hermes-codex-bridge",
      role: "HERMES",
      providerLabel: "Local execution",
      assignment: "Finish the durable HERMES session",
      kind: "world-worker",
      truth: "persisted",
    })]))

    const durable = screen.getByRole("button", { name: `Reviewer · Claude · Review src/world-worker.ts` })
    expect(within(durable).getByTitle("Review src/world-worker.ts").textContent).toBe("Review src/world-worker.ts")
    expect(within(durable).getByText("resume unverified · saved transcript · server verification required")).toBeTruthy()

    mounted.rerender(<Harness executionSession={{
      ...executionSession,
      status: "complete",
      evidence: "merge: protected main · PASS",
      observedAt: "2026-08-27T16:10:00Z",
    }} />)
    expect(expose!.sessions.filter((session) => session.kind === "world-worker")).toEqual([
      expect.objectContaining({ id: executionSession.id, status: "complete", evidence: "merge: protected main · PASS" }),
    ])
    expect(JSON.parse(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")!)).toMatchObject({
      sessions: [expect.objectContaining({ provider: "Claude" })],
    })
  })

  it("keeps a newer successful HERMES poll when an older failed read settles afterward", async () => {
    const spine = {
      ...EMPTY_SPINE,
      projectId: 1,
      projectName: "TerraFusion",
      outcomeKey: "EXPERIENCE_V2",
      outcomeTitle: "Finish Experience V2",
      workOrderId: 41,
      execution: "implementing" as const,
    }
    const space = {
      ...defaultSpace(), selectedPath: "src/app.ts", activeWindowId: "editor" as const,
      editor: { openFiles: ["src/app.ts"], panes: [{ id: "primary" as const, activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }], activePaneId: "primary" as const },
    }
    let settleOlderRead!: (response: Response) => void
    const olderRead = new Promise<Response>((resolve) => { settleOlderRead = resolve })
    const successfulSession: ProjectedWorldWorkerSession = {
      id: "world-worker:server-world:41:hermes-codex-bridge",
      worldId: "server-world",
      workOrderId: 41,
      assignee: "hermes-codex-bridge",
      agent: "codex",
      role: "HERMES",
      providerLabel: "Local execution",
      assignment: "Finish the durable HERMES session",
      status: "implementing",
      evidence: "tests: 202 passed · PASS",
      observedAt: "2026-08-31T22:00:00Z",
    }
    let executionReads = 0
    let poll: (() => void) | null = null
    vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: TimerHandler) => {
      poll = callback as () => void
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval)
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        worldId: "server-world", space: spaceToServer(space), spine,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", browserStorageKey: null,
      }))
      if (url.startsWith("/api/environment/execution?")) {
        executionReads += 1
        if (executionReads === 1) return olderRead
        return Promise.resolve(Response.json({ worldId: "server-world", ...spine, session: successfulSession }))
      }
      if (url.startsWith("/api/loom/codex/continuation")) return Promise.resolve(Response.json({ status: "WORK_ORDER_PATHS_COMPLETE" }))
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n", modifiedAt: "2026-08-31T22:00:00Z" }))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/environment/judgment" && init?.method === "POST") return Promise.resolve(Response.json({ judgment: null }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await waitFor(() => expect(poll).not.toBeNull())
    act(() => poll!())
    expect(await screen.findByRole("button", { name: /HERMES · Local execution · Finish the durable HERMES session/i })).toBeTruthy()

    await act(async () => settleOlderRead(new Response(null, { status: 503 })))
    expect(screen.getByRole("button", { name: /HERMES · Local execution · Finish the durable HERMES session/i })).toBeTruthy()
    expect(screen.queryByText(/Assignment refresh unavailable/)).toBeNull()
  })

  it("marks assignment refresh truthfully, removes mismatches, recovers automatically, and keeps Mission Control unknown", async () => {
    const spine = {
      ...EMPTY_SPINE,
      projectId: 1,
      projectName: "WilliamOS",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      outcomeTitle: "Finish Experience V2",
      workOrderId: 41,
      execution: "implementing" as const,
    }
    const session: ProjectedWorldWorkerSession = {
      id: "world-worker:server-world:41:hermes-codex-bridge",
      worldId: "server-world",
      workOrderId: 41,
      assignee: "hermes-codex-bridge",
      agent: "codex",
      role: "HERMES",
      providerLabel: "Local execution",
      assignment: "Finish assignment freshness",
      status: "implementing",
      evidence: "tests: focused suite · PASS",
      observedAt: "2026-09-01T19:00:00.000Z",
    }
    const space = defaultSpace(1440, 900, "server-world", "Experience V2")
    let executionRead = 0
    let poll: (() => void) | null = null
    vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: TimerHandler) => {
      poll = callback as () => void
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as unknown as typeof setInterval)
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        worldId: "server-world", space: spaceToServer(space), spine,
        spaces: [{ worldId: "server-world", name: "Experience V2", updatedAt: "2026-09-01T19:00:00.000Z", space: spaceToServer(space) }],
        multiSpaceAvailable: true,
        project: { identity: "c:/repos/william-os-devops", name: "WilliamOS" }, storage: "server", browserStorageKey: null,
      }))
      if (url.startsWith("/api/environment/execution?")) {
        executionRead += 1
        if (executionRead === 2) return Promise.resolve(new Response(null, { status: 503 }))
        if (executionRead === 3) return Promise.resolve(new Response(null, { status: 409 }))
        if (executionRead === 5) return Promise.reject(new Error("network unavailable"))
        if (executionRead === 7) return Promise.resolve(Response.json({
          worldId: "foreign-world",
          ...spine,
          session: { ...session, worldId: "foreign-world", id: "world-worker:foreign-world:41:hermes-codex-bridge" },
        }))
        return Promise.resolve(Response.json({ worldId: "server-world", ...spine, session }))
      }
      if (url.startsWith("/api/loom/codex/continuation")) return Promise.resolve(Response.json({ status: "WORK_ORDER_PATHS_COMPLETE" }))
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/environment/judgment" && init?.method === "POST") return Promise.resolve(Response.json({ judgment: null }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    expect(await screen.findByRole("button", { name: /HERMES · Local execution · Finish assignment freshness/i })).toBeTruthy()
    expect(screen.queryByText(/Assignment refresh unavailable/)).toBeNull()
    const executionPoll = poll!

    await act(async () => { executionPoll(); await Promise.resolve() })
    expect(await screen.findByText("Assignment refresh unavailable · last persisted observation 2026-09-01T19:00:00.000Z · runtime liveness unverified")).toBeTruthy()
    expect(screen.getByRole("button", { name: /HERMES · Local execution · Finish assignment freshness/i })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Open Mission Control" }))
    expect((await screen.findAllByText("Agent activity unknown")).length).toBeGreaterThan(0)

    await act(async () => { executionPoll(); await Promise.resolve() })
    expect(await screen.findByText("Work Order #41 assignment could not be verified for this Space")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /HERMES · Local execution · Finish assignment freshness/i })).toBeNull()

    await act(async () => { executionPoll(); await Promise.resolve() })
    expect(await screen.findByRole("button", { name: /HERMES · Local execution · Finish assignment freshness/i })).toBeTruthy()
    expect(screen.queryByText(/assignment could not be verified/)).toBeNull()

    await act(async () => { executionPoll(); await Promise.resolve() })
    expect(await screen.findByText("Assignment refresh unavailable · last persisted observation 2026-09-01T19:00:00.000Z · runtime liveness unverified")).toBeTruthy()
    await act(async () => { executionPoll(); await Promise.resolve() })
    await waitFor(() => expect(screen.queryByText(/Assignment refresh unavailable/)).toBeNull())
    await act(async () => { executionPoll(); await Promise.resolve() })
    expect(await screen.findByText("Work Order #41 assignment could not be verified for this Space")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /HERMES · Local execution · Finish assignment freshness/i })).toBeNull()
  })

  it("opens and deduplicates the exact persisted HERMES assignment Inspector without appliance probes", async () => {
    const spine = {
      ...EMPTY_SPINE,
      projectId: 1,
      projectName: "WilliamOS",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      outcomeTitle: "Finish Experience V2",
      workOrderId: 41,
      execution: "validating" as const,
      evidence: [
        { kind: "test", detail: "Focused product suite", result: "PASS", at: "2026-09-01T18:00:00.000Z" },
        { kind: "checkpoint", detail: "", result: null, at: "2026-09-01T18:01:00.000Z" },
      ],
    }
    const executionSession: ProjectedWorldWorkerSession = {
      id: "world-worker:server-world:41:hermes-codex-bridge",
      worldId: "server-world",
      workOrderId: 41,
      assignee: "hermes-codex-bridge",
      agent: "codex",
      role: "HERMES",
      providerLabel: "Local execution",
      assignment: "Finish Experience V2 · Work Order #41: Inspect persisted execution",
      status: "validating",
      evidence: "test: Focused product suite · PASS",
      observedAt: "2026-09-01T18:01:00.000Z",
    }
    const space = defaultSpace(1440, 900, "server-world", "Experience V2")
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        worldId: "server-world", space: spaceToServer(space), spine,
        project: { identity: "c:/repos/william-os-devops", name: "WilliamOS" }, storage: "server", browserStorageKey: null,
      }))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, spine, judgment: null }))
      }
      if (url.startsWith("/api/environment/execution?")) return Promise.resolve(Response.json({ worldId: "server-world", ...spine, session: executionSession }))
      if (url.startsWith("/api/loom/codex/continuation")) return Promise.resolve(Response.json({ status: "WORK_ORDER_PATHS_COMPLETE" }))
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/environment/judgment" && init?.method === "POST") return Promise.resolve(Response.json({ judgment: null }))
      if (url === "/api/environment/line" && init?.method === "POST") return Promise.resolve(Response.json({
        worldId: "server-world", say: "Inspect the focused product suite next.", surfaces: [], spine,
      }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    const worker = await screen.findByRole("button", { name: /HERMES · Local execution · Finish Experience V2/i })
    fireEvent.click(worker)

    expect(await screen.findByText("Assignment · Work Order #41")).toBeTruthy()
    expect(screen.getByText("WILLIAMOS_EXPERIENCE_V2 · Finish Experience V2")).toBeTruthy()
    expect(screen.getByText("Focused product suite")).toBeTruthy()
    expect(screen.getByText("No detail recorded")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }))
    expect(screen.getAllByText("Assignment · Work Order #41")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Ask William" }))
    expect(screen.getByText("Persisted assignment · Work Order #41 · runtime liveness unverified")).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "What should I inspect next?" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(await screen.findByText("Inspect the focused product suite next.")).toBeTruthy()
    const lineCall = fetcher.mock.calls.find(([input]) => String(input) === "/api/environment/line")
    expect(JSON.parse(String(lineCall?.[1]?.body))).toMatchObject({
      worldId: "server-world",
      lineContext: { kind: "execution-assignment", workOrderId: 41 },
    })
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/environment/hermes")).toBe(false)
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
      worldId: "world-1",
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

  it("persists and restores only the exact server-bound file target earned by a successful Codex Builder session", async () => {
    const sessionId = "codex-bound-target"
    const key = "williamos:agent-session:owner-1:terrafusion"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: ASSIGNMENT_HASH },
      { type: "result", text: "Changed the captured file." },
      { type: "done", code: 0, reason: null },
    )))
    const first = render(<Harness />)

    await act(async () => {
      await expose!.runAgentTurn({
        provider: "Codex",
        role: "Builder",
        assignment: "src/app.ts",
        prompt: "Change the captured file.",
        target: { kind: "file", path: "src/app.ts" },
      })
    })

    expect(expose!.sessions[0]).toMatchObject({ target: { kind: "file", path: "src/app.ts" } })
    expect(JSON.parse(String(window.localStorage.getItem(key))).sessions[0].target).toEqual({ kind: "file", path: "src/app.ts" })

    first.unmount()
    render(<Harness />)
    await waitFor(() => expect(expose!.sessions[0]).toMatchObject({
      truth: "resume-unverified",
      target: { kind: "file", path: "src/app.ts" },
    }))
  })

  it.each([
    ["missing selected path", { assignmentHash: ASSIGNMENT_HASH }],
    ["mismatched selected path", { selectedPath: "src/other.ts", assignmentHash: ASSIGNMENT_HASH }],
    ["noncanonical selected path", { selectedPath: "./src/app.ts", assignmentHash: ASSIGNMENT_HASH }],
    ["missing assignment hash", { selectedPath: "src/app.ts" }],
    ["malformed assignment hash", { selectedPath: "src/app.ts", assignmentHash: "browser-proof" }],
  ])("fails a Codex target-bearing stream with %s evidence without persisting a session", async (_case, binding) => {
    const sessionId = "codex-invalid-binding"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, ...binding },
      { type: "result", text: "Unbound result." },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)

    await expect(act(async () => expose!.runAgentTurn({
      provider: "Codex",
      role: "Builder",
      assignment: "src/app.ts",
      prompt: "Change the captured file.",
      target: { kind: "file", path: "src/app.ts" },
    }))).rejects.toThrow("AGENT_STREAM_INVALID")

    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
    expect(expose!.sessions).toEqual([])
  })

  it("requires a resumed Codex target session to re-earn the exact server binding", async () => {
    const sessionId = "codex-resume-binding"
    const key = "williamos:agent-session:owner-1:terrafusion"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Codex:${sessionId}`,
      sessions: [{
        schemaVersion: 1, sessionId, role: "Builder", provider: "Codex", assignment: "src/app.ts",
        target: { kind: "file", path: "src/app.ts" }, updatedAt: "2026-08-27T16:00:00.000Z", completedTurns: [],
      }],
    }))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: true },
      { type: "result", text: "Unbound resumed result." },
      { type: "done", code: 0, reason: null },
    )))
    render(<Harness />)
    await waitFor(() => expect(expose!.savedSessions).toHaveLength(1))

    await expect(act(async () => expose!.runAgentTurn({
      provider: "Codex", role: "Builder", assignment: "src/app.ts", prompt: "Continue.",
      target: { kind: "file", path: "src/app.ts" },
    }))).rejects.toThrow("AGENT_STREAM_INVALID")

    expect(window.localStorage.getItem(key)).toBeNull()
    cleanup()
    render(<Harness />)
    await waitFor(() => expect(expose!.sessions).toEqual([]))
  })

  it.each([
    ["dot-prefixed", "./src/app.ts"],
    ["backslash", "src\\app.ts"],
    ["parent segment", "src/../app.ts"],
    ["current-directory segment", "src/./app.ts"],
    ["absolute", "/src/app.ts"],
    ["drive absolute", "C:/repo/src/app.ts"],
    ["backslash drive absolute", "C:\\repo\\src\\app.ts"],
    ["UNC", "//server/share/app.ts"],
    ["backslash UNC", "\\\\server\\share\\app.ts"],
    ["NUL", "src/\0app.ts"],
    ["control character", "src/\u001fapp.ts"],
    ["empty", ""],
    ["double separator", "src//app.ts"],
    ["trailing separator", "src/app.ts/"],
    ["surrounding whitespace", " src/app.ts "],
  ])("rejects a %s target instead of normalizing or persisting it", async (_case, path) => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("FETCH_CALLED_FOR_INVALID_TARGET") }))
    render(<Harness />)

    await expect(act(async () => {
      await expose!.runAgentTurn({
        provider: "Claude",
        role: "Builder",
        assignment: "src/app.ts",
        prompt: "Change it.",
        target: { kind: "file", path },
      })
    })).rejects.toThrow("AGENT_TARGET_INVALID")

    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it.each([
    ["Claude Builder without a server binding", () => expose!.runAgentTurn({ provider: "Claude", role: "Builder", assignment: "src/app.ts", prompt: "Work.", target: { kind: "file", path: "src/app.ts" } })],
    ["Local conversation", () => expose!.runAgentTurn({ provider: "Local", role: "Builder", assignment: "src/app.ts", prompt: "Think.", target: { kind: "file", path: "src/app.ts" } })],
    ["non-Builder delegate", () => expose!.runAgentTurn({ provider: "Claude", role: "Reviewer", assignment: "src/app.ts", prompt: "Inspect.", target: { kind: "file", path: "src/app.ts" } })],
    ["read-only Review", () => expose!.runClaudeTurn({ role: "Reviewer", assignment: "Review src/app.ts", mode: "review", path: "src/app.ts", target: { kind: "file", path: "src/app.ts" } })],
  ])("refuses target metadata on %s", async (_case, start) => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("FETCH_CALLED_FOR_INELIGIBLE_TARGET") }))
    render(<Harness />)

    await expect(act(async () => { await start() })).rejects.toThrow("AGENT_TARGET_INVALID")
    expect(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")).toBeNull()
  })

  it("surfaces restored target-policy violations as partial without rewriting unrelated valid sessions", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const validId = "123e4567-e89b-42d3-a456-426614174000"
    const invalidSelectedId = "223e4567-e89b-42d3-a456-426614174000"
    const stored = JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${invalidSelectedId}`,
      sessions: [
        { schemaVersion: 1, sessionId: validId, role: "Builder", provider: "Codex", assignment: "General work", updatedAt: "2026-08-27T16:00:00.000Z" },
        { schemaVersion: 1, sessionId: invalidSelectedId, role: "Reviewer", provider: "Claude", assignment: "Not a builder", target: { kind: "file", path: "src/reviewer.ts" }, updatedAt: "2026-08-27T16:01:00.000Z" },
        { schemaVersion: 1, sessionId: "323e4567-e89b-42d3-a456-426614174000", role: "Reviewer", provider: "Claude", assignment: "Review src/review.ts", target: { kind: "file", path: "src/review.ts" }, reviewPath: "src/review.ts", updatedAt: "2026-08-27T16:02:00.000Z" },
        { schemaVersion: 1, sessionId: "423e4567-e89b-42d3-a456-426614174000", role: "Thinker", provider: "Local", assignment: "Conversation", target: { kind: "file", path: "src/local.ts" }, updatedAt: "2026-08-27T16:03:00.000Z" },
        { schemaVersion: 1, sessionId: "523e4567-e89b-42d3-a456-426614174000", role: "Builder", provider: "Claude", assignment: "Bad path", target: { kind: "file", path: "./src/bad.ts" }, updatedAt: "2026-08-27T16:04:00.000Z" },
        { schemaVersion: 1, sessionId: "623e4567-e89b-42d3-a456-426614174000", role: "Builder", provider: "Claude", assignment: "No server binding", target: { kind: "file", path: "src/claude.ts" }, updatedAt: "2026-08-27T16:05:00.000Z" },
      ],
    })
    window.localStorage.setItem(key, stored)

    render(<Harness />)

    await waitFor(() => expect(expose!.sessions).toEqual([
      expect.objectContaining({ id: `Codex:${validId}`, assignment: "General work" }),
    ]))
    expect(expose!.collectionState).toBe("partial")
    expect(window.localStorage.getItem(key)).toBe(stored)
  })

  it("rejects malformed persisted target metadata while retaining legacy sessions without a target", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: "Claude:123e4567-e89b-42d3-a456-426614174000",
      sessions: [{
        schemaVersion: 1,
        sessionId: "123e4567-e89b-42d3-a456-426614174000",
        role: "Builder",
        provider: "Claude",
        assignment: "Legacy work",
        target: { kind: "file", path: "", inventedAuthority: true },
        updatedAt: "2026-08-27T16:05:00.000Z",
      }],
    }))

    const malformed = render(<Harness />)
    await waitFor(() => expect(expose!.collectionState).toBe("partial"))
    expect(expose!.sessions).toEqual([])
    expect(window.localStorage.getItem(key)).not.toBeNull()

    malformed.unmount()
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      role: "Builder",
      provider: "Claude",
      assignment: "Legacy work",
      updatedAt: "2026-08-27T16:05:00.000Z",
    }))
    render(<Harness />)
    await waitFor(() => expect(expose!.sessions).toHaveLength(1))
    expect(expose!.sessions[0]?.assignment).toBe("Legacy work")
    expect(expose!.sessions[0]?.target).toBeUndefined()
  })

  it("shows a restored Builder descriptor as unverified until resume succeeds", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 1,
      sessionId,
      role: "Builder",
      provider: "Claude",
      assignment: "Build src/app.ts",
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
    expect(screen.getByRole("button", { name: /Builder · Claude/i })).toBeTruthy()
    expect(screen.getByText("resume unverified · saved transcript · server verification required")).toBeTruthy()
    await act(async () => {
      await expose!.runClaudeTurn({ role: "Builder", assignment: "Build src/app.ts", prompt: "Continue the work." })
    })

    expect(screen.getByRole("button", { name: /Builder · Claude/i })).toBeTruthy()
    expect(screen.getByText("ready · resumable session")).toBeTruthy()
    expect(expose!.descriptorState).toBe("verified")
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      worldId: "world-1",
      prompt: "Continue the work.",
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
    ["Claude Builder carrying reviewPath", { provider: "Claude", role: "Builder", assignment: "Build src/app.ts", reviewPath: "src/app.ts" }],
    ["Claude Reviewer missing reviewPath", { provider: "Claude", role: "Reviewer", assignment: "Review src/app.ts" }],
    ["Codex Reviewer carrying reviewPath", { provider: "Codex", role: "Reviewer", assignment: "Review src/app.ts", reviewPath: "src/app.ts" }],
    ["Local Reviewer carrying reviewPath", { provider: "Local", role: "Reviewer", assignment: "Review src/app.ts", reviewPath: "src/app.ts" }],
  ] as const)("rejects impossible restored review metadata: %s", async (_label, metadata) => {
    const sessionId = metadata.provider === "Codex" ? "codex-impossible-review" : "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `${metadata.provider}:${sessionId}`,
      sessions: [{
        schemaVersion: 1,
        sessionId,
        ...metadata,
        updatedAt: "2026-08-29T10:00:00.000Z",
        completedTurns: [],
      }],
    }))

    render(<Harness />)

    await waitFor(() => expect(expose!.collectionState).toBe("partial"))
    expect(expose!.savedSessions).toEqual([])
    expect(expose!.sessions).toEqual([])
  })

  it("requires the exact durable Reviewer prior before a bound Talk or Redirect can issue a request", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.collectionState).toBe("missing"))

    await expect(expose!.runClaudeTurn({
      role: "Reviewer",
      assignment: "Review src/app.ts",
      mode: "review",
      path: "src/app.ts",
      focus: "Continue exactly.",
      requiredSessionKey: "Claude:123e4567-e89b-42d3-a456-426614174000",
    })).rejects.toThrow("AGENT_REVIEW_PRIOR_REQUIRED")

    expect(fetcher).not.toHaveBeenCalled()
    expect(expose!.activeTurns).toEqual([])
    expect(expose!.savedSessions).toEqual([])
  })

  it("refuses a mismatched bound Reviewer prior instead of starting a new review", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${sessionId}`,
      sessions: [{
        schemaVersion: 1,
        sessionId,
        role: "Reviewer",
        provider: "Claude",
        assignment: "Review src/app.ts",
        reviewPath: "src/app.ts",
        updatedAt: "2026-08-29T10:00:00.000Z",
        completedTurns: [],
      }],
    }))
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(expose!.selectedSessionKey).toBe(`Claude:${sessionId}`))

    await expect(expose!.runClaudeTurn({
      role: "Reviewer",
      assignment: "Review src/other.ts",
      mode: "review",
      path: "src/other.ts",
      focus: "Redirect exactly.",
      requiredSessionKey: `Claude:${sessionId}`,
    })).rejects.toThrow("AGENT_REVIEW_SESSION_MISMATCH")

    await expect(expose!.runClaudeTurn({
      role: "Builder",
      assignment: "Review src/app.ts",
      mode: "review",
      path: "src/app.ts",
      focus: "Do not reinterpret this as Builder work.",
      requiredSessionKey: `Claude:${sessionId}`,
    })).rejects.toThrow("AGENT_REVIEW_ROLE_INVALID")

    expect(fetcher).not.toHaveBeenCalled()
    expect(expose!.savedSessions).toEqual([expect.objectContaining({ sessionId, reviewPath: "src/app.ts" })])
  })

  it.each([
    ["Builder", undefined],
    ["Reviewer", "src/other.ts"],
  ])("starts Review fresh rather than resuming a valid but incompatible %s descriptor", async (role, reviewPath) => {
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({ schemaVersion: 1, sessionId: "123e4567-e89b-42d3-a456-426614174000", role, provider: "Claude", assignment: "Prior work", ...(reviewPath ? { reviewPath } : {}), updatedAt: "2026-08-27T16:05:00.000Z" }))
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
