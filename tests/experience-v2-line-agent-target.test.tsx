// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
const OS1_REVISION = "a".repeat(40)
const OS1_REPOSITORY = {
  resourceKey: "os-1",
  identity: "bsvalues/terrafusion_os_1.0",
  mountKey: "terrafusion:os-1:configured",
  observedRevision: OS1_REVISION,
} as const

function reviewerFileBinding(path: string) {
  return {
    repository: OS1_REPOSITORY,
    fileRef: {
      projectIdentity: "c:/repos/terrafusion",
      repositoryResourceKey: OS1_REPOSITORY.resourceKey,
      repositoryMountKey: OS1_REPOSITORY.mountKey,
      worktreeKey: null,
      observedRevision: OS1_REVISION,
      path,
    },
  } as const
}

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

function workspaceResponse(storage: "browser" | "server" = "browser") {
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
    storage,
    ...(storage === "browser" ? { browserStorageKey: "line-target-test" } : {}),
  })
}

function fetcher(storage: "browser" | "server" = "browser") {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse(storage))
    if (url === "/api/environment/space" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body))
      return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-08-30T12:00:00.000Z" }))
    }
    if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
    if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n" }))
    if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json(liveDiff))
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
  })
}

function descriptor(sessionId: string, assignment: string) {
  const reviewPath = assignment.endsWith("other.ts") ? "src/other.ts" : "src/app.ts"
  return {
    schemaVersion: 1 as const,
    sessionId,
    role: "Reviewer",
    provider: "Claude" as const,
    assignment,
    reviewPath,
    ...reviewerFileBinding(reviewPath),
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
    evidence: truth === "live" ? "saved transcript" : "saved transcript · server verification required",
    truth,
    kind: "durable-session" as const,
    mode: "review" as const,
    reviewPath,
    ...reviewerFileBinding(reviewPath),
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
    expect(within(targets).getByRole("button", { name: "William" }).getAttribute("aria-pressed")).toBe("true")
    expect(within(targets).getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/app\\.ts.*${FIRST}`) })).toBeTruthy()
    expect(within(targets).getByRole("button", { name: new RegExp(`Reviewer · Claude · Review src/other\\.ts.*${SECOND}`) })).toBeTruthy()
    const colliding = [FIRST, COLLISION].map((id) => within(targets).getByRole("button", { name: new RegExp(`Review src/app\\.ts.*${id}`) }))
    expect(new Set(colliding.map((button) => button.getAttribute("aria-label"))).size).toBe(2)
    expect(colliding.every((button) => button.getAttribute("title")?.includes(idFor(button, [FIRST, COLLISION])))).toBe(true)
    expect(new Set(colliding.map((button) => button.textContent)).size).toBe(2)
    expect(within(targets).queryByText(/unverified\.ts/)).toBeNull()

    const strip = screen.getByRole("navigation", { name: "Durable agent sessions" })
    const unverified = within(strip).getByRole("button", { name: `Reviewer · Claude · Review src/unverified.ts` })
    expect(within(unverified).getByTitle("Review src/unverified.ts").textContent).toBe("Review src/unverified.ts")
    expect(within(unverified).getByText("resume unverified · saved transcript · server verification required")).toBeTruthy()
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
    await waitFor(() => expect(harness.controller.continueSession).toHaveBeenCalledTimes(1))
    expect(harness.controller.continueSession.mock.calls[0][0]).toMatchObject({
      sessionKey: `Claude:${FIRST}`,
      prompt: "Continue this exact saved session from its canonical transcript. Re-establish context and report the next bounded result without changing files, runtime state, target, or authority.",
    })
    expect(screen.queryByRole("textbox", { name: "The Line" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Continue session" })).toBeNull()
    expect(screen.getByRole("button", { name: "Stop Space continuation" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: new RegExp(FIRST) }))

    expect(screen.getByText("Agent is starting.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Stop Space continuation" })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "The Line" })).toBeNull()
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))
    expect(harness.controller.continueSession).toHaveBeenCalledTimes(1)

    settle(harness.controller.savedSessions[0])
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue session" })).toBeTruthy())
  })

  it("stops the exact newly-created Space continuation instead of an unrelated same-role pending turn", async () => {
    workspaceActiveWindowId = null
    const unrelated = { id: "starting-claude-41", provider: "Claude", role: "Reviewer", sessionId: null, presentation: "Agent is starting.", descriptor: null }
    const exact = { id: "starting-claude-42", provider: "Claude", role: "Reviewer", sessionId: null, presentation: "Agent is starting.", descriptor: null }
    harness.controller.activeTurns = [unrelated]
    harness.controller.continueSession = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal("fetch", fetcher())
    const view = render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    await waitFor(() => expect(harness.controller.continueSession).toHaveBeenCalledTimes(1))
    harness.controller.activeTurns = [unrelated, exact]
    view.rerender(<WorkspaceShell />)
    fireEvent.click(screen.getByRole("button", { name: "Stop Space continuation" }))

    expect(harness.controller.stop).toHaveBeenCalledWith(exact.id)
    expect(harness.controller.stop).not.toHaveBeenCalledWith(unrelated.id)
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
    { name: "Codex Builder", provider: "Codex" as const, sessionId: BUILDER, role: "Builder", assignment: "Build the bounded file", mode: "delegate" as const, method: "runAgentTurn" as const, reviewPath: null },
    { name: "Preview debugger", provider: "Claude" as const, sessionId: PREVIEW, role: "Preview debugger", assignment: "Developer Preview diagnosis", mode: "preview" as const, method: "runPreviewDiagnostic" as const, reviewPath: null },
    { name: "Local Thinker", provider: "Local" as const, sessionId: LOCAL, role: "Thinker", assignment: "Conversation", mode: "delegate" as const, method: "runAgentTurn" as const, reviewPath: null },
    { name: "Claude Reviewer", provider: "Claude" as const, sessionId: FIRST, role: "Reviewer", assignment: "Review src/app.ts", mode: "review" as const, method: "runClaudeTurn" as const, reviewPath: "src/app.ts" },
  ])("reattaches and canonically rebinds a batched pre-init $name Talk", async ({ provider, sessionId, role, assignment, mode, method, reviewPath }) => {
    const exactKey = `${provider}:${sessionId}`
    const durable = {
      schemaVersion: 1 as const, sessionId, role, provider, assignment,
      ...(mode === "preview" ? { preview: { worldId: "browser-world", evidenceFingerprint: "preview-fingerprint" } } : {}),
      ...(reviewPath ? { reviewPath, ...reviewerFileBinding(reviewPath) } : {}),
      updatedAt: "2026-08-30T12:00:00.000Z", completedTurns: [],
    }
    const projection = {
      id: exactKey, role, providerLabel: provider, assignment, status: "ready", evidence: "saved transcript",
      truth: "live" as const, kind: "durable-session" as const, mode,
      ...(mode === "preview" ? { preview: durable.preview } : {}),
      ...(reviewPath ? { reviewPath, ...reviewerFileBinding(reviewPath) } : {}),
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

    const completed = {
      ...durable,
      updatedAt: "2026-08-30T12:01:00.000Z",
      completedTurns: [{ ownerPrompt: `Continue ${role}.`, finalResult: `Batched ${role} result.`, completedAt: "2026-08-30T12:01:00.000Z" }],
    }
    harness.controller.savedSessions = [completed]
    harness.controller.savedDescriptor = completed
    harness.controller.durableSession = completed
    harness.controller.sessions = [{ ...projection, lastResult: `Batched ${role} result.` }]
    settle(completed)
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue session" })).toBeTruthy())

    const followedUp = {
      ...completed,
      updatedAt: "2026-08-30T12:02:00.000Z",
      completedTurns: [...completed.completedTurns, { ownerPrompt: `Follow up ${role}.`, finalResult: `Followed up ${role}.`, completedAt: "2026-08-30T12:02:00.000Z" }],
    }
    harness.controller.continueSession = vi.fn(async ({ sessionKey }: any) => {
      expect(sessionKey).toBe(exactKey)
      harness.controller.savedSessions = [followedUp]
      harness.controller.sessions = [{ ...projection, lastResult: `Followed up ${role}.` }]
      return followedUp
    })
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: `Follow up ${role}.` } })
    fireEvent.click(screen.getByRole("button", { name: "Continue session" }))
    await waitFor(() => expect(harness.controller.continueSession).toHaveBeenCalledTimes(1))
    expect(screen.queryByText("Agent turn unavailable.")).toBeNull()
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

  it("asks William with one exact bounded saved-session snapshot and no agent execution", async () => {
    const base = fetcher("server")
    const lineBodies: any[] = []
    const mockedFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/environment/line" && init?.method === "POST") {
        lineBodies.push(JSON.parse(String(init.body)))
        return Promise.resolve(Response.json({ worldId: "browser-world", say: "Historical advisory.", surfaces: [], spine: EMPTY_SPINE }))
      }
      return base(input, init)
    })
    vi.stubGlobal("fetch", mockedFetch)
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.click(screen.getAllByRole("button", { name: "Reviewer · Claude · Review src/app.ts" })[0])
    fireEvent.click(screen.getByRole("button", { name: "Ask William" }))
    expect(await screen.findByText(`Browser-saved session snapshot · Claude:${FIRST} · runtime liveness unverified`)).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "What should I know about this exact session?" } })
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))

    await waitFor(() => expect(lineBodies).toHaveLength(1))
    expect(lineBodies[0]).toMatchObject({
      worldId: "browser-world",
      text: "What should I know about this exact session?",
      lineContext: {
        kind: "agent-snapshot",
        sessionKey: `Claude:${FIRST}`,
        role: "Reviewer",
        provider: "Claude",
        assignment: "Review src/app.ts",
        mode: "review",
        target: "file review · src/app.ts",
        forkedFrom: null,
        updatedAt: "2026-08-30T12:00:00.000Z",
        lastTurn: {
          identity: "turn-1:2026-08-30T12:00:00.000Z",
          result: { excerpt: "Saved Review src/app.ts", originalCodePoints: 23 },
        },
      },
    })
    expect(lineBodies[0].lineContext.clientGuard).toBeUndefined()
    expect(harness.controller.continueSession).not.toHaveBeenCalled()
    expect(harness.controller.runClaudeTurn).not.toHaveBeenCalled()
    expect(harness.controller.runAgentTurn).not.toHaveBeenCalled()
  })

  it("sends no William request when the selected saved session changes after snapshot capture", async () => {
    const base = fetcher()
    const lineRequests: unknown[] = []
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/environment/line" && init?.method === "POST") {
        lineRequests.push(init.body)
        return Promise.resolve(Response.json({ worldId: "browser-world", say: "must not settle", surfaces: [], spine: EMPTY_SPINE }))
      }
      return base(input, init)
    }))
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.click(screen.getAllByRole("button", { name: "Reviewer · Claude · Review src/app.ts" })[0])
    fireEvent.click(screen.getByRole("button", { name: "Ask William" }))
    await screen.findByText(/Browser-saved session snapshot/)
    fireEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "What should I know?" } })
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))

    expect(await screen.findByText("The selected browser-saved session changed before William dispatch, so no advice was requested.")).toBeTruthy()
    expect(lineRequests).toHaveLength(0)
  })

  it("rechecks the exact saved session after the Space persistence barrier before requesting William", async () => {
    const base = fetcher("server")
    const lineRequests: unknown[] = []
    let signalPutStarted!: () => void
    let releasePut!: () => void
    let deferNextPut = false
    const putStarted = new Promise<void>((resolve) => { signalPutStarted = resolve })
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/environment/space" && init?.method === "PUT" && deferNextPut) {
        deferNextPut = false
        const body = JSON.parse(String(init.body))
        signalPutStarted()
        return new Promise<Response>((resolve) => {
          releasePut = () => resolve(Response.json({
            worldId: body.worldId,
            space: body.space,
            updatedAt: "2026-08-30T12:00:00.000Z",
          }))
        })
      }
      if (String(input) === "/api/environment/line" && init?.method === "POST") {
        lineRequests.push(init.body)
        return Promise.resolve(Response.json({ worldId: "browser-world", say: "must not settle", surfaces: [], spine: EMPTY_SPINE }))
      }
      return base(input, init)
    }))
    const { rerender } = render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.click(screen.getAllByRole("button", { name: "Reviewer · Claude · Review src/app.ts" })[0])
    fireEvent.click(screen.getByRole("button", { name: "Ask William" }))
    await screen.findByText(/Browser-saved session snapshot/)
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "What should I know?" } })
    deferNextPut = true
    fireEvent.submit(screen.getByRole("form", { name: "The Line" }))
    await putStarted

    harness.controller.savedSessions = [descriptor(SECOND, "Review src/other.ts")]
    harness.controller.selectedSessionKey = `Claude:${SECOND}`
    rerender(<WorkspaceShell />)
    releasePut()

    expect(await screen.findByText("The selected browser-saved session changed before William dispatch, so no advice was requested.")).toBeTruthy()
    expect(lineRequests).toHaveLength(0)
  })
})

function idFor(button: HTMLElement, ids: readonly string[]): string {
  return ids.find((id) => button.getAttribute("aria-label")?.includes(id)) ?? "missing"
}
