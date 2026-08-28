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

function workspaceResponse(storage: "server" | "browser" = "browser") {
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
      schemaVersion: 1,
      sessionId,
      role: "Builder",
      provider: "Codex",
      assignment: "src/app.ts",
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
    expect(JSON.parse(String(window.localStorage.getItem(key)))).toMatchObject({ sessionId, provider: "Codex" })
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
    expect(JSON.parse(String(window.localStorage.getItem("williamos:agent-session:owner-1:terrafusion")))).toMatchObject({ provider: "Claude", assignment: "new.ts" })
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
      schemaVersion: 1,
      sessionId,
      role: "Builder",
      provider: "Claude",
      assignment: "Change src/app.ts",
    })
  })

  it("keeps a restored descriptor unverified and out of the live session strip until resume succeeds", async () => {
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
    expect(screen.queryByRole("button", { name: /Reviewer · Claude/i })).toBeNull()
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

  it("clears a refused restored descriptor so the next delegation can start fresh", async () => {
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

    expect(window.localStorage.getItem(key)).toBeNull()
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

    expect(JSON.parse(String(window.localStorage.getItem(key)))).toEqual(descriptor)
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
    expect(expose!.sessions).toEqual([])
  })
})
