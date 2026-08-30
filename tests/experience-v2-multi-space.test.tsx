// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

vi.mock("next/dynamic", () => ({
  default: () => function Editor(props: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Source content" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  },
}))

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); vi.unstubAllGlobals() })

const project = { identity: "c:/project", name: "Project" }
const preferenceStorageKey = "opaque-preference"
const alpha = spaceToServer({ ...defaultSpace(1440, 900, "a", "Alpha"), windows: { ...defaultSpace().windows, editor: { ...defaultSpace().windows.editor, x: 41 } } })
const beta = spaceToServer({ ...defaultSpace(1440, 900, "b", "Beta"), windows: { ...defaultSpace().windows, editor: { ...defaultSpace().windows.editor, x: 177 } } })
const summaries = [
  { worldId: "a", name: "Alpha", space: alpha, updatedAt: "2026-08-28T10:00:00Z" },
  { worldId: "b", name: "Beta", space: beta, updatedAt: "2026-08-28T09:00:00Z" },
]
const envelope = (id: "a" | "b") => ({
  worldId: id, name: id === "a" ? "Alpha" : "Beta", space: id === "a" ? alpha : beta,
  project, spaces: summaries, multiSpaceAvailable: true, preferenceStorageKey,
  judgment: { recommendation: "Keep building.", rationale: "Grounded test state.", basis: [], confidence: 0.8, generatedAt: "2026-08-28T10:00:00Z", basisFingerprint: "test", provenance: { provider: "test", model: "fixture" } },
})

