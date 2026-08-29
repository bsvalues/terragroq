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
const ASSIGNMENT_HASH = "a".repeat(64)

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
    await waitFor(() => expect(expose!.activeSessionIds).toHaveLength(2))

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

    fireEvent.click(screen.getByRole("button", { name: "Ask Local" }))
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
      const controller = useExperienceAgentSessions({ ownerScope, worldScope, worldId: ownerScope, worker: null })
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

    fireEvent.click(screen.getByRole("button", { name: "Ask Local" }))
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
    fireEvent.click(screen.getByRole("button", { name: "Ask Local" }))
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

    fireEvent.click(screen.getByRole("button", { name: "Ask Local" }))
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
    expect(within(mission).getAllByText("No active agents")).toHaveLength(1)
    expect(within(mission).queryByText(/Codex/)).toBeNull()
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

  it("drops only restored target-policy violations and preserves unrelated valid sessions", async () => {
    const key = "williamos:agent-session:owner-1:terrafusion"
    const validId = "123e4567-e89b-42d3-a456-426614174000"
    const invalidSelectedId = "223e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(key, JSON.stringify({
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
    }))

    render(<Harness />)

    await waitFor(() => expect(expose!.sessions).toEqual([
      expect.objectContaining({ id: `Codex:${validId}`, assignment: "General work" }),
    ]))
    expect(JSON.parse(String(window.localStorage.getItem(key)))).toEqual({
      schemaVersion: 3,
      selectedSessionKey: null,
      sessions: [{
        schemaVersion: 1,
        sessionId: validId,
        role: "Builder",
        provider: "Codex",
        assignment: "General work",
        updatedAt: "2026-08-27T16:00:00.000Z",
        completedTurns: [],
      }],
    })
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
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull())
    expect(expose!.sessions).toEqual([])

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
