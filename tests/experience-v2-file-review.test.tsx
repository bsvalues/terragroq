// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { type DurableClaudeSession, type ExperienceAgentSessionController, type RunClaudeTurnInput } from "@/components/workspace-shell/agent-sessions"
import { useSelectedFileReview } from "@/components/workspace-shell/use-selected-file-review"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000"

function resultEvent(result: string, overrides: Record<string, unknown> = {}) {
  return { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: SESSION_ID, result, ...overrides } }
}

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

function initialSpace() {
  return {
    ...defaultSpace(), selectedPath: "src/app.ts", activeWindowId: "editor" as const,
    editor: { openFiles: ["src/app.ts", "src/other.ts"], panes: [{ id: "primary" as const, activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }], activePaneId: "primary" as const },
  }
}

function workspaceResponse() {
  return Response.json({ worldId: "browser-world", space: spaceToServer(initialSpace()), spine: EMPTY_SPINE, project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "browser", browserStorageKey: "file-review-test" })
}

function stream(...events: readonly Record<string, unknown>[]): Response {
  return new Response(`${events.map(JSON.stringify).join("\n")}\n`, { headers: { "content-type": "application/x-ndjson" } })
}

function deferredStream(...events: readonly Record<string, unknown>[]) {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  return {
    response: new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; events.forEach((event) => value.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))) } })),
    send(event: Record<string, unknown>) { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)) },
    close() { controller.close() },
  }
}

function baseFetch(review: (init: RequestInit) => Promise<Response> | Response) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
    if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
    if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
    if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/other.ts", content: "export const other = true\n", modifiedAt: "2026-08-28T12:00:00.000Z" }))
    if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
    if (url === "/api/loom/agent" && init?.method === "POST") return Promise.resolve(review(init))
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
  })
}

async function openReview(focus = "Check the authorization boundary.") {
  await screen.findByLabelText("Source content")
  fireEvent.click(screen.getByRole("button", { name: "Review" }))
  expect(screen.getByText("Review · src/app.ts")).toBeTruthy()
  const input = screen.getByRole("textbox", { name: "Review focus" })
  fireEvent.change(input, { target: { value: focus } })
  fireEvent.click(screen.getByRole("button", { name: "Start review" }))
}

