// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

const REVISION = "a".repeat(40)

function repository(projectKey: "terrafusion" | "williamos") {
  const key = projectKey === "williamos" ? "williamos" : "os-1"
  return {
    key,
    identity: projectKey === "williamos" ? "bsvalues/terragroq" : "bsvalues/terrafusion_os_1.0",
    label: projectKey === "williamos" ? "WilliamOS" : "OS 1.0",
    role: "integrated-runtime" as const,
    suite: null,
    previewSource: true,
    defaultRepository: true,
    mount: { key: projectKey === "williamos" ? "williamos:williamos:configured" : "terrafusion:os-1:configured", configured: true, verified: true, branch: "main", revision: REVISION, refusal: null },
  }
}

function fileRef(projectKey: "terrafusion" | "williamos" = "terrafusion", path = "src/app.ts") {
  const repo = repository(projectKey)
  return { projectIdentity: projectKey === "williamos" ? "c:/repos/williamos" : "c:/repos/terrafusion", repositoryResourceKey: repo.key, repositoryMountKey: repo.mount.key, worktreeKey: null, observedRevision: REVISION, path }
}

function project(projectKey: "terrafusion" | "williamos" = "terrafusion") {
  return { identity: projectKey === "williamos" ? "c:/repos/williamos" : "c:/repos/terrafusion", name: projectKey === "williamos" ? "WilliamOS" : "TerraFusion", repositories: [repository(projectKey)] }
}

