// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

vi.mock("next/dynamic", () => ({ default: () => function Editor() { return null } }))
vi.mock("@/components/workspace-shell/editor-surface", () => ({
  EditorSurface: ({ space, onEditorChange }: {
    space: { selectedPath: string | null; editor: { activePaneId: "primary" | "secondary"; openFiles: string[]; panes: { id: "primary" | "secondary"; activePath: string | null; selection: { anchor: number; head: number } }[] } }
    onEditorChange: (editor: typeof space.editor, selectedPath: string) => void
  }) => <div>Source {space.selectedPath}<button type="button" onClick={() => onEditorChange({
    ...space.editor,
    openFiles: ["src/app.ts", "src/other.ts"],
    panes: space.editor.panes.map((pane) => pane.id === space.editor.activePaneId
      ? { ...pane, activePath: "src/other.ts", selection: { anchor: 0, head: 0 } }
      : pane),
  }, "src/other.ts")}>Select other file</button></div>,
}))

const BOUND_SPINE = {
  ...EMPTY_SPINE,
  outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
  outcomeTitle: "Finish Experience V2",
  workOrderId: 1122,
  execution: "authorized" as const,
}

function ndjson(...events: readonly Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""))
}

function serverSpace() {
  const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
  return spaceToServer({
    ...base, revision: 7, activeWindowId: "editor", selectedPath: "src/app.ts",
    editor: {
      ...base.editor, openFiles: ["src/app.ts"], activePaneId: "primary",
      panes: [{ id: "primary", activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }],
    },
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe("Experience V2 exact selected-file Delegate", () => {
  it("offers only server-proven providers and persists an exact Claude file target", async () => {
    const sessionId = "323e4567-e89b-42d3-a456-426614174211"
    const agentBodies: Record<string, unknown>[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace(), spine: BOUND_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) {
        const actor = new URL(url, "http://localhost").searchParams.get("actor")
        return Response.json(actor === "claude" ? {
          eligible: true, worldId: "world-a", worldRevision: 8,
          outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1122, grantId: 45,
          actor: "claude", selectedPath: "src/app.ts",
        } : { eligible: false, reason: "EXACT_PATH_AUTHORITY_UNAVAILABLE" })
      }
      if (url === "/api/loom/agent" && init?.method === "POST") {
        agentBodies.push(JSON.parse(String(init.body)))
        return ndjson(
          { type: "session", sessionId, provider: "Claude", mode: "delegate", resumed: false,
            worldId: "world-a", worldRevision: 8, outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
            workOrderId: 1122, grantId: 45, actor: "claude", selectedPath: "src/app.ts" },
          { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Changed the exact selected file." } },
          { type: "done", code: 0, reason: null },
        )
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    expect(within(line).getByText("File assignment · exact selected file src/app.ts")).toBeTruthy()
    expect((within(line).getByRole("button", { name: "Codex unavailable" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(line).getByRole("button", { name: "Claude" }))
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "Implement this exact file change." } })
    fireEvent.click(within(line).getByRole("button", { name: "Delegate" }))

    await waitFor(() => expect(agentBodies).toHaveLength(1))
    expect(agentBodies[0]).toEqual({
      worldId: "world-a", prompt: "Owner request: Implement this exact file change.",
      projectKey: "terrafusion",
      provider: "cloud", sessionId: null, resume: false,
    })
    expect(await within(line).findByText("Changed the exact selected file.")).toBeTruthy()
    const stored = [...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!)).join("\n")
    expect(stored).toContain('"provider":"Claude"')
    expect(stored).toContain('"target":{"kind":"file","path":"src/app.ts"}')
  })

  it("keeps File Delegate unavailable when neither actor has exact current authority", async () => {
    const agentRequests: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace(), spine: BOUND_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) return Response.json({ eligible: false, reason: "EXACT_PATH_AUTHORITY_UNAVAILABLE" })
      if ((url === "/api/loom/agent" || url === "/api/loom/codex") && init?.method === "POST") agentRequests.push(url)
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const unavailable = await screen.findByRole("button", { name: "Delegate unavailable" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    await waitFor(() => expect(unavailable.title).toBe("Delegate requires a current server-derived exact-path authority proof for Codex or Claude."))
    expect(screen.queryByRole("dialog", { name: "The Line" })).toBeNull()
    expect(agentRequests).toEqual([])
  })

  it("aborts an exact File Delegate when the selected path drifts during inference", async () => {
    let resolveAgent!: (response: Response) => void
    let signal: AbortSignal | null = null
    const pending = new Promise<Response>((resolve) => { resolveAgent = resolve })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace(), spine: BOUND_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) {
        const actor = new URL(url, "http://localhost").searchParams.get("actor")
        return Response.json(actor === "codex" ? {
          eligible: true, worldId: "world-a", worldRevision: 8,
          outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1122, grantId: 46,
          actor: "codex", selectedPath: "src/app.ts",
        } : { eligible: false, reason: "EXACT_PATH_AUTHORITY_UNAVAILABLE" })
      }
      if (url === "/api/loom/codex" && init?.method === "POST") {
        signal = init.signal ?? null
        return pending
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    fireEvent.click(within(line).getByRole("button", { name: "Codex" }))
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "Keep exact." } })
    fireEvent.click(within(line).getByRole("button", { name: "Delegate" }))
    await waitFor(() => expect(signal).not.toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Select other file" }))
    await waitFor(() => expect(signal?.aborted).toBe(true))
    resolveAgent(ndjson(
      { type: "session", sessionId: "codex-file-stale", provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: "e".repeat(64) },
      { type: "result", text: "STALE FILE RESULT" }, { type: "done", code: 0, reason: null },
    ))
    await waitFor(() => expect(within(line).queryByText("STALE FILE RESULT")).toBeNull())
    expect([...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!)).join("\n")).not.toContain("codex-file-stale")
  })
})
