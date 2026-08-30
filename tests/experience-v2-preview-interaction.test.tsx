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
})
