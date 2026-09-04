// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AgentSessionStrip,
  useExperienceAgentSessions,
  type ProviderNeutralAgentSessionController,
} from "@/components/workspace-shell/agent-sessions"
import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const ATLAS_REPOSITORY = {
  resourceKey: "atlas",
  identity: "bsvalues/terrafusion-atlas",
  mountKey: "terrafusion:atlas:configured",
  observedRevision: "a".repeat(40),
} as const

const FORGE_REPOSITORY = {
  resourceKey: "forge",
  identity: "bsvalues/terrafusion-forge",
  mountKey: "terrafusion:forge:configured",
  observedRevision: "c".repeat(40),
} as const

const DELEGATE_SPINE = {
  ...EMPTY_SPINE,
  outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
  outcomeTitle: "Finish Experience V2",
  workOrderId: 1122,
  execution: "authorized" as const,
}

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor(props: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Source content" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  },
}))

let controller: ProviderNeutralAgentSessionController | null = null

function Harness() {
  controller = useExperienceAgentSessions({
    ownerScope: "owner-1",
    worldScope: "terrafusion",
    worldId: "world-1",
    projectKey: "terrafusion",
  })
  return <AgentSessionStrip sessions={controller.sessions} />
}

function ndjson(...events: readonly Record<string, unknown>[]): Response {
  return new Response(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

function atlasSession(sessionId: string, resumed: boolean): Response {
  return ndjson(
    {
      type: "session",
      sessionId,
      provider: "Codex",
      mode: "delegate",
      resumed,
      selectedPath: "src/atlas.ts",
      assignmentHash: "b".repeat(64),
      repositoryResourceKey: ATLAS_REPOSITORY.resourceKey,
      repositoryIdentity: ATLAS_REPOSITORY.identity,
      repositoryMountKey: ATLAS_REPOSITORY.mountKey,
      observedRevision: ATLAS_REPOSITORY.observedRevision,
    },
    { type: "result", text: "Atlas work completed." },
    { type: "done", code: 0, reason: null },
  )
}

function atlasWorkspaceResponse() {
  const selectedFileRef = {
    projectIdentity: "c:/repos/terrafusion_os_1.0",
    repositoryResourceKey: ATLAS_REPOSITORY.resourceKey,
    repositoryMountKey: ATLAS_REPOSITORY.mountKey,
    worktreeKey: null,
    observedRevision: ATLAS_REPOSITORY.observedRevision,
    path: "src/atlas.ts",
  }
  const space = {
    ...defaultSpace(),
    revision: 7,
    selectedPath: selectedFileRef.path,
    selectedFileRef,
    activeWindowId: "editor" as const,
    editor: {
      openFiles: [selectedFileRef.path],
      openFileRefs: [selectedFileRef],
      panes: [{ id: "primary" as const, activePath: selectedFileRef.path, activeFileRef: selectedFileRef, selection: { anchor: 0, head: 0 } }],
      activePaneId: "primary" as const,
    },
  }
  return Response.json({
    worldId: "server-world",
    space: spaceToServer(space),
    spine: DELEGATE_SPINE,
    project: {
      identity: selectedFileRef.projectIdentity,
      name: "TerraFusion",
      repositories: [{
        key: "atlas",
        identity: ATLAS_REPOSITORY.identity,
        label: "Atlas",
        role: "suite-source",
        suite: "atlas",
        previewSource: false,
        defaultRepository: false,
        mount: {
          key: ATLAS_REPOSITORY.mountKey,
          configured: true,
          verified: true,
          branch: "main",
          revision: ATLAS_REPOSITORY.observedRevision,
          refusal: null,
        },
      }],
    },
    storage: "server",
    browserStorageKey: null,
  })
}

afterEach(() => {
  cleanup()
  controller = null
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Experience V2 repository-qualified browser dispatch", () => {
  it("does not fabricate a repository identity for an unbound session", () => {
    render(<AgentSessionStrip sessions={[{
      id: "Codex:project-only",
      role: "Builder",
      providerLabel: "Codex",
      assignment: "Project-only task",
      status: "working",
      evidence: "live agent stream",
      truth: "live",
      kind: "durable-session",
      mode: "delegate",
    }]} />)

    expect(screen.getByRole("button", { name: "Builder · Codex · Project-only task" })).toBeTruthy()
    expect(screen.queryByText("WilliamOS · Builder · Codex")).toBeNull()
  })

  it("keeps two repository-qualified writer sessions live concurrently", async () => {
    const encoder = new TextEncoder()
    const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { repositoryKey: string }
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(stream) { streams.set(body.repositoryKey, stream) },
      })))
    }))
    render(<Harness />)

    let atlas!: Promise<unknown>
    act(() => {
      atlas = controller!.runAgentTurn({
        provider: "Codex", role: "Builder", assignment: "Implement shared contract", prompt: "Build Atlas.",
        target: { kind: "file", path: "src/atlas.ts" }, repositoryKey: "atlas",
      })
    })
    await waitFor(() => expect(streams.has("atlas")).toBe(true))
    act(() => streams.get("atlas")!.enqueue(encoder.encode(`${JSON.stringify({
      type: "session", sessionId: "codex-atlas-parallel", provider: "Codex", mode: "delegate", resumed: false,
      selectedPath: "src/atlas.ts", assignmentHash: "b".repeat(64),
      repositoryResourceKey: ATLAS_REPOSITORY.resourceKey, repositoryIdentity: ATLAS_REPOSITORY.identity,
      repositoryMountKey: ATLAS_REPOSITORY.mountKey, observedRevision: ATLAS_REPOSITORY.observedRevision,
    })}\n`)))

    let forge!: Promise<unknown>
    act(() => {
      forge = controller!.runAgentTurn({
        provider: "Codex", role: "Builder", assignment: "Implement shared contract", prompt: "Build Forge.",
        target: { kind: "file", path: "src/forge.ts" }, repositoryKey: "forge",
      })
    })
    await waitFor(() => expect(streams.has("forge")).toBe(true))
    act(() => streams.get("forge")!.enqueue(encoder.encode(`${JSON.stringify({
      type: "session", sessionId: "codex-forge-parallel", provider: "Codex", mode: "delegate", resumed: false,
      selectedPath: "src/forge.ts", assignmentHash: "d".repeat(64),
      repositoryResourceKey: FORGE_REPOSITORY.resourceKey, repositoryIdentity: FORGE_REPOSITORY.identity,
      repositoryMountKey: FORGE_REPOSITORY.mountKey, observedRevision: FORGE_REPOSITORY.observedRevision,
    })}\n`)))

    await waitFor(() => expect(controller!.activeSessionIds).toEqual([
      "Codex:codex-atlas-parallel", "Codex:codex-forge-parallel",
    ]))
    const concurrentCards = screen.getAllByRole("button", { name: "Builder · Codex · Implement shared contract" })
    const atlasCard = concurrentCards.find((card) => card.getAttribute("aria-description") === "Repository Atlas")!
    const forgeCard = concurrentCards.find((card) => card.getAttribute("aria-description") === "Repository Forge")!
    expect(atlasCard.getAttribute("title")).toBe("Atlas · Builder · Codex · Implement shared contract")
    expect(forgeCard.getAttribute("title")).toBe("Forge · Builder · Codex · Implement shared contract")
    expect(atlasCard.getAttribute("aria-description")).toBe("Repository Atlas")
    expect(forgeCard.getAttribute("aria-description")).toBe("Repository Forge")
    expect(within(atlasCard).getByText("Atlas")).toBeTruthy()
    expect(within(forgeCard).getByText("Forge")).toBeTruthy()
    expect(atlasCard.textContent).not.toMatch(/1 of 2|2 of 2/)
    expect(forgeCard.textContent).not.toMatch(/1 of 2|2 of 2/)

    act(() => {
      streams.get("forge")!.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Forge done." })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams.get("forge")!.close()
      streams.get("atlas")!.enqueue(encoder.encode(`${JSON.stringify({ type: "result", text: "Atlas done." })}\n${JSON.stringify({ type: "done", code: 0, reason: null })}\n`))
      streams.get("atlas")!.close()
    })
    await act(async () => { await Promise.all([atlas, forge]) })
  })

  it("sends the selected secondary repository key on a fresh Codex assignment", async () => {
    const fetcher = vi.fn().mockResolvedValue(atlasSession("codex-atlas-fresh", false))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)

    await act(async () => {
      await controller!.runAgentTurn({
        provider: "Codex",
        role: "Builder",
        assignment: "src/atlas.ts",
        prompt: "Change only the selected Atlas file.",
        target: { kind: "file", path: "src/atlas.ts" },
        repositoryKey: "atlas",
      })
    })

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      projectKey: "terrafusion",
      repositoryKey: "atlas",
      worldId: "world-1",
      resume: false,
    })
    expect(controller!.savedSessions).toEqual([
      expect.objectContaining({ repository: ATLAS_REPOSITORY }),
    ])
  })

  it("continues a saved secondary-repository session against that same repository", async () => {
    const sessionId = "codex-atlas-resume"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Codex:${sessionId}`,
      sessions: [{
        schemaVersion: 1,
        sessionId,
        role: "Builder",
        provider: "Codex",
        assignment: "src/atlas.ts",
        repository: ATLAS_REPOSITORY,
        target: { kind: "file", path: "src/atlas.ts" },
        updatedAt: "2026-09-02T10:00:00.000Z",
        completedTurns: [],
      }],
    }))
    const fetcher = vi.fn().mockResolvedValue(atlasSession(sessionId, true))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(controller!.savedSessions).toHaveLength(1))
    const restoredAtlasCard = screen.getByRole("button", { name: "Builder · Codex · src/atlas.ts" })
    expect(restoredAtlasCard.getAttribute("title")).toBe("Atlas · Builder · Codex · src/atlas.ts")
    expect(within(restoredAtlasCard).getByText("Atlas")).toBeTruthy()

    await act(async () => {
      await controller!.continueSession({
        sessionKey: `Codex:${sessionId}`,
        prompt: "Continue the exact Atlas session.",
      })
    })

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      repositoryKey: "atlas",
      sessionId,
      resume: true,
    })
    expect(controller!.savedSessions[0]?.repository).toEqual(ATLAS_REPOSITORY)
  })

  it("refuses a resume request that tries to hop a saved session to another repository", async () => {
    const sessionId = "codex-atlas-no-hop"
    window.localStorage.setItem("williamos:agent-session:owner-1:terrafusion", JSON.stringify({
      schemaVersion: 3,
      selectedSessionKey: `Codex:${sessionId}`,
      sessions: [{
        schemaVersion: 1,
        sessionId,
        role: "Builder",
        provider: "Codex",
        assignment: "Atlas assignment",
        repository: ATLAS_REPOSITORY,
        updatedAt: "2026-09-02T10:00:00.000Z",
        completedTurns: [],
      }],
    }))
    const fetcher = vi.fn().mockResolvedValue(atlasSession(sessionId, true))
    vi.stubGlobal("fetch", fetcher)
    render(<Harness />)
    await waitFor(() => expect(controller!.savedSessions).toHaveLength(1))

    await expect(act(async () => controller!.runAgentTurn({
      provider: "Codex",
      role: "Builder",
      assignment: "Atlas assignment",
      prompt: "Continue elsewhere.",
      repositoryKey: "os-1",
    }))).rejects.toThrow("AGENT_REPOSITORY_SCOPE_MISMATCH")
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("carries the selected Space file repository through eligibility and provider start", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(atlasWorkspaceResponse())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, spine: DELEGATE_SPINE, judgment: null }))
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) {
        const query = new URL(url, "http://localhost").searchParams
        const actor = query.get("actor")
        return Promise.resolve(Response.json(actor === "codex" ? {
          eligible: true,
          worldId: "server-world",
          worldRevision: 8,
          outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
          workOrderId: 1122,
          grantId: 45,
          actor: "codex",
          selectedPath: "src/atlas.ts",
          repositoryResourceKey: ATLAS_REPOSITORY.resourceKey,
          repositoryIdentity: ATLAS_REPOSITORY.identity,
          repositoryMountKey: ATLAS_REPOSITORY.mountKey,
          observedRevision: ATLAS_REPOSITORY.observedRevision,
        } : { eligible: false, reason: "EXACT_PATH_AUTHORITY_UNAVAILABLE" }))
      }
      if (url.startsWith("/api/loom/files?") && !init?.method) {
        const path = new URL(url, "http://localhost").searchParams.get("path")
        return Promise.resolve(path ? Response.json({
          kind: "file", path, content: "export const atlas = true\n", modifiedAt: "2026-09-02T10:00:00.000Z",
          repository: {
            key: ATLAS_REPOSITORY.resourceKey,
            identity: ATLAS_REPOSITORY.identity,
            mountKey: ATLAS_REPOSITORY.mountKey,
            observedRevision: ATLAS_REPOSITORY.observedRevision,
          },
        }) : Response.json({ kind: "directory", entries: [] }))
      }
      if (url.startsWith("/api/loom/diff?") && !init?.method) {
        return Promise.resolve(Response.json({ path: "src/atlas.ts", untracked: false, diff: "" }))
      }
      if (url === "/api/loom/codex" && init?.method === "POST") {
        return Promise.resolve(atlasSession("codex-atlas-shell", false))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    expect(screen.getByLabelText("Selected object actions").textContent).toContain("Selected file · Atlas · src/atlas.ts")

    await waitFor(() => {
      const eligibilityUrls = fetcher.mock.calls
        .filter(([, init]) => !init?.method)
        .map(([input]) => String(input))
        .filter((url) => url.startsWith("/api/loom/agent?"))
      expect(eligibilityUrls.length).toBeGreaterThanOrEqual(2)
      expect(eligibilityUrls.every((url) => new URL(url, "http://localhost").searchParams.get("repositoryKey") === "atlas")).toBe(true)
    })

    fireEvent.click(await screen.findByRole("button", { name: "Delegate" }))
    fireEvent.click(screen.getByRole("button", { name: "Codex" }))
    fireEvent.change(screen.getByRole("textbox", { name: "The Line" }), { target: { value: "Change the exact Atlas file." } })
    fireEvent.click(within(screen.getByRole("form", { name: "The Line" })).getByRole("button", { name: "Delegate" }))

    await screen.findByText("Atlas work completed.")
    const request = fetcher.mock.calls.find(([input, init]) => String(input) === "/api/loom/codex" && init?.method === "POST")
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ repositoryKey: "atlas" })
  })

  it("keeps Delegate unavailable when secondary-repository eligibility loses or mismatches its repository binding", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(atlasWorkspaceResponse())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, spine: DELEGATE_SPINE, judgment: null }))
      }
      if (url.startsWith("/api/loom/agent?") && !init?.method) {
        const actor = new URL(url, "http://localhost").searchParams.get("actor")
        const proof = {
          eligible: true,
          worldId: "server-world",
          worldRevision: 8,
          outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
          workOrderId: 1122,
          grantId: 45,
          selectedPath: "src/atlas.ts",
        }
        return Promise.resolve(Response.json(actor === "codex" ? {
          ...proof,
          actor: "codex",
        } : {
          ...proof,
          actor: "claude",
          repositoryResourceKey: ATLAS_REPOSITORY.resourceKey,
          repositoryIdentity: "bsvalues/terrafusion-dais",
          repositoryMountKey: ATLAS_REPOSITORY.mountKey,
          observedRevision: ATLAS_REPOSITORY.observedRevision,
        }))
      }
      if (url.startsWith("/api/loom/files?") && !init?.method) {
        const path = new URL(url, "http://localhost").searchParams.get("path")
        return Promise.resolve(path ? Response.json({
          kind: "file", path, content: "export const atlas = true\n", modifiedAt: "2026-09-02T10:00:00.000Z",
          repository: {
            key: ATLAS_REPOSITORY.resourceKey,
            identity: ATLAS_REPOSITORY.identity,
            mountKey: ATLAS_REPOSITORY.mountKey,
            observedRevision: ATLAS_REPOSITORY.observedRevision,
          },
        }) : Response.json({ kind: "directory", entries: [] }))
      }
      if (url.startsWith("/api/loom/diff?") && !init?.method) {
        return Promise.resolve(Response.json({ path: "src/atlas.ts", untracked: false, diff: "" }))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")

    await waitFor(() => expect(fetcher.mock.calls.filter(([input]) => (
      String(input).startsWith("/api/loom/agent?")
    )).length).toBeGreaterThanOrEqual(2))

    const unavailable = await waitFor(() => screen.getByRole("button", { name: "Delegate unavailable" }))
    expect((unavailable as HTMLButtonElement).disabled).toBe(true)
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/loom/codex")).toBe(false)
  })
})
