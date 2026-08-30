// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell, lineObjectBindingFingerprint } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const FIRST = "123e4567-e89b-42d3-a456-426614174000"
const SECOND = "223e4567-e89b-42d3-a456-426614174000"
const UNVERIFIED = "323e4567-e89b-42d3-a456-426614174000"
const COLLISION = "423e4567-e89b-42d3-a456-426614174000"
const BUILDER = "523e4567-e89b-42d3-a456-426614174001"
const PREVIEW = "623e4567-e89b-42d3-a456-426614174002"
const LOCAL = "723e4567-e89b-42d3-a456-426614174003"

let liveDiff = { path: "src/app.ts", state: "clean", fingerprint: "clean-diff", untracked: false, diff: "", status: "" }
let workspaceActiveWindowId: "editor" | null = "editor"

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
    activeWindowId: workspaceActiveWindowId,
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
    if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json(liveDiff))
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
  liveDiff = { path: "src/app.ts", state: "clean", fingerprint: "clean-diff", untracked: false, diff: "", status: "" }
  workspaceActiveWindowId = "editor"
  const saved = [descriptor(FIRST, "Review src/app.ts"), descriptor(SECOND, "Review src/other.ts"), descriptor(COLLISION, "Review src/app.ts"), descriptor(UNVERIFIED, "Review src/unverified.ts")]
  harness.controller = {
    sessions: [projected(FIRST, "Review src/app.ts"), projected(SECOND, "Review src/other.ts"), projected(COLLISION, "Review src/app.ts"), projected(UNVERIFIED, "Review src/unverified.ts", "resume-unverified")],
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
  it("structurally distinguishes same-role agent objects and exact diff identities", () => {
    expect(lineObjectBindingFingerprint({ kind: "agent-session", sessionKey: `Claude:${FIRST}` }))
      .not.toBe(lineObjectBindingFingerprint({ kind: "agent-session", sessionKey: `Claude:${SECOND}` }))
    expect(lineObjectBindingFingerprint({ kind: "diff", path: "src/app.ts", fingerprint: "diff-a" }))
      .not.toBe(lineObjectBindingFingerprint({ kind: "diff", path: "src/app.ts", fingerprint: "diff-b" }))
  })

  it("keeps William default and lists each verified exact-world session role-first without projecting unverified hints", async () => {
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    const targets = screen.getByRole("group", { name: "Line targets" })
    expect(targets).toBeTruthy()
    expect(screen.getByRole("button", { name: "William" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts.*${FIRST}`) })).toBeTruthy()
    expect(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/other\\.ts.*${SECOND}`) })).toBeTruthy()
    const colliding = [FIRST, COLLISION].map((id) => screen.getByRole("button", { name: new RegExp(`Review src/app\\.ts.*${id}`) }))
    expect(new Set(colliding.map((button) => button.getAttribute("aria-label"))).size).toBe(2)
    expect(colliding.every((button) => button.getAttribute("title")?.includes(idFor(button, [FIRST, COLLISION])))).toBe(true)
    expect(new Set(colliding.map((button) => button.textContent)).size).toBe(2)
    expect(screen.queryByText(/unverified\.ts/)).toBeNull()
  })

  it("binds the exact chosen session and resumes it through continueSession without a William or replacement request", async () => {
    const mockedFetch = fetcher()
    vi.stubGlobal("fetch", mockedFetch)
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/other\\.ts.*${SECOND}`) }))
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
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts.*${FIRST}`) }))

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
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts.*${FIRST}`) }))

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
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts.*${FIRST}`) }))
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

  it("reattaches the exact pre-init continuation as starting and cannot dispatch it twice", async () => {
    let settle!: (value: any) => void
    harness.controller.continueSession = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    vi.stubGlobal("fetch", fetcher())
    const view = render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(FIRST) }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Start exact continuation." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(FIRST) }))
    expect(screen.getByText("Agent is starting.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Session working" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Do not duplicate." } })
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))
    expect(harness.controller.continueSession).toHaveBeenCalledTimes(1)

    const completed = { ...harness.controller.savedSessions[0], completedTurns: [...harness.controller.savedSessions[0].completedTurns, { ownerPrompt: "Start exact continuation.", finalResult: "Settled exact continuation.", completedAt: "2026-08-30T12:02:00.000Z" }] }
    harness.controller.savedSessions = [completed, ...harness.controller.savedSessions.slice(1)]
    harness.controller.sessions = harness.controller.sessions.map((session: any) => session.id === `Claude:${FIRST}` ? { ...session, lastResult: "Settled exact continuation." } : session)
    settle(completed)
    view.rerender(<WorkspaceShell />)
    expect(await screen.findByText("Settled exact continuation.")).toBeTruthy()
  })

  it("reattaches a pre-init Space Continue to its exact prior session without a second dispatch", async () => {
    workspaceActiveWindowId = null
    let settle!: (value: any) => void
    harness.controller.continueSession = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Continue from Space." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(FIRST) }))

    expect(screen.getByText("Agent is starting.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Session working" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))
    expect(harness.controller.continueSession).toHaveBeenCalledTimes(1)

    settle(harness.controller.savedSessions[0])
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue session" })).toBeTruthy())
  })

  it("reattaches pre-init Reviewer Talk to the exact review session without starting another resume", async () => {
    let settle!: (value: any) => void
    harness.controller.runClaudeTurn = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    const reviewerCard = screen.getAllByRole("button", { name: "Reviewer · Claude · Review src/app.ts" })[0]
    fireEvent.click(reviewerCard)
    fireEvent.click(screen.getByRole("button", { name: "Talk" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Talk to this Reviewer." } })
    fireEvent.click(screen.getByRole("button", { name: "Send to Reviewer" }))
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Talk" }))
    expect(screen.getByText("Agent is starting.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Session working" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(FIRST) }))

    expect(screen.getByText("Agent is starting.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Session working" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))
    expect(harness.controller.runClaudeTurn).toHaveBeenCalledTimes(1)

    settle(harness.controller.savedSessions[0])
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue session" })).toBeTruthy())
  })

  it.each([
    { name: "Codex Builder", provider: "Codex" as const, sessionId: BUILDER, role: "Builder", assignment: "Build the bounded file", mode: "delegate" as const, method: "runAgentTurn" as const },
    { name: "Preview debugger", provider: "Claude" as const, sessionId: PREVIEW, role: "Preview debugger", assignment: "Developer Preview diagnosis", mode: "preview" as const, method: "runPreviewDiagnostic" as const },
    { name: "Local Thinker", provider: "Local" as const, sessionId: LOCAL, role: "Thinker", assignment: "Conversation", mode: "delegate" as const, method: "runAgentTurn" as const },
  ])("reattaches pre-init $name Talk through its exact durable identity", async ({ provider, sessionId, role, assignment, mode, method }) => {
    const exactKey = `${provider}:${sessionId}`
    const durable = {
      schemaVersion: 1 as const, sessionId, role, provider, assignment,
      ...(mode === "preview" ? { preview: { worldId: "browser-world", evidenceFingerprint: "preview-fingerprint" } } : {}),
      updatedAt: "2026-08-30T12:00:00.000Z", completedTurns: [],
    }
    const projection = {
      id: exactKey, role, providerLabel: provider, assignment, status: "ready", evidence: "saved transcript",
      truth: "live" as const, kind: "durable-session" as const, mode,
      ...(mode === "preview" ? { preview: durable.preview } : {}),
    }
    harness.controller.savedSessions = [durable]
    harness.controller.savedDescriptor = durable
    harness.controller.durableSession = durable
    harness.controller.sessions = [projection]
    harness.controller.selectedSessionKey = exactKey
    let settle!: (value: any) => void
    harness.controller[method] = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.click(screen.getByRole("button", { name: `${role} · ${provider} · ${assignment}` }))
    if (screen.queryByRole("button", { name: "Close The Line" })) fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Talk" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: `Continue ${role}.` } })
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(sessionId) }))

    expect(screen.getByText("Agent is starting.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Session working" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))
    expect(harness.controller[method]).toHaveBeenCalledTimes(1)

    settle(durable)
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue session" })).toBeTruthy())
  })

  it("rebinds canonical fingerprints after a successful continuation so the same selected target can continue again", async () => {
    let turn = 0
    harness.controller.continueSession = vi.fn(async ({ sessionKey, prompt, onPresentation }: any) => {
      turn += 1
      const prior = harness.controller.savedSessions.find((candidate: any) => `Claude:${candidate.sessionId}` === sessionKey)
      const result = `Canonical follow-up ${turn}`
      const completed = { ...prior, updatedAt: `2026-08-30T12:0${turn}:00.000Z`, completedTurns: [...prior.completedTurns, { ownerPrompt: prompt, finalResult: result, completedAt: `2026-08-30T12:0${turn}:00.000Z` }] }
      harness.controller.savedSessions = harness.controller.savedSessions.map((candidate: any) => candidate.sessionId === completed.sessionId ? completed : candidate)
      harness.controller.sessions = harness.controller.sessions.map((session: any) => session.id === sessionKey ? { ...session, lastResult: result } : session)
      onPresentation?.({ phase: "complete", text: result, provider: "Claude", sessionId: completed.sessionId })
      return completed
    })
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(FIRST) }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "First follow-up." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))
    expect(await screen.findByText("Canonical follow-up 1")).toBeTruthy()

    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Second follow-up." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))
    expect(await screen.findByText("Canonical follow-up 2")).toBeTruthy()
    expect(harness.controller.continueSession).toHaveBeenCalledTimes(2)
  })

  it("fails closed when the selected Changes path or fingerprint drifts after target capture", async () => {
    liveDiff = { path: "src/app.ts", state: "modified", fingerprint: "diff-a", untracked: false, diff: "+a", status: " M src/app.ts" }
    vi.stubGlobal("fetch", fetcher())
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: "Restore Changes" }))
    await screen.findByText("+a")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(FIRST) }))

    liveDiff = { ...liveDiff, fingerprint: "diff-b", diff: "+b" }
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText("+b")
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Must refuse stale diff." } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))

    expect(await screen.findByText("Agent turn unavailable.")).toBeTruthy()
    expect(harness.controller.continueSession).not.toHaveBeenCalled()
  })
})

function idFor(button: HTMLElement, ids: readonly string[]): string {
  return ids.find((id) => button.getAttribute("aria-label")?.includes(id)) ?? "missing"
}
