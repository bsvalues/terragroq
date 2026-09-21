// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/workspace-shell/hello-application-assistant", () => ({
  ApplicationAssistant: ({ project }: { project: { name: string } }) => <div>Assistant for {project.name}</div>,
  HelloApplicationAssistant: ({ project }: { project: { name: string } }) => <div>Assistant for {project.name}</div>,
}))

import { DeveloperPreviewSurface } from "@/components/workspace-shell/developer-preview-surface"
import { projectHelloApplicationRuntime } from "@/lib/hello-application/runtime-projection"
import { applicationWorkspaceProject, HELLO_APPLICATION_WORKSPACE_PROJECT } from "@/lib/projects/workspace-project-key"

const project = applicationWorkspaceProject("focus-board", "Focus Board")
const truth = { runtimeBuild: { sha: "a".repeat(40), builtAt: null }, activeProjectHead: "b".repeat(40) }
const record = (observed: "stopped" | "running") => ({
  schemaVersion: 1,
  applicationId: "focus-board",
  desired: observed,
  observed,
  policyDigest: "c".repeat(64),
  recipeDigest: "d".repeat(64),
  containerName: "williamos-application-focus-board",
  active: observed === "running" ? {
    generation: "e".repeat(64), sourceHead: "b".repeat(40), manifestDigest: "f".repeat(64),
    sourceDigest: "1".repeat(64), artifactSha256: "2".repeat(64), imageId: `sha256:${"3".repeat(64)}`,
    staticImageId: `sha256:${"4".repeat(64)}`, containerId: "5".repeat(64), validated: true,
  } : null,
  retiring: null,
  updatedAt: "2026-09-21T00:00:00.000Z",
  error: null,
})

