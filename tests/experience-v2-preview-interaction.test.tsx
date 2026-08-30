// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, parsePreviewInspectorPayload, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

vi.mock("next/dynamic", () => ({
  default: () => function Editor() { return <textarea aria-label="Source content" readOnly /> },
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const project = { identity: "c:/repos/terrafusion", name: "TerraFusion" }
const previewSpace = spaceToServer({
  ...defaultSpace(1440, 900, "world-a", "TerraFusion"),
  activeWindowId: "running-app",
  runningAppUrl: "http://tf.test:5000/app",
})
const attached = {
  schemaVersion: 1 as const,
  status: "attached" as const,
  reason: null,
  configuredUrl: "http://tf.test:5000/app",
  admittedUrl: "http://tf.test:5000/app",
  origin: "http://tf.test:5000",
  identity: "TerraFusion" as const,
  reachable: true,
  frameable: true,
  checkedAt: "2026-08-30T03:00:00.000Z",
  limitations: { dom: "unavailable" as const, console: "unavailable" as const, network: "unavailable" as const },
  fingerprint: "a".repeat(64),
}

function installFetch(previewEvidence: () => typeof attached | { [key: string]: unknown }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/environment/space" && !init?.method) return Response.json({
      worldId: "world-a", name: "TerraFusion", space: previewSpace, project, storage: "server",
      spine: EMPTY_SPINE,
      judgment: { recommendation: "Keep building.", rationale: "Grounded.", basis: [], confidence: 0.8, generatedAt: "2026-08-30T03:00:00.000Z", basisFingerprint: "b".repeat(64), provenance: { provider: "test", model: "test" } },
    })
    if (url === "/api/environment/space" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body))
      return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-08-30T03:00:01.000Z" })
    }
    if (url === "/api/environment/preview") return Response.json({ evidence: previewEvidence() })
    if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
    return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
  })
}

