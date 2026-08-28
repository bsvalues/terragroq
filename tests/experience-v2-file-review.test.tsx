// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

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
      { type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false },
      { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: report }] } } },
      { type: "done", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)

    await openReview()

    expect(await screen.findByRole("heading", { name: "Review report · src/app.ts" })).toBeTruthy()
    expect(screen.getByText((_text, element) => element?.tagName === "PRE" && element.textContent === report)).toBeTruthy()
    expect(document.querySelector("img")).toBeNull()
    const request = fetcher.mock.calls.find(([input, init]) => String(input) === "/api/loom/agent" && init?.method === "POST")
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ mode: "review", path: "src/app.ts", focus: "Check the authorization boundary.", provider: "cloud", sessionId: null, resume: false })
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/environment/line")).toBe(false)
  })

  it("keeps the captured path through selection drift and blocks dismissal while streaming", async () => {
    const pending = deferredStream({ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false })
    vi.stubGlobal("fetch", baseFetch(() => pending.response))
    render(<WorkspaceShell />)
    await openReview("")
    expect(await screen.findByRole("button", { name: "Stop review" })).toBeTruthy()

    fireEvent.keyDown(window, { key: "Escape" })
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByText("Review · src/app.ts")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "other.ts" }))
    pending.send({ type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "Captured report" }] } } })
    pending.send({ type: "done", code: 0, reason: null })
    pending.close()

    expect(await screen.findByRole("heading", { name: "Review report · src/app.ts" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Review report · src/other.ts" })).toBeNull()
  })

  it("keeps a done-before-EOF review stoppable and reports its outcome unknown", async () => {
    let signal: AbortSignal | null = null
    const pending = deferredStream(
      { type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false },
      { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "Premature report" }] } } },
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

  it.each([
    ["missing session", [{ type: "done", code: 0, reason: null }]],
    ["session missing resumed truth", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000" }, { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "untrusted" }] } } }, { type: "done", code: 0, reason: null }]],
    ["session with malformed resumed truth", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: "false" }, { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "untrusted" }] } } }, { type: "done", code: 0, reason: null }]],
    ["duplicate session", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "done", code: 0, reason: null }]],
    ["nonzero terminal", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "done", code: 1, reason: null }]],
    ["terminal with malformed reason", [{ type: "session", sessionId: "123e4567-e89b-42d3-a456-426614174000", resumed: false }, { type: "event", event: { type: "assistant", message: { content: [{ type: "text", text: "untrusted" }] } } }, { type: "done", code: 0, reason: { code: "REFUSED" } }]],
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
