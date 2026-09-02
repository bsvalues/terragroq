// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

vi.mock("@/components/workspace-shell/editor-surface", () => ({
  EditorSurface: ({ space, onEditorChange }: {
    space: { selectedPath: string | null; editor: { activePaneId: "primary" | "secondary"; openFiles: string[]; panes: { id: "primary" | "secondary"; activePath: string | null; selection: { anchor: number; head: number } }[] } }
    onEditorChange: (editor: typeof space.editor, selectedPath: string) => void
  }) => <div>Source {space.selectedPath}<button type="button" onClick={() => onEditorChange({
    ...space.editor, openFiles: ["src/a.ts", "src/b.ts"],
    panes: space.editor.panes.map((pane) => pane.id === space.editor.activePaneId
      ? { ...pane, activePath: "src/b.ts", selection: { anchor: 0, head: 0 } } : pane),
  }, "src/b.ts")}>Select B</button></div>,
}))
vi.mock("@/components/workspace-shell/agent-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/workspace-shell/agent-sessions")>()
  return { ...actual, useExperienceAgentSessions: () => ({
    sessions: [], savedSessions: [], collectionState: "available", selectedSessionKey: null,
    activeSessionId: null, pausableSessionId: null, activeSessionIds: [], pausableSessionIds: [], activeTurns: [], activeProvider: null, error: null,
    runClaudeTurn: vi.fn(), runPreviewDiagnostic: vi.fn(), runAgentTurn: vi.fn(), forkClaudeSession: vi.fn(), continueSession: vi.fn(), selectSession: vi.fn(() => true), stop: vi.fn(),
  }) }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Experience V2 exact selected-file Ask", () => {
  it("opens an exact-bound composer and sends only the owner question beside the immutable file guard", async () => {
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const space = {
      ...base,
      revision: 7,
      selectedPath: "src/a.ts",
      activeWindowId: "editor" as const,
      editor: {
        ...base.editor,
        openFiles: ["src/a.ts"],
        activePaneId: "primary" as const,
        panes: [{ id: "primary" as const, activePath: "src/a.ts", selection: { anchor: 3, head: 9 } }],
      },
    }
    const lineRequests: Record<string, unknown>[] = []
    let spacePuts = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", space: spaceToServer(space), spine: EMPTY_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        spacePuts += 1
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        lineRequests.push(JSON.parse(String(init.body)))
        return Response.json({ worldId: "world-a", say: "A is the selected saved file.", surfaces: [], spine: EMPTY_SPINE })
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/loom/files?path=src%2Fa.ts" && !init?.method) return Response.json({ kind: "file", path: "src/a.ts", content: "export const a = true\n" })
      if (url === "/api/loom/diff?path=src%2Fa.ts" && !init?.method) return Response.json({ path: "src/a.ts", state: "clean", status: "", diff: "", fingerprint: "clean" })
      return Response.json({ error: "NOT_FOUND" }, { status: 404 })
    }))
    render(<WorkspaceShell />)

    await screen.findByText("Source src/a.ts")
    await waitFor(() => expect(spacePuts).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    expect(within(line).getByText("Exact saved file · src/a.ts · c:/repos/williamos · read-only")).toBeTruthy()
    const input = within(line).getByRole("textbox", { name: "The Line" }) as HTMLInputElement
    expect(input.value).toBe("")
    fireEvent.change(input, { target: { value: "What invariant does this file enforce?" } })
    fireEvent.click(within(line).getByRole("button", { name: "Send" }))

    await waitFor(() => expect(lineRequests).toHaveLength(1))
    expect(lineRequests[0]).toEqual({
      worldId: "world-a",
      text: "What invariant does this file enforce?",
      lineContext: {
        kind: "file-ask",
        projectKey: "terrafusion",
        path: "src/a.ts",
        projectIdentity: "c:/repos/williamos",
        revision: 8,
        activePaneId: "primary",
        selection: { anchor: 3, head: 9 },
      },
    })
    expect(await within(line).findByText(/A is the selected saved file\./)).toBeTruthy()
  })

  it("discards a delayed answer when the selected file changes after dispatch", async () => {
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const space = {
      ...base, revision: 7, selectedPath: "src/a.ts", activeWindowId: "editor" as const,
      editor: {
        ...base.editor, openFiles: ["src/a.ts"], activePaneId: "primary" as const,
        panes: [{ id: "primary" as const, activePath: "src/a.ts", selection: { anchor: 3, head: 9 } }],
      },
    }
    let resolveLine!: (response: Response) => void
    let signalLine!: () => void
    let spacePuts = 0
    const lineStarted = new Promise<void>((resolve) => { signalLine = resolve })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", space: spaceToServer(space), spine: EMPTY_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        spacePuts += 1
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        signalLine()
        return new Promise<Response>((resolve) => { resolveLine = resolve })
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
      if (url.includes("/api/loom/files?path=") && !init?.method) {
        const selected = url.includes("b.ts") ? "src/b.ts" : "src/a.ts"
        return Response.json({ kind: "file", path: selected, content: `export const selected = ${JSON.stringify(selected)}\n` })
      }
      if (url.includes("/api/loom/diff") && !init?.method) return Response.json({ path: "src/a.ts", state: "clean", status: "", diff: "", fingerprint: "clean" })
      return Response.json({ error: "NOT_FOUND" }, { status: 404 })
    }))
    render(<WorkspaceShell />)

    await screen.findByText("Source src/a.ts", { exact: false })
    await waitFor(() => expect(spacePuts).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "What does A guarantee?" } })
    fireEvent.click(within(line).getByRole("button", { name: "Send" }))
    await lineStarted
    fireEvent.click(screen.getByRole("button", { name: "Select B" }))
    resolveLine(Response.json({ worldId: "world-a", say: "STALE A ANSWER", surfaces: [], spine: EMPTY_SPINE }))

    expect(await within(line).findByText("LINE_CONTEXT_STALE")).toBeTruthy()
    expect(within(line).queryByText("STALE A ANSWER")).toBeNull()
  })
})
