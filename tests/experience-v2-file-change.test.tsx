// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

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

function ndjson(...events: readonly Record<string, unknown>[]): Response {
  return new Response(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

function deferredNdjson(...events: readonly Record<string, unknown>[]) {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({
    start(stream) {
      controller = stream
      events.forEach((event) => stream.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)))
    },
  }), { headers: { "content-type": "application/x-ndjson" } })
  return {
    response,
    finish(event: Record<string, unknown>) {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      controller.close()
    },
  }
}

function initialSpace() {
  return {
    ...defaultSpace(),
    selectedPath: "src/app.ts",
    activeWindowId: "editor" as const,
    editor: {
      openFiles: ["src/app.ts"],
      panes: [{ id: "primary" as const, activePath: "src/app.ts", selection: { anchor: 0, head: 0 } }],
      activePaneId: "primary" as const,
    },
  }
}

function workspaceResponse() {
  return Response.json({
    worldId: "browser-world",
    space: spaceToServer(initialSpace()),
    spine: EMPTY_SPINE,
    project: { identity: "c:/repos/terrafusion", name: "TerraFusion" },
    storage: "browser",
    browserStorageKey: "file-change-test",
  })
}

function selectedFile(content: string) {
  return Response.json({
    kind: "file", path: "src/app.ts", content, modifiedAt: "2026-08-28T12:00:00.000Z",
  })
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

async function openChange(task = "Use the verified helper.") {
  await screen.findByLabelText("Source content")
  fireEvent.click(screen.getByRole("button", { name: "Change" }))
  expect(screen.getByText("Change · src/app.ts")).toBeTruthy()
  const input = screen.getByRole("textbox", { name: "Change instruction" })
  expect((input as HTMLInputElement).value).toBe("")
  fireEvent.change(input, { target: { value: task } })
  return input
}

describe("Experience V2 selected-file Change", () => {
  it("sends the selected file and owner instruction to the structured edit route, then reloads source and actual diff", async () => {
    let fileReads = 0
    let diffReads = 0
    const editStream = deferredNdjson(
      { type: "started", file: "src/app.ts", model: "local" },
      { type: "progress", text: "applying structured edit" },
    )
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return Promise.resolve(selectedFile(fileReads === 1 ? "export const before = true\n" : "export const after = true\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: fileReads > 1 ? "-before\n+after" : "-before\n+before" }))
      }
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(editStream.response)
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("applying structured edit")).toBeTruthy()
    editStream.finish({ type: "done", receipt: { success: true } })
    await waitFor(() => expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const after = true\n"))
    expect(screen.getByText("Change applied and verified.")).toBeTruthy()
    expect(await screen.findByText("+after", { exact: false })).toBeTruthy()
    const edit = fetcher.mock.calls.find(([input, init]) => String(input) === "/api/loom/edit" && init?.method === "POST")
    expect(JSON.parse(String(edit?.[1]?.body))).toEqual({ path: "src/app.ts", task: "Use the verified helper." })
    expect(fetcher.mock.calls.some(([input, init]) => String(input) === "/api/environment/line" && init?.method === "POST")).toBe(false)
    expect(diffReads).toBeGreaterThan(0)
  })

  it("exposes Stop change and aborts the in-flight structured edit", async () => {
    let requestSignal: AbortSignal | undefined
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") {
        requestSignal = init.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    expect(await screen.findByRole("button", { name: "Stop change" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop change" }))

    await waitFor(() => expect(requestSignal?.aborted).toBe(true))
    expect(screen.getByText("Change cancelled.")).toBeTruthy()
  })

  it("does not call a completed stream successful when its receipt refuses the edit", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "done", reason: "REFUSED", receipt: { success: false } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange("Do not apply this.")
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("Change was not verified.")).toBeTruthy()
    expect(screen.queryByText("Change applied and verified.")).toBeNull()
  })

  it("treats a malformed stream as a visible unsuccessful result", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(new Response("not json\n", { headers: { "content-type": "application/x-ndjson" } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("Change did not return a valid completion receipt.")).toBeTruthy()
  })

  it("refuses Change for an unsaved selected buffer without discarding the draft or calling the edit route", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "" }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    const source = await screen.findByLabelText("Source content")
    fireEvent.change(source, { target: { value: "export const unsaved = true\n" } })
    await openChange("Apply a change after saving.")
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("Save src/app.ts before starting Change.")).toBeTruthy()
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const unsaved = true\n")
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/loom/edit")).toBe(false)
  })

  it("keeps the verified reload when an older editor read arrives afterward", async () => {
    const originalRead = deferredResponse()
    let fileReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return fileReads === 1 ? originalRead.promise : Promise.resolve(selectedFile("export const verified = true\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(Response.json({ path: "src/app.ts", untracked: false, diff: "+verified" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Change" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Change instruction" }), { target: { value: "Use the verified source." } })
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    await waitFor(() => expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const verified = true\n"))
    originalRead.resolve(selectedFile("export const stale = true\n"))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const verified = true\n")
  })
})
