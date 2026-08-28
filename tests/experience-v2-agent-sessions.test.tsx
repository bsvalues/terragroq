// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AgentSessionStrip,
  useExperienceAgentSessions,
  type ExperienceAgentSessionController,
} from "@/components/workspace-shell/agent-sessions"
import type { WorldWorker } from "@/lib/environment/working-world"

const OWNER_SCOPE = "owner-1"
const WORLD_SCOPE = "terrafusion"

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

function Harness({ worker = null }: { worker?: WorldWorker | null }) {
  const controller = useExperienceAgentSessions({ ownerScope: OWNER_SCOPE, worldScope: WORLD_SCOPE, worker })
  expose = controller
  return (
    <AgentSessionStrip
      sessions={controller.sessions}
      runningSessionId={controller.activeSessionId}
      onStop={controller.stop}
    />
  )
}

let expose: ExperienceAgentSessionController | null = null

describe("Experience V2 real agent sessions", () => {
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
