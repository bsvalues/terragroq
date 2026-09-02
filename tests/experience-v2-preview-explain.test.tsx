// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

vi.mock("@/components/workspace-shell/developer-tools-surface", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/workspace-shell/developer-tools-surface")>()
  return { ...actual, DeveloperToolsSurface: ({ kind }: { kind: string }) => <div>{kind}</div> }
})

vi.mock("@/components/workspace-shell/editor-surface", () => ({
  EditorSurface: ({ space, onEditorChange }: {
    space: { editor: { openFiles: readonly string[]; panes: readonly unknown[]; activePaneId: "primary" | "secondary" } }
    onEditorChange: (editor: unknown, selectedPath: string | null) => void
  }) => <button type="button" onClick={() => onEditorChange({
    ...space.editor,
    openFiles: ["src/replacement.ts"],
    panes: [{ id: "primary", activePath: "src/replacement.ts", selection: { anchor: 0, head: 0 } }],
  }, "src/replacement.ts")}>Select replacement source</button>,
}))

vi.mock("@/components/workspace-shell/agent-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/workspace-shell/agent-sessions")>()
  return {
    ...actual,
    useExperienceAgentSessions: () => ({
      sessions: [], savedSessions: [], collectionState: "available", selectedSessionKey: null,
      activeSessionId: null, pausableSessionId: null, activeSessionIds: [], pausableSessionIds: [], activeTurns: [], activeProvider: null, error: null,
      runClaudeTurn: vi.fn(), runPreviewDiagnostic: vi.fn(), runAgentTurn: vi.fn(), forkClaudeSession: vi.fn(), continueSession: vi.fn(), selectSession: vi.fn(() => true), stop: vi.fn(),
    }),
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Experience V2 Developer Preview Explain", () => {
  it("dispatches once and discards a delayed answer after selected-source drift", async () => {
    const selectedPath = "src/authoritative.ts"
    const baseSpace = defaultSpace()
    const space = {
      ...baseSpace,
      runningAppUrl: "http://tf.test:5000/real-preview",
      activeWindowId: "running-app" as const,
      selectedPath,
      editor: {
        ...baseSpace.editor,
        openFiles: [selectedPath],
        panes: [{ id: "primary" as const, activePath: selectedPath, selection: { anchor: 0, head: 0 } }],
      },
    }
    const evidence = {
      schemaVersion: 1, status: "attached", reason: null,
      configuredUrl: "http://tf.test:5000/real-preview", admittedUrl: "http://tf.test:5000/real-preview",
      origin: "http://tf.test:5000", identity: "TerraFusion", reachable: true, frameable: true,
      checkedAt: "2026-09-01T18:00:00.000Z",
      limitations: { dom: "unavailable", console: "unavailable", network: "unavailable" },
      fingerprint: "a".repeat(64),
    }
    let resolveLine!: (response: Response) => void
    let signalLine!: () => void
    let linePosts = 0
    let lineBody: Record<string, unknown> | null = null
    let spacePuts = 0
    const lineStarted = new Promise<void>((resolve) => { signalLine = resolve })
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        worldId: "world-a", space: spaceToServer(space), spine: EMPTY_SPINE,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server",
      }))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        spacePuts += 1
        const body = JSON.parse(String(init.body))
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T18:00:00.000Z" }))
      }
      if (url === "/api/environment/preview" && !init?.method) return Promise.resolve(Response.json({ evidence }))
      if (url === "/api/environment/line" && init?.method === "POST") {
        linePosts += 1
        lineBody = JSON.parse(String(init.body))
        signalLine()
        return new Promise<Response>((resolve) => { resolveLine = resolve })
      }
      return Promise.resolve(Response.json({ error: "NOT_FOUND" }, { status: 404 }))
    }))

    render(<WorkspaceShell />)
    await screen.findByText("Space ready")
    await waitFor(() => expect(spacePuts).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole("button", { name: "Explain" }))
    await lineStarted

    expect(linePosts).toBe(1)
    expect(lineBody).toEqual({
      worldId: "world-a",
      text: "Explain the exact current developer Preview.",
      lineContext: { kind: "preview-explain", previewFingerprint: "a".repeat(64), selectedPath },
    })
    expect(await screen.findByText(/Preview attached · TerraFusion · http:\/\/tf\.test:5000/)).toBeTruthy()
    expect(screen.getByText(/DOM unavailable · console unavailable · network unavailable/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Select replacement source" }))
    resolveLine(Response.json({ worldId: "world-a", say: "STALE PREVIEW ADVICE", surfaces: [], spine: EMPTY_SPINE }))

    expect(await screen.findByText("LINE_CONTEXT_STALE")).toBeTruthy()
    expect(screen.queryByText("STALE PREVIEW ADVICE")).toBeNull()
  })

  it("dispatches exactly once when browser storage is denied", async () => {
    const selectedPath = "src/authoritative.ts"
    const baseSpace = defaultSpace()
    const space = {
      ...baseSpace,
      runningAppUrl: "http://tf.test:5000/real-preview",
      activeWindowId: "running-app" as const,
      selectedPath,
      editor: {
        ...baseSpace.editor,
        openFiles: [selectedPath],
        panes: [{ id: "primary" as const, activePath: selectedPath, selection: { anchor: 0, head: 0 } }],
      },
    }
    const evidence = {
      schemaVersion: 1, status: "attached", reason: null,
      configuredUrl: "http://tf.test:5000/real-preview", admittedUrl: "http://tf.test:5000/real-preview",
      origin: "http://tf.test:5000", identity: "TerraFusion", reachable: true, frameable: true,
      checkedAt: "2026-09-01T18:00:00.000Z",
      limitations: { dom: "unavailable", console: "unavailable", network: "unavailable" },
      fingerprint: "b".repeat(64),
    }
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("denied", "SecurityError") },
      setItem: () => { throw new DOMException("denied", "SecurityError") },
      removeItem: () => { throw new DOMException("denied", "SecurityError") },
      clear: () => { throw new DOMException("denied", "SecurityError") },
      key: () => null,
      length: 0,
    })
    let linePosts = 0
    let lineBody: Record<string, unknown> | null = null
    let spacePuts = 0
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        worldId: "world-a", space: spaceToServer(space), spine: EMPTY_SPINE,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server",
      }))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        spacePuts += 1
        const body = JSON.parse(String(init.body))
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T18:00:00.000Z" }))
      }
      if (url === "/api/environment/preview" && !init?.method) return Promise.resolve(Response.json({ evidence }))
      if (url === "/api/environment/line" && init?.method === "POST") {
        linePosts += 1
        lineBody = JSON.parse(String(init.body))
        return Promise.resolve(Response.json({ worldId: "world-a", say: "CURRENT PREVIEW ADVICE", surfaces: [], spine: EMPTY_SPINE }))
      }
      return Promise.resolve(Response.json({ error: "NOT_FOUND" }, { status: 404 }))
    }))

    render(<WorkspaceShell />)
    await screen.findByText("Space ready")
    await waitFor(() => expect(spacePuts).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole("button", { name: "Explain" }))

    await waitFor(() => expect(linePosts).toBe(1))
    expect(lineBody).toEqual({
      worldId: "world-a",
      text: "Explain the exact current developer Preview.",
      lineContext: { kind: "preview-explain", previewFingerprint: "b".repeat(64), selectedPath },
    })
    expect(await screen.findByText("CURRENT PREVIEW ADVICE")).toBeTruthy()
  })
})
