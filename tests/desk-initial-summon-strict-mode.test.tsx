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
  window.localStorage.clear()
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
      if (url === "/api/environment/space/outcome" && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ status: "MISSING_AUTHORITY" }),
        })
      }
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
        project: { identity: "c:/repos/terrafusion_os_1.0", name: "terrafusion_os_1.0" },
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
    expect(fetchStub.mock.calls.some(([input]) => String(input) === "/api/environment/space/outcome")).toBe(false)
    expect(screen.getAllByText("WO-STRICT-1")).toHaveLength(1)
    expect(screen.getByRole("region", { name: "Source window" })).toBeTruthy()
    expect(screen.getByLabelText("Workspace project").textContent).toContain("terrafusion_os_1.0")
    expect(screen.getByLabelText("Workspace project").getAttribute("title")).toBe("c:/repos/terrafusion_os_1.0")
    expect(screen.queryByText("opening space")).toBeNull()
    expect(screen.queryByText("working…")).toBeNull()
  })

  it("reuses a restored HERMES window when the same surface is summoned again", async () => {
    const base = defaultSpace(1440, 900, "world-hermes", "TerraFusion OS Space")
    const persisted = spaceToServer({
      ...base,
      inspectorWindows: {
        "inspector-hermes": { x: 104, y: 72, width: 560, height: 480, z: 12, minimized: false },
      },
      inspectorSeeds: {
        "inspector-hermes": { kind: "hermes", subject: "HERMES appliance" },
      },
      activeWindowId: "inspector-hermes",
    })
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (url === "/api/environment/space" && method === "GET") {
        return Response.json({
          worldId: "world-hermes",
          space: persisted,
          project: { identity: "c:/tf-wt-rel-001", name: "TerraFusion OS" },
        })
      }
      if (url === "/api/environment/space" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { space: unknown }
        return Response.json({ worldId: "world-hermes", space: body.space, updatedAt: "2026-09-02T00:00:00.000Z" })
      }
      if (url === "/api/environment/line" && method === "POST") {
        return Response.json({
          worldId: "world-hermes",
          say: "HERMES is here.",
          surfaces: [{ kind: "hermes", subject: "HERMES appliance" }],
        })
      }
      if (url === "/api/environment/space/outcome" && method === "POST") {
        return Response.json({ error: "NO_ACTIVE_OUTCOME" }, { status: 409 })
      }
      if (url === "/api/environment/judgment" && method === "POST") {
        return Response.json({ error: "JUDGMENT_UNAVAILABLE" }, { status: 503 })
      }
      if (url === "/api/environment/hermes" && method === "GET") {
        return Response.json({ error: "HERMES_STATUS_UNAVAILABLE" }, { status: 503 })
      }
      if (url.startsWith("/api/loom/files") && method === "GET") {
        return Response.json({ kind: "directory", entries: [] })
      }
      throw new Error(`unexpected request: ${method} ${url}`)
    })
    vi.stubGlobal("fetch", fetchStub)

    render(<WorkspaceShell initialSummon="hermes" />)

    await waitFor(() => {
      expect(fetchStub.mock.calls.filter(([input]) => String(input) === "/api/environment/line").length).toBeGreaterThanOrEqual(2)
    })
    await waitFor(() => {
      expect(screen.getAllByRole("region", { name: "HERMES · Appliance window" })).toHaveLength(1)
    })
  })

  it("restores a project-bound browser Space when server persistence is unavailable", async () => {
    const project = { identity: "c:/repos/terrafusion", name: "TerraFusion" }
    const browserStorageKey = "opaque-owner-project-key"
    const restored = {
      ...defaultSpace(),
      selectedPath: "package.json",
      editor: {
        openFiles: ["README.md", "package.json"],
        panes: [
          { id: "primary" as const, activePath: "README.md", selection: null },
          { id: "secondary" as const, activePath: "package.json", selection: null },
        ],
        activePaneId: "secondary" as const,
      },
    }
    window.localStorage.setItem(`williamos:space:${browserStorageKey}`, JSON.stringify({
      worldId: "browser-local",
      space: spaceToServer(restored),
    }))
    const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            worldId: "browser-local",
            space: spaceToServer(defaultSpace()),
            project,
            storage: "browser",
            browserStorageKey,
          }),
        })
      }
      if (url === "/api/loom/files?path=&projectKey=williamos" && !init?.method) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }) })
      }
      if (url.startsWith("/api/loom/files?path=") && !init?.method) {
        const path = decodeURIComponent(url.split("=")[1])
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ kind: "file", path, content: `${path}\n`, modifiedAt: "2026-08-27T12:00:00.000Z" }),
        })
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetchStub)

    render(<WorkspaceShell />)

    await waitFor(() => expect(screen.getAllByLabelText("Source content")).toHaveLength(2))
    expect(screen.getByLabelText("Workspace project").textContent).toContain("TerraFusion")
    expect(await screen.findByText("space saved locally")).toBeTruthy()
    expect(screen.getAllByRole("tab", { name: "README.md" })).toHaveLength(2)
    expect(screen.getAllByRole("tab", { name: "package.json" })).toHaveLength(2)
    expect(fetchStub.mock.calls.some(([input]) => String(input) === "/api/environment/space/outcome")).toBe(false)
  })

  it("does not restore browser fallback state from another signed-in user namespace", async () => {
    const project = { identity: "c:/repos/terrafusion", name: "TerraFusion" }
    window.localStorage.setItem("williamos:space:opaque-other-user", JSON.stringify({
      worldId: "browser-local",
      space: spaceToServer({ ...defaultSpace(), editor: {
        openFiles: ["OTHER_USER.md"],
        panes: [{ id: "primary", activePath: "OTHER_USER.md", selection: null }],
        activePaneId: "primary",
      } }),
    }))
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve({
        ok: true, status: 200, json: async () => ({
          worldId: "browser-local", space: spaceToServer(defaultSpace()), project,
          storage: "browser", browserStorageKey: "opaque-current-user",
        }),
      })
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve({
        ok: true, status: 200, json: async () => ({ kind: "directory", entries: [] }),
      })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)

    await waitFor(() => expect(screen.getByText("space saved locally")).toBeTruthy())
    expect(screen.queryByRole("tab", { name: "OTHER_USER.md" })).toBeNull()
  })
})

describe("EditorSurface in-flight save reconciliation", () => {
  it("saves through the manual owner endpoint and keeps later typing dirty", async () => {
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

    render(<EditorSurface projectKey="williamos" space={space} onEditorChange={() => undefined} />)
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
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ content: "content actually submitted\n", projectKey: "williamos" })
  })
})
