// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"

vi.mock("next/dynamic", () => ({
  default: () => function Editor(props: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Source content" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  },
}))

afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals() })

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
})

describe("Experience V2 multi-Space re-entry", () => {
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
      if (url === "/api/environment/space" && !init?.method) return { ok: true, status: 200, json: async () => envelope("a") }
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
