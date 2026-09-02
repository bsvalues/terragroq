// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/dynamic", () => ({ default: () => function TestSourceEditor() { return <div>Source editor</div> } }))

import {
  agentSessionInspectorId,
  agentSessionInspectorIdentity,
  AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX,
  AGENT_SESSION_INSPECTOR_SURFACE_KIND,
  encodeAgentSessionInspectorPayload,
  parseAgentSessionInspectorPayload,
} from "@/components/workspace-shell/agent-session-inspector"
import type { DurableAgentSession } from "@/components/workspace-shell/agent-sessions"
import { InspectorSurfaceView, inspectorSurfaceWindowTitle } from "@/components/workspace-shell/inspector-surface"
import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const turns = [
  { ownerPrompt: "First owner request", finalResult: "First canonical result", completedAt: "2026-09-01T18:00:00.000Z" },
  { ownerPrompt: "Second owner request", finalResult: "Second canonical result", completedAt: "2026-09-01T18:01:00.000Z" },
]

const codex: DurableAgentSession = {
  schemaVersion: 1,
  sessionId: "codex-inspector-1",
  role: "Builder",
  provider: "Codex",
  assignment: "Build the selected WilliamOS slice",
  target: { kind: "file", path: "components/workspace-shell/workspace-shell.tsx" },
  updatedAt: "2026-09-01T18:01:00.000Z",
  completedTurns: turns,
}

const claude: DurableAgentSession = {
  schemaVersion: 1,
  sessionId: "123e4567-e89b-42d3-a456-426614174000",
  role: "Reviewer",
  provider: "Claude",
  assignment: "Review the selected WilliamOS file",
  reviewPath: "components/workspace-shell/workspace-shell.tsx",
  updatedAt: "2026-09-01T18:02:00.000Z",
  completedTurns: [{ ownerPrompt: "Review it", finalResult: "Review complete", completedAt: "2026-09-01T18:02:00.000Z" }],
}

const local: DurableAgentSession = {
  schemaVersion: 1,
  sessionId: "223e4567-e89b-42d3-a456-426614174000",
  role: "Thinker",
  provider: "Local",
  assignment: "Conversation",
  updatedAt: "2026-09-01T18:03:00.000Z",
  completedTurns: [{ ownerPrompt: "Think", finalResult: "Local thought", completedAt: "2026-09-01T18:03:00.000Z" }],
}

afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals() })