describe("Experience V2 Preview evidence interaction", () => {
  it("round-trips only a bounded canonical Preview evidence snapshot", () => {
    expect(parsePreviewInspectorPayload({ evidence: attached, snapshot: "saved" })).toEqual({
      evidence: attached,
      snapshot: "saved",
    })
    expect(parsePreviewInspectorPayload({ evidence: { ...attached, configuredUrl: "http://user:secret@tf.test/app" }, snapshot: "saved" })).toBeNull()
    expect(parsePreviewInspectorPayload({ evidence: { ...attached, configuredUrl: "http://tf.test/app?token=secret" }, snapshot: "saved" })).toBeNull()
    expect(parsePreviewInspectorPayload({
      evidence: {
        ...attached,
        status: "unavailable",
        reason: "URL_INVALID",
        configuredUrl: null,
        admittedUrl: null,
        origin: null,
        identity: "unverified",
        reachable: false,
        frameable: false,
      },
      snapshot: "saved",
    })?.evidence.reason).toBe("URL_INVALID")
    expect(parsePreviewInspectorPayload({ evidence: { ...attached, status: "unavailable" }, snapshot: "saved" })).toBeNull()
    expect(parsePreviewInspectorPayload({ evidence: attached, snapshot: "saved", padding: "x".repeat(9_000) })).toBeNull()
  })

  it("opens exact evidence, restores the bounded saved snapshot, and refreshes it", async () => {
    let current: typeof attached | { [key: string]: unknown } = attached
    const fetchStub = installFetch(() => current)
    vi.stubGlobal("fetch", fetchStub)

    const first = render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }))
    expect(await screen.findByRole("heading", { name: "Preview evidence · TerraFusion developer preview" })).toBeTruthy()
    expect(screen.getByText("Live check")).toBeTruthy()
    expect(screen.getAllByText("http://tf.test:5000/app")).toHaveLength(2)
    expect(screen.getByText("DOM unavailable · console unavailable · network unavailable")).toBeTruthy()
    expect(fetchStub.mock.calls.filter(([input]) => String(input) === "/api/environment/preview")).toHaveLength(1)
    expect(window.localStorage.length).toBe(1)
    first.unmount()

    render(<WorkspaceShell />)
    expect(await screen.findByRole("heading", { name: "Preview evidence · TerraFusion developer preview" })).toBeTruthy()
    expect(screen.getByText("Saved snapshot")).toBeTruthy()
    expect(fetchStub.mock.calls.filter(([input]) => String(input) === "/api/environment/preview")).toHaveLength(1)

    current = {
      ...attached,
      status: "unavailable",
      reason: "UNREACHABLE",
      admittedUrl: null,
      identity: "unverified",
      reachable: false,
      frameable: false,
      checkedAt: "2026-08-30T03:05:00.000Z",
      fingerprint: "c".repeat(64),
    }
    fireEvent.click(screen.getByRole("button", { name: "Refresh Preview evidence" }))
    await waitFor(() => expect(screen.getByText("UNREACHABLE")).toBeTruthy())
    expect(screen.getByText("Live check")).toBeTruthy()
  })

  it.each([
    ["foreign scope", (record: Record<string, unknown>) => ({ ...record, worldId: "world-b" })],
    ["oversized record", (record: Record<string, unknown>) => ({ ...record, padding: "x".repeat(9_000) })],
  ])("fails closed on a %s saved snapshot", async (_label, mutate) => {
    vi.stubGlobal("fetch", installFetch(() => attached))
    const first = render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }))
    await screen.findByRole("heading", { name: "Preview evidence · TerraFusion developer preview" })
    const key = window.localStorage.key(0)
    expect(key).not.toBeNull()
    const record = JSON.parse(window.localStorage.getItem(key!)!) as Record<string, unknown>
    window.localStorage.setItem(key!, JSON.stringify(mutate(record)))
    first.unmount()

    render(<WorkspaceShell />)
    await screen.findByRole("button", { name: "Inspect" })
    expect(screen.queryByRole("heading", { name: "Preview evidence · TerraFusion developer preview" })).toBeNull()
  })

  it.each(["Debug", "Explain"])("opens %s in The Line against exact Preview evidence", async (action) => {
    vi.stubGlobal("fetch", installFetch(() => attached))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: action }))

    const line = screen.getByRole("textbox", { name: "The Line" }) as HTMLInputElement
    expect(line.value).toBe(`${action} the exact current developer Preview evidence: `)
    expect(screen.getByRole("dialog", { name: "The Line" })).toBeTruthy()
  })

  it("delegates Preview only to a durable read-only Claude Preview debugger", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    const baseFetch = installFetch(() => attached)
    let previewTurns = 0
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/loom/agent") return baseFetch(input, init)
      previewTurns += 1
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toEqual(previewTurns === 1 ? {
        mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Explain the failed frame.",
        sessionId: null, resume: false,
      } : {
        mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Continue the diagnosis.",
        sessionId, resume: true,
      })
      const frames = [
        { type: "session", sessionId, resumed: previewTurns > 1, provider: "Claude", mode: "preview", worldId: "world-a", evidenceFingerprint: "a".repeat(64) },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: previewTurns > 1 ? "The same read-only diagnosis resumed." : "The frame is reachable and admitted." } },
        { type: "done", reason: null, code: 0 },
      ]
      return new Response(frames.map((frame) => `${JSON.stringify(frame)}\n`).join(""), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchStub)
    const first = render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    const codex = screen.getByRole("button", { name: "Codex unavailable" }) as HTMLButtonElement
    expect(codex.disabled).toBe(true)
    expect(codex.title).toContain("Preview diagnostic transport")
    fireEvent.click(screen.getByRole("button", { name: "Claude" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Explain the failed frame." } })
    fireEvent.click(screen.getAllByRole("button", { name: "Delegate" }).at(-1)!)

    expect(await screen.findByText("Preview debugger · Claude")).toBeTruthy()
    expect(await screen.findByText("The frame is reachable and admitted.")).toBeTruthy()
    const stored = [...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!))
      .find((value) => value?.includes(sessionId))
    expect(stored).toContain('"preview":{"worldId":"world-a","evidenceFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')

    first.unmount()
    render(<WorkspaceShell />)
    expect(await screen.findByText(/resume unverified/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Preview debugger · Claude · Developer Preview diagnosis/ }))
    fireEvent.click(screen.getByRole("button", { name: "Redirect" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Continue the diagnosis." } })
    fireEvent.click(screen.getAllByRole("button", { name: "Delegate" }).at(-1)!)
    expect(await screen.findByText("The same read-only diagnosis resumed.")).toBeTruthy()
    expect(previewTurns).toBe(2)
  })

  it("keeps provider-unavailable Preview delegation truthful without materializing a session", async () => {
    const baseFetch = installFetch(() => attached)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/loom/agent") return baseFetch(input, init)
      return Response.json({ error: "AGENT_UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    fireEvent.click(screen.getByRole("button", { name: "Claude" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Diagnose without browser instrumentation." } })
    fireEvent.click(screen.getAllByRole("button", { name: "Delegate" }).at(-1)!)

    expect(await screen.findByText("Agent turn unavailable.")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Durable agent sessions" })).toBeNull()
    expect([...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!))
      .some((value) => value?.includes("Preview debugger"))).toBe(false)
  })

  it("fails closed when the server session frame names a foreign Preview world", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    const baseFetch = installFetch(() => attached)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/loom/agent") return baseFetch(input, init)
      return ndjsonResponse([
        { type: "session", sessionId, resumed: false, provider: "Claude", mode: "preview", worldId: "world-b", evidenceFingerprint: "a".repeat(64) },
        { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Foreign result" } },
        { type: "done", reason: null, code: 0 },
      ])
    }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    fireEvent.click(screen.getByRole("button", { name: "Claude" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Diagnose." } })
    fireEvent.click(screen.getAllByRole("button", { name: "Delegate" }).at(-1)!)

    expect(await screen.findByText("Agent turn unavailable.")).toBeTruthy()
    expect(screen.queryByText("Foreign result")).toBeNull()
    expect([...Array(window.localStorage.length)].map((_, index) => window.localStorage.getItem(window.localStorage.key(index)!))
      .some((value) => value?.includes(sessionId))).toBe(false)
  })

  it("refuses to resume a restored Preview descriptor bound to another world", async () => {
    const sessionId = "123e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:world-a:c%3A%2Frepos%2Fterrafusion", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${sessionId}`,
      sessions: [{
        schemaVersion: 1, sessionId, role: "Preview debugger", provider: "Claude", assignment: "Developer Preview diagnosis",
        preview: { worldId: "world-b", evidenceFingerprint: "a".repeat(64) },
        updatedAt: "2026-08-30T03:00:00.000Z", completedTurns: [],
      }],
    }))
    const baseFetch = installFetch(() => attached)
    const fetchStub = vi.fn(baseFetch)
    vi.stubGlobal("fetch", fetchStub)
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: /Preview debugger · Claude · Developer Preview diagnosis/ }))
    fireEvent.click(screen.getByRole("button", { name: "Redirect" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Continue." } })
    fireEvent.click(screen.getAllByRole("button", { name: "Delegate" }).at(-1)!)

    expect(await screen.findByText("Agent turn unavailable.")).toBeTruthy()
    expect(fetchStub.mock.calls.some(([input]) => String(input) === "/api/loom/agent")).toBe(false)
  })
})

function ndjsonResponse(frames: readonly Record<string, unknown>[]) {
  return new Response(frames.map((frame) => `${JSON.stringify(frame)}\n`).join(""), { status: 200 })
}
