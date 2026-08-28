// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DeveloperToolsSurface } from "@/components/workspace-shell/developer-tools-surface"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function ndjson(...events: readonly Record<string, unknown>[]): Response {
  const body = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } })
}

describe("Experience V2 developer tools", () => {
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
})