describe("durable agent session Inspector", () => {
  it("strictly round-trips exact identity, truth, mode, target, lineage, and canonical turns", () => {
    const payload = encodeAgentSessionInspectorPayload("Codex:codex-inspector-1", codex, "live", "2026-09-01T18:05:00.000Z")
    const snapshot = parseAgentSessionInspectorPayload(payload)

    expect(snapshot).toEqual({
      schemaVersion: 1,
      kind: "agent-session",
      sessionKey: "Codex:codex-inspector-1",
      sessionId: "codex-inspector-1",
      role: "Builder",
      provider: "Codex",
      assignment: "Build the selected WilliamOS slice",
      verificationAtCapture: "verified",
      capturedAt: "2026-09-01T18:05:00.000Z",
      mode: "delegate",
      target: { kind: "file", path: "components/workspace-shell/workspace-shell.tsx" },
      forkedFrom: null,
      updatedAt: "2026-09-01T18:01:00.000Z",
      turns,
    })
    expect(agentSessionInspectorIdentity(snapshot!)).toBe('["Codex:codex-inspector-1"]')
    expect(agentSessionInspectorId(snapshot!)).not.toBe(agentSessionInspectorId("Codex:another-session"))

    const surface = { id: "agent-inspector", kind: AGENT_SESSION_INSPECTOR_SURFACE_KIND, subject: "Builder · Codex", payload }
    render(<InspectorSurfaceView surface={surface} />)
    expect(inspectorSurfaceWindowTitle(surface)).toBe("Agent session · Builder · Codex")
    const article = screen.getByRole("article", { name: "Durable agent session snapshot" })
    expect(within(article).getByText("Verified at snapshot time 2026-09-01T18:05:00.000Z · current runtime liveness unverified")).toBeTruthy()
    const first = within(article).getByRole("region", { name: "Completed turn 1" })
    const second = within(article).getByRole("region", { name: "Completed turn 2" })
    expect(first.textContent).toContain("First owner request")
    expect(first.textContent).toContain("First canonical result")
    expect(second.textContent).toContain("Second owner request")
    expect(second.textContent).toContain("Second canonical result")
    expect((article.textContent ?? "").indexOf("First owner request")).toBeLessThan((article.textContent ?? "").indexOf("Second owner request"))
  })

  it("fails closed and renders unavailable for malformed or oversized snapshots", () => {
    expect(parseAgentSessionInspectorPayload('{"schemaVersion":1,"kind":"agent-session","sessionKey":"spoof"}')).toBeNull()
    const oversized = encodeAgentSessionInspectorPayload("Codex:codex-inspector-1", {
      ...codex,
      completedTurns: [{ ownerPrompt: "Owner", finalResult: "x".repeat(200_000), completedAt: "2026-09-01T18:04:00.000Z" }],
    }, "resume-unverified", "2026-09-01T18:05:00.000Z")
    expect(parseAgentSessionInspectorPayload(oversized)).toBeNull()
    render(<InspectorSurfaceView surface={{ id: "unavailable", kind: AGENT_SESSION_INSPECTOR_SURFACE_KIND, subject: "Builder · Codex", payload: oversized }} />)
    expect(screen.getByRole("status").textContent).toContain("Durable agent session snapshot unavailable.")
  })

  it("records a fork as its own strict mode and renders exact Claude lineage", () => {
    const forked: DurableAgentSession = {
      schemaVersion: 1,
      sessionId: "323e4567-e89b-42d3-a456-426614174000",
      role: "Builder",
      provider: "Claude",
      assignment: "Try the alternate implementation",
      forkedFrom: "423e4567-e89b-42d3-a456-426614174000",
      updatedAt: "2026-09-01T18:06:00.000Z",
      completedTurns: [],
    }
    const payload = encodeAgentSessionInspectorPayload("Claude:323e4567-e89b-42d3-a456-426614174000", forked, "resume-unverified", "2026-09-01T18:07:00.000Z")
    expect(parseAgentSessionInspectorPayload(payload)?.mode).toBe("fork")
    render(<InspectorSurfaceView surface={{ id: "fork", kind: AGENT_SESSION_INSPECTOR_SURFACE_KIND, subject: "Builder · Claude", payload }} />)
    expect(screen.getByText("fork")).toBeTruthy()
    expect(screen.getByText("Claude:423e4567-e89b-42d3-a456-426614174000")).toBeTruthy()
  })

  it("does not let Review JSON impersonate an agent-session surface and preserves malformed Review reports", () => {
    const agentPayload = encodeAgentSessionInspectorPayload("Codex:codex-inspector-1", codex, "live", "2026-09-01T18:05:00.000Z")
    const first = render(<InspectorSurfaceView surface={{ id: "review-json", kind: "review", subject: "report.json", payload: agentPayload }} />)
    expect(screen.getByRole("heading", { name: "Review report · report.json" })).toBeTruthy()
    expect(screen.queryByRole("article", { name: "Durable agent session snapshot" })).toBeNull()
    first.unmount()

    render(<InspectorSurfaceView surface={{ id: "review-malformed", kind: "review", subject: "malformed.txt", payload: "not-json review content" }} />)
    expect(screen.getByRole("heading", { name: "Review report · malformed.txt" })).toBeTruthy()
    expect(screen.getByText("not-json review content")).toBeTruthy()
  })

  it("does not promote a prefixed Review when its persisted id is outside the reserved agent-session namespace", async () => {
    const worldId = "21111111-1111-4111-8111-111111111111"
    const payload = encodeAgentSessionInspectorPayload("Codex:codex-inspector-1", codex, "live", "2026-09-01T18:05:00.000Z")
    const baseSpace = spaceToServer(defaultSpace(1440, 900, worldId, "Experience V2"))
    const persistedSpace = {
      ...baseSpace,
      windows: [...baseSpace.windows, {
        id: "ordinary-review-window", kind: "inspector" as const, title: "Review report",
        surfaceKind: "review" as const,
        surfaceSubject: `${AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX}spoofed report`,
        surfacePayload: payload,
        frame: { x: 104, y: 72, width: 560, height: 480 }, z: 6, minimized: false,
      }],
      activeWindowId: "ordinary-review-window",
    }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId, space: persistedSpace, spine: EMPTY_SPINE,
        project: { identity: "c:/repos/william-os-devops", name: "WilliamOS" }, storage: "server", browserStorageKey: null,
      })
      if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/environment/judgment" && init?.method === "POST") return Response.json({ judgment: null })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    expect(await screen.findByRole("heading", { name: `Review report · ${AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX}spoofed report` })).toBeTruthy()
    expect(screen.queryByRole("article", { name: "Durable agent session snapshot" })).toBeNull()
  })

  it("persists an oversized Inspect as unavailable and restores it as the same agent-session Inspector", async () => {
    const worldId = "31111111-1111-4111-8111-111111111111"
    const projectIdentity = "c:/repos/william-os-devops"
    const storageKey = `williamos:agent-session:${worldId}:c%3A%2Frepos%2Fwilliam-os-devops`
    const oversized: DurableAgentSession = {
      ...codex,
      sessionId: "codex-oversized-inspector",
      completedTurns: [{ ownerPrompt: "Owner", finalResult: "x".repeat(200_000), completedAt: "2026-09-01T18:04:00.000Z" }],
    }
    window.localStorage.setItem(storageKey, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: "Codex:codex-oversized-inspector",
      sessions: [oversized],
    }))
    const baseSpace = spaceToServer(defaultSpace(1440, 900, worldId, "Experience V2"))
    let persistedSpace = baseSpace
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId, space: persistedSpace, spine: EMPTY_SPINE,
        project: { identity: projectIdentity, name: "WilliamOS" }, storage: "server", browserStorageKey: null,
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        persistedSpace = (JSON.parse(String(init.body)) as { space: typeof persistedSpace }).space
        return Response.json({ worldId, space: persistedSpace, spine: EMPTY_SPINE, judgment: null })
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/environment/judgment" && init?.method === "POST") return Response.json({ judgment: null })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    const first = render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: /^Builder · Codex · Build the selected WilliamOS slice$/ }))
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }))
    expect(await screen.findByText("Durable agent session snapshot unavailable.")).toBeTruthy()
    await waitFor(() => expect(persistedSpace.windows.some((window) =>
      window.id === agentSessionInspectorId("Codex:codex-oversized-inspector"))).toBe(true))

    first.unmount()
    render(<WorkspaceShell />)
    expect(await screen.findByText("Durable agent session snapshot unavailable.")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: /Review report/ })).toBeNull()
  })

  it("selects restored Codex, Claude, and Local sessions, Inspects without provider calls, and restores exact persisted snapshots", async () => {
    const worldId = "11111111-1111-4111-8111-111111111111"
    const projectIdentity = "c:/repos/william-os-devops"
    const storageKey = `williamos:agent-session:${worldId}:c%3A%2Frepos%2Fwilliam-os-devops`
    window.localStorage.setItem(storageKey, JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: "Codex:codex-inspector-1",
      sessions: [codex, claude, local],
    }))
    const oldCodex = { ...codex, role: "Earlier Builder", updatedAt: "2026-09-01T17:59:00.000Z" }
    const oldPayload = encodeAgentSessionInspectorPayload("Codex:codex-inspector-1", oldCodex, "live", "2026-09-01T17:59:30.000Z")
    const baseSpace = spaceToServer(defaultSpace(1440, 900, worldId, "Experience V2"))
    let persistedSpace = {
      ...baseSpace,
      windows: [...baseSpace.windows, {
        id: agentSessionInspectorId("Codex:codex-inspector-1"), kind: "inspector" as const, title: "Review report",
        surfaceKind: "review" as const,
        surfaceSubject: `${AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX}Earlier Builder · Codex`,
        surfacePayload: oldPayload,
        frame: { x: 104, y: 72, width: 560, height: 480 }, z: 6, minimized: false,
      }],
      activeWindowId: agentSessionInspectorId("Codex:codex-inspector-1"),
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId, space: persistedSpace, spine: EMPTY_SPINE,
        project: { identity: projectIdentity, name: "WilliamOS" }, storage: "server", browserStorageKey: null,
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        persistedSpace = (JSON.parse(String(init.body)) as { space: typeof persistedSpace }).space
        return Response.json({ worldId, space: persistedSpace, spine: EMPTY_SPINE, judgment: null })
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/environment/judgment" && init?.method === "POST") return Response.json({ judgment: null })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    const first = render(<WorkspaceShell />)
    expect(await screen.findByText("Verified at snapshot time 2026-09-01T17:59:30.000Z · current runtime liveness unverified")).toBeTruthy()
    for (const name of [
      /^Builder · Codex · Build the selected WilliamOS slice$/,
      /^Reviewer · Claude · Review the selected WilliamOS file$/,
      /^Thinker · Local · Conversation$/,
    ]) {
      fireEvent.click(await screen.findByRole("button", { name }))
      fireEvent.click(screen.getByRole("button", { name: "Inspect" }))
    }
    expect(screen.getAllByRole("region", { name: "Agent session · Builder · Codex window" })).toHaveLength(1)
    expect(screen.queryByRole("region", { name: "Agent session · Earlier Builder · Codex window" })).toBeNull()
    expect(await screen.findByText("First canonical result")).toBeTruthy()
    expect(screen.getByText("Review complete")).toBeTruthy()
    const localInspector = screen.getByRole("heading", { name: "Thinker · Local" }).closest("article")!
    expect(within(localInspector).getByText("Local thought")).toBeTruthy()
    expect(screen.getAllByText(/Saved \/ resume unverified at snapshot time/)).toHaveLength(3)
    await waitFor(() => expect(JSON.stringify(persistedSpace)).toContain('\\"kind\\":\\"agent-session\\"'))
    await waitFor(() => expect(persistedSpace.windows.filter((window) =>
      "surfaceSubject" in window && String(window.surfaceSubject).startsWith(AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX)).length).toBe(3))
    expect(fetcher.mock.calls.some(([url]) => /\/api\/loom\/(?:agent|codex|claude)/.test(String(url)))).toBe(false)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/api/environment/execution"))).toBe(false)

    first.unmount()
    render(<WorkspaceShell />)
    expect(await screen.findByText("First canonical result")).toBeTruthy()
    const restoredClaudeInspector = screen.getByRole("heading", { name: "Reviewer · Claude" }).closest("article")!
    expect(within(restoredClaudeInspector).getByText("Review complete")).toBeTruthy()
    const restoredLocalInspector = screen.getByRole("heading", { name: "Thinker · Local" }).closest("article")!
    expect(within(restoredLocalInspector).getByText("Local thought")).toBeTruthy()
    expect(screen.getByText("Codex:codex-inspector-1")).toBeTruthy()
    expect(screen.getByText("Claude:123e4567-e89b-42d3-a456-426614174000")).toBeTruthy()
    expect(screen.getByText("Local:223e4567-e89b-42d3-a456-426614174000")).toBeTruthy()
  })
})