const legacyRuntime = (state: "stopped" | "running") => ({
  runtime: projectHelloApplicationRuntime({
    state,
    host: "127.0.0.1",
    port: state === "running" ? 43117 : null,
    pid: state === "running" ? 42 : null,
    url: state === "running" ? "http://127.0.0.1:43117/" : null,
    workspaceRoot: "C:/runtime/source/examples/hello-application",
    startedAt: state === "running" ? "2026-09-21T00:00:00.000Z" : null,
    error: null,
    logs: ["server detail that must remain server-side"],
  }),
  truth,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("contained application developer preview", () => {
  it("withholds the iframe until runtime truth is running, then uses the exact opaque script sandbox", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ runtime: record("stopped"), truth }))
      .mockResolvedValueOnce(Response.json({ runtime: record("running"), truth }))
      .mockResolvedValueOnce(Response.json({ runtime: record("running"), truth }))
    vi.stubGlobal("fetch", fetcher)

    render(<DeveloperPreviewSurface project={project} runningAppUrl={project.application.previewUrl} />)

    expect(await screen.findByText("Runtime stopped", { exact: false })).toBeTruthy()
    expect(screen.queryByTitle("Running Focus Board application")).toBeNull()
    expect(screen.getByText(/Start the contained runtime to open the real Focus Board preview/i)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Start application" }))
    const frame = await screen.findByTitle("Running Focus Board application")
    expect(frame.getAttribute("src")).toBe(project.application.previewUrl)
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts")
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1))
  })

  it("uses neutral metadata for an unknown core workspace instead of a TerraFusion fallback", () => {
    render(<DeveloperPreviewSurface
      project={{ key: "research-space", name: "Research Space", kind: "core", preview: "neutral" }}
      runningAppUrl={null}
    />)
    expect(screen.getByRole("heading", { name: "Research Space application fixture" })).toBeTruthy()
    expect(screen.queryByText(/TerraFusion/i)).toBeNull()
  })

  it("remounts contained controls and clears the running preview when the project key changes", async () => {
    const notes = applicationWorkspaceProject("notes-pad", "Notes Pad")
    let resolveNotes!: (response: Response) => void
    const notesStatus = new Promise<Response>((resolve) => { resolveNotes = resolve })
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === project.application.runtimeUrl) {
        return Response.json({ runtime: record("running"), truth })
      }
      if (String(input) === notes.application.runtimeUrl) return notesStatus
      return Response.json({ error: "UNEXPECTED" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    const view = render(<DeveloperPreviewSurface project={project} runningAppUrl={project.application.previewUrl} />)

    expect(await screen.findByTitle("Running Focus Board application")).toBeTruthy()
    view.rerender(<DeveloperPreviewSurface project={notes} runningAppUrl={notes.application.previewUrl} />)
    expect(screen.queryByTitle("Running Focus Board application")).toBeNull()
    expect(screen.queryByTitle("Running Notes Pad application")).toBeNull()
    expect(screen.getByText("Checking contained runtime")).toBeTruthy()

    await act(async () => resolveNotes(Response.json({
      runtime: { ...record("stopped"), applicationId: "notes-pad", containerName: "williamos-application-notes-pad" },
      truth,
    })))
    expect(await screen.findByText("Runtime stopped", { exact: false })).toBeTruthy()
    expect(screen.getByText("Assistant for Notes Pad")).toBeTruthy()
  })

  it("immediately withholds a running iframe and stays unavailable when a refresh loses runtime truth", async () => {
    let rejectRefresh!: (reason: Error) => void
    const refresh = new Promise<Response>((_resolve, reject) => { rejectRefresh = reject })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ runtime: record("running"), truth }))
      .mockReturnValueOnce(refresh)
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperPreviewSurface project={project} runningAppUrl={project.application.previewUrl} />)

    expect(await screen.findByTitle("Running Focus Board application")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }))
    await waitFor(() => expect(screen.queryByTitle("Running Focus Board application")).toBeNull())

    await act(async () => rejectRefresh(new Error("APPLICATION_RUNTIME_UNAVAILABLE")))
    expect(await screen.findByText("Runtime unavailable", { exact: false })).toBeTruthy()
    expect(screen.queryByTitle("Running Focus Board application")).toBeNull()
  })

  it("immediately withholds the legacy Hello iframe when a refresh loses runtime truth", async () => {
    let rejectRefresh!: (reason: Error) => void
    const refresh = new Promise<Response>((_resolve, reject) => { rejectRefresh = reject })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(legacyRuntime("running")))
      .mockReturnValueOnce(refresh)
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperPreviewSurface
      project={HELLO_APPLICATION_WORKSPACE_PROJECT}
      runningAppUrl={HELLO_APPLICATION_WORKSPACE_PROJECT.application.previewUrl}
    />)

    expect(await screen.findByTitle("Running Hello Application application")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }))
    await waitFor(() => expect(screen.queryByTitle("Running Hello Application application")).toBeNull())

    await act(async () => rejectRefresh(new Error("HELLO_APPLICATION_STATUS_UNAVAILABLE: C:/secret/status.log")))
    expect(await screen.findByText("Runtime unavailable", { exact: false })).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toMatch(/runtime status is unavailable.*Retry Refresh/i)
    expect(screen.getByRole("alert").textContent).not.toMatch(/HELLO_APPLICATION|secret/i)
    expect(screen.queryByTitle("Running Hello Application application")).toBeNull()
  })

  it("humanizes an HTTP failure while reading legacy Hello runtime truth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { error: "HELLO_APPLICATION_STATUS_UNAVAILABLE: C:/secret/status.log" },
      { status: 503 },
    )))
    render(<DeveloperPreviewSurface
      project={HELLO_APPLICATION_WORKSPACE_PROJECT}
      runningAppUrl={HELLO_APPLICATION_WORKSPACE_PROJECT.application.previewUrl}
    />)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/runtime status is unavailable.*Retry Refresh/i)
    expect(alert.textContent).not.toMatch(/HELLO_APPLICATION|secret/i)
    expect(screen.queryByTitle("Running Hello Application application")).toBeNull()
  })

  it.each(["HTTP", "transport"] as const)("humanizes a %s failure while starting legacy Hello", async (failureKind) => {
    const startFailure = () => failureKind === "HTTP"
      ? Promise.resolve(Response.json(
        { error: "HELLO_APPLICATION_START_FAILED: C:/secret/start.log" },
        { status: 503 },
      ))
      : Promise.reject(new Error("connect ECONNREFUSED C:/secret/start.log"))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(legacyRuntime("stopped")))
      .mockImplementationOnce(startFailure)
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperPreviewSurface
      project={HELLO_APPLICATION_WORKSPACE_PROJECT}
      runningAppUrl={HELLO_APPLICATION_WORKSPACE_PROJECT.application.previewUrl}
    />)

    expect(await screen.findByText("Runtime stopped", { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Start application" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/start outcome is unavailable.*Retry Start application or Refresh/i)
    expect(alert.textContent).not.toMatch(/HELLO_APPLICATION|ECONNREFUSED|secret/i)
    expect(screen.queryByTitle("Running Hello Application application")).toBeNull()
  })

  it("withholds the legacy Hello iframe for the full Stop transition", async () => {
    let resolveStop!: (response: Response) => void
    const stop = new Promise<Response>((resolve) => { resolveStop = resolve })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(legacyRuntime("running")))
      .mockReturnValueOnce(stop)
      .mockResolvedValueOnce(Response.json(legacyRuntime("stopped")))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperPreviewSurface
      project={HELLO_APPLICATION_WORKSPACE_PROJECT}
      runningAppUrl={HELLO_APPLICATION_WORKSPACE_PROJECT.application.previewUrl}
    />)

    expect(await screen.findByTitle("Running Hello Application application")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop application" }))
    await waitFor(() => expect(screen.queryByTitle("Running Hello Application application")).toBeNull())

    await act(async () => resolveStop(Response.json({ runtime: { state: "stopped", pid: null, url: null } })))
    expect(await screen.findByText("Runtime stopped", { exact: false })).toBeTruthy()
    expect(screen.queryByTitle("Running Hello Application application")).toBeNull()
  })

  it("keeps the projected legacy Hello iframe withheld when Stop fails", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(legacyRuntime("running")))
      .mockResolvedValueOnce(Response.json(
        { error: "HELLO_APPLICATION_STOP_FAILED: C:/secret/stop.log" },
        { status: 503 },
      ))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperPreviewSurface
      project={HELLO_APPLICATION_WORKSPACE_PROJECT}
      runningAppUrl={HELLO_APPLICATION_WORKSPACE_PROJECT.application.previewUrl}
    />)

    expect(await screen.findByTitle("Running Hello Application application")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop application" }))
    await waitFor(() => expect(screen.queryByTitle("Running Hello Application application")).toBeNull())

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/stop outcome is unavailable.*Retry Stop application or Refresh/i)
    expect(alert.textContent).not.toMatch(/HELLO_APPLICATION|secret/i)
    expect(screen.queryByTitle("Running Hello Application application")).toBeNull()
  })

  it("keeps the legacy Hello iframe withheld and humanizes a thrown Stop failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(legacyRuntime("running")))
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED C:/secret/stop.log"))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperPreviewSurface
      project={HELLO_APPLICATION_WORKSPACE_PROJECT}
      runningAppUrl={HELLO_APPLICATION_WORKSPACE_PROJECT.application.previewUrl}
    />)

    expect(await screen.findByTitle("Running Hello Application application")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop application" }))
    await waitFor(() => expect(screen.queryByTitle("Running Hello Application application")).toBeNull())

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/stop outcome is unavailable.*Retry Stop application or Refresh/i)
    expect(alert.textContent).not.toMatch(/HELLO_APPLICATION|ECONNREFUSED|secret/i)
    expect(screen.queryByTitle("Running Hello Application application")).toBeNull()
  })

  it("does not restore the iframe when Stop succeeds but the authoritative status reread fails", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        if (fetcher.mock.calls.length === 1) return Response.json({ runtime: record("running"), truth })
        return Response.json({ error: "APPLICATION_RUNTIME_UNAVAILABLE" }, { status: 503 })
      }
      if (init.method === "DELETE") return Response.json({ runtime: record("stopped"), truth })
      return Response.json({ error: "UNEXPECTED" }, { status: 500 })
    })
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperPreviewSurface project={project} runningAppUrl={project.application.previewUrl} />)

    expect(await screen.findByTitle("Running Focus Board application")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop application" }))
    await waitFor(() => expect(screen.queryByTitle("Running Focus Board application")).toBeNull())
    expect(await screen.findByText("Runtime unavailable", { exact: false })).toBeTruthy()
    expect(screen.queryByTitle("Running Focus Board application")).toBeNull()
  })

  it("never mounts an observed-running stale artifact whose source head is behind project HEAD", async () => {
    const appliedTruth = { ...truth, activeProjectHead: "6".repeat(40) }
    const fetcher = vi.fn().mockResolvedValue(Response.json({ runtime: record("running"), truth: appliedTruth }))
    vi.stubGlobal("fetch", fetcher)
    render(<DeveloperPreviewSurface project={project} runningAppUrl={project.application.previewUrl} />)

    expect(await screen.findByText("Runtime mismatch", { exact: false })).toBeTruthy()
    expect(screen.queryByTitle("Running Focus Board application")).toBeNull()
    expect(screen.getByText(/built from an older source commit/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Start application" })).toBeTruthy()
  })
})
