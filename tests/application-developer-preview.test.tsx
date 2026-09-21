// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/workspace-shell/hello-application-assistant", () => ({
  ApplicationAssistant: ({ project }: { project: { name: string } }) => <div>Assistant for {project.name}</div>,
}))

import { DeveloperPreviewSurface } from "@/components/workspace-shell/developer-preview-surface"
import { applicationWorkspaceProject } from "@/lib/projects/workspace-project-key"

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
})
