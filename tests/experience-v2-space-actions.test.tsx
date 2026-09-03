// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const CLAUDE_REVIEW_ID = "123e4567-e89b-42d3-a456-426614174000"
const LOCAL_ID = "223e4567-e89b-42d3-a456-426614174000"
const SESSION_KEY = "williamos:agent-session:world-a:c%3A%2Frepos%2Fterrafusion"
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

const OS1_SESSION_FRAME = {
  repositoryResourceKey: OS1_REPOSITORY.resourceKey,
  repositoryIdentity: OS1_REPOSITORY.identity,
  repositoryMountKey: OS1_REPOSITORY.mountKey,
  observedRevision: OS1_REPOSITORY.observedRevision,
} as const

vi.mock("next/dynamic", () => ({
  default: () => function Editor() { return <textarea aria-label="Source content" readOnly /> },
}))
vi.mock("@/components/workspace-shell/editor-surface", () => ({
  EditorSurface: ({ space, onEditorChange, onSelectedFileDirtyChange }: {
    space: { selectedPath: string | null; editor: { activePaneId: "primary" | "secondary"; openFiles: string[]; panes: { id: "primary" | "secondary"; activePath: string | null; selection: { anchor: number; head: number } }[] } }
    onEditorChange: (editor: typeof space.editor, selectedPath: string) => void
    onSelectedFileDirtyChange?: (path: string, dirty: boolean) => void
  }) => <div>Source {space.selectedPath}<button type="button" onClick={() => onEditorChange({
    ...space.editor,
    openFiles: ["src/app.ts", "src/other.ts"],
    panes: space.editor.panes.map((pane) => pane.id === space.editor.activePaneId
      ? { ...pane, activePath: "src/other.ts", selection: { anchor: 0, head: 0 } }
      : pane),
  }, "src/other.ts")}>Select other file</button><button type="button" onClick={() => {
    if (space.selectedPath) onSelectedFileDirtyChange?.(space.selectedPath, true)
  }}>Dirty selected file</button></div>,
}))

const BOUND_SPINE = {
  ...EMPTY_SPINE,
  outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
  outcomeTitle: "Finish Experience V2",
  workOrderId: 1121,
  execution: "authorized" as const,
}