describe("Experience V2 selected-file Review", () => {
  it("runs a path-bound review and materializes plain text in a captured-path inspector", async () => {
    const report = "<img src=x onerror=alert(1)>\nP1: authorization is bypassed"
    const fetcher = baseFetch(() => stream(
      { type: "session", sessionId: SESSION_ID, resumed: false },
      { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "Streaming draft must not duplicate the canonical result." }] } } },
      resultEvent(report),
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await openReview()

    expect(await screen.findByRole("heading", { name: "Review report · src/app.ts" })).toBeTruthy()
    expect(screen.getByText((_text, element) => element?.tagName === "PRE" && element.textContent === report)).toBeTruthy()
    expect(screen.queryByText(/Streaming draft must not duplicate/)).toBeNull()
    expect(document.querySelector("img")).toBeNull()
    const request = fetcher.mock.calls.find(([input, init]) => String(input) === "/api/loom/agent" && init?.method === "POST")
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ mode: "review", path: "src/app.ts", focus: "Check the authorization boundary.", provider: "cloud", sessionId: null, resume: false })
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/environment/line")).toBe(false)
  })

  it("accepts diagnostic stderr without treating it as Review report content or success truth", async () => {
    const fetcher = baseFetch(() => stream(
      { type: "session", sessionId: SESSION_ID, resumed: false },
      { type: "stderr", text: "Claude diagnostic: retrying transport" },
      resultEvent("Canonical review report"),
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await openReview("")

    expect(await screen.findByText("Canonical review report")).toBeTruthy()
    expect(screen.queryByText(/retrying transport/)).toBeNull()
  })

  it("restores a persisted Review report and Inspector geometry after close and reopen", async () => {
    vi.stubGlobal("fetch", baseFetch(() => stream(
      { type: "session", sessionId: SESSION_ID, resumed: false },
      resultEvent("Durable review report"),
      { type: "done", code: 0, reason: null },
    )))
    const first = render(<WorkspaceShell />)
    await openReview("")
    await screen.findByText("Durable review report")
    const original = screen.getByLabelText("Inspector · src/app.ts window") as HTMLElement
    const geometry = {
      left: original.style.left,
      top: original.style.top,
      width: original.style.width,
      height: original.style.height,
    }
    await waitFor(() => {
      const saved = window.localStorage.getItem("williamos:space:file-review-test")
      expect(saved).toContain("Durable review report")
    }, { timeout: 2_000 })

    first.unmount()
    render(<WorkspaceShell />)

    expect(await screen.findByText("Durable review report")).toBeTruthy()
    const restored = screen.getByLabelText("Inspector · src/app.ts window") as HTMLElement
    expect({
      left: restored.style.left,
      top: restored.style.top,
      width: restored.style.width,
      height: restored.style.height,
    }).toEqual(geometry)
    expect(fetch).not.toHaveBeenCalledWith("/api/environment/line", expect.anything())
  })

  it("keeps the captured path through selection drift and blocks dismissal while streaming", async () => {
    const pending = deferredStream({ type: "session", sessionId: SESSION_ID, resumed: false })
    vi.stubGlobal("fetch", baseFetch(() => pending.response))
    render(<WorkspaceShell />)
    await openReview("")
    expect(await screen.findByRole("button", { name: "Stop review" })).toBeTruthy()

    fireEvent.keyDown(window, { key: "Escape" })
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByText("Review · src/app.ts")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "other.ts" }))
    pending.send(resultEvent("Captured report"))
    pending.send({ type: "done", code: 0, reason: null })
    pending.close()

    expect(await screen.findByRole("heading", { name: "Review report · src/app.ts" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Review report · src/other.ts" })).toBeNull()
  })

  it("keeps a done-before-EOF review stoppable and reports its outcome unknown", async () => {
    let signal: AbortSignal | null = null
    const pending = deferredStream(
      { type: "session", sessionId: SESSION_ID, resumed: false },
      resultEvent("Premature report"),
      { type: "done", code: 0, reason: null },
    )
    vi.stubGlobal("fetch", baseFetch((init) => { signal = init.signal as AbortSignal; return pending.response }))
    render(<WorkspaceShell />)
    await openReview()
    fireEvent.click(await screen.findByRole("button", { name: "Stop review" }))

    await waitFor(() => expect(signal?.aborted).toBe(true))
    expect(await screen.findByText("Stop requested. Review outcome is unknown.")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: /Review report/ })).toBeNull()
  })

  it("routes a projected Reviewer back through its exact read-only Review path", async () => {
    vi.stubGlobal("fetch", baseFetch(() => stream(
      { type: "session", sessionId: SESSION_ID, resumed: false }, resultEvent("First report"), { type: "done", code: 0, reason: null },
    )))
    render(<WorkspaceShell />)
    await openReview()
    await screen.findByRole("heading", { name: "Review report · src/app.ts" })

    fireEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    fireEvent.click(screen.getByRole("tab", { name: "other.ts" }))
    fireEvent.click(screen.getByRole("button", { name: /Reviewer · Claude · Review src\/app.ts/ }))

    expect(screen.getByText("Review · src/app.ts")).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Review focus" })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "The Line" })).toBeNull()
  })

  it("restores, raises, and updates a minimized inspector when the same file is reviewed again", async () => {
    let turns = 0
    vi.stubGlobal("fetch", baseFetch(() => {
      turns += 1
      return stream(
        { type: "session", sessionId: SESSION_ID, resumed: turns > 1 },
        resultEvent(turns === 1 ? "First report" : "Replacement report"),
        { type: "done", code: 0, reason: null },
      )
    }))
    render(<WorkspaceShell />)
    await openReview()
    await screen.findByText("First report")
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Minimize Inspector · src/app.ts" }))
    expect(screen.queryByRole("heading", { name: "Review report · src/app.ts" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    fireEvent.click(screen.getByRole("button", { name: "Review" }))
    fireEvent.click(screen.getByRole("button", { name: "Start review" }))

    expect(await screen.findByText("Replacement report")).toBeTruthy()
    expect(screen.queryByText("First report")).toBeNull()
    const inspector = screen.getByLabelText("Inspector · src/app.ts window")
    expect(inspector.className).toContain("activeWindow")
  })

  it("keeps empty Change and generic submits disabled while allowing Review without focus", async () => {
    vi.stubGlobal("fetch", baseFetch(() => new Promise<Response>(() => undefined)))
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.click(screen.getByRole("button", { name: "Change" }))
    expect((screen.getByRole("button", { name: "Start change" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "The Line · Ctrl+K" }))
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Review" }))
    expect((screen.getByRole("button", { name: "Start review" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("suppresses a stale older completion after a newer Review has started", async () => {
    const turns: RunClaudeTurnInput[] = []
    const resolvers: Array<(value: DurableClaudeSession) => void> = []
    const rejectors: Array<(reason: unknown) => void> = []
    let activeTurn = -1
    const sessions: ExperienceAgentSessionController = {
      sessions: [], durableSession: null, savedDescriptor: null, descriptorState: "none", activeSessionId: null, error: null,
      runClaudeTurn(input) {
        activeTurn = turns.length
        turns.push(input)
        return new Promise((resolve, reject) => { resolvers.push(resolve); rejectors.push(reject) })
      },
      stop() { if (activeTurn >= 0) rejectors[activeTurn]?.(new DOMException("Aborted", "AbortError")) },
    }
    function Harness() {
      const [path, setPath] = useState("src/app.ts")
      const [report, setReport] = useState("")
      const review = useSelectedFileReview({ path, sessions, onReport: (_path, text) => setReport(text) })
      return <><button onClick={() => void review.start("")}>Start</button><button onClick={review.stop}>Stop</button><button onClick={() => setPath("src/other.ts")}>Select other</button><button onClick={() => review.reset(path)}>Open selected</button><output>{review.outcome}</output><pre>{report}</pre></>
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    await screen.findByText("Stop requested. Review outcome is unknown.")
    fireEvent.click(screen.getByRole("button", { name: "Select other" }))
    fireEvent.click(screen.getByRole("button", { name: "Open selected" }))
    fireEvent.click(screen.getByRole("button", { name: "Start" }))

    act(() => turns[0]?.onReviewComplete?.("stale report"))
    expect(screen.queryByText("stale report")).toBeNull()
    act(() => turns[1]?.onReviewComplete?.("new report"))
    await act(async () => resolvers[1]?.({ schemaVersion: 1, sessionId: "223e4567-e89b-42d3-a456-426614174000", role: "Reviewer", provider: "Claude", assignment: "Review src/other.ts", reviewPath: "src/other.ts", updatedAt: "2026-08-28T12:00:00.000Z" }))
    expect(screen.getByText("new report")).toBeTruthy()
  })

  it.each([
    ["missing session", [{ type: "done", code: 0, reason: null }]],
    ["session missing resumed truth", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000" }, { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "untrusted" }] } } }, { type: "done", code: 0, reason: null }]],
    ["session with malformed resumed truth", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: "false" }, { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "untrusted" }] } } }, { type: "done", code: 0, reason: null }]],
    ["duplicate session", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "done", code: 0, reason: null }]],
    ["nonzero terminal", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "done", code: 1, reason: null }]],
    ["terminal with malformed reason", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "untrusted" }] } } }, { type: "done", code: 0, reason: { code: "REFUSED" } }]],
    ["missing canonical result", [{ type: "session", sessionId: SESSION_ID, resumed: false }, { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "not authoritative" }] } } }, { type: "done", code: 0, reason: null }]],
    ["duplicate canonical result", [{ type: "session", sessionId: SESSION_ID, resumed: false }, resultEvent("first"), resultEvent("second"), { type: "done", code: 0, reason: null }]],
    ["error canonical result", [{ type: "session", sessionId: SESSION_ID, resumed: false }, resultEvent("refused", { subtype: "error", is_error: true }), { type: "done", code: 0, reason: null }]],
    ["mismatched result session", [{ type: "session", sessionId: SESSION_ID, resumed: false }, resultEvent("wrong session", { session_id: "223e4567-e89b-42d3-a456-426614174000" }), { type: "done", code: 0, reason: null }]],
    ["outer session contradicts fresh request", [{ type: "session", sessionId: SESSION_ID, resumed: true }, resultEvent("wrong resume truth"), { type: "done", code: 0, reason: null }]],
    ["post-terminal event", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "done", code: 0, reason: null }, { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "late" }] } } }]],
  ])("does not materialize or project an invalid %s stream", async (_case, events) => {
    vi.stubGlobal("fetch", baseFetch(() => stream(...events)))
    render(<WorkspaceShell />)
    await openReview()

    expect(await screen.findByText(/Review did not return a valid successful result/)).toBeTruthy()
    expect(screen.queryByRole("heading", { name: /Review report/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Reviewer · Claude/ })).toBeNull()
  })
})
