// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor(props: { value: string }) {
    return <textarea aria-label="Source content" value={props.value} readOnly />
  },
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

describe("William judgment client freshness", () => {
  it("serializes a background flush behind the judgment save barrier and labels only acknowledged state as saved", async () => {
    const firstSave = deferredResponse()
    const secondSave = deferredResponse()
    const saves = [firstSave, secondSave]
    const saveBodies: Array<{ worldId: string; space: ReturnType<typeof spaceToServer> }> = []
    let judgmentRequests = 0
    const initial = defaultSpace()

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        worldId: "world-a",
        space: spaceToServer(initial),
        spine: EMPTY_SPINE,
        judgment: null,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" },
      }))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        saveBodies.push(JSON.parse(String(init.body)) as { worldId: string; space: ReturnType<typeof spaceToServer> })
        const response = saves[saveBodies.length - 1]
        if (!response) throw new Error("unexpected extra Space save")
        return response.promise
      }
      if (url === "/api/environment/judgment" && init?.method === "POST") {
        judgmentRequests += 1
        return Promise.resolve(Response.json({ judgment: {
          recommendation: "Continue with the saved Space.",
          rationale: "The exact current Space revision was acknowledged before reasoning.",
          basis: [{ key: "space", label: "Space", value: "world-a" }],
          confidence: 0.9,
          generatedAt: "2026-08-29T02:00:00.000Z",
          basisFingerprint: "b".repeat(64),
          provenance: { provider: "williamos-inference", model: "local-model" },
        } }))
      }
      if (url === "/api/loom/files?path=" && !init?.method) {
        return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await waitFor(() => expect(saveBodies).toHaveLength(1))
    expect(screen.getByText("saving space")).toBeTruthy()

    fireEvent.blur(window)
    await Promise.resolve()
    expect(saveBodies).toHaveLength(1)
    expect(judgmentRequests).toBe(0)

    firstSave.resolve(Response.json({ worldId: "world-a", space: saveBodies[0].space, spine: EMPTY_SPINE, judgment: null }))
    await waitFor(() => expect(saveBodies).toHaveLength(2))
    expect(screen.getByText("saving space")).toBeTruthy()
    expect(judgmentRequests).toBe(0)

    secondSave.resolve(Response.json({ worldId: "world-a", space: saveBodies[1].space, spine: EMPTY_SPINE, judgment: null }))
    await waitFor(() => expect(judgmentRequests).toBe(1))
    await screen.findByText("Continue with the saved Space.")
    expect(screen.queryByText("The current Space must be saved before grounded reasoning can begin.")).toBeNull()
    expect(screen.getByText("space saved")).toBeTruthy()
  })

  it("never labels a refused latest Space revision as saved", async () => {
    const save = deferredResponse()
    let saveRequests = 0
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        worldId: "world-a",
        space: spaceToServer(defaultSpace()),
        spine: EMPTY_SPINE,
        judgment: null,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" },
      }))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        saveRequests += 1
        return save.promise
      }
      if (url === "/api/loom/files?path=" && !init?.method) {
        return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await waitFor(() => expect(saveRequests).toBe(1))
    expect(screen.getByText("saving space")).toBeTruthy()

    save.resolve(Response.json({ error: "SPACE_WRITE_REFUSED" }, { status: 503 }))
    await screen.findByText("SPACE_WRITE_REFUSED")
    expect(screen.queryByText("space saved")).toBeNull()
  })

  it("discards an inference response when the selected Space context changes while it is running", async () => {
    const firstJudgment = deferredResponse()
    const never = new Promise<Response>(() => undefined)
    let judgmentRequests = 0
    const initial = {
      ...defaultSpace(),
      selectedPath: "src/old.ts",
      editor: {
        openFiles: ["src/old.ts", "src/current.ts"],
        panes: [{ id: "primary" as const, activePath: "src/old.ts", selection: null }],
        activePaneId: "primary" as const,
      },
    }
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(Response.json({
        worldId: "world-a",
        space: spaceToServer(initial),
        spine: EMPTY_SPINE,
        judgment: null,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" },
      }))
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Promise.resolve(Response.json({ worldId: body.worldId, space: body.space, spine: EMPTY_SPINE, judgment: null }))
      }
      if (url === "/api/environment/judgment" && init?.method === "POST") {
        judgmentRequests += 1
        return judgmentRequests === 1 ? firstJudgment.promise : never
      }
      if (url === "/api/loom/files?path=" && !init?.method) {
        return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      }
      if (url.startsWith("/api/loom/files?path=") && !init?.method) {
        const selected = decodeURIComponent(url.split("=")[1] ?? "")
        return Promise.resolve(Response.json({ kind: "file", path: selected, content: `${selected}\n`, modifiedAt: "2026-08-27T12:00:00.000Z" }))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await waitFor(() => expect(judgmentRequests).toBe(1))
    fireEvent.click((await screen.findAllByRole("tab", { name: "current.ts" }))[0])
    firstJudgment.resolve(Response.json({ judgment: {
      recommendation: "Keep working in the old file.",
      rationale: "The old file was selected when reasoning began.",
      basis: [{ key: "active-file", label: "Active file", value: "src/old.ts" }],
      confidence: 0.8,
      generatedAt: "2026-08-27T18:00:00.000Z",
      basisFingerprint: "a".repeat(64),
      provenance: { provider: "williamos-inference", model: "local-model" },
    } }))

    await waitFor(() => expect(judgmentRequests).toBe(2))
    expect(screen.queryByText("Keep working in the old file.")).toBeNull()
  })
})
