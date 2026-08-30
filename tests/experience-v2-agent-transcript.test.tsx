// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const CODEX = "codex-transcript-session"
const CLAUDE = "123e4567-e89b-42d3-a456-426614174000"
const LOCAL = "223e4567-e89b-42d3-a456-426614174000"
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

const savedSessions = [
  {
    schemaVersion: 1 as const,
    sessionId: CODEX,
    role: "Builder",
    provider: "Codex" as const,
    assignment: "Implement exact save conflict recovery",
    updatedAt: "2026-08-30T13:04:00.000Z",
    completedTurns: [
      { ownerPrompt: "Inspect the failing save path.", finalResult: "The save path loses its revision fence.", completedAt: "2026-08-30T13:01:00.000Z" },
      { ownerPrompt: "Repair only the exact conflict.", finalResult: "Added the revision comparison and focused regression.", completedAt: "2026-08-30T13:04:00.000Z" },
    ],
  },
  {
    schemaVersion: 1 as const,
    sessionId: CLAUDE,
    role: "Reviewer",
    provider: "Claude" as const,
    assignment: "Review src/workspace-shell.tsx",
    reviewPath: "src/workspace-shell.tsx",
    updatedAt: "2026-08-30T13:06:00.000Z",
    completedTurns: [
      { ownerPrompt: "Review the current interaction.", finalResult: "The interaction preserves its exact session identity.", completedAt: "2026-08-30T13:06:00.000Z" },
    ],
  },
  {
    schemaVersion: 1 as const,
    sessionId: LOCAL,
    role: "Thinker",
    provider: "Local" as const,
    assignment: "Trace the preview failure",
    updatedAt: "2026-08-30T13:07:00.000Z",
    completedTurns: [],
  },
  {
    schemaVersion: 1 as const,
    sessionId: UNVERIFIED,
    role: "Builder",
    provider: "Claude" as const,
    assignment: "Recover the saved session",
    updatedAt: "2026-08-30T13:08:00.000Z",
    completedTurns: [
      { ownerPrompt: "Keep this saved question.", finalResult: "Saved result awaiting resume verification.", completedAt: "2026-08-30T13:08:00.000Z" },
    ],
  },
]

function projection(provider: "Codex" | "Claude" | "Local", sessionId: string, role: string, assignment: string, options: {
  mode?: "delegate" | "review"
  reviewPath?: string
  truth?: "live" | "resume-unverified"
  presentation?: string
} = {}) {
  const truth = options.truth ?? "live"
  const lastResult = savedSessions.find((session) => session.provider === provider && session.sessionId === sessionId)?.completedTurns?.at(-1)?.finalResult
  return {
    id: `${provider}:${sessionId}`,
    role,
    providerLabel: provider,
    assignment,
    status: options.presentation ? provider === "Local" ? "thinking" : "working" : truth === "live" ? "ready" : "resume unverified",
    evidence: options.presentation ? provider === "Local" ? "live model response" : "live agent stream" : truth === "live" ? "resumable session" : "saved transcript · server verification required",
    truth,
    kind: "durable-session" as const,
    mode: options.mode ?? "delegate" as const,
    ...(options.reviewPath ? { reviewPath: options.reviewPath } : {}),
    ...(options.presentation ? { presentation: options.presentation } : {}),
    ...(lastResult ? { lastResult } : {}),
  }
}

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
    browserStorageKey: "agent-transcript-test",
  })
}

function fetcher() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
    if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
    if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ kind: "file", path: "src/app.ts", content: "export const app = true\n" }))
    if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", state: "clean", fingerprint: "clean-diff", untracked: false, diff: "", status: "" }))
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
  })
}