describe("Experience V2 multi-Space re-entry", () => {
  it("keeps an initial degraded collection truthful as the exact singleton the server returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/environment/space"
      ? { ok: true, status: 200, json: async () => ({ ...envelope("a"), spaces: [summaries[0]], collectionAvailable: false, collectionReason: "SPACE_COLLECTION_UNAVAILABLE" }) }
      : { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Enter Beta" })).toBeNull()
    expect(screen.getByText(/Space collection is temporarily unavailable.*SPACE_COLLECTION_UNAVAILABLE/i)).toBeTruthy()
  })

  it("projects current restored hints and inactive owned Space sessions as saved resume-unverified truth", async () => {
    const currentId = "123e4567-e89b-42d3-a456-426614174000"
    const inactiveId = "223e4567-e89b-42d3-a456-426614174000"
    window.localStorage.setItem("williamos:agent-session:a:c%3A%2Fproject", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Codex:build-current`,
      sessions: [{ schemaVersion: 1, sessionId: "build-current", role: "Builder", provider: "Codex", assignment: "Build current Space", updatedAt: "2026-08-29T10:00:00.000Z", completedTurns: [] }],
    }))
    window.localStorage.setItem("williamos:agent-session:b:c%3A%2Fproject", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Claude:${inactiveId}`,
      sessions: [
        { schemaVersion: 1, sessionId: inactiveId, role: "Reviewer", provider: "Claude", assignment: "Review inactive Space", reviewPath: "src/app.ts", updatedAt: "2026-08-29T10:01:00.000Z", completedTurns: [] },
        { schemaVersion: 1, sessionId: currentId, role: "Thinker", provider: "Local", assignment: "Conversation", updatedAt: "2026-08-29T10:02:00.000Z", completedTurns: [] },
      ],
    }))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/environment/space"
      ? { ok: true, status: 200, json: async () => envelope("a") }
      : { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))

    const current = screen.getByRole("button", { name: "Enter Alpha, current Space" })
    const inactive = screen.getByRole("button", { name: "Enter Beta" })
    expect(current.textContent).toContain("Codex · Build current Space")
    expect(current.textContent).toContain("Saved · resume unverified")
    expect(inactive.textContent).toContain("Claude · Review inactive Space")
    expect(inactive.textContent).toContain("Local · Conversation")
    expect(inactive.textContent).toContain("Saved · resume unverified")
    expect(inactive.textContent).not.toContain("Live agent")
  })

  it("renders current and inactive skipped migrated records unknown instead of understating their saved sessions", async () => {
    const invalid = { schemaVersion: 1, sessionId: "123e4567-e89b-42d3-a456-426614174000", role: "Reviewer", provider: "Claude", assignment: "Invalid target", target: { kind: "file", path: "src/app.ts" }, updatedAt: "2026-08-29T10:01:00.000Z", completedTurns: [] }
    window.localStorage.setItem("williamos:agent-session:a:c%3A%2Fproject", JSON.stringify({
      schemaVersion: 3, selectedSessionKey: null,
      sessions: [{ schemaVersion: 1, sessionId: "current-valid", role: "Builder", provider: "Codex", assignment: "Would understate", updatedAt: "2026-08-29T10:00:00.000Z", completedTurns: [] }, invalid],
    }))
    window.localStorage.setItem("williamos:agent-session:b:c%3A%2Fproject", JSON.stringify({
      schemaVersion: 3, selectedSessionKey: null, sessions: [invalid],
    }))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/environment/space"
      ? { ok: true, status: 200, json: async () => envelope("a") }
      : { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))

    const current = screen.getByRole("button", { name: "Enter Alpha, current Space" })
    const inactive = screen.getByRole("button", { name: "Enter Beta" })
    expect(current.textContent).toContain("Agent activity unknown")
    expect(current.textContent).not.toContain("Would understate")
    expect(inactive.textContent).toContain("Agent activity unknown")
    expect(inactive.textContent).not.toContain("No active agents")
  })

  it("keeps server Space hydration usable when reading the opaque preference hint throws", async () => {
    const getItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (key) {
      if (key.startsWith("williamos:selected-space:")) throw new DOMException("blocked", "SecurityError")
      return getItem.call(this, key)
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/environment/space"
      ? { ok: true, status: 200, json: async () => envelope("a") }
      : { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
  })

  it("keeps browser Space hydration usable when corrupt-record cleanup is storage-blocked", async () => {
    const browserKey = "williamos:space:opaque-browser-space"
    window.localStorage.setItem(browserKey, "{not-json")
    const removeItem = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (key) {
      if (key === browserKey) throw new DOMException("blocked", "SecurityError")
      return removeItem.call(this, key)
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/environment/space"
      ? { ok: true, status: 200, json: async () => ({ ...envelope("a"), storage: "browser", browserStorageKey: "opaque-browser-space" }) }
      : { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))

    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
  })

  it("applies an exact Space switch when writing the best-effort preference hint throws", async () => {
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key.startsWith("williamos:selected-space:")) throw new DOMException("quota", "QuotaExceededError")
      return setItem.call(this, key, value)
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url === "/api/environment/space?worldId=b") return { ok: true, status: 200, json: async () => envelope("b") }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    render(<WorkspaceShell />)
    await waitFor(() => expect(screen.queryByText("Reasoning")).toBeNull())
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy())
  })

  it("keeps the initial server Space when removing a stale preference hint throws", async () => {
    window.localStorage.setItem(`williamos:selected-space:${preferenceStorageKey}`, "foreign")
    const removeItem = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (key) {
      if (key.startsWith("williamos:selected-space:")) throw new DOMException("blocked", "SecurityError")
      return removeItem.call(this, key)
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/environment/space"
      ? { ok: true, status: 200, json: async () => envelope("a") }
      : { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
  })

  it("exact-verifies an opaque last-selected hint before restoring B", async () => {
    window.localStorage.setItem(`williamos:selected-space:${preferenceStorageKey}`, "b")
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space?worldId=b") return { ok: true, status: 200, json: async () => envelope("b") }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    })
    vi.stubGlobal("fetch", fetchStub)
    const user = userEvent.setup()
    render(<WorkspaceShell />)
    await user.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy()
    expect(fetchStub.mock.calls.some(([input]) => String(input) === "/api/environment/space?worldId=b")).toBe(true)
  })

  it.each([
    ["network rejection", async () => { throw new Error("offline") }],
    ["non-JSON response", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("invalid json") } })],
    ["typed refusal", async () => ({ ok: false, status: 404, json: async () => ({ error: "SPACE_NOT_FOUND" }) })],
  ])("keeps the valid initial Space when the saved-preference exact lookup has a %s", async (_failure, exactLookup) => {
    window.localStorage.setItem(`williamos:selected-space:${preferenceStorageKey}`, "b")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/environment/space") return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space?worldId=b") return exactLookup()
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))

    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
  })

  it("ownership-checks a saved hint omitted from a degraded singleton collection before restoring it", async () => {
    window.localStorage.setItem(`williamos:selected-space:${preferenceStorageKey}`, "b")
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/environment/space") return { ok: true, status: 200, json: async () => ({
        ...envelope("a"), spaces: [summaries[0]], collectionAvailable: false, collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      }) }
      if (url === "/api/environment/space?worldId=b") return { ok: true, status: 200, json: async () => ({
        ...envelope("b"), spaces: [summaries[1]], collectionAvailable: false, collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      }) }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    })
    vi.stubGlobal("fetch", fetchStub)

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))

    expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy()
    expect(fetchStub.mock.calls.some(([input]) => String(input) === "/api/environment/space?worldId=b")).toBe(true)
    expect(window.localStorage.getItem(`williamos:selected-space:${preferenceStorageKey}`)).toBe("b")
  })

  it("recomputes the real Mission overview on re-entry without retaining the prior Space judgment", async () => {
    const alphaEnvelope = { ...envelope("a"), judgment: { ...envelope("a").judgment, recommendation: "Alpha judgment." } }
    const betaEnvelope = { ...envelope("b"), judgment: { ...envelope("b").judgment, recommendation: "Beta judgment." } }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => alphaEnvelope }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url === "/api/environment/space?worldId=b") return { ok: true, status: 200, json: async () => betaEnvelope }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    expect(screen.getByText(/Current Space: Alpha\./)).toBeTruthy()
    expect(screen.getByText(/Current-Space judgment: Alpha judgment\./)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy())
    expect(screen.getByText(/Current Space: Beta\./)).toBeTruthy()
    expect(screen.getByText(/Current-Space judgment: Beta judgment\./)).toBeTruthy()
    expect(screen.queryByText(/Alpha judgment/)).toBeNull()
  })

  it("promotes an older current Space to most recent only after its exact successful save acknowledgement", async () => {
    const olderAlpha = { ...summaries[0], updatedAt: "2026-08-28T08:00:00Z" }
    const newerBeta = { ...summaries[1], updatedAt: "2026-08-28T09:00:00Z" }
    const initial = { ...envelope("a"), spaces: [olderAlpha, newerBeta] }
    let releaseBeta!: () => void
    const betaWait = new Promise<void>((resolve) => { releaseBeta = resolve })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => initial }
      if (url === "/api/environment/space" && init?.method === "PUT") return {
        ok: true, status: 200, json: async () => ({
          space: JSON.parse(String(init.body)).space,
          updatedAt: "2026-08-29T11:12:13.456Z",
        }),
      }
      if (url === "/api/environment/space?worldId=b") {
        await betaWait
        return { ok: true, status: 200, json: async () => envelope("b") }
      }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    expect(screen.getByText(/Most recent Space: Beta\./)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(screen.getByText(/Most recent Space: Alpha\./)).toBeTruthy())
    releaseBeta()
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy())
  })

  it("does not reorder recency when the current Space save fails", async () => {
    const olderAlpha = { ...summaries[0], updatedAt: "2026-08-28T08:00:00Z" }
    const newerBeta = { ...summaries[1], updatedAt: "2026-08-28T09:00:00Z" }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => ({ ...envelope("a"), spaces: [olderAlpha, newerBeta] }) }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: false, status: 503, json: async () => ({ error: "SPACE_PERSISTENCE_UNAVAILABLE" }) }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(screen.getAllByText(/SPACE_PERSISTENCE_UNAVAILABLE/).length).toBeGreaterThan(0))
    expect(screen.getByText(/Most recent Space: Beta\./)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
  })

  it("uses the acknowledged local write time for successful browser-only persistence", async () => {
    const olderAlpha = { ...summaries[0], updatedAt: "2026-08-28T08:00:00Z" }
    const newerBeta = { ...summaries[1], updatedAt: "2026-08-28T09:00:00Z" }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/environment/space"
      ? { ok: true, status: 200, json: async () => ({
        ...envelope("a"), storage: "browser", browserStorageKey: "browser-alpha",
        spaces: [olderAlpha, newerBeta], multiSpaceAvailable: false,
      }) }
      : { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    expect(screen.getByText(/Most recent Space: Beta\./)).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Most recent Space: Alpha\./)).toBeTruthy())
    expect(window.localStorage.getItem("williamos:space:browser-alpha")).not.toBeNull()
  })

  it("does not let a stale older save acknowledgement rewrite Space recency", async () => {
    const olderAlpha = { ...summaries[0], updatedAt: "2026-08-28T08:00:00Z" }
    const newerBeta = { ...summaries[1], updatedAt: "2026-08-29T11:00:00.000Z" }
    const saves: Array<{
      body: { worldId: string; space: typeof alpha }
      resolve: (response: Response) => void
    }> = []
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        ...envelope("a"), spaces: [olderAlpha, newerBeta],
      }))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        let resolve!: (response: Response) => void
        const response = new Promise<Response>((done) => { resolve = done })
        saves.push({ body: JSON.parse(String(init.body)), resolve })
        return response
      }
      if (url.startsWith("/api/loom/files")) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      return Promise.resolve(Response.json({ error: "UNAVAILABLE" }, { status: 503 }))
    }))

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    await waitFor(() => expect(saves).toHaveLength(1))
    fireEvent(window, new Event("pagehide"))
    await waitFor(() => expect(saves).toHaveLength(2))

    saves[1].resolve(Response.json({ space: saves[1].body.space, updatedAt: "2026-08-29T10:00:00.000Z" }))
    await waitFor(() => expect(screen.getByText(/Most recent Space: Beta\./)).toBeTruthy())
    saves[0].resolve(Response.json({ space: saves[0].body.space, updatedAt: "2026-08-29T12:00:00.000Z" }))
    await waitFor(() => expect(screen.getByText(/Most recent Space: Beta\./)).toBeTruthy())
  })

  it("awaits the exact old-Space PUT acknowledgement before loading B and preserves both places", async () => {
    const order: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space" && init?.method === "PUT") {
        order.push(`PUT:${JSON.parse(String(init.body)).worldId}`)
        return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      }
      if (url === "/api/environment/space?worldId=b") { order.push("GET:b"); return { ok: true, status: 200, json: async () => envelope("b") } }
      if (url === "/api/environment/space?worldId=a") { order.push("GET:a"); return { ok: true, status: 200, json: async () => envelope("a") } }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    const user = userEvent.setup()
    render(<WorkspaceShell />)
    await user.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    await user.click(screen.getByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy())
    expect(order.indexOf("PUT:a")).toBeLessThan(order.indexOf("GET:b"))
    expect(window.localStorage.getItem(`williamos:selected-space:${preferenceStorageKey}`)).toBe("b")

    await user.click(screen.getByRole("button", { name: "Enter Alpha" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy())
    expect(order.lastIndexOf("PUT:b")).toBeLessThan(order.lastIndexOf("GET:a"))
  })

  it("preserves known real Spaces when a committed switch returns degraded singleton collection metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url === "/api/environment/space?worldId=b") return { ok: true, status: 200, json: async () => ({
        ...envelope("b"), spaces: [summaries[1]], collectionAvailable: false, collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      }) }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy())
    expect(screen.getByRole("button", { name: "Enter Alpha" })).toBeTruthy()
    expect(screen.getByText(/Space collection is temporarily unavailable.*SPACE_COLLECTION_UNAVAILABLE/i)).toBeTruthy()
  })

  it("preserves known real Spaces when a committed creation returns degraded singleton collection metadata", async () => {
    const gamma = { worldId: "c", name: "Gamma", space: beta, updatedAt: "2026-08-28T11:00:00Z" }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url === "/api/environment/space" && init?.method === "POST") return { ok: true, status: 201, json: async () => ({
        ...envelope("b"), ...gamma, spaces: [gamma], collectionAvailable: false, collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      }) }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "New Space" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Space name" }), { target: { value: "Gamma" } })
    fireEvent.submit(screen.getByRole("textbox", { name: "Space name" }).closest("form")!)
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Gamma, current Space" })).toBeTruthy())
    expect(screen.getByRole("button", { name: "Enter Alpha" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Enter Beta" })).toBeTruthy()
    expect(screen.getByText(/Space collection is temporarily unavailable.*SPACE_COLLECTION_UNAVAILABLE/i)).toBeTruthy()
  })

  it("keeps A current and Mission Control open when exact B load fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url === "/api/environment/space?worldId=b") return { ok: false, status: 503, json: async () => ({ error: "SPACE_PERSISTENCE_UNAVAILABLE" }) }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    render(<WorkspaceShell />)
    await waitFor(() => expect(screen.queryByText("Reasoning")).toBeNull())
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(screen.getByText("SPACE_PERSISTENCE_UNAVAILABLE")).toBeTruthy())
    expect(screen.getByRole("dialog", { name: "Mission Control" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
  })

  it("cannot dismiss Mission Control while a deferred exact switch is in flight", async () => {
    let resolveB!: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
    const pendingB = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((done) => { resolveB = done })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url === "/api/environment/space?worldId=b") return pendingB
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    render(<WorkspaceShell />)
    await waitFor(() => expect(screen.queryByText("Reasoning")).toBeNull())
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    await screen.findByText("Restoring the selected Space…")
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.getByRole("dialog", { name: "Mission Control" })).toBeTruthy()
    resolveB({ ok: true, status: 200, json: async () => envelope("b") })
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy())
  })

  it("cannot dismiss Mission Control while a deferred Space creation is in flight", async () => {
    let resolveCreate!: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
    const pendingCreate = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((done) => { resolveCreate = done })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url === "/api/environment/space" && init?.method === "POST") return pendingCreate
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "New Space" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Space name" }), { target: { value: "Gamma" } })
    fireEvent.submit(screen.getByRole("textbox", { name: "Space name" }).closest("form")!)
    await screen.findByText("Saving this Space before creating another…")
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.getByRole("dialog", { name: "Mission Control" })).toBeTruthy()
    resolveCreate({ ok: true, status: 201, json: async () => ({
      ...envelope("b"), worldId: "c", name: "Gamma",
      spaces: [...summaries, { worldId: "c", name: "Gamma", space: beta, updatedAt: "2026-08-28T11:00:00Z" }],
    }) })
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Gamma, current Space" })).toBeTruthy())
    expect(screen.getByText(/Current Space: Gamma\./)).toBeTruthy()
  })

  it("blocks re-entry until the user stops an active Test run", async () => {
    let settleRun!: (response: Response) => void
    const pendingRun = new Promise<Response>((done) => { settleRun = done })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
      if (url === "/api/loom/run" && init?.method === "POST") return pendingRun
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: /^(Restore|Focus) Tests$/ }))
    fireEvent.click(screen.getByRole("button", { name: "Run full test suite" }))
    fireEvent.click(screen.getByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    expect(screen.getByText("Stop the active Test or Terminal run before switching Spaces.")).toBeTruthy()
    settleRun(new Response(`${JSON.stringify({ type: "exit", code: 0, reason: null })}\n`))
  })

  it("blocks re-entry while canonical Space execution is live", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => ({ ...envelope("a"), judgment: null, spine: { ...EMPTY_SPINE, execution: "implementing" } }) }
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init?.body ?? "{}"))?.space }) }
    }))
    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(screen.getByRole("button", { name: "Enter Beta" }))
    expect(screen.getByText("Finish or stop the active Space execution before switching Spaces.")).toBeTruthy()
  })

  it("blocks re-entry visibly while the current source has unsaved edits", async () => {
    const dirtySpace = spaceToServer({
      ...defaultSpace(1440, 900, "a", "Alpha"), selectedPath: "src/a.ts",
      editor: { openFiles: ["src/a.ts"], panes: [{ id: "primary", activePath: "src/a.ts", selection: null }], activePaneId: "primary" },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => ({ ...envelope("a"), space: dirtySpace, spaces: [{ ...summaries[0], space: dirtySpace }, summaries[1]] }) }
      if (url.includes("src%2Fa.ts")) return { ok: true, status: 200, json: async () => ({ kind: "file", path: "src/a.ts", content: "before", modifiedAt: "2026-08-28T00:00:00Z" }) }
      if (url === "/api/loom/files?path=") return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    const user = userEvent.setup()
    render(<WorkspaceShell />)
    const editor = await screen.findByLabelText("Source content")
    await user.clear(editor)
    await user.type(editor, "after")
    await user.click(screen.getByRole("button", { name: "Open Mission Control" }))
    await user.click(screen.getByRole("button", { name: "Enter Beta" }))
    expect(screen.getByText("Save or discard the dirty source before switching Spaces.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
  })

  it("blocks re-entry while grounded William work is active", async () => {
    let settleJudgment!: () => void
    const pendingJudgment = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => {
      settleJudgment = () => resolve({ ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) })
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => ({ ...envelope("a"), judgment: null }) }
      if (url === "/api/environment/space" && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ space: JSON.parse(String(init.body)).space }) }
      if (url === "/api/environment/judgment") return pendingJudgment
      if (url.startsWith("/api/loom/files")) return { ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) }
      return { ok: false, status: 503, json: async () => ({ error: "UNAVAILABLE" }) }
    }))
    const user = userEvent.setup()
    render(<WorkspaceShell />)
    await screen.findByText("Reasoning")
    await user.click(screen.getByRole("button", { name: "Open Mission Control" }))
    await user.click(screen.getByRole("button", { name: "Enter Beta" }))
    expect(screen.getByText("Finish or stop active work before switching Spaces.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Enter Alpha, current Space" })).toBeTruthy()
    settleJudgment()
  })
})
