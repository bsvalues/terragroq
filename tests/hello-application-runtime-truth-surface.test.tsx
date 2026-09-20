// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/workspace-shell/hello-application-assistant", () => ({
  HelloApplicationAssistant: ({ onPreviewRefresh }: { onPreviewRefresh: () => void }) => (
    <button type="button" aria-label="Simulate assistant apply refresh" onClick={onPreviewRefresh}>Assistant</button>
  ),
}))

import { HelloApplicationControls } from "@/components/workspace-shell/hello-application-controls"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Hello Application runtime truth surface", () => {
  it("shows the full WilliamOS runtime-build SHA beside the full active-project HEAD", async () => {
    const runtimeBuildSha = "a".repeat(40)
    const activeProjectHead = "b".repeat(40)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      runtime: { state: "running", pid: 42, url: "http://127.0.0.1:43117/" },
      truth: {
        runtimeBuild: { sha: runtimeBuildSha, builtAt: "2026-09-20T12:00:00.000Z" },
        activeProjectHead,
      },
    })))

    render(<HelloApplicationControls onPreviewRefresh={vi.fn()} />)

    const truth = await screen.findByLabelText("Hello Application runtime truth")
    expect(truth.textContent).toContain(`Runtime build ${runtimeBuildSha}`)
    expect(truth.textContent).toContain(`Active project HEAD ${activeProjectHead}`)
  })

  it("refreshes project HEAD with the preview so a governed apply cannot leave stale truth", async () => {
    const initialHead = "b".repeat(40)
    const advancedHead = "c".repeat(40)
    const payload = (activeProjectHead: string) => Response.json({
      runtime: { state: "running", pid: 42, url: "http://127.0.0.1:43117/" },
      truth: {
        runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" },
        activeProjectHead,
      },
    })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(payload(initialHead))
      .mockResolvedValueOnce(payload(advancedHead))
    const onPreviewRefresh = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<HelloApplicationControls onPreviewRefresh={onPreviewRefresh} />)
    expect((await screen.findByLabelText("Hello Application runtime truth")).textContent).toContain(initialHead)

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }))

    expect(onPreviewRefresh).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByLabelText("Hello Application runtime truth").textContent).toContain(advancedHead))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("serializes an assistant refresh behind an older runtime read without publishing the stale HEAD", async () => {
    const oldHead = "b".repeat(40)
    const newHead = "c".repeat(40)
    const payload = (activeProjectHead: string) => Response.json({
      runtime: { state: "running", pid: 42, url: "http://127.0.0.1:43117/" },
      truth: {
        runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" },
        activeProjectHead,
      },
    })
    let resolveOld!: (response: Response) => void
    let resolveNew!: (response: Response) => void
    const oldRead = new Promise<Response>((resolve) => { resolveOld = resolve })
    const newRead = new Promise<Response>((resolve) => { resolveNew = resolve })
    const fetcher = vi.fn()
      .mockReturnValueOnce(oldRead)
      .mockReturnValueOnce(newRead)
    vi.stubGlobal("fetch", fetcher)
    render(<HelloApplicationControls onPreviewRefresh={vi.fn()} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    expect((screen.getByRole("button", { name: "Refresh preview" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Simulate assistant apply refresh" }))
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveOld(payload(oldHead))
      await oldRead
    })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(screen.queryByLabelText("Hello Application runtime truth")).toBeNull()

    resolveNew(payload(newHead))
    await waitFor(() => expect(screen.getByLabelText("Hello Application runtime truth").textContent).toContain(newHead))
    const truth = screen.getByLabelText("Hello Application runtime truth")
    expect(truth.textContent).toContain(newHead)
    expect(truth.textContent).not.toContain(oldHead)
  })

  it("ignores a stale runtime read from a completed StrictMode effect lifecycle", async () => {
    const oldHead = "b".repeat(40)
    const newHead = "c".repeat(40)
    const payload = (activeProjectHead: string) => Response.json({
      runtime: { state: "running", pid: 42, url: "http://127.0.0.1:43117/" },
      truth: {
        runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" },
        activeProjectHead,
      },
    })
    let resolveOld!: (response: Response) => void
    let resolveNew!: (response: Response) => void
    const oldRead = new Promise<Response>((resolve) => { resolveOld = resolve })
    const newRead = new Promise<Response>((resolve) => { resolveNew = resolve })
    const fetcher = vi.fn()
      .mockReturnValueOnce(oldRead)
      .mockReturnValueOnce(newRead)
    vi.stubGlobal("fetch", fetcher)
    render(<StrictMode><HelloApplicationControls onPreviewRefresh={vi.fn()} /></StrictMode>)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))

    resolveNew(payload(newHead))
    await waitFor(() => expect(screen.getByLabelText("Hello Application runtime truth").textContent).toContain(newHead))
    await act(async () => {
      resolveOld(payload(oldHead))
      await oldRead
    })

    const truth = screen.getByLabelText("Hello Application runtime truth")
    expect(truth.textContent).toContain(newHead)
    expect(truth.textContent).not.toContain(oldHead)
  })

  it("blocks a runtime mutation while a truth refresh is in flight", async () => {
    const initialHead = "b".repeat(40)
    const refreshedHead = "c".repeat(40)
    const payload = (activeProjectHead: string) => Response.json({
      runtime: { state: "running", pid: 42, url: "http://127.0.0.1:43117/" },
      truth: {
        runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" },
        activeProjectHead,
      },
    })
    let resolveRefresh!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => { resolveRefresh = resolve })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(payload(initialHead))
      .mockReturnValueOnce(refresh)
    vi.stubGlobal("fetch", fetcher)
    render(<HelloApplicationControls onPreviewRefresh={vi.fn()} />)
    await screen.findByLabelText("Hello Application runtime truth")

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const stop = screen.getByRole("button", { name: "Stop application" }) as HTMLButtonElement
    expect(stop.disabled).toBe(true)
    fireEvent.click(stop)
    expect(fetcher).toHaveBeenCalledTimes(2)

    resolveRefresh(payload(refreshedHead))
    await waitFor(() => expect(screen.getByLabelText("Hello Application runtime truth").textContent).toContain(refreshedHead))
    expect((screen.getByRole("button", { name: "Stop application" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("queues an assistant truth refresh behind a runtime mutation and preserves both outcomes", async () => {
    const initialHead = "b".repeat(40)
    const advancedHead = "c".repeat(40)
    const statusPayload = (state: "running" | "stopped", activeProjectHead: string) => Response.json({
      runtime: { state, pid: state === "running" ? 42 : null, url: state === "running" ? "http://127.0.0.1:43117/" : null },
      truth: {
        runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" },
        activeProjectHead,
      },
    })
    let resolveMutation!: (response: Response) => void
    let resolveTruth!: (response: Response) => void
    const mutation = new Promise<Response>((resolve) => { resolveMutation = resolve })
    const truthRead = new Promise<Response>((resolve) => { resolveTruth = resolve })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(statusPayload("running", initialHead))
      .mockReturnValueOnce(mutation)
      .mockReturnValueOnce(truthRead)
    vi.stubGlobal("fetch", fetcher)
    render(<HelloApplicationControls onPreviewRefresh={vi.fn()} />)
    await screen.findByLabelText("Hello Application runtime truth")

    fireEvent.click(screen.getByRole("button", { name: "Stop application" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole("button", { name: "Simulate assistant apply refresh" }))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText("Hello Application runtime truth")).toBeNull()

    resolveMutation(Response.json({ runtime: { state: "stopped", pid: null, url: null } }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    resolveTruth(statusPayload("stopped", advancedHead))

    await waitFor(() => expect(screen.getByLabelText("Hello Application runtime truth").textContent).toContain(advancedHead))
    expect(screen.getByRole("button", { name: "Start application" })).toBeTruthy()
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("DELETE")
    expect(fetcher.mock.calls[2]?.[1]).toEqual({ cache: "no-store" })
  })

  it("removes stale truth when a refresh cannot prove the new active-project HEAD", async () => {
    const initial = Response.json({
      runtime: { state: "running", pid: 42, url: "http://127.0.0.1:43117/" },
      truth: {
        runtimeBuild: { sha: "a".repeat(40), builtAt: "2026-09-20T12:00:00.000Z" },
        activeProjectHead: "b".repeat(40),
      },
    })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(Response.json({ error: "HELLO_APPLICATION_PROJECT_TRUTH_UNAVAILABLE" }, { status: 503 }))
    vi.stubGlobal("fetch", fetcher)
    render(<HelloApplicationControls onPreviewRefresh={vi.fn()} />)
    await screen.findByLabelText("Hello Application runtime truth")

    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }))

    expect((await screen.findByRole("alert")).textContent).toContain("HELLO_APPLICATION_PROJECT_TRUTH_UNAVAILABLE")
    expect(screen.queryByLabelText("Hello Application runtime truth")).toBeNull()
  })
})
