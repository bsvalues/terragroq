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