function setController(options: { activeCodex?: boolean } = {}) {
  const sessions = [
    projection("Codex", CODEX, "Builder", "Implement exact save conflict recovery", options.activeCodex ? { presentation: "Builder is checking the revision fence." } : {}),
    projection("Claude", CLAUDE, "Reviewer", "Review src/workspace-shell.tsx", { mode: "review", reviewPath: "src/workspace-shell.tsx" }),
    projection("Local", LOCAL, "Thinker", "Trace the preview failure"),
    projection("Claude", UNVERIFIED, "Builder", "Recover the saved session", { truth: "resume-unverified" }),
  ]
  const activeKey = options.activeCodex ? `Codex:${CODEX}` : null
  harness.controller = {
    sessions,
    durableSession: savedSessions[0],
    savedDescriptor: savedSessions[0],
    savedSessions,
    collectionState: "available",
    selectedSessionKey: null,
    descriptorState: "verified",
    activeSessionId: activeKey,
    pausableSessionId: activeKey,
    activeSessionIds: activeKey ? [activeKey] : [],
    pausableSessionIds: activeKey ? [activeKey] : [],
    activeTurns: activeKey ? [{ id: activeKey, provider: "Codex", role: "Builder", sessionId: CODEX, presentation: "Builder is checking the revision fence.", descriptor: savedSessions[0] }] : [],
    activeProvider: activeKey ? "Codex" : null,
    error: null,
    runClaudeTurn: vi.fn(),
    runPreviewDiagnostic: vi.fn(),
    runAgentTurn: vi.fn(),
    forkClaudeSession: vi.fn(),
    continueSession: vi.fn(),
    selectSession: vi.fn((key: string | null) => { harness.controller.selectedSessionKey = key; return true }),
    stop: vi.fn(),
  }
}

async function selectAndTalk(provider: "Codex" | "Claude" | "Local", role: string, assignment: string) {
  fireEvent.click(screen.getByRole("button", { name: `${role} · ${provider} · ${assignment}` }))
  const talk = await screen.findByRole("button", { name: "Talk" })
  fireEvent.click(talk)
  return screen.getByRole("dialog", { name: "The Line" })
}

