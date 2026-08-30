// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DeveloperToolsSurface } from "@/components/workspace-shell/developer-tools-surface"
import { loadToolRunHistory, persistToolRunTranscript, type ToolRunTranscript } from "@/components/workspace-shell/tool-run-history"

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function ndjson(...events: readonly Record<string, unknown>[]): Response {
  const body = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } })
}

const projectOperations = [
  { id: "repo.status", label: "What has changed", intent: "List files", scope: "project", mutating: false },
  { id: "repo.diff", label: "Show diff summary", intent: "Show diff", scope: "project", mutating: false },
  { id: "repo.log", label: "Recent history", intent: "Show log", scope: "project", mutating: false },
  { id: "build.run", label: "Build the app", intent: "Build", scope: "project", mutating: false },
]

function saveTranscript({
  scope,
  id,
  operationId,
  startedAt,
  text,
  status = "completed",
}: {
  scope: string
  id: string
  operationId: "tests.run" | "repo.status" | "repo.diff"
  startedAt: string
  text: string
  status?: ToolRunTranscript["outcome"]["status"]
}) {
  const operation = operationId === "tests.run"
    ? { label: "Run the tests", alias: "test" }
    : operationId === "repo.status"
      ? { label: "What has changed", alias: "git status" }
      : { label: "Show diff summary", alias: "git diff" }
  const terminal = status === "completed" ? { text: "exit 0", code: 0, reason: null }
    : status === "cancelled" ? { text: "CANCELLED", code: null, reason: "CANCELLED" }
      : { text: "INTERRUPTED", code: null, reason: "INTERRUPTED" }
  const verdict = persistToolRunTranscript(window.localStorage, scope, {
    schemaVersion: 1,
    id,
    operationId,
    operationLabel: operation.label,
    alias: operation.alias,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 1_000).toISOString(),
    outcome: { status, code: terminal.code, reason: terminal.reason },
    lines: [{ channel: "stdout", text }, { channel: "meta", text: terminal.text }],
  })
  expect(verdict.ok).toBe(true)
}