function ndjson(...events: readonly Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""), { status: 200 })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Experience V2 selected Space actions", () => {
  it("delegates a Space only as the exact already-authorized saved selected file", async () => {
    const sessionId = "codex-space-file-1"
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const serverSpace = spaceToServer({
      ...base,
      revision: 7,
      activeWindowId: null,
      selectedPath: "src/app.ts",
      editor: {
        ...base.editor,
        openFiles: ["src/app.ts"],
        activePaneId: "primary",
        panes: [{ id: "primary", activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }],
      },
    })
    const agentRequests: Record<string, unknown>[] = []
    let spacePuts = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace, spine: BOUND_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        spacePuts += 1
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) return Response.json({
        eligible: true, worldId: "world-a", worldRevision: 8,
        outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1121, grantId: 44,
        actor: "codex", selectedPath: "src/app.ts",
      })
      if (url === "/api/loom/codex" && init?.method === "POST") {
        agentRequests.push(JSON.parse(String(init.body)))
        return ndjson(
          { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: "a".repeat(64) },
          { type: "result", text: "Changed only the exact selected file." },
          { type: "done", code: 0, reason: null },
        )
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    await waitFor(() => expect(spacePuts).toBeGreaterThan(0))
    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    expect(within(line).getByText("Space assignment · exact selected file src/app.ts")).toBeTruthy()
    const claudeUnavailable = within(line).getByRole("button", { name: "Claude unavailable" }) as HTMLButtonElement
    expect(claudeUnavailable.disabled).toBe(true)
    expect(claudeUnavailable.title).toBe("No current server-derived exact-path Claude authority proof is available.")
    fireEvent.click(within(line).getByRole("button", { name: "Codex" }))
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "Implement the bounded fix." } })
    fireEvent.click(within(line).getByRole("button", { name: "Delegate" }))

    await waitFor(() => expect(agentRequests).toHaveLength(1))
    expect(agentRequests[0]).toEqual({
      worldId: "world-a",
      projectKey: "terrafusion",
      prompt: "Owner request: Implement the bounded fix.",
      sessionId: null,
      resume: false,
    })
    expect(await within(line).findByText("Changed only the exact selected file.")).toBeTruthy()
    const stored = [...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!)).join("\n")
    expect(stored).toContain('"target":{"kind":"file","path":"src/app.ts"}')
    expect(stored).not.toContain("src/other.ts")
  })

  it("offers only Claude when the Space exact-path proof belongs to Claude", async () => {
    const sessionId = "323e4567-e89b-42d3-a456-426614174212"
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const serverSpace = spaceToServer({
      ...base,
      revision: 7,
      activeWindowId: null,
      selectedPath: "src/app.ts",
      editor: {
        ...base.editor,
        openFiles: ["src/app.ts"],
        activePaneId: "primary",
        panes: [{ id: "primary", activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }],
      },
    })
    const agentBodies: Record<string, unknown>[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace, spine: BOUND_SPINE,
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
          outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1121, grantId: 45,
          actor: "claude", selectedPath: "src/app.ts",
        } : { eligible: false, reason: "EXACT_PATH_AUTHORITY_UNAVAILABLE" })
      }
      if (url === "/api/loom/agent" && init?.method === "POST") {
        agentBodies.push(JSON.parse(String(init.body)))
        return ndjson(
          { type: "session", sessionId, provider: "Claude", mode: "delegate", resumed: false,
            worldId: "world-a", worldRevision: 8, outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
            workOrderId: 1121, grantId: 45, actor: "claude", selectedPath: "src/app.ts" },
          { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Claude changed only the exact selected file." } },
          { type: "done", code: 0, reason: null },
        )
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    expect(within(line).getByText("Space assignment · exact selected file src/app.ts")).toBeTruthy()
    expect((within(line).getByRole("button", { name: "Codex unavailable" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(line).getByRole("button", { name: "Claude" }))
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "Implement this exact Space assignment." } })
    fireEvent.click(within(line).getByRole("button", { name: "Delegate" }))

    await waitFor(() => expect(agentBodies).toHaveLength(1))
    expect(agentBodies[0]).toEqual({
      worldId: "world-a", prompt: "Owner request: Implement this exact Space assignment.",
      projectKey: "terrafusion",
      provider: "cloud", sessionId: null, resume: false,
    })
    expect(await within(line).findByText("Claude changed only the exact selected file.")).toBeTruthy()
    const stored = [...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!)).join("\n")
    expect(stored).toContain('"provider":"Claude"')
    expect(stored).toContain('"target":{"kind":"file","path":"src/app.ts"}')
  })

  it("shows Space Delegate unavailable when no exact selected-file authority is bound", async () => {
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const serverSpace = spaceToServer({ ...base, activeWindowId: null, selectedPath: "src/app.ts" })
    const requests: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push(url)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace, spine: EMPTY_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const unavailable = await screen.findByRole("button", { name: "Delegate unavailable" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(unavailable.title).toBe("Delegate needs one clean durably saved selected file in a server-bound active Work Order.")
    expect(screen.getByText(unavailable.title)).toBeTruthy()
    expect(requests.some((url) => url === "/api/loom/codex" || url === "/api/loom/agent")).toBe(false)
  })

  it.each([
    ["refused", { eligible: false, reason: "EXACT_PATH_AUTHORITY_UNAVAILABLE" }],
    ["stale", {
      eligible: true, worldId: "world-a", worldRevision: 6,
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1121, grantId: 44,
      actor: "codex", selectedPath: "src/app.ts",
    }],
  ])("keeps Space Delegate unavailable when the exact server proof is %s", async (_label, eligibility) => {
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const serverSpace = spaceToServer({
      ...base, revision: 7, activeWindowId: null, selectedPath: "src/app.ts",
      editor: {
        ...base.editor, openFiles: ["src/app.ts"], activePaneId: "primary",
        panes: [{ id: "primary", activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }],
      },
    })
    const agentRequests: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace, spine: BOUND_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) return Response.json(eligibility)
      if (url === "/api/loom/codex" || url === "/api/loom/agent") agentRequests.push(url)
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const unavailable = await screen.findByRole("button", { name: "Delegate unavailable" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(await screen.findByText("Delegate requires a current server-derived exact-path authority proof for Codex or Claude.")).toBeTruthy()
    expect(agentRequests).toEqual([])
  })

  it("discards an exact Space file assignment when the selected path drifts during inference", async () => {
    const sessionId = "codex-space-file-stale"
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const serverSpace = spaceToServer({
      ...base, revision: 7, activeWindowId: null, selectedPath: "src/app.ts",
      editor: { ...base.editor, openFiles: ["src/app.ts"], activePaneId: "primary", panes: [{ id: "primary", activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }] },
    })
    let resolveAgent!: (response: Response) => void
    let agentSignal: AbortSignal | null = null
    let spacePuts = 0
    const agent = new Promise<Response>((resolve) => { resolveAgent = resolve })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace, spine: BOUND_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        spacePuts += 1
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) return Response.json({
        eligible: true, worldId: "world-a", worldRevision: 8,
        outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1121, grantId: 44,
        actor: "codex", selectedPath: "src/app.ts",
      })
      if (url === "/api/loom/codex" && init?.method === "POST") {
        agentSignal = init.signal ?? null
        return agent
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    await waitFor(() => expect(spacePuts).toBeGreaterThan(0))
    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    fireEvent.click(within(line).getByRole("button", { name: "Codex" }))
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "Do not retarget this." } })
    fireEvent.click(within(line).getByRole("button", { name: "Delegate" }))
    await waitFor(() => expect(agentSignal).not.toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Select other file" }))
    await waitFor(() => expect(agentSignal?.aborted).toBe(true))
    resolveAgent(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: "b".repeat(64) },
      { type: "result", text: "STALE SPACE ASSIGNMENT" },
      { type: "done", code: 0, reason: null },
    ))

    await waitFor(() => expect(within(line).queryByText("STALE SPACE ASSIGNMENT")).toBeNull())
    const stored = [...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!)).join("\n")
    expect(stored).not.toContain(sessionId)
  })

  it("aborts an exact Space file assignment when the same selected file becomes dirty", async () => {
    const sessionId = "codex-space-file-dirty-stale"
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const serverSpace = spaceToServer({
      ...base, revision: 7, activeWindowId: null, selectedPath: "src/app.ts",
      editor: {
        ...base.editor, openFiles: ["src/app.ts"], activePaneId: "primary",
        panes: [{ id: "primary", activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }],
      },
    })
    let resolveAgent!: (response: Response) => void
    let agentSignal: AbortSignal | null = null
    const agent = new Promise<Response>((resolve) => { resolveAgent = resolve })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace, spine: BOUND_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) return Response.json({
        eligible: true, worldId: "world-a", worldRevision: 8,
        outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1121, grantId: 44,
        actor: "codex", selectedPath: "src/app.ts",
      })
      if (url === "/api/loom/codex" && init?.method === "POST") {
        agentSignal = init.signal ?? null
        return agent
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    fireEvent.click(within(line).getByRole("button", { name: "Codex" }))
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "Do not overwrite my buffer." } })
    fireEvent.click(within(line).getByRole("button", { name: "Delegate" }))
    await waitFor(() => expect(agentSignal).not.toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Dirty selected file" }))
    await waitFor(() => expect(agentSignal?.aborted).toBe(true))
    resolveAgent(ndjson(
      { type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false, selectedPath: "src/app.ts", assignmentHash: "d".repeat(64) },
      { type: "result", text: "STALE DIRTY RESULT" },
      { type: "done", code: 0, reason: null },
    ))
    await waitFor(() => expect(within(line).queryByText("STALE DIRTY RESULT")).toBeNull())
    const stored = [...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!)).join("\n")
    expect(stored).not.toContain(sessionId)
  })

  it("stops the exact accepted Space file assignment before stale completion can persist", async () => {
    const sessionId = "codex-space-file-accepted-stale"
    const base = defaultSpace(1440, 900, "world-a", "WilliamOS")
    const serverSpace = spaceToServer({
      ...base, revision: 7, activeWindowId: null, selectedPath: "src/app.ts",
      editor: {
        ...base.editor, openFiles: ["src/app.ts"], activePaneId: "primary",
        panes: [{ id: "primary", activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }],
      },
    })
    let agentSignal: AbortSignal | null = null
    const encoder = new TextEncoder()
    const agentResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          type: "session", sessionId, provider: "Codex", mode: "delegate", resumed: false,
          selectedPath: "src/app.ts", assignmentHash: "c".repeat(64),
        })}\n`))
      },
    }))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "WilliamOS", space: serverSpace, spine: BOUND_SPINE,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server",
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-09-01T20:00:00.000Z" })
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) return Response.json({
        eligible: true, worldId: "world-a", worldRevision: 8,
        outcomeKey: "WILLIAMOS_EXPERIENCE_V2", workOrderId: 1121, grantId: 44,
        actor: "codex", selectedPath: "src/app.ts",
      })
      if (url === "/api/loom/codex" && init?.method === "POST") {
        agentSignal = init.signal ?? null
        return agentResponse
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    fireEvent.click(within(line).getByRole("button", { name: "Codex" }))
    fireEvent.change(within(line).getByRole("textbox", { name: "The Line" }), { target: { value: "Keep this exact." } })
    fireEvent.click(within(line).getByRole("button", { name: "Delegate" }))

    await screen.findByRole("button", { name: "Builder · Codex · Space assignment · exact selected file src/app.ts" })
    fireEvent.click(screen.getByRole("button", { name: "Select other file" }))
    await waitFor(() => expect(agentSignal?.aborted).toBe(true))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Builder · Codex · Space assignment · exact selected file src/app.ts" })).toBeNull())
    const stored = [...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!)).join("\n")
    expect(stored).not.toContain(sessionId)
  })
  it("summarizes the exact Space in one click without exposing a second editable prompt", async () => {
    const serverSpace = spaceToServer({
      ...defaultSpace(1440, 900, "world-a", "TerraFusion"),
      activeWindowId: null,
    })
    const requests: Record<string, unknown>[] = []
    let resolveSummary!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-08-30T05:00:00.000Z" })
      }
      if (url === "/api/environment/line") {
        requests.push(JSON.parse(String(init?.body)))
        return new Promise<Response>((resolve) => { resolveSummary = resolve })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Summarize" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    const input = within(line).getByRole("textbox", { name: "The Line" }) as HTMLInputElement
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(input.value).toBe("")
    expect(input.disabled).toBe(true)
    expect(within(line).getByText("Exact current Space · server-grounded · read-only")).toBeTruthy()
    expect((within(line).getByRole("button", { name: "Working" }) as HTMLButtonElement).disabled).toBe(true)
    expect(requests[0]).toEqual({
      worldId: "world-a",
      projectKey: "terrafusion",
      text: "Summarize this exact current Space.",
      lineContext: "space-summary",
    })
    resolveSummary(Response.json({ worldId: "world-a", say: "Grounded summary", surfaces: [], spine: EMPTY_SPINE }))
    expect(await screen.findByText("Grounded summary")).toBeTruthy()
    fireEvent.submit(within(line).getByRole("form", { name: "The Line" }))
    expect(requests).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    const genericLine = screen.getByRole("dialog", { name: "The Line" })
    const genericInput = within(genericLine).getByRole("textbox", { name: "The Line" })
    fireEvent.change(genericInput, { target: { value: "A separate ordinary question." } })
    fireEvent.click(within(genericLine).getByRole("button", { name: "Send" }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toEqual({
      worldId: "world-a",
      projectKey: "terrafusion",
      text: "A separate ordinary question.",
    })
  })

  it("keeps a pending summary bound to its exact Space by refusing cross-Space re-entry", async () => {
    const worldA = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "Alpha"), activeWindowId: null })
    const worldB = spaceToServer({ ...defaultSpace(1440, 900, "world-b", "Beta"), activeWindowId: null })
    const spaces = [
      { worldId: "world-a", name: "Alpha", space: worldA, updatedAt: "2026-08-30T05:00:00.000Z" },
      { worldId: "world-b", name: "Beta", space: worldB, updatedAt: "2026-08-30T05:01:00.000Z" },
    ]
    let resolveSummary!: (response: Response) => void
    let betaReads = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "Alpha", space: worldA, spaces, multiSpaceAvailable: true,
        project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/environment/space?worldId=world-b" && !init?.method) {
        betaReads += 1
        return Response.json({
          worldId: "world-b", name: "Beta", space: worldB, spaces, multiSpaceAvailable: true,
          project: { identity: "c:/repos/williamos", name: "WilliamOS" }, storage: "server", spine: EMPTY_SPINE,
        })
      }
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-08-30T05:01:00.000Z" })
      }
      if (url === "/api/environment/line") return new Promise<Response>((resolve) => { resolveSummary = resolve })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Summarize" }))
    await waitFor(() => expect(resolveSummary).toBeTypeOf("function"))
    fireEvent.click(screen.getByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    expect(await screen.findByText("Finish or stop active work before switching Spaces.")).toBeTruthy()
    expect(betaReads).toBe(0)

    resolveSummary(Response.json({ worldId: "world-a", say: "EXACT ALPHA SUMMARY", surfaces: [], spine: EMPTY_SPINE }))
    expect(await screen.findByText("EXACT ALPHA SUMMARY")).toBeTruthy()
    expect(betaReads).toBe(0)
  })

  it("truthfully disables Continue when this Space has no durable session", async () => {
    const requests: string[] = []
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push(url)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const unavailable = await screen.findByRole("button", { name: "Continue unavailable" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(screen.getByText("No durable session exists in this Space; use Delegate.")).toBeTruthy()
    expect(requests).not.toContain("/api/environment/line")
  })

  it.each([
    ["Codex Builder", {
      schemaVersion: 1, sessionId: "codex-builder-1", role: "Builder", provider: "Codex", assignment: "src/app.ts",
      target: { kind: "file", path: "src/app.ts" }, updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }],
    ["Claude Builder", {
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Builder", provider: "Claude", assignment: "Build src/app.ts",
      updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }],
    ["Claude fork", {
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Builder", provider: "Claude", assignment: "Forked build",
      forkedFrom: LOCAL_ID, updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }],
  ] as const)("does not advertise mutation-capable %s resume as read-only Space Continue", async (_name, descriptor) => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      schemaVersion: 3, selectedSessionKey: `${descriptor.provider}:${descriptor.sessionId}`, sessions: [descriptor],
    }))
    const requests: string[] = []
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push(`${init?.method ?? "GET"} ${url}`)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const unavailable = await screen.findByRole("button", { name: "Continue unavailable" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(unavailable.title).toBe("This saved session is mutation-capable or not verifiably read-only, so Space Continue did not resume it.")
    expect(screen.getByText(unavailable.title)).toBeTruthy()
    expect(requests.some((request) => request.includes("/api/loom/codex") || request.includes("/api/loom/agent"))).toBe(false)
  })

  it("does not offer Talk, Redirect, or Continue for a saved Claude file-mutation transcript without current authority", async () => {
    const descriptor = {
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Builder", provider: "Claude", assignment: "Build src/app.ts",
      target: { kind: "file", path: "src/app.ts" }, updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      schemaVersion: 3, selectedSessionKey: `Claude:${CLAUDE_REVIEW_ID}`, sessions: [descriptor],
    }))
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Builder · Claude · Build src/app.ts" }))
    expect(screen.queryByRole("button", { name: "Talk" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Redirect" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Continue session" })).toBeNull()
    expect(screen.getByRole("button", { name: "Inspect" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Review work" })).toBeTruthy()
  })

  it.each([
    ["corrupt", "{not-json", "Saved durable sessions are corrupt, so Continue cannot verify an exact session."],
    ["oversized", "x".repeat(262_145), "Saved durable sessions exceed the safe storage limit, so Continue cannot verify an exact session."],
    ["partial", JSON.stringify({ schemaVersion: 3, selectedSessionKey: null, sessions: [
      { schemaVersion: 1, sessionId: LOCAL_ID, role: "Thinker", provider: "Local", assignment: "Conversation", updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [] },
      { schemaVersion: 1, sessionId: "codex-partial", role: "Builder", provider: "Codex", assignment: "Broken", target: { kind: "file", path: "./unsafe" }, updatedAt: "2026-08-30T05:19:00.000Z", completedTurns: [] },
    ] }), "Saved durable-session collection integrity is partial, so Continue cannot verify an exact session."],
  ] as const)("describes %s durable-session storage truthfully instead of claiming no session exists", async (_state, stored, message) => {
    window.localStorage.setItem(SESSION_KEY, stored)
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const unavailable = await screen.findByRole("button", { name: "Continue unavailable" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    await waitFor(() => expect(unavailable.title).toBe(message))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByText("No durable session exists in this Space; use Delegate.")).toBeNull()
  })

  it("describes unavailable durable-session storage truthfully instead of claiming no session exists", async () => {
    const availableStorage = window.localStorage
    vi.stubGlobal("localStorage", {
      get length() { return availableStorage.length },
      clear: () => availableStorage.clear(),
      getItem: (key: string) => {
        if (key === SESSION_KEY) throw new DOMException("blocked", "SecurityError")
        return availableStorage.getItem(key)
      },
      key: (index: number) => availableStorage.key(index),
      removeItem: (key: string) => availableStorage.removeItem(key),
      setItem: (key: string, value: string) => availableStorage.setItem(key, value),
    })
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    const message = "Durable-session storage is unavailable, so Continue cannot verify an exact session."
    const unavailable = await screen.findByRole("button", { name: "Continue unavailable" }) as HTMLButtonElement
    await waitFor(() => expect(unavailable.title).toBe(message))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByText("No durable session exists in this Space; use Delegate.")).toBeNull()
  })

  it("continues the exact selected durable Reviewer instead of a newer session and appends its transcript", async () => {
    const newerLocal = {
      schemaVersion: 1, sessionId: LOCAL_ID, role: "Thinker", provider: "Local", assignment: "Conversation",
      updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }
    const selectedReviewer = {
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts",
      reviewPath: "src/app.ts", updatedAt: "2026-08-30T05:10:00.000Z",
      ...reviewerFileBinding("src/app.ts"),
      completedTurns: [{ ownerPrompt: "Review it.", finalResult: "Saved review", completedAt: "2026-08-30T05:10:00.000Z" }],
    }
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      schemaVersion: 3, selectedSessionKey: `Claude:${CLAUDE_REVIEW_ID}`, sessions: [newerLocal, selectedReviewer],
    }))
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    let resolveContinuation!: (response: Response) => void
    const continuation = new Promise<Response>((resolve) => { resolveContinuation = resolve })
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return continuation
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    expect(within(line).getByText(/Reviewer · Claude · Review src\/app.ts/)).toBeTruthy()
    expect(within(line).getByText("Agent is working.")).toBeTruthy()
    expect(within(line).queryByRole("textbox", { name: "The Line" })).toBeNull()
    expect(within(line).queryByRole("button", { name: "Continue session" })).toBeNull()
    expect(within(line).getByRole("button", { name: "Stop Space continuation" })).toBeTruthy()
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests).toEqual([{ url: "/api/loom/agent", body: {
      mode: "review", projectKey: "terrafusion", path: "src/app.ts",
      fileRef: reviewerFileBinding("src/app.ts").fileRef,
      focus: "Continue this exact saved session from its canonical transcript. Re-establish context and report the next bounded result without changing files, runtime state, target, or authority.",
      provider: "cloud", sessionId: CLAUDE_REVIEW_ID, resume: true,
      repositoryKey: "os-1",
    } }])

    resolveContinuation(new Response(`${[
      { type: "session", sessionId: CLAUDE_REVIEW_ID, provider: "Claude", mode: "review", resumed: true, ...OS1_SESSION_FRAME },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: CLAUDE_REVIEW_ID, result: "Continued selected review." } },
      { type: "done", code: 0, reason: null },
    ].map((frame) => JSON.stringify(frame)).join("\n")}\n`))

    expect(await within(line).findByText("Continued selected review.")).toBeTruthy()
    expect(within(line).getByRole("textbox", { name: "The Line" })).toBeTruthy()
    expect(JSON.parse(String(window.localStorage.getItem(SESSION_KEY))).sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: CLAUDE_REVIEW_ID,
        completedTurns: [
          expect.objectContaining({ finalResult: "Saved review" }),
          expect.objectContaining({ finalResult: "Continued selected review." }),
        ],
      }),
      expect.objectContaining({ sessionId: LOCAL_ID, completedTurns: [] }),
    ]))
  })

  it("stops only the exact pre-acceptance Space continuation and ignores a late settlement", async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ schemaVersion: 3, selectedSessionKey: `Claude:${CLAUDE_REVIEW_ID}`, sessions: [{
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts",
      reviewPath: "src/app.ts", ...reviewerFileBinding("src/app.ts"), updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }] }))
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    let continuationSignal: AbortSignal | null = null
    let resolveLate!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        continuationSignal = init.signal ?? null
        return new Promise<Response>((resolve, reject) => {
          resolveLate = resolve
          continuationSignal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true })
        })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    await waitFor(() => expect(continuationSignal).not.toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Stop Space continuation" }))
    await waitFor(() => expect(continuationSignal?.aborted).toBe(true))
    expect(await screen.findByText("Agent turn stopped.")).toBeTruthy()

    resolveLate(new Response(`${JSON.stringify({ type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: CLAUDE_REVIEW_ID, result: "LATE CONTINUATION" } })}\n`))
    await Promise.resolve()
    expect(screen.queryByText("LATE CONTINUATION")).toBeNull()
    expect(JSON.parse(String(window.localStorage.getItem(SESSION_KEY))).sessions).toEqual([
      expect.objectContaining({ sessionId: CLAUDE_REVIEW_ID, completedTurns: [] }),
    ])
  })

  it("reports provider failure without inventing a replacement durable session", async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ schemaVersion: 3, selectedSessionKey: `Local:${LOCAL_ID}`, sessions: [{
      schemaVersion: 1, sessionId: LOCAL_ID, role: "Thinker", provider: "Local", assignment: "Conversation",
      updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }] }))
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    let agentRequests = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        agentRequests += 1
        return Response.json({ error: "LOCAL_PROVIDER_UNAVAILABLE" }, { status: 503 })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    expect(await screen.findByText("Agent turn unavailable.")).toBeTruthy()
    expect(agentRequests).toBe(1)
    expect(JSON.parse(String(window.localStorage.getItem(SESSION_KEY))).sessions).toEqual([
      expect.objectContaining({ sessionId: LOCAL_ID, completedTurns: [] }),
    ])
  })

  it("does not present a late continuation after the exact saved-session selection drifts", async () => {
    const local = {
      schemaVersion: 1, sessionId: LOCAL_ID, role: "Thinker", provider: "Local", assignment: "Conversation",
      updatedAt: "2026-08-30T05:21:00.000Z", completedTurns: [],
    }
    const reviewer = {
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts",
      reviewPath: "src/app.ts", ...reviewerFileBinding("src/app.ts"), updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      schemaVersion: 3, selectedSessionKey: `Claude:${CLAUDE_REVIEW_ID}`, sessions: [local, reviewer],
    }))
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    let resolveContinuation!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        return new Promise<Response>((resolve) => { resolveContinuation = resolve })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    await waitFor(() => expect(resolveContinuation).toBeTypeOf("function"))
    fireEvent.click(screen.getByRole("button", { name: "Thinker · Local · Conversation" }))
    resolveContinuation(new Response(`${[
      { type: "session", sessionId: CLAUDE_REVIEW_ID, provider: "Claude", mode: "review", resumed: true, ...OS1_SESSION_FRAME },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: CLAUDE_REVIEW_ID, result: "STALE REVIEW CONTINUATION" } },
      { type: "done", code: 0, reason: null },
    ].map((frame) => JSON.stringify(frame)).join("\n")}\n`))

    await waitFor(() => expect(screen.queryByText("Agent is working.")).toBeNull())
    expect(screen.queryByText("STALE REVIEW CONTINUATION")).toBeNull()
    expect(screen.getByText("Local conversation · no workspace mutation")).toBeTruthy()
    const persisted = JSON.parse(String(window.localStorage.getItem(SESSION_KEY)))
    expect(persisted.sessions.find((session: { sessionId: string }) => session.sessionId === CLAUDE_REVIEW_ID).completedTurns).toEqual([])
  })

  it("chooses the deterministic most-recent session when no valid durable selection exists", async () => {
    const first = "323e4567-e89b-42d3-a456-426614174000"
    const second = "423e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ schemaVersion: 3, selectedSessionKey: null, sessions: [
      { schemaVersion: 1, sessionId: second, role: "Reviewer", provider: "Claude", assignment: "Review second.ts", reviewPath: "second.ts", ...reviewerFileBinding("second.ts"), updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [] },
      { schemaVersion: 1, sessionId: first, role: "Reviewer", provider: "Claude", assignment: "Review first.ts", reviewPath: "first.ts", ...reviewerFileBinding("first.ts"), updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [] },
    ] }))
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") return new Promise<Response>(() => {})
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    expect(screen.getByText("Continue · Reviewer · Claude · Review first.ts · verification pending")).toBeTruthy()
  })

  it("focuses an already-running candidate without dispatching a duplicate turn", async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ schemaVersion: 3, selectedSessionKey: `Local:${LOCAL_ID}`, sessions: [{
      schemaVersion: 1, sessionId: LOCAL_ID, role: "Thinker", provider: "Local", assignment: "Conversation",
      updatedAt: "2026-08-30T05:20:00.000Z",
      completedTurns: [{ ownerPrompt: "Think.", finalResult: "Saved thought", completedAt: "2026-08-30T05:20:00.000Z" }],
    }] }))
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const agentRequests: Record<string, unknown>[] = []
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        agentRequests.push(JSON.parse(String(init.body)))
        return new Response(new ReadableStream<Uint8Array>({ start(value) {
          controller = value
          value.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: LOCAL_ID, provider: "Local", mode: "delegate", resumed: true, continuity: "browser-replayed" })}\n`))
        } }))
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    await screen.findByRole("button", { name: "Stop Local Thinker turn" })
    expect(screen.queryByRole("textbox", { name: "The Line" })).toBeNull()
    expect(agentRequests).toEqual([{
      worldId: "world-a",
      projectKey: "terrafusion",
      prompt: "Continue this exact saved session from its canonical transcript. Re-establish context and report the next bounded result without changing files, runtime state, target, or authority.",
      provider: "local",
      sessionId: LOCAL_ID,
      resume: true,
      completedTurns: [{
        ownerPrompt: "Think.", finalResult: "Saved thought", completedAt: "2026-08-30T05:20:00.000Z",
      }],
    }])
    fireEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    expect(screen.getByText("Local conversation · no workspace mutation")).toBeTruthy()
    expect(agentRequests).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Pause" }))
  })

  it("reattaches to a pending Reviewer without invalidating its presentation owner and shows natural settlement", async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ schemaVersion: 3, selectedSessionKey: `Claude:${CLAUDE_REVIEW_ID}`, sessions: [{
      schemaVersion: 1, sessionId: CLAUDE_REVIEW_ID, role: "Reviewer", provider: "Claude", assignment: "Review src/app.ts",
      reviewPath: "src/app.ts", ...reviewerFileBinding("src/app.ts"), updatedAt: "2026-08-30T05:20:00.000Z", completedTurns: [],
    }] }))
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const agentRequests: Record<string, unknown>[] = []
    const serverSpace = spaceToServer({ ...defaultSpace(1440, 900, "world-a", "TerraFusion"), activeWindowId: null })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/loom/agent" && init?.method === "POST") {
        agentRequests.push(JSON.parse(String(init.body)))
        return new Response(new ReadableStream<Uint8Array>({ start(value) {
          controller = value
          value.enqueue(encoder.encode(`${JSON.stringify({ type: "session", sessionId: CLAUDE_REVIEW_ID, provider: "Claude", mode: "review", resumed: true, ...OS1_SESSION_FRAME })}\n`))
        } }))
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))
    await screen.findByRole("button", { name: "Stop Claude Reviewer turn" })
    expect(screen.queryByRole("textbox", { name: "The Line" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByText("Reviewer · Claude · src/app.ts · read-only")).toBeTruthy()
    expect(agentRequests).toHaveLength(1)

    controller.enqueue(encoder.encode(`${JSON.stringify({ type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: CLAUDE_REVIEW_ID, result: "Natural Reviewer settlement." } })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
    controller.close()

    expect(await screen.findByText("Natural Reviewer settlement.")).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop Claude Reviewer turn" })).toBeNull())
    const send = screen.getByRole("button", { name: "Send to Reviewer" }) as HTMLButtonElement
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "A next exact question." } })
    await waitFor(() => expect(send.disabled).toBe(false))
    expect(agentRequests).toHaveLength(1)
  })
})