beforeEach(() => {
  setController()
  vi.stubGlobal("fetch", fetcher())
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe("Experience V2 transient durable-agent transcript", () => {
  it("shows the exact selected session completed turns before the composer and replaces them when another session is selected", async () => {
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    let line = await selectAndTalk("Codex", "Builder", "Implement exact save conflict recovery")
    let history = within(line).getByRole("region", { name: "Agent transcript" })
    expect(history.getAttribute("data-session-key")).toBe(`Codex:${CODEX}`)
    expect(within(history).getByText("Inspect the failing save path.")).toBeTruthy()
    expect(within(history).getByText("The save path loses its revision fence.")).toBeTruthy()
    expect(within(history).getByText("2026-08-30T13:01:00.000Z")).toBeTruthy()
    expect(within(history).getByText("Repair only the exact conflict.")).toBeTruthy()
    expect(within(line).getAllByText("Added the revision comparison and focused regression.")).toHaveLength(1)
    expect(history.compareDocumentPosition(within(line).getByRole("textbox", { name: "The Line" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    line = await selectAndTalk("Claude", "Reviewer", "Review src/workspace-shell.tsx")
    history = within(line).getByRole("region", { name: "Agent transcript" })
    expect(history.getAttribute("data-session-key")).toBe(`Claude:${CLAUDE}`)
    expect(within(history).getByText("Review the current interaction.")).toBeTruthy()
    expect(within(history).getByText("The interaction preserves its exact session identity.")).toBeTruthy()
    expect(within(history).queryByText("Inspect the failing save path.")).toBeNull()
    expect(within(history).queryByText("The save path loses its revision fence.")).toBeNull()
  })

  it("shows truthful empty and saved resume-unverified transcript states without promoting either", async () => {
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    let line = await selectAndTalk("Local", "Thinker", "Trace the preview failure")
    let history = within(line).getByRole("region", { name: "Agent transcript" })
    expect(within(history).getByText("No completed turns yet.")).toBeTruthy()
    expect(within(history).getByText("live · verified")).toBeTruthy()

    line = await selectAndTalk("Claude", "Builder", "Recover the saved session")
    history = within(line).getByRole("region", { name: "Agent transcript" })
    expect(within(history).getByText("saved · resume unverified")).toBeTruthy()
    expect(within(history).getByText("Saved result awaiting resume verification.")).toBeTruthy()
    expect(within(history).queryByText("live · verified")).toBeNull()
  })

  it("keeps live partial presentation outside canonical completed history", async () => {
    setController({ activeCodex: true })
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    const line = await selectAndTalk("Codex", "Builder", "Implement exact save conflict recovery")
    const history = within(line).getByRole("region", { name: "Agent transcript" })
    expect(within(line).getByText("Builder is checking the revision fence.")).toBeTruthy()
    expect(within(history).queryByText("Builder is checking the revision fence.")).toBeNull()
    expect(within(history).getByText("Added the revision comparison and focused regression.")).toBeTruthy()
  })

  it("never paints a durable canonical final twice while a deferred live turn settles", async () => {
    const finalResult = "Canonical deferred settlement result."
    const prior = savedSessions[0]
    let settle!: () => void
    harness.controller.continueSession = vi.fn(({ prompt, onPresentation }: {
      prompt: string
      onPresentation?: (presentation: { phase: "working" | "complete"; text: string; provider: "Codex"; sessionId: string }) => void
    }) => new Promise((resolve) => {
      settle = () => {
        const completed = {
          ...prior,
          updatedAt: "2026-08-30T13:10:00.000Z",
          completedTurns: [...prior.completedTurns, {
            ownerPrompt: prompt,
            finalResult,
            completedAt: "2026-08-30T13:10:00.000Z",
          }],
        }
        harness.controller.savedSessions = harness.controller.savedSessions.map((session: typeof prior) => (
          session.provider === completed.provider && session.sessionId === completed.sessionId ? completed : session
        ))
        harness.controller.sessions = harness.controller.sessions.map((session: ReturnType<typeof projection>) => (
          session.id === `Codex:${CODEX}`
            ? { ...session, status: "ready", presentation: undefined, lastResult: finalResult }
            : session
        ))
        onPresentation?.({ phase: "complete", text: finalResult, provider: "Codex", sessionId: CODEX })
        resolve(completed)
      }
    }))
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    const targets = screen.getByRole("group", { name: "Line targets" })
    fireEvent.click(within(targets).getByRole("button", { name: new RegExp(CODEX) }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "Settle this exact session." } })
    fireEvent.click(within(line).getByRole("button", { name: "Continue session" }))
    expect(within(line).getByText("Agent is starting.")).toBeTruthy()

    let maxCanonicalAdditionsInOneDelivery = 0
    let canonicalLineReplyPainted = false
    const observer = new MutationObserver((records) => {
      const canonicalAdditions = records.flatMap((record) => Array.from(record.addedNodes))
        .filter((node) => node.textContent?.includes(finalResult)).length
      maxCanonicalAdditionsInOneDelivery = Math.max(maxCanonicalAdditionsInOneDelivery, canonicalAdditions)
      canonicalLineReplyPainted ||= records.some((record) => (
        record.type === "characterData"
        && record.target.textContent === finalResult
        && record.target.parentElement?.tagName === "OUTPUT"
      ))
    })
    observer.observe(line, { childList: true, characterData: true, subtree: true })

    await act(async () => { settle() })
    await waitFor(() => expect(within(line).getAllByText(finalResult)).toHaveLength(1))
    await Promise.resolve()
    observer.disconnect()

    expect(maxCanonicalAdditionsInOneDelivery).toBeLessThanOrEqual(1)
    expect(canonicalLineReplyPainted).toBe(false)
    expect(harness.controller.continueSession).toHaveBeenCalledTimes(1)
  })

  it("removes transcript detail when The Line closes without changing the current Space", async () => {
    render(<WorkspaceShell />)
    const source = await screen.findByLabelText("Source content")
    await selectAndTalk("Claude", "Reviewer", "Review src/workspace-shell.tsx")
    expect(screen.getByRole("region", { name: "Agent transcript" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))

    await waitFor(() => expect(screen.queryByRole("region", { name: "Agent transcript" })).toBeNull())
    expect(screen.queryByRole("dialog", { name: "The Line" })).toBeNull()
    expect(source.isConnected).toBe(true)
    expect(screen.getByLabelText("TerraFusion Space")).toBeTruthy()
  })
})
