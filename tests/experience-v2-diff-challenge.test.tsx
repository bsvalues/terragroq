// @vitest-environment jsdom
import fs from "node:fs"
import path from "node:path"

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const browser = vi.hoisted(() => ({
  diff: null as null | { path: string; state: string; status: string; fingerprint: string; diff: string },
}))

vi.mock("@/components/workspace-shell/editor-surface", () => ({ EditorSurface: ({ space }: { space: { selectedPath: string | null } }) => <div>Source {space.selectedPath}</div> }))
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
  browser.diff = null
  vi.unstubAllGlobals()
})

describe("Experience V2 exact diff Challenge", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "components/workspace-shell/workspace-shell.tsx"), "utf8")

  it("dispatches one-click William analysis with an exact immutable diff identity", () => {
    expect(source).toContain('kind: "diff-challenge"')
    expect(source).toContain('baseHash: string')
    expect(source).toContain('indexHash: string')
    expect(source).toContain('patchHash: string')
    expect(source).toContain('void sendWilliamTurn("Challenge the exact current patch for the selected file.", context)')
    expect(source).toContain('Challenge exact patch · ${lineContext.path} · ${lineContext.patchHash}')
  })

  it("fails closed before and after the persistence barrier when exact patch context drifts", () => {
    const firstGuard = source.indexOf('!diffChallengeLineContextIsCurrent(context)')
    const barrier = source.indexOf('await persistBarrierRef.current()', firstGuard)
    const secondGuard = source.indexOf('!diffChallengeLineContextIsCurrent(context)', barrier)
    const post = source.indexOf('fetch("/api/environment/line"', secondGuard)
    expect(firstGuard).toBeGreaterThan(0)
    expect(barrier).toBeGreaterThan(firstGuard)
    expect(secondGuard).toBeGreaterThan(barrier)
    expect(post).toBeGreaterThan(secondGuard)
    expect(source).toContain('dirtyPathsRef.current[context.path]')
    expect(source).toContain('live.fingerprint === context.fingerprint')
  })

  it("concretely disables Challenge without a durable exact live patch", () => {
    expect(source).toContain('storage !== "server" ? "Challenge requires a server-bound Space with durable persistence."')
    expect(source).toContain('"Challenge waits until the current Space is durably saved."')
    expect(source).toContain('"Challenge needs the exact live modified patch for the saved selected file."')
    expect(source).toContain('action === "Challenge unavailable"')
  })

  it("discards a delayed answer when the same selected path receives a replacement patch", async () => {
    const pathName = "src/exact.ts"
    const identity = { path: pathName, state: "modified", status: " M src/exact.ts", baseHash: "base-a", indexHash: "index-a", patchHash: "patch-a" }
    browser.diff = { path: pathName, state: "modified", status: identity.status, fingerprint: JSON.stringify(identity), diff: "-old\n+new" }
    const baseSpace = defaultSpace()
    const space = {
      ...baseSpace,
      selectedPath: pathName,
      activeWindowId: "diff" as const,
      editor: {
        ...baseSpace.editor,
        openFiles: [pathName],
        panes: [{ id: "primary" as const, activePath: pathName, selection: { anchor: 0, head: 0 } }],
      },
    }
    let resolveLine!: (response: Response) => void
    let signalLine!: () => void
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
      if (url.includes("/api/loom/diff") && !init?.method) {
        return Promise.resolve(Response.json(browser.diff))
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        signalLine()
        return new Promise<Response>((resolve) => { resolveLine = resolve })
      }
      return Promise.resolve(Response.json({ error: "NOT_FOUND" }, { status: 404 }))
    }))

    render(<WorkspaceShell />)
    await screen.findByText("Space ready")
    await waitFor(() => expect(spacePuts).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText("+new", { exact: false })
    const challenge = await screen.findByRole("button", { name: "Challenge" })
    await waitFor(() => expect((challenge as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(challenge)
    await lineStarted

    const replacement = { ...identity, patchHash: "patch-b" }
    browser.diff = { path: pathName, state: "modified", status: identity.status, fingerprint: JSON.stringify(replacement), diff: "-old\n+replacement" }
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText("+replacement", { exact: false })
    resolveLine(Response.json({ worldId: "world-a", say: "STALE PATCH ADVICE", surfaces: [], spine: EMPTY_SPINE }))

    expect(await screen.findByText("LINE_CONTEXT_STALE")).toBeTruthy()
    expect(screen.queryByText("STALE PATCH ADVICE")).toBeNull()
  })
})