describe("Experience V2 developer tools", () => {
  it("does not expose a covered inactive Test action as runnable", async () => {
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "stdout", text: "suite started\n" },
      { type: "exit", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)

    const view = render(<DeveloperToolsSurface kind="tests" selectedPath={null} active={false} />)
    const runButton = screen.getByRole("button", { name: "Run full test suite" })
    expect((runButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Focus Tests before running validation.")).toBeTruthy()

    view.rerender(<DeveloperToolsSurface kind="tests" selectedPath={null} active />)
    expect((runButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(runButton)
    expect(await screen.findByText("suite started", { exact: false })).toBeTruthy()
  })

  it("loads the real selected-file diff and can refresh it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      path: "src/app.ts",
      untracked: false,
      diff: "@@ -1 +1 @@\n-old\n+new",
    }), { headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetcher)

    render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" />)

    expect(await screen.findByText("+new", { exact: false })).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith("/api/loom/diff?path=src%2Fapp.ts", expect.objectContaining({
      cache: "no-store",
      signal: expect.any(AbortSignal),
    }))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("publishes only an exact live modified diff identity for mutation actions", async () => {
    const onLiveDiffContextChange = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        path: "src/app.ts",
        state: "modified",
        fingerprint: "diff-fingerprint-1",
        untracked: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
        status: " M src/app.ts",
      }))
      .mockResolvedValueOnce(Response.json({ error: "DIFF_UNAVAILABLE" }, { status: 503 }))
    vi.stubGlobal("fetch", fetcher)

    render(<DeveloperToolsSurface
      kind="diff"
      selectedPath="src/app.ts"
      onLiveDiffContextChange={onLiveDiffContextChange}
    />)

    await waitFor(() => expect(onLiveDiffContextChange).toHaveBeenCalledWith({
      path: "src/app.ts",
      fingerprint: "diff-fingerprint-1",
    }))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(onLiveDiffContextChange).toHaveBeenLastCalledWith(null))
  })

  it.each([
    [{ path: "src/app.ts", state: "clean", fingerprint: "clean-fingerprint", untracked: false, diff: "", status: "" }],
    [{ path: "src/app.ts", state: "untracked", fingerprint: "new-fingerprint", untracked: true, note: "This file is new.", status: "?? src/app.ts" }],
    [{ path: "other.ts", state: "modified", fingerprint: "foreign-fingerprint", untracked: false, diff: "+foreign", status: " M other.ts" }],
  ])("does not publish non-actionable Changes truth as a mutation identity", async (payload) => {
    const onLiveDiffContextChange = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)))

    render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" onLiveDiffContextChange={onLiveDiffContextChange} />)

    await waitFor(() => expect(onLiveDiffContextChange).toHaveBeenCalled())
    expect(onLiveDiffContextChange).not.toHaveBeenCalledWith(expect.objectContaining({ fingerprint: expect.any(String) }))
    expect(onLiveDiffContextChange).toHaveBeenLastCalledWith(null)
  })

  it("clears stale diff output and makes a governed refresh failure visible", async () => {
    let calls = 0
    const fetcher = vi.fn(() => {
      calls += 1
      return Promise.resolve(calls === 1
        ? Response.json({ path: "src/app.ts", untracked: false, diff: "-old\n+old" })
        : Response.json({ error: "DIFF_REFUSED" }, { status: 500 }))
    })
    vi.stubGlobal("fetch", fetcher)

    const view = render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" refreshKey={0} />)
    expect(await screen.findByText("+old", { exact: false })).toBeTruthy()
    view.rerender(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" refreshKey={1} />)

    expect(screen.queryByText("+old", { exact: false })).toBeNull()
    expect(await screen.findByText("Unable to refresh current change: DIFF_REFUSED")).toBeTruthy()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })

  it("restores the last real Changes response in the same Space as a saved browser snapshot", async () => {
    let resolveReopen!: (response: Response) => void
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ path: "src/app.ts", untracked: false, diff: "-before\n+after", status: " M src/app.ts" }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveReopen = resolve }))
    vi.stubGlobal("fetch", fetcher)

    const first = render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-a" />)
    expect(await screen.findByText("+after", { exact: false })).toBeTruthy()
    expect(window.localStorage.length).toBe(1)
    first.unmount()

    render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-a" />)
    expect(screen.getByText("+after", { exact: false })).toBeTruthy()
    expect(screen.getByText("Saved browser snapshot · not live evidence")).toBeTruthy()

    resolveReopen(Response.json({ path: "src/app.ts", untracked: false, diff: "-after\n+current", status: " M src/app.ts" }))
    expect(await screen.findByText("+current", { exact: false })).toBeTruthy()
  })

  it("never restores a Changes browser snapshot into another Space", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ path: "src/app.ts", untracked: false, diff: "-private\n+world-a-only", status: " M src/app.ts" }))
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
    vi.stubGlobal("fetch", fetcher)

    const view = render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-a" />)
    expect(await screen.findByText("+world-a-only", { exact: false })).toBeTruthy()
    expect(window.localStorage.length).toBe(1)

    view.rerender(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-b" />)
    expect(screen.queryByText("world-a-only", { exact: false })).toBeNull()
    expect(screen.queryByText("Saved browser snapshot · not live evidence")).toBeNull()
  })

  it("replaces a restored Changes snapshot with current live workspace truth on Refresh", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ path: "src/app.ts", untracked: false, diff: "-one\n+saved", status: " M src/app.ts" }))
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(Response.json({ path: "src/app.ts", untracked: false, diff: "-saved\n+live-refresh", status: "MM src/app.ts" }))
    vi.stubGlobal("fetch", fetcher)

    const first = render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-a" />)
    expect(await screen.findByText("+saved", { exact: false })).toBeTruthy()
    expect(window.localStorage.length).toBe(1)
    first.unmount()

    render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-a" />)
    expect(screen.getByText("Saved browser snapshot · not live evidence")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))

    expect(await screen.findByText("+live-refresh", { exact: false })).toBeTruthy()
    expect(screen.queryByText("Saved browser snapshot · not live evidence")).toBeNull()
  })

  it("reports when a live Changes snapshot cannot be saved in browser storage", async () => {
    const quotaStorage = {
      getItem: () => null,
      setItem: () => { throw new DOMException("quota", "QuotaExceededError") },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      path: "src/app.ts", untracked: false, diff: "-before\n+live-only", status: " M src/app.ts",
    })))

    render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-a" historyStorage={quotaStorage} />)

    expect(await screen.findByText("+live-only", { exact: false })).toBeTruthy()
    expect(screen.getByText("Changes snapshot not saved in this browser.")).toBeTruthy()
  })

  it("reports and ignores a corrupt saved Changes snapshot", async () => {
    const corruptStorage = {
      getItem: () => "{not-json",
      setItem: () => undefined,
    }
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>(() => {})))

    render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-a" historyStorage={corruptStorage} />)

    expect(screen.getByText("Saved Changes snapshot was corrupt and was not loaded.")).toBeTruthy()
    expect(screen.queryByText("Saved browser snapshot · not live evidence")).toBeNull()
  })

  it("reports when saved Changes snapshot storage cannot be read", async () => {
    const unavailableStorage = {
      getItem: () => { throw new DOMException("blocked", "SecurityError") },
      setItem: () => undefined,
    }
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>(() => {})))

    render(<DeveloperToolsSurface kind="diff" selectedPath="src/app.ts" historyScope="server:world-a" historyStorage={unavailableStorage} />)

    expect(screen.getByText("Saved Changes snapshot history is unavailable.")).toBeTruthy()
    expect(screen.queryByText("Saved browser snapshot · not live evidence")).toBeNull()
  })

  it("runs the real catalogued test operation and renders its streamed exit", async () => {
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "started", operation: "tests.run" },
      { type: "stdout", text: "7 tests passed\n" },
      { type: "exit", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)

    render(<DeveloperToolsSurface kind="tests" selectedPath={null} />)
    fireEvent.click(screen.getByRole("button", { name: "Run full test suite" }))

    expect(await screen.findByText("7 tests passed", { exact: false })).toBeTruthy()
    expect(await screen.findByText("exit 0", { exact: false })).toBeTruthy()
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ operation: "tests.run" })
  })

  it("reports the exact running tool identity until streamed settlement", async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done }))
    vi.stubGlobal("fetch", fetcher)
    const onRunningChange = vi.fn()
    render(<DeveloperToolsSurface kind="tests" selectedPath={null} onRunningChange={onRunningChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Run full test suite" }))
    await waitFor(() => expect(onRunningChange).toHaveBeenCalledWith({ kind: "tests", operationId: "tests.run" }))
    resolve(ndjson({ type: "exit", code: 0, reason: null }))
    await waitFor(() => expect(onRunningChange).toHaveBeenLastCalledWith(null))
  })

  it("restores a completed Test run as saved browser transcript rather than current evidence", async () => {
    const fetcher = vi.fn().mockResolvedValue(ndjson(
      { type: "started", operation: "tests.run" },
      { type: "stdout", text: "focused suite green\n" },
      { type: "exit", code: 0, reason: null },
    ))
    vi.stubGlobal("fetch", fetcher)

    const first = render(<DeveloperToolsSurface kind="tests" selectedPath={null} historyScope="server:world-a" />)
    fireEvent.click(screen.getByRole("button", { name: "Run full test suite" }))
    expect(await screen.findByText("Transcript saved in this browser.")).toBeTruthy()
    first.unmount()

    render(<DeveloperToolsSurface kind="tests" selectedPath={null} historyScope="server:world-a" />)
    expect(screen.getByText("focused suite green", { exact: false })).toBeTruthy()
    expect(screen.getByText("Saved browser transcript · not live evidence")).toBeTruthy()
  })

  it("automatically renders the newest relevant saved transcript and keeps Live output explicit", async () => {
    saveTranscript({ scope: "server:world-a", id: "older-terminal", operationId: "repo.status", startedAt: "2026-08-30T10:00:00.000Z", text: "older status bytes\n" })
    saveTranscript({ scope: "server:world-a", id: "newer-terminal", operationId: "repo.diff", startedAt: "2026-08-30T10:01:00.000Z", text: "newest diff bytes\n" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ operations: projectOperations })))

    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)

    expect(await screen.findByText("newest diff bytes", { exact: false })).toBeTruthy()
    expect(screen.queryByText("older status bytes", { exact: false })).toBeNull()
    expect(screen.getByText("Saved browser transcript · not live evidence")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Live output" }).getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("button", { name: /git diff.*saved browser transcript/i }).getAttribute("aria-pressed")).toBe("true")
  })

  it("selects only the newest valid transcript for the current kind and Space scope", async () => {
    saveTranscript({ scope: "server:world-a", id: "world-a-test", operationId: "tests.run", startedAt: "2026-08-30T10:00:00.000Z", text: "world A test bytes\n" })
    saveTranscript({ scope: "server:world-a", id: "world-a-terminal", operationId: "repo.status", startedAt: "2026-08-30T10:01:00.000Z", text: "world A terminal bytes\n" })
    saveTranscript({ scope: "server:world-b", id: "world-b-terminal", operationId: "repo.diff", startedAt: "2026-08-30T10:02:00.000Z", text: "world B terminal bytes\n" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ operations: projectOperations })))
    const view = render(<DeveloperToolsSurface kind="tests" selectedPath={null} historyScope="server:world-a" />)

    expect(await screen.findByText("world A test bytes", { exact: false })).toBeTruthy()
    expect(screen.queryByText("world A terminal bytes", { exact: false })).toBeNull()

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    expect(await screen.findByText("world A terminal bytes", { exact: false })).toBeTruthy()
    expect(screen.queryByText("world A test bytes", { exact: false })).toBeNull()

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-b" />)
    expect(await screen.findByText("world B terminal bytes", { exact: false })).toBeTruthy()
    expect(screen.queryByText("world A terminal bytes", { exact: false })).toBeNull()
  })

  it("automatically preserves cancelled and interrupted transcript truth without promoting restored bytes live", async () => {
    saveTranscript({ scope: "server:cancelled", id: "cancelled-terminal", operationId: "repo.status", startedAt: "2026-08-30T10:00:00.000Z", text: "cancelled partial bytes\n", status: "cancelled" })
    saveTranscript({ scope: "server:interrupted", id: "interrupted-terminal", operationId: "repo.diff", startedAt: "2026-08-30T10:01:00.000Z", text: "interrupted partial bytes\n", status: "interrupted" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ operations: projectOperations })))
    const view = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:cancelled" />)

    expect(await screen.findByText("cancelled partial bytes", { exact: false })).toBeTruthy()
    expect(screen.getByText("Cancelled · not completed or live evidence")).toBeTruthy()

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:interrupted" />)
    expect(await screen.findByText("interrupted partial bytes", { exact: false })).toBeTruthy()
    expect(screen.getByText("Interrupted · not completed or live evidence")).toBeTruthy()
    expect(screen.queryByText("cancelled partial bytes", { exact: false })).toBeNull()
  })

  it("keeps empty, corrupt, and unavailable history on Live output without restoring bytes", () => {
    window.localStorage.setItem("williamos:tool-runs:v1:server:corrupt", "{not-json")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ operations: projectOperations })))
    const view = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:empty" />)

    expect(screen.getByText("Type one fixed alias. Tab completes; Enter runs. No shell text is accepted.")).toBeTruthy()
    expect(screen.queryByText("Saved browser transcript · not live evidence")).toBeNull()

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:corrupt" />)
    expect(screen.getByText("Saved browser transcript history was corrupt and was not loaded.")).toBeTruthy()
    expect(screen.queryByText("Saved browser transcript · not live evidence")).toBeNull()

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:unavailable" historyStorage={{
      getItem: () => { throw new DOMException("blocked", "SecurityError") },
      setItem: () => undefined,
    }} />)
    expect(screen.getByText("Saved browser transcript history is unavailable.")).toBeTruthy()
    expect(screen.queryByText("Saved browser transcript · not live evidence")).toBeNull()
  })

  it("switches immediately from a restored transcript to Live output when a new command starts", async () => {
    saveTranscript({ scope: "server:world-a", id: "saved-terminal", operationId: "repo.status", startedAt: "2026-08-30T10:00:00.000Z", text: "restored command bytes\n" })
    let resolveRun!: (response: Response) => void
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? new Promise<Response>((resolve) => { resolveRun = resolve })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    expect(await screen.findByText("restored command bytes", { exact: false })).toBeTruthy()
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })

    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(screen.queryByText("restored command bytes", { exact: false })).toBeNull()
    expect(screen.getByRole("button", { name: "Live output" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("Running repo.status")).toBeTruthy()
    resolveRun(ndjson({ type: "exit", code: 0, reason: null }))
  })

  it("keeps Terminal and Test transcript switchers relevant while preserving their shared bounded history", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? ndjson({ type: "stdout", text: "terminal bytes\n" }, { type: "exit", code: 0, reason: null })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    const terminal = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(await screen.findByText("Transcript saved in this browser.")).toBeTruthy()
    terminal.unmount()

    render(<DeveloperToolsSurface kind="tests" selectedPath={null} historyScope="server:world-a" />)
    expect(screen.queryByRole("button", { name: /git status.*saved browser transcript/i })).toBeNull()
  })

  it("offers only real bounded project operations in the Terminal surface", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ operations: [
      { id: "repo.status", label: "What has changed", intent: "List files", scope: "project", mutating: false },
      { id: "tests.run", label: "Run tests", intent: "Run tests", scope: "project", mutating: false },
      { id: "service.restart", label: "Restart", intent: "Restart service", scope: "runtime", mutating: true },
    ] }), { headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetcher)

    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} />)

    expect(await screen.findByRole("button", { name: "What has changed" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Run tests" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull()
  })

  it("completes and runs an exact alias from the keyboard while streaming exact exit truth", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? ndjson(
        { type: "started", operation: "repo.status", label: "What has changed" },
        { type: "stdout", text: "## main\n" },
        { type: "stderr", text: "warning\n" },
        { type: "exit", code: 3, reason: null },
      )
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)

    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git st" } })
    fireEvent.keyDown(input, { key: "Tab" })
    expect((input as HTMLInputElement).value).toBe("git status")
    fireEvent.keyDown(input, { key: "Enter" })

    expect(await screen.findByText("## main", { exact: false })).toBeTruthy()
    expect(screen.getByText("warning", { exact: false })).toBeTruthy()
    expect(screen.getByText("exit 3", { exact: false })).toBeTruthy()
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ operation: "repo.status" })
  })

  it.each([
    ["CANCELLED", "cancelled"],
    ["TIMEOUT", "interrupted"],
    ["OUTPUT_LIMIT", "interrupted"],
    ["SPAWN_FAILED", "interrupted"],
    [null, "interrupted"],
  ] as const)("settles server exit reason %s as %s rather than completed", async (reason, expectedStatus) => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? ndjson({ type: "stdout", text: "bounded bytes\n" }, { type: "exit", code: null, reason })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(await screen.findByRole("button", { name: new RegExp(`git status.*${expectedStatus}.*saved browser transcript`, "i") })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /git status.*completed.*saved browser transcript/i })).toBeNull()
  })

  it("binds an active run to its start Space and never injects settlement into a newly selected Space", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller } })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? new Response(body, { headers: { "content-type": "application/x-ndjson" } })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    const view = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })
    streamController!.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "stdout", text: "old Space bytes\n" })}\n`))
    expect(await screen.findByText("old Space bytes", { exact: false })).toBeTruthy()

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-b" />)
    await waitFor(() => expect(screen.queryByText("old Space bytes", { exact: false })).toBeNull())
    streamController!.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "exit", code: 0, reason: null })}\n`))
    streamController!.close()

    await waitFor(() => expect(loadToolRunHistory(window.localStorage, "server:world-a").runs).toHaveLength(1))
    expect(loadToolRunHistory(window.localStorage, "server:world-b").runs).toHaveLength(0)
    expect(screen.queryByText("old Space bytes", { exact: false })).toBeNull()
    expect(screen.queryByRole("button", { name: /git status.*saved browser transcript/i })).toBeNull()
  })

  it("does not publish Stop settlement from an old active run into the newly selected Space", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller } })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? new Response(body, { headers: { "content-type": "application/x-ndjson" } })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    const view = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })
    streamController!.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "stdout", text: "old stop bytes\n" })}\n`))
    expect(await screen.findByText("old stop bytes", { exact: false })).toBeTruthy()

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-b" />)
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Project terminal command" }) as HTMLInputElement).value).toBe(""))
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    streamController!.close()

    expect(screen.queryByText("old stop bytes", { exact: false })).toBeNull()
    expect(screen.queryByText("CANCELLED", { exact: false })).toBeNull()
    expect(loadToolRunHistory(window.localStorage, "server:world-b").runs).toHaveLength(0)
  })

  it("does not publish old-run EOF interruption into the newly selected Space", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller } })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? new Response(body, { headers: { "content-type": "application/x-ndjson" } })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    const view = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })
    streamController!.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "stdout", text: "old eof bytes\n" })}\n`))
    expect(await screen.findByText("old eof bytes", { exact: false })).toBeTruthy()

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-b" />)
    await waitFor(() => expect(screen.queryByText("old eof bytes", { exact: false })).toBeNull())
    streamController!.close()

    await waitFor(() => expect(screen.queryByText("Running repo.status")).toBeNull())
    expect(screen.queryByText("INTERRUPTED", { exact: false })).toBeNull()
    expect(loadToolRunHistory(window.localStorage, "server:world-b").runs).toHaveLength(0)
  })

  it("does not publish an old-run fetch rejection or command into the newly selected Space", async () => {
    let rejectPost!: (reason: unknown) => void
    const post = new Promise<Response>((_resolve, reject) => { rejectPost = reject })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? post
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    const view = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await screen.findByText("Running repo.status")

    view.rerender(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-b" />)
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Project terminal command" }) as HTMLInputElement).value).toBe(""))
    rejectPost(new Error("OLD_SPACE_REJECTED"))

    await waitFor(() => expect(screen.queryByText("Running repo.status")).toBeNull())
    expect(screen.queryByText("OLD_SPACE_REJECTED", { exact: false })).toBeNull()
    expect(screen.queryByText("INTERRUPTED", { exact: false })).toBeNull()
    expect(loadToolRunHistory(window.localStorage, "server:world-b").runs).toHaveLength(0)
  })

  it("refuses arbitrary commands and extra arguments locally without posting", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })

    for (const command of ["rm -rf .", "powershell Get-ChildItem", "git status --short"]) {
      fireEvent.change(input, { target: { value: command } })
      fireEvent.keyDown(input, { key: "Enter" })
      expect(await screen.findByText(`Not run: “${command}” is not a fixed project alias.`)).toBeTruthy()
    }
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0)
  })

  it("does not trap keyboard focus when Tab has no unique fixed-alias completion", async () => {
    const fetcher = vi.fn(async () => Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "unknown" } })
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })

    input.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(false)
  })

  it("restores a completed saved browser transcript only inside the same Space scope", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? ndjson({ type: "started", operation: "repo.status", label: "What has changed" }, { type: "stdout", text: "saved bytes\n" }, { type: "exit", code: 0, reason: null })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    const first = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(await screen.findByText("Transcript saved in this browser.")).toBeTruthy()
    first.unmount()

    const reopened = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    expect(screen.getByText("Saved browser transcript · not live evidence")).toBeTruthy()
    expect(screen.getByText("saved bytes", { exact: false })).toBeTruthy()
    reopened.unmount()

    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-b" />)
    expect(screen.queryByText("saved bytes", { exact: false })).toBeNull()
    expect(screen.queryByRole("button", { name: /git status.*saved browser transcript/i })).toBeNull()
  })

  it("persists Stop as cancelled partial output, never as completed evidence", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "started", operation: "repo.status", label: "What has changed" })}\n${JSON.stringify({ type: "stdout", text: "partial bytes\n" })}\n`))
      },
    })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? new Response(body, { headers: { "content-type": "application/x-ndjson" } })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    const first = render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(await screen.findByText("partial bytes", { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(await screen.findByText("cancelled · saved browser transcript", { exact: false })).toBeTruthy()
    expect(screen.queryByText("server-verified")).toBeNull()
    first.unmount()

    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" />)
    expect(screen.getByText("partial bytes", { exact: false })).toBeTruthy()
    expect(screen.getByText("Cancelled · not completed or live evidence")).toBeTruthy()
  })

  it("keeps completed output visible and marks it not saved when browser persistence fails", async () => {
    const quotaStorage = {
      getItem: (key: string) => window.localStorage.getItem(key),
      setItem: () => { throw new DOMException("quota", "QuotaExceededError") },
    }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? ndjson({ type: "started", operation: "repo.status", label: "What has changed" }, { type: "stdout", text: "still visible\n" }, { type: "exit", code: 0, reason: null })
      : Response.json({ operations: projectOperations }))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperToolsSurface kind="terminal" selectedPath={null} historyScope="server:world-a" historyStorage={quotaStorage} />)
    const input = await screen.findByRole("textbox", { name: "Project terminal command" })
    fireEvent.change(input, { target: { value: "git status" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(await screen.findByText("still visible", { exact: false })).toBeTruthy()
    expect(screen.getByText("Browser transcript not saved.")).toBeTruthy()
  })
})
