// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const FIRST = "123e4567-e89b-42d3-a456-426614174000"
const SECOND = "223e4567-e89b-42d3-a456-426614174000"
const UNVERIFIED = "323e4567-e89b-42d3-a456-426614174000"

const harness = vi.hoisted(() => ({ controller: null as any }))

vi.mock("@/components/workspace-shell/agent-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/workspace-shell/agent-sessions")>()
  return { ...actual, useExperienceAgentSessions: () => harness.controller }
})

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor(props: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Source content" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  },
}))

function workspaceResponse() {
  const space = {
    ...defaultSpace(),
    selectedPath: "src/app.ts",
    activeWindowId: "editor" as const,
    editor: { openFiles: ["src/app.ts"], panes: [{ id: "primary" as const, activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }], activePaneId: "primary" as const },
  }
  return Response.json({
    worldId: "browser-world",
    space: spaceToServer(space),
    spine: EMPTY_SPINE,
    project: { identity: "c:/repos/terrafusion", name: "TerraFusion" },
    storage: "browser",
    browserStorageKey: "line-target-test",
  })
}

function fetcher() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
    if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
    if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n" }))
    if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
  })
}

function descriptor(sessionId: string, assignment: string) {
  return {
    schemaVersion: 1 as const,
    sessionId,
    role: "Reviewer",
    provider: "Claude" as const,
    assignment,
    reviewPath: assignment.endsWith("other.ts") ? "src/other.ts" : "src/app.ts",
    updatedAt: "2026-08-30T12:00:00.000Z",
    completedTurns: [{ ownerPrompt: "Review it.", finalResult: `Saved ${assignment}`, completedAt: "2026-08-30T12:00:00.000Z" }],
  }
}

function projected(sessionId: string, assignment: string, truth: "live" | "resume-unverified" = "live") {
  const reviewPath = assignment.endsWith("other.ts") ? "src/other.ts" : "src/app.ts"
  return {
    id: `Claude:${sessionId}`,
    role: "Reviewer",
    providerLabel: "Claude",
    assignment,
    status: truth === "live" ? "ready" : "resume unverified",
    evidence: "saved transcript",
    truth,
    kind: "durable-session" as const,
    mode: "review" as const,
    reviewPath,
    lastResult: `Saved ${assignment}`,
  }
}

