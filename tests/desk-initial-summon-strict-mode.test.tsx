// @vitest-environment jsdom
import { StrictMode } from "react"

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { EditorSurface } from "@/components/workspace-shell/editor-surface"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"

vi.mock("next/dynamic", () => ({
  default: () => function TestSourceEditor(props: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Source content" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  },
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function deferredResponse() {
  let resolve!: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
  const promise = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("WorkspaceShell addressed arrival under React Strict Mode", () => {
  it("shares in-flight re-entry and summon requests so replay cannot strand the workspace", async () => {
    const reentry = deferredResponse()
    const summon = deferredResponse()
    const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return reentry.promise
      if (url === "/api/environment/line" && init?.method === "POST") return summon.promise
      if (url.startsWith("/api/loom/files")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ entries: [] }) })
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetchStub)

    render(
      <StrictMode>
        <WorkspaceShell initialSummon="work-orders" />
      </StrictMode>,
    )

    expect(fetchStub.mock.calls.filter(([input]) => String(input) === "/api/environment/space")).toHaveLength(1)
    reentry.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        worldId: "world-strict",
        space: spaceToServer(defaultSpace()),
      }),
    })

    await waitFor(() => {
      expect(fetchStub.mock.calls.filter(([input]) => String(input) === "/api/environment/line")).toHaveLength(1)
    })
    summon.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        worldId: "world-strict",
        say: "The governed work is here.",
        surfaces: [{
          kind: "work-orders",
          subject: "work orders",
          payload: [{
            ref: "WO-STRICT-1",
            title: "Strict Mode summon survives replay",
            status: "in_progress",
            agent: "aegis",
            phase: "validation",
          }],
        }],
      }),
    })

    await waitFor(() => expect(screen.getByText("WO-STRICT-1")).toBeTruthy())
    expect(screen.getAllByText("WO-STRICT-1")).toHaveLength(1)
    expect(screen.getByRole("region", { name: "Source window" })).toBeTruthy()
    expect(screen.queryByText("opening space")).toBeNull()
    expect(screen.queryByText("working…")).toBeNull()
  })
})

describe("EditorSurface in-flight save reconciliation", () => {
  it("keeps bytes typed after the submitted request dirty when that request completes", async () => {
    const saveResponse = deferredResponse()
    const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/loom/files?path=" && !init?.method) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) })
      }
      if (url.includes("src%2Freal.ts") && !init?.method) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            kind: "file", path: "src/real.ts", content: "disk before\n", modifiedAt: "2026-08-25T10:00:00.000Z",
          }),
        })
      }
      if (url === "/api/governance/workroom-authority" && init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, workOrder: "WO-W1" }) })
      }
      if (url === "/api/governance/work-context" && init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, receipt: "receipt-w1" }) })
      }
      if (url === "/api/loom/files" && init?.method === "PUT") return saveResponse.promise
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetchStub)
    const space = {
      ...defaultSpace(),
      selectedPath: "src/real.ts",
      editor: {
        openFiles: ["src/real.ts"],
        panes: [{ id: "primary" as const, activePath: "src/real.ts", selection: null }],
        activePaneId: "primary" as const,
      },
    }

    render(<EditorSurface space={space} onEditorChange={() => undefined} />)
    const editor = await screen.findByLabelText("Source content")
    fireEvent.change(editor, { target: { value: "content actually submitted\n" } })
    fireEvent.click(screen.getByRole("button", { name: "Save src/real.ts" }))
    await waitFor(() => expect(fetchStub.mock.calls.some(([input, init]) => (
      String(input) === "/api/loom/files" && init?.method === "PUT"
    ))).toBe(true))
    fireEvent.change(editor, { target: { value: "edit typed after request started\n" } })
    saveResponse.resolve({
      ok: true,
      status: 200,
      json: async () => ({ modifiedAt: "2026-08-25T10:01:00.000Z" }),
    })

    await waitFor(() => expect((screen.getByRole("button", { name: "Save src/real.ts" }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByLabelText("Unsaved")).toBeTruthy()
    const put = fetchStub.mock.calls.find(([input, init]) => String(input) === "/api/loom/files" && init?.method === "PUT")
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ content: "content actually submitted\n" })
  })
})