function diffResponse(payload: Record<string, unknown>, projectKey: "terrafusion" | "williamos" = "terrafusion") {
  const repo = repository(projectKey)
  return Response.json({
    ...payload,
    repository: { key: repo.key, identity: repo.identity, mountKey: repo.mount.key, observedRevision: REVISION },
  })
}

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
  const exact = events.map((event) => event.type === "started" && event.fileRef === undefined ? { ...event, fileRef: fileRef() } : event)
  return new Response(`${exact.map((event) => JSON.stringify(event)).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  })
}

function deferredNdjson(...events: readonly Record<string, unknown>[]) {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({
    start(stream) {
      controller = stream
      events.forEach((event) => stream.enqueue(encoder.encode(`${JSON.stringify(event.type === "started" && event.fileRef === undefined ? { ...event, fileRef: fileRef() } : event)}\n`)))
    },
  }), { headers: { "content-type": "application/x-ndjson" } })
  return {
    response,
    send(event: Record<string, unknown>) {
      controller.enqueue(encoder.encode(`${JSON.stringify(event.type === "started" && event.fileRef === undefined ? { ...event, fileRef: fileRef() } : event)}\n`))
    },
    finish(event: Record<string, unknown>) {
      controller.enqueue(encoder.encode(`${JSON.stringify(event.type === "started" && event.fileRef === undefined ? { ...event, fileRef: fileRef() } : event)}\n`))
      controller.close()
    },
    close() {
      controller.close()
    },
  }
}

function initialSpace(projectKey: "terrafusion" | "williamos" = "terrafusion") {
  const ref = fileRef(projectKey)
  return {
    ...defaultSpace(),
    selectedPath: "src/app.ts",
    selectedFileRef: ref,
    activeWindowId: "editor" as const,
    editor: {
      openFiles: ["src/app.ts"],
      openFileRefs: [ref],
      panes: [{ id: "primary" as const, activePath: "src/app.ts", activeFileRef: ref, selection: { anchor: 0, head: 0 } }],
      activePaneId: "primary" as const,
    },
  }
}

function workspaceResponse() {
  return Response.json({
    worldId: "browser-world",
    space: spaceToServer(initialSpace()),
    spine: EMPTY_SPINE,
    project: project(),
    storage: "browser",
    browserStorageKey: "file-change-test",
  })
}

function serverWorkspaceResponse(
  worldId = "world-a",
  space = initialSpace(),
  spaces?: readonly Record<string, unknown>[],
) {
  return Response.json({
    worldId,
    name: space.name,
    space: spaceToServer(space),
    spine: EMPTY_SPINE,
    project: project(),
    storage: "server",
    spaces,
    multiSpaceAvailable: Boolean(spaces && spaces.length > 1),
  })
}

function successfulSpaceSave(init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { worldId: string; space: Record<string, unknown> }
  return Response.json({
    worldId: body.worldId,
    space: body.space,
    updatedAt: "2026-08-30T06:00:00.000Z",
  })
}

function selectedFile(content: string, path = "src/app.ts", projectKey: "terrafusion" | "williamos" = "terrafusion") {
  const repo = repository(projectKey)
  return Response.json({
    kind: "file", path, content, modifiedAt: "2026-08-28T12:00:00.000Z",
    repository: { key: repo.key, identity: repo.identity, mountKey: repo.mount.key, observedRevision: REVISION },
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
  it("binds a WilliamOS selected-file Change request to the active project", async () => {
    const editBodies: Record<string, unknown>[] = []
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space?projectKey=williamos" && !init?.method) {
        return Promise.resolve(Response.json({
          worldId: "world-a",
          name: "WilliamOS",
          space: spaceToServer(initialSpace("williamos")),
          spine: EMPTY_SPINE,
          project: project("williamos"),
          storage: "server",
        }))
      }
      if (url === "/api/environment/space" && init?.method === "PUT") return Promise.resolve(successfulSpaceSave(init))
      if (url === "/api/loom/files?path=&projectKey=williamos&repositoryKey=williamos" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts&projectKey=williamos&repositoryKey=williamos" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n", "src/app.ts", "williamos"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts&projectKey=williamos&repositoryKey=williamos" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }, "williamos"))
      if (url === "/api/loom/edit" && init?.method === "POST") {
        editBodies.push(JSON.parse(String(init.body)))
        return Promise.resolve(ndjson(
          { type: "started", file: "src/app.ts", fileRef: fileRef("williamos") },
          { type: "done", receipt: { success: false } },
        ))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell projectKey="williamos" />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    await waitFor(() => expect(editBodies).toHaveLength(1))
    expect(editBodies[0]).toMatchObject({
      worldId: "world-a",
      projectKey: "williamos",
      path: "src/app.ts",
      task: "Use the verified helper.",
    })
  })

  it("runs Improve for the exact live current patch through structured edit and refreshes its outcome", async () => {
    let diffReads = 0
    const editStream = deferredNdjson({ type: "started", file: "src/app.ts" })
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(serverWorkspaceResponse())
      if (url === "/api/environment/space" && init?.method === "PUT") return Promise.resolve(successfulSpaceSave(init))
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile(diffReads > 1 ? "export const improved = true\n" : "export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        return Promise.resolve(diffResponse({
          path: "src/app.ts",
          state: "modified",
          fingerprint: diffReads === 1 ? "exact-live-diff" : "refreshed-diff",
          untracked: false,
          diff: diffReads === 1 ? "-before\n+current" : "-current\n+improved",
          status: " M src/app.ts",
        }))
      }
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(editStream.response)
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: /(?:Focus|Restore) Changes/ }))
    const improve = await screen.findByRole("button", { name: "Improve" })
    await waitFor(() => expect((improve as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(improve)

    expect(screen.getByText("Improve current change · src/app.ts")).toBeTruthy()
    const instruction = screen.getByRole("textbox", { name: "Improve instruction" })
    fireEvent.change(instruction, { target: { value: "Make this patch clearer." } })
    fireEvent.click(screen.getByRole("button", { name: "Start improvement" }))

    expect(await screen.findByText("Working on src/app.ts.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Stop improvement" })).toBeTruthy()
    editStream.send({ type: "progress", text: "Applying bounded structured edit." })
    expect(await screen.findByText("Applying bounded structured edit.")).toBeTruthy()
    editStream.finish({ type: "done", receipt: { success: true } })
    expect(await screen.findByText("Change applied; source and diff refreshed.")).toBeTruthy()
    expect(await screen.findByText("+improved", { exact: false })).toBeTruthy()
    const edit = fetcher.mock.calls.find(([request, options]) => String(request) === "/api/loom/edit" && options?.method === "POST")
    expect(JSON.parse(String(edit?.[1]?.body))).toEqual({
      path: "src/app.ts",
      repositoryKey: "os-1",
      fileRef: fileRef(),
      task: "Make this patch clearer.",
      intent: "improve-diff",
      worldId: "world-a",
      expectedDiffFingerprint: "exact-live-diff",
    })
    expect(fetcher.mock.calls.some(([request]) => String(request) === "/api/environment/line")).toBe(false)
  })

  it("keeps Improve unavailable until Changes has an exact live modified identity", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(serverWorkspaceResponse())
      if (url === "/api/environment/space" && init?.method === "PUT") return Promise.resolve(successfulSpaceSave(init))
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({
        path: "src/app.ts", state: "clean", fingerprint: "clean", untracked: false, diff: "", status: "",
      }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: /(?:Focus|Restore) Changes/ }))

    const improve = await screen.findByRole("button", { name: "Improve" })
    await waitFor(() => expect(improve.getAttribute("title")).toContain("live modified patch"), { timeout: 2_000 })
    expect((improve as HTMLButtonElement).disabled).toBe(true)
  })

  it("keeps an exact live modified patch unavailable in a browser-only Space", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({
        path: "src/app.ts", state: "modified", fingerprint: "browser-diff", untracked: false,
        diff: "-before\n+browser", status: " M src/app.ts",
      }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: /(?:Focus|Restore) Changes/ }))

    const improve = await screen.findByRole("button", { name: "Improve" })
    await waitFor(() => expect(improve.getAttribute("title")).toContain("server-bound"))
    expect((improve as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const before = true\n")
  })

  it("keeps Improve unavailable while the server-bound Space save is pending or failed", async () => {
    let saveMode: "pending" | "failed" = "pending"
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(serverWorkspaceResponse())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        return saveMode === "pending"
          ? new Promise<Response>(() => {})
          : Promise.resolve(Response.json({ error: "SPACE_SAVE_REFUSED" }, { status: 503 }))
      }
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({
        path: "src/app.ts", state: "modified", fingerprint: "server-diff", untracked: false,
        diff: "-before\n+server", status: " M src/app.ts",
      }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    const view = render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: /(?:Focus|Restore) Changes/ }))
    const pendingImprove = await screen.findByRole("button", { name: "Improve" })
    await waitFor(() => expect(pendingImprove.getAttribute("title")).toContain("durably saved"))
    expect((pendingImprove as HTMLButtonElement).disabled).toBe(true)

    view.unmount()
    saveMode = "failed"
    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: /(?:Focus|Restore) Changes/ }))
    const failedImprove = await screen.findByRole("button", { name: "Improve" })
    await waitFor(() => expect(failedImprove.getAttribute("title")).toContain("persistence is refusing"), { timeout: 2_000 })
    expect((failedImprove as HTMLButtonElement).disabled).toBe(true)
  })

  it("surfaces the typed server stale refusal and materializes no successful outcome", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(serverWorkspaceResponse())
      if (url === "/api/environment/space" && init?.method === "PUT") return Promise.resolve(successfulSpaceSave(init))
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({
        path: "src/app.ts", state: "modified", fingerprint: "captured-diff", untracked: false,
        diff: "-before\n+current", status: " M src/app.ts",
      }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(Response.json({ error: "DIFF_CONTEXT_STALE" }, { status: 409 }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: /(?:Focus|Restore) Changes/ }))
    const improve = await screen.findByRole("button", { name: "Improve" })
    await waitFor(() => expect((improve as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(improve)
    fireEvent.change(screen.getByRole("textbox", { name: "Improve instruction" }), { target: { value: "Improve this." } })
    fireEvent.click(screen.getByRole("button", { name: "Start improvement" }))

    expect(await screen.findByText("Change failed: DIFF_CONTEXT_STALE")).toBeTruthy()
    expect(screen.queryByText("Change applied; source and diff refreshed.")).toBeNull()
  })

  it("refuses a captured Improve when the live patch identity changes before submit", async () => {
    let diffReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(serverWorkspaceResponse())
      if (url === "/api/environment/space" && init?.method === "PUT") return Promise.resolve(successfulSpaceSave(init))
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        return Promise.resolve(diffResponse({
          path: "src/app.ts", state: "modified", fingerprint: `fingerprint-${diffReads}`,
          untracked: false, diff: `-before\n+version-${diffReads}`, status: " M src/app.ts",
        }))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: /(?:Focus|Restore) Changes/ }))
    const improve = await screen.findByRole("button", { name: "Improve" })
    await waitFor(() => expect((improve as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(improve)
    fireEvent.change(screen.getByRole("textbox", { name: "Improve instruction" }), { target: { value: "Improve this." } })
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText("+version-2", { exact: false })
    fireEvent.click(screen.getByRole("button", { name: "Start improvement" }))

    expect(await screen.findByText("The live change changed. Reopen Improve from the current Changes surface.")).toBeTruthy()
    expect(fetcher.mock.calls.some(([request]) => String(request) === "/api/loom/edit")).toBe(false)
  })

  it("drops a deferred Improve terminal from an old Space without refreshing or leaking busy state", async () => {
    const alpha = { ...initialSpace(), id: "world-a", name: "Alpha" }
    const beta = {
      ...initialSpace(), id: "world-b", name: "Beta", selectedPath: "src/beta.ts",
      editor: {
        openFiles: ["src/beta.ts"],
        panes: [{ id: "primary" as const, activePath: "src/beta.ts", selection: { anchor: 0, head: 0 } }],
        activePaneId: "primary" as const,
      },
    }
    const summaries = [
      { worldId: "world-a", name: "Alpha", space: spaceToServer(alpha), updatedAt: "2026-08-30T05:00:00.000Z" },
      { worldId: "world-b", name: "Beta", space: spaceToServer(beta), updatedAt: "2026-08-30T04:00:00.000Z" },
    ]
    const targetSpace = deferredResponse()
    const oldEdit = deferredResponse()
    let alphaFileReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(serverWorkspaceResponse("world-a", alpha, summaries))
      if (url === "/api/environment/space?worldId=world-b" && !init?.method) return targetSpace.promise
      if (url === "/api/environment/space?worldId=world-a" && !init?.method) return new Promise<Response>(() => {})
      if (url === "/api/environment/space" && init?.method === "PUT") return Promise.resolve(successfulSpaceSave(init))
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        alphaFileReads += 1
        return Promise.resolve(selectedFile("export const alpha = true\n"))
      }
      if (url === "/api/loom/files?path=src%2Fbeta.ts" && !init?.method) return Promise.resolve(selectedFile("export const beta = true\n", "src/beta.ts"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({
        path: "src/app.ts", state: "modified", fingerprint: "alpha-live", untracked: false,
        diff: "-before\n+alpha", status: " M src/app.ts",
      }))
      if (url === "/api/loom/diff?path=src%2Fbeta.ts" && !init?.method) return Promise.resolve(diffResponse({
        path: "src/beta.ts", state: "clean", fingerprint: "beta-clean", untracked: false, diff: "", status: "",
      }))
      if (url === "/api/loom/edit" && init?.method === "POST") return oldEdit.promise
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await screen.findByLabelText("Source content")
    fireEvent.click(screen.getByRole("button", { name: "Open Mission Control" }))
    fireEvent.click(await screen.findByRole("button", { name: "Enter Beta" }))
    await waitFor(() => expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/environment/space?worldId=world-b")).toBe(true))

    fireEvent.click(screen.getByRole("button", { name: /(?:Focus|Restore) Changes/ }))
    const improve = await screen.findByRole("button", { name: "Improve" })
    await waitFor(() => expect((improve as HTMLButtonElement).disabled).toBe(false), { timeout: 2_000 })
    fireEvent.click(improve)
    fireEvent.change(screen.getByRole("textbox", { name: "Improve instruction" }), { target: { value: "Improve Alpha only." } })
    fireEvent.click(screen.getByRole("button", { name: "Start improvement" }))
    await waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => String(input) === "/api/loom/edit" && options?.method === "POST")).toBe(true))

    targetSpace.resolve(serverWorkspaceResponse("world-b", beta, summaries))
    await waitFor(() => expect(screen.getByRole("button", { name: "Enter Beta, current Space" })).toBeTruthy())
    oldEdit.resolve(ndjson(
      { type: "started", file: "src/app.ts" },
      { type: "done", receipt: { success: true } },
    ))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(alphaFileReads).toBe(1)
    expect(screen.queryByText("Change applied; source and diff refreshed.")).toBeNull()
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const beta = true\n")
    fireEvent.click(screen.getByRole("button", { name: "Enter Alpha" }))
    await waitFor(() => expect(fetcher.mock.calls.some(([input]) => String(input) === "/api/environment/space?worldId=world-a")).toBe(true))
    expect(screen.queryByText("Finish or stop active work before switching Spaces.")).toBeNull()
  })
  it("settles a successful Change when initially minimized Changes mounts under StrictMode", async () => {
    let fileReads = 0
    let diffReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return Promise.resolve(selectedFile(fileReads === 1 ? "export const before = true\n" : "export const after = true\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        if (diffReads < 3) {
          return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
        }
        return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "-before\n+after" }))
      }
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<StrictMode><WorkspaceShell /></StrictMode>)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("Change applied; source and diff refreshed.")).toBeTruthy()
    expect(screen.getByText("+after", { exact: false })).toBeTruthy()
    expect(diffReads).toBe(4)
  })

  it("keeps a dirty Source draft and settles truthfully when minimization is attempted during Change", async () => {
    const editStream = deferredNdjson({ type: "started", file: "src/app.ts" })
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "-before\n+after" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(editStream.response)
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    expect(await screen.findByText("Working on src/app.ts.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Source content"), { target: { value: "export const draft = true\n" } })
    const minimize = screen.getByRole("button", { name: "Minimize Source" }) as HTMLButtonElement
    expect(minimize.disabled).toBe(true)
    fireEvent.click(minimize)
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const draft = true\n")
    editStream.finish({ type: "done", receipt: { success: true } })

    expect(await screen.findByText("Change was verified, but src/app.ts has unsaved editor changes; source was not refreshed.")).toBeTruthy()
    expect(screen.getByText("+after", { exact: false })).toBeTruthy()
    expect(screen.queryByText("Refreshing source and diff…")).toBeNull()
    expect(screen.queryByText("Change applied; source and diff refreshed.")).toBeNull()
    expect(minimize.disabled).toBe(true)
    fireEvent.click(minimize)
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const draft = true\n")
  })

  it("keeps a dirty Source draft visible when minimization is attempted after dirty-conflict settlement", async () => {
    const editStream = deferredNdjson({ type: "started", file: "src/app.ts" })
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "+after" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(editStream.response)
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    fireEvent.change(screen.getByLabelText("Source content"), { target: { value: "export const draft = true\n" } })
    editStream.finish({ type: "done", receipt: { success: true } })
    expect(await screen.findByText("Change was verified, but src/app.ts has unsaved editor changes; source was not refreshed.")).toBeTruthy()

    const minimize = screen.getByRole("button", { name: "Minimize Source" }) as HTMLButtonElement
    expect(minimize.disabled).toBe(true)
    fireEvent.click(minimize)
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const draft = true\n")
  })

  it("settles Change when minimization is attempted on Changes during joined refresh", async () => {
    let fileReads = 0
    let resolveDiff!: (response: Response) => void
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return Promise.resolve(selectedFile(fileReads === 1 ? "export const before = true\n" : "export const after = true\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        return new Promise<Response>((resolve, reject) => {
          resolveDiff = resolve
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        })
      }
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    const minimize = await screen.findByRole("button", { name: "Minimize Changes" }) as HTMLButtonElement
    expect(minimize.disabled).toBe(true)
    expect(minimize.title).toBe("Changes cannot be minimized while Change is active")
    fireEvent.click(minimize)
    resolveDiff(diffResponse({ path: "src/app.ts", untracked: false, diff: "-before\n+after" }))

    expect(await screen.findByText("Change applied; source and diff refreshed.")).toBeTruthy()
    expect(screen.getByText("+after", { exact: false })).toBeTruthy()
  })

  it("preserves newer typing when a delayed save acknowledgement races a delayed verified reload", async () => {
    const saved = deferredResponse()
    const reload = deferredResponse()
    let fileReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return fileReads === 1 ? Promise.resolve(selectedFile("export const before = true\n")) : reload.promise
      }
      if (url === "/api/loom/files" && init?.method === "PUT") return saved.promise
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "+after" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    await waitFor(() => expect(fileReads).toBe(2))
    fireEvent.change(screen.getByLabelText("Source content"), { target: { value: "export const saved = true\n" } })
    const save = screen.getByRole("button", { name: "Save src/app.ts" }) as HTMLButtonElement
    fireEvent.click(save)
    fireEvent.change(screen.getByLabelText("Source content"), { target: { value: "export const newer = true\n" } })
    saved.resolve(Response.json({ modifiedAt: "2026-08-28T12:01:00.000Z" }))
    await waitFor(() => expect(save.disabled).toBe(false))
    reload.resolve(selectedFile("export const fromDisk = true\n"))

    expect(await screen.findByText("Change was verified, but src/app.ts has unsaved editor changes; source was not refreshed.")).toBeTruthy()
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const newer = true\n")
  })

  it("sends the selected file and owner instruction to the structured edit route, then reloads source and actual diff", async () => {
    let fileReads = 0
    let diffReads = 0
    const editStream = deferredNdjson(
      { type: "started", file: "src/app.ts", model: "local" },
      { type: "progress", text: "applying structured edit" },
    )
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return Promise.resolve(selectedFile(fileReads === 1 ? "export const before = true\n" : "export const after = true\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: fileReads > 1 ? "-before\n+after" : "-before\n+before" }))
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
    expect(screen.getByText("Change applied; source and diff refreshed.")).toBeTruthy()
    expect(await screen.findByText("+after", { exact: false })).toBeTruthy()
    const edit = fetcher.mock.calls.find(([input, init]) => String(input) === "/api/loom/edit" && init?.method === "POST")
    expect(JSON.parse(String(edit?.[1]?.body))).toEqual({ worldId: "browser-world", repositoryKey: "os-1", fileRef: fileRef(), path: "src/app.ts", task: "Use the verified helper." })
    expect(fetcher.mock.calls.some(([input, init]) => String(input) === "/api/environment/line" && init?.method === "POST")).toBe(false)
    expect(diffReads).toBeGreaterThan(0)
    const minimize = screen.getByRole("button", { name: "Minimize Source" }) as HTMLButtonElement
    expect(minimize.disabled).toBe(false)
    fireEvent.click(minimize)
    expect(screen.queryByLabelText("Source content")).toBeNull()
  })

  it("exposes Stop change and aborts the in-flight structured edit", async () => {
    let requestSignal: AbortSignal | undefined
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
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
    expect(screen.getByText("Stop requested. Change outcome is unknown.")).toBeTruthy()
  })

  it("does not call a completed stream successful when its receipt refuses the edit", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", reason: "REFUSED", receipt: { success: false } }))
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
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
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
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
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
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return fileReads === 1 ? originalRead.promise : Promise.resolve(selectedFile("export const verified = true\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "+verified" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
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

  it("keeps the Change surface bound to its selected file while the edit is active", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    const form = await screen.findByRole("form", { name: "Change" })
    fireEvent.pointerDown(form.parentElement!)

    expect(screen.getByRole("form", { name: "Change" })).toBeTruthy()
    expect(screen.getByText("Change · src/app.ts")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Stop change" })).toBeTruthy()
  })

  it("keeps the active Change form and operation path visible when Escape is pressed", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    expect(await screen.findByRole("button", { name: "Stop change" })).toBeTruthy()
    fireEvent.keyDown(window, { key: "Escape" })

    expect(screen.getByRole("form", { name: "Change" })).toBeTruthy()
    expect(screen.getByText("Change · src/app.ts")).toBeTruthy()
  })

  it("binds each newly opened Change form to its displayed selected file", async () => {
    const posted: Array<{ path: string; task: string }> = []
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [
        { name: "app.ts", path: "src/app.ts", directory: false },
        { name: "other.ts", path: "src/other.ts", directory: false },
      ] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const app = true\\n"))
      if (url === "/api/loom/files?path=src%2Fother.ts" && !init?.method) return Promise.resolve(selectedFile("export const other = true\\n", "src/other.ts"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/diff?path=src%2Fother.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/other.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { path: string; task: string }
        posted.push(body)
        return Promise.resolve(ndjson({ type: "started", file: body.path, fileRef: fileRef("terrafusion", body.path) }, { type: "done", receipt: { success: false } }))
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange("Change the first file.")
    expect(screen.getByText("Change · src/app.ts")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    await screen.findByText("Change was not verified.")
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))

    const other = await screen.findByRole("button", { name: "other.ts" })
    fireEvent.pointerDown(other)
    fireEvent.click(other)
    await waitFor(() => expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const other = true\\n"))
    fireEvent.click(screen.getByRole("button", { name: "Change" }))

    expect(screen.getByText("Change · src/other.ts")).toBeTruthy()
    const instruction = screen.getByRole("textbox", { name: "Change instruction" })
    expect((instruction as HTMLInputElement).value).toBe("")
    fireEvent.change(instruction, { target: { value: "Change the second file." } })
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    await screen.findByText("Change was not verified.")

    expect(posted).toEqual([
      { worldId: "browser-world", repositoryKey: "os-1", fileRef: fileRef(), path: "src/app.ts", task: "Change the first file." },
      { worldId: "browser-world", repositoryKey: "os-1", fileRef: fileRef("terrafusion", "src/other.ts"), path: "src/other.ts", task: "Change the second file." },
    ])
  })

  it("aborts a done-before-EOF stream and reports the Change outcome unknown", async () => {
    let requestSignal: AbortSignal | undefined
    const editStream = deferredNdjson(
      { type: "started", file: "src/app.ts", model: "local" },
      { type: "done", receipt: { success: true } },
    )
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const refreshed = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "+refreshed" }))
      if (url === "/api/loom/edit" && init?.method === "POST") {
        requestSignal = init.signal ?? undefined
        return Promise.resolve(editStream.response)
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    expect(await screen.findByText("Governed receipt received; waiting for stream completion.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop change" }))

    await waitFor(() => expect(requestSignal?.aborted).toBe(true))
    expect(await screen.findByText("Stop requested. Change outcome is unknown.")).toBeTruthy()
  })

  it("freezes the submitted Change instruction while its stream is active", async () => {
    const editStream = deferredNdjson({ type: "started", file: "src/app.ts" })
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(editStream.response)
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    const instruction = await openChange("Keep the submitted task visible.")
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("Working on src/app.ts.")).toBeTruthy()
    expect((instruction as HTMLInputElement).disabled).toBe(true)
    expect((instruction as HTMLInputElement).value).toBe("Keep the submitted task visible.")
  })

  it("does not overwrite a draft created while Change was active", async () => {
    const editStream = deferredNdjson({ type: "started", file: "src/app.ts", model: "local" })
    let fileReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return Promise.resolve(selectedFile(fileReads === 1 ? "export const before = true\n" : "export const changed = true\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "+changed" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(editStream.response)
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    fireEvent.change(screen.getByLabelText("Source content"), { target: { value: "export const draft = true\n" } })
    editStream.finish({ type: "done", receipt: { success: true } })

    expect(await screen.findByText("Change was verified, but src/app.ts has unsaved editor changes; source was not refreshed.")).toBeTruthy()
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const draft = true\n")
  })

  it("preserves a draft typed while the verified source reload is still in flight", async () => {
    const reloadRead = deferredResponse()
    let fileReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return fileReads === 1 ? Promise.resolve(selectedFile("export const before = true\n")) : reloadRead.promise
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "+changed" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    await waitFor(() => expect(fileReads).toBe(2))
    fireEvent.change(screen.getByLabelText("Source content"), { target: { value: "export const lateDraft = true\n" } })
    reloadRead.resolve(selectedFile("export const fromDisk = true\n"))

    expect(await screen.findByText("Change was verified, but src/app.ts has unsaved editor changes; source was not refreshed.")).toBeTruthy()
    expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const lateDraft = true\n")
  })

  it("settles Change truthfully when manual Refresh replaces the governed diff refresh", async () => {
    let fileReads = 0
    let diffReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return Promise.resolve(selectedFile(fileReads === 1 ? "export const before = true\n" : "export const after = true\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        if (diffReads === 1) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "-before\n+before" }))
        if (diffReads === 2) return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
        return Promise.resolve(Response.json({ error: "MANUAL_REFUSED" }, { status: 500 }))
      }
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    await waitFor(() => expect(diffReads).toBe(2))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))

    expect(await screen.findByText("Change was verified, but source or diff refresh failed.")).toBeTruthy()
    expect(screen.queryByText("Refreshing source and diff…")).toBeNull()
  })

  it("keeps the settled governed diff instead of refetching on same-key cleanup", async () => {
    let fileReads = 0
    let diffReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return Promise.resolve(selectedFile(fileReads === 1 ? "export const before = true\\n" : "export const after = true\\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) {
        diffReads += 1
        if (diffReads < 3) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: diffReads === 1 ? "-before\\n+before" : "-before\\n+proven" }))
        return Promise.resolve(Response.json({ error: "UNJOINED_REFRESH" }, { status: 500 }))
      }
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("Change applied; source and diff refreshed.")).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText("+proven", { exact: false })).toBeTruthy()
    expect(screen.queryByText(/Unable to refresh current change/)).toBeNull()
  })

  it("does not publish an initial file-read failure after its verified reload wins", async () => {
    const originalRead = deferredResponse()
    let fileReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return fileReads === 1 ? originalRead.promise : Promise.resolve(selectedFile("export const verified = true\\n"))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "+verified" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    fireEvent.click(await screen.findByRole("button", { name: "Change" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Change instruction" }), { target: { value: "Use the verified source." } })
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))
    await waitFor(() => expect((screen.getByLabelText("Source content") as HTMLTextAreaElement).value).toBe("export const verified = true\\n"))

    originalRead.resolve(Response.json({ error: "INITIAL_READ_REFUSED" }, { status: 500 }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("distinguishes a verified mutation from a source or diff refresh failure", async () => {
    let fileReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) {
        fileReads += 1
        return Promise.resolve(fileReads === 1 ? selectedFile("export const before = true\n") : Response.json({ error: "READ_REFUSED" }, { status: 500 }))
      }
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "+changed" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson({ type: "started", file: "src/app.ts" }, { type: "done", receipt: { success: true } }))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("Change was verified, but source or diff refresh failed.")).toBeTruthy()
    expect(screen.queryByText("Change applied; source and diff refreshed.")).toBeNull()
  })

  it("rejects a success receipt when a post-terminal protocol event follows it", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace("&repositoryKey=os-1", "")
      if (url === "/api/environment/space" && !init?.method) return Promise.resolve(workspaceResponse())
      if (url === "/api/loom/files?path=" && !init?.method) return Promise.resolve(Response.json({ kind: "directory", entries: [] }))
      if (url === "/api/loom/files?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(selectedFile("export const before = true\n"))
      if (url === "/api/loom/diff?path=src%2Fapp.ts" && !init?.method) return Promise.resolve(diffResponse({ path: "src/app.ts", untracked: false, diff: "" }))
      if (url === "/api/loom/edit" && init?.method === "POST") return Promise.resolve(ndjson(
        { type: "started", file: "src/app.ts" },
        { type: "done", receipt: { success: true } },
        { type: "progress", text: "too late" },
      ))
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<WorkspaceShell />)
    await openChange()
    fireEvent.click(screen.getByRole("button", { name: "Start change" }))

    expect(await screen.findByText("Change did not return a valid completion receipt.")).toBeTruthy()
    expect(screen.queryByText("Change applied; source and diff refreshed.")).toBeNull()
  })
})