beforeEach(() => {
  const saved = [descriptor(FIRST, "Review src/app.ts"), descriptor(SECOND, "Review src/other.ts"), descriptor(UNVERIFIED, "Review src/unverified.ts")]
  harness.controller = {
    sessions: [projected(FIRST, "Review src/app.ts"), projected(SECOND, "Review src/other.ts"), projected(UNVERIFIED, "Review src/unverified.ts", "resume-unverified")],
    durableSession: saved[0], savedDescriptor: saved[0], savedSessions: saved,
    collectionState: "available", selectedSessionKey: `Claude:${FIRST}`, descriptorState: "verified",
    activeSessionId: null, pausableSessionId: null, activeSessionIds: [], pausableSessionIds: [], activeTurns: [], activeProvider: null, error: null,
    runClaudeTurn: vi.fn(), runPreviewDiagnostic: vi.fn(), runAgentTurn: vi.fn(), forkClaudeSession: vi.fn(),
    continueSession: vi.fn(async ({ sessionKey, prompt, onPresentation }: any) => {
      const prior = saved.find((candidate) => `Claude:${candidate.sessionId}` === sessionKey)!
      const completed = { ...prior, completedTurns: [...prior.completedTurns, { ownerPrompt: prompt, finalResult: `Continued ${prior.assignment}`, completedAt: "2026-08-30T12:01:00.000Z" }] }
      onPresentation?.({ phase: "complete", text: `Continued ${prior.assignment}`, provider: "Claude", sessionId: prior.sessionId })
      return completed
    }),
    selectSession: vi.fn((key: string | null) => { harness.controller.selectedSessionKey = key; return true }), stop: vi.fn(),
  }
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe("Experience V2 Line durable-session targets", () => {
  it("keeps William default and lists each verified exact-world session role-first without projecting unverified hints", async () => {
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    const targets = screen.getByRole("group", { name: "Line targets" })
    expect(targets).toBeTruthy()
    expect(screen.getByRole("button", { name: "William" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts · .*${FIRST.slice(-6)}`) })).toBeTruthy()
    expect(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/other\\.ts · .*${SECOND.slice(-6)}`) })).toBeTruthy()
    expect(screen.queryByText(/unverified\.ts/)).toBeNull()
  })

  it("binds the exact chosen session and resumes it through continueSession without a William or replacement request", async () => {
    const mockedFetch = fetcher()
    vi.stubGlobal("fetch", mockedFetch)
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/other\\.ts · .*${SECOND.slice(-6)}`) }))
    expect(screen.getByText((text, element) => element?.tagName === "SPAN" && /Reviewer · Claude · Review src\/other\.ts/.test(text))).toBeTruthy()
    expect(screen.getByText((text, element) => element?.tagName === "SPAN" && /src\/app\.ts · TerraFusion Space/.test(text))).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Recheck this exact review." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))

    await waitFor(() => expect(harness.controller.continueSession).toHaveBeenCalledTimes(1))
    expect(harness.controller.continueSession.mock.calls[0][0]).toMatchObject({
      sessionKey: `Claude:${SECOND}`,
      prompt: "Recheck this exact review.",
    })
    expect(await screen.findByText("Continued Review src/other.ts")).toBeTruthy()
    expect(mockedFetch.mock.calls.some(([input]) => String(input) === "/api/environment/line")).toBe(false)
    expect(harness.controller.runClaudeTurn).not.toHaveBeenCalled()
    expect(harness.controller.runAgentTurn).not.toHaveBeenCalled()
  })

  it("fails closed before transport when the exact durable collection changes after target selection", async () => {
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts · .*${FIRST.slice(-6)}`) }))

    harness.controller.savedSessions = [descriptor(SECOND, "Review src/other.ts")]
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Do not guess." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))

    expect(await screen.findByText("Agent turn unavailable.")).toBeTruthy()
    expect(harness.controller.continueSession).not.toHaveBeenCalled()
  })

  it("reattaches an already-running exact session without overlap and closing the Line does not cancel it", async () => {
    const exactKey = `Claude:${FIRST}`
    harness.controller.activeSessionId = exactKey
    harness.controller.activeSessionIds = [exactKey]
    harness.controller.activeTurns = [{ id: exactKey, provider: "Claude", role: "Reviewer", sessionId: FIRST, presentation: "Reviewer is checking the saved assignment.", descriptor: harness.controller.savedSessions[0] }]
    harness.controller.sessions = harness.controller.sessions.map((session: any) => session.id === exactKey
      ? { ...session, status: "working", presentation: "Reviewer is checking the saved assignment." }
      : session)
    vi.stubGlobal("fetch", fetcher())
    const view = render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts · .*${FIRST.slice(-6)}`) }))

    expect(screen.getByText("Reviewer is checking the saved assignment.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Session working" }) as HTMLButtonElement).disabled).toBe(true)
    expect(harness.controller.continueSession).not.toHaveBeenCalled()

    harness.controller.activeSessionId = null
    harness.controller.activeSessionIds = []
    harness.controller.activeTurns = []
    harness.controller.sessions = harness.controller.sessions.map((session: any) => session.id === exactKey
      ? { ...session, status: "ready", presentation: undefined, lastResult: "Canonical settled Reviewer answer." }
      : session)
    view.rerender(<WorkspaceShell />)
    expect(await screen.findByText("Canonical settled Reviewer answer.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    expect(harness.controller.stop).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.queryByText("Canonical settled Reviewer answer.")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts · .*${FIRST.slice(-6)}`) }))
    expect(screen.getByText("Canonical settled Reviewer answer.")).toBeTruthy()
  })

  it.each(["missing", "corrupt", "oversized", "unavailable", "partial"] as const)("shows no durable targets when the exact collection is %s", async (state) => {
    harness.controller.collectionState = state
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    const targets = screen.getByRole("group", { name: "Line targets" })
    expect(targets.querySelectorAll("button")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "William" }).getAttribute("aria-pressed")).toBe("true")
  })
})
