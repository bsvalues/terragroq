// @vitest-environment jsdom

import { useState } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EditorSurface } from "@/components/workspace-shell/editor-surface"
import { defaultSpace, type WorkspaceProject, type WorkspaceSpace } from "@/components/workspace-shell/types"

vi.mock("next/dynamic", () => ({
  default: () => function Editor({ value, onChange, onSelection }: {
    value: string
    onChange: (value: string) => void
    onSelection: (selection: { anchor: number; head: number }) => void
  }) {
    return (
      <textarea
        aria-label="Test source editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onSelect={(event) => onSelection({ anchor: event.currentTarget.selectionStart, head: event.currentTarget.selectionEnd })}
      />
    )
  },
}))

const revision = "1".repeat(40)
const project: WorkspaceProject = {
  identity: "c:/repos/terrafusion_os_1.0",
  name: "TerraFusion",
  repositories: [
    {
      key: "os-1",
      identity: "bsvalues/terrafusion_os_1.0",
      label: "OS 1.0",
      role: "integrated-runtime",
      suite: null,
      previewSource: true,
      defaultRepository: true,
      mount: { key: "terrafusion:os-1:configured", configured: true, verified: true, branch: "main", revision, refusal: null },
    },
    {
      key: "sovereign-os",
      identity: "bsvalues/terrafusion-os",
      label: "Sovereign OS",
      role: "sovereign-planning-and-promotion",
      suite: null,
      previewSource: false,
      defaultRepository: false,
      mount: { key: "terrafusion:sovereign-os:configured", configured: false, verified: false, branch: null, revision: null, refusal: "WORKSPACE_REPOSITORY_MOUNT_NOT_CONFIGURED" },
    },
    {
      key: "atlas",
      identity: "bsvalues/terrafusion-atlas",
      label: "Atlas",
      role: "suite-source",
      suite: "atlas",
      previewSource: false,
      defaultRepository: false,
      mount: { key: "terrafusion:atlas:configured", configured: true, verified: true, branch: "main", revision, refusal: null },
    },
  ],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Experience V2 multi-repository Source workspace", () => {
  it("keeps one repository-qualified tab when the legacy tree reopens the same file", async () => {
    const user = userEvent.setup()
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&projectKey=williamos") {
        return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      }
      if (url === "/api/loom/files?path=README.md&projectKey=williamos") {
        return Response.json({
          kind: "file",
          path: "README.md",
          content: "WilliamOS",
          modifiedAt: "2026-09-04T00:00:00.000Z",
          repository: {
            key: "williamos",
            identity: "bsvalues/terragroq",
            mountKey: "williamos:configured",
            observedRevision: revision,
          },
        })
      }
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    const legacyProject: WorkspaceProject = {
      identity: "c:/hermeslab/williamos-source",
      name: "WilliamOS",
      repositories: [],
    }
    function ControlledEditor() {
      const [space, setSpace] = useState<WorkspaceSpace>(defaultSpace())
      return (
        <EditorSurface
          project={legacyProject}
          projectKey="williamos"
          space={space}
          onEditorChange={(editor, selectedPath, selectedFileRef) => {
            setSpace((current) => ({ ...current, editor, selectedPath, selectedFileRef: selectedFileRef ?? null }))
          }}
        />
      )
    }

    render(<ControlledEditor />)
    const treeFile = await screen.findByRole("button", { name: "README.md" })
    treeFile.focus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.getAllByRole("tab", { name: "README.md" })).toHaveLength(1))

    treeFile.focus()
    await user.keyboard("{Enter}")

    await waitFor(() => expect(screen.getAllByRole("tab", { name: "README.md" })).toHaveLength(1))
    expect(screen.getAllByRole("button", { name: "Close README.md" })).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("path=README.md"))).toHaveLength(1)
  })

  it("keeps the repository shelf compact and progressively reveals a large active root", async () => {
    const user = userEvent.setup()
    const entries = Array.from({ length: 40 }, (_, index) => ({
      name: `file-${String(index).padStart(2, "0")}.ts`,
      path: `file-${String(index).padStart(2, "0")}.ts`,
      directory: false,
    }))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/loom/files?path=&repositoryKey=os-1") {
        return Response.json({ kind: "directory", entries })
      }
      throw new Error(`unexpected request ${String(input)}`)
    }))

    render(<EditorSurface project={project} projectKey="terrafusion" space={defaultSpace()} onEditorChange={() => undefined} />)

    expect(await screen.findByRole("button", { name: "file-00.ts" })).toBeTruthy()
    expect(screen.queryByRole("group", { name: "OS 1.0 repository details" })).toBeNull()
    expect(screen.getByRole("button", { name: "file-31.ts" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "file-32.ts" })).toBeNull()
    const more = screen.getByRole("button", { name: "Show 8 more OS 1.0 entries" })
    expect(more.textContent).toContain("8 remaining")

    await user.click(more)
    expect(screen.getByRole("button", { name: "file-39.ts" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Show 8 more OS 1.0 entries" })).toBeNull()
  })

  it("renders one role-qualified TerraFusion repository shelf and switches the real source mount", async () => {
    const user = userEvent.setup()
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [{ name: "backend", path: "backend", directory: true }] })
      if (url === "/api/loom/files?path=&repositoryKey=atlas") return Response.json({ kind: "directory", entries: [{ name: "src", path: "src", directory: true }] })
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<EditorSurface project={project} projectKey="terrafusion" space={defaultSpace()} onEditorChange={() => undefined} />)

    expect(await screen.findByRole("navigation", { name: "TerraFusion sources" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Repository OS 1\.0,/i }).textContent).toContain("Preview source")
    await user.click(screen.getByRole("tab", { name: "Core Seven, 3 repositories" }))
    expect(screen.getByRole("button", { name: /^Repository Sovereign OS,/i }).textContent).toContain("No Preview")
    await user.click(screen.getByRole("button", { name: /^Repository Atlas,/i }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/api/loom/files?path=&repositoryKey=atlas",
      { cache: "no-store" },
    ))
  })

  it("persists explicit Working Set membership and restores its active repository", async () => {
    const user = userEvent.setup()
    const onEditorChange = vi.fn()
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      if (url === "/api/loom/files?path=&repositoryKey=atlas") return Response.json({ kind: "directory", entries: [{ name: "src", path: "src", directory: true }] })
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    const view = render(<EditorSurface project={project} projectKey="terrafusion" space={defaultSpace()} onEditorChange={onEditorChange} />)
    await screen.findByRole("button", { name: "README.md" })
    await user.click(screen.getByRole("tab", { name: "Core Seven, 3 repositories" }))
    await user.click(screen.getByRole("button", { name: /^Repository Atlas,/i }))
    await user.click(screen.getByRole("button", { name: "Add Atlas to Working Set" }))

    const addedEditor = onEditorChange.mock.calls.at(-1)?.[0] as WorkspaceSpace["editor"]
    expect(addedEditor.workingSetRepositoryKeys).toEqual(["os-1", "atlas"])
    expect(addedEditor.activeRepositoryKey).toBe("atlas")

    view.unmount()
    const restored = { ...defaultSpace(), editor: addedEditor }
    render(<EditorSurface project={project} projectKey="terrafusion" space={restored} onEditorChange={onEditorChange} />)
    expect(await screen.findByRole("button", { name: "src" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Working Set, 2 repositories" })).toBeTruthy()

    await user.click(screen.getByRole("tab", { name: "Core Seven, 3 repositories" }))
    await user.click(screen.getByRole("button", { name: /^Repository Atlas,/i }))
    await user.click(screen.getByRole("button", { name: "Remove Atlas from Working Set" }))
    const removedEditor = onEditorChange.mock.calls.at(-1)?.[0] as WorkspaceSpace["editor"]
    expect(removedEditor.workingSetRepositoryKeys).toEqual(["os-1"])
    expect(removedEditor.activeRepositoryKey).toBe("os-1")
    expect(await screen.findByRole("button", { name: "README.md" })).toBeTruthy()
  })

  it("restores the default member instead of a persisted hidden non-member", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/loom/files?path=&repositoryKey=os-1") {
        return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      }
      throw new Error(`unexpected request ${String(input)}`)
    }))
    const space = {
      ...defaultSpace(),
      editor: {
        ...defaultSpace().editor,
        workingSetRepositoryKeys: ["os-1"],
        activeRepositoryKey: "atlas",
      },
    }

    render(<EditorSurface project={project} projectKey="terrafusion" space={space} onEditorChange={() => undefined} />)
    expect(await screen.findByRole("button", { name: "README.md" })).toBeTruthy()
    expect(screen.getByRole("list", { name: "OS 1.0 file tree" })).toBeTruthy()
    expect(screen.queryByRole("list", { name: "Atlas file tree" })).toBeNull()
  })

  it("moves the active repository to the replacement when a selected cross-repository tab closes", async () => {
    const user = userEvent.setup()
    const onEditorChange = vi.fn()
    const osRef = {
      projectIdentity: project.identity, repositoryResourceKey: "os-1",
      repositoryMountKey: "terrafusion:os-1:configured", worktreeKey: null,
      observedRevision: revision, path: "README.md",
    }
    const atlasRef = {
      projectIdentity: project.identity, repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured", worktreeKey: null,
      observedRevision: revision, path: "README.md",
    }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=atlas") return Response.json({ kind: "directory", entries: [{ name: "src", path: "src", directory: true }] })
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      if (url === "/api/loom/files?path=README.md&repositoryKey=os-1") return Response.json({ kind: "file", path: "README.md", content: "OS", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", mountKey: "terrafusion:os-1:configured", observedRevision: revision } })
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas") return Response.json({ kind: "file", path: "README.md", content: "Atlas", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision } })
      throw new Error(`unexpected request ${url}`)
    }))
    const space = {
      ...defaultSpace(), selectedPath: "README.md", selectedFileRef: atlasRef,
      editor: {
        ...defaultSpace().editor,
        openFiles: ["README.md", "README.md"], openFileRefs: [osRef, atlasRef],
        workingSetRepositoryKeys: ["os-1", "atlas"], activeRepositoryKey: "atlas",
        panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: atlasRef, selection: null }],
      },
    }

    render(<EditorSurface project={project} projectKey="terrafusion" space={space} onEditorChange={onEditorChange} />)
    await screen.findByRole("button", { name: "Close Atlas · README.md" })
    await user.click(screen.getByRole("button", { name: "Close Atlas · README.md" }))
    const editor = onEditorChange.mock.calls.at(-1)?.[0] as WorkspaceSpace["editor"]
    expect(editor.activeRepositoryKey).toBe("os-1")
    expect(onEditorChange.mock.calls.at(-1)?.[2]).toMatchObject({ repositoryResourceKey: "os-1" })
    expect(await screen.findByRole("button", { name: "README.md" })).toBeTruthy()
  })

  it("keeps an unavailable restored tab from marking the active verified repository unavailable", async () => {
    const user = userEvent.setup()
    const unavailableAtlasProject: WorkspaceProject = {
      ...project,
      repositories: project.repositories.map((repository) => repository.key === "atlas"
        ? {
          ...repository,
          mount: {
            ...repository.mount,
            configured: false,
            verified: false,
            branch: null,
            revision: null,
            refusal: "WORKSPACE_REPOSITORY_MOUNT_NOT_CONFIGURED",
          },
        }
        : repository),
    }
    const osRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "os-1",
      repositoryMountKey: "terrafusion:os-1:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const atlasRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const space = {
      ...defaultSpace(),
      selectedPath: "README.md",
      selectedFileRef: osRef,
      editor: {
        ...defaultSpace().editor,
        openFiles: ["README.md", "README.md"],
        openFileRefs: [osRef, atlasRef],
        panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: osRef, selection: null }],
      },
    }
    let resolveAtlasRead!: () => void
    const atlasRead = new Promise<void>((resolve) => { resolveAtlasRead = resolve })
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=os-1") {
        return Response.json({ kind: "directory", entries: [{ name: "backend", path: "backend", directory: true }] })
      }
      if (url === "/api/loom/files?path=README.md&repositoryKey=os-1") {
        return Response.json({
          kind: "file", path: "README.md", content: "OS", modifiedAt: "2026-09-02T00:00:00.000Z",
          repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", mountKey: "terrafusion:os-1:configured", observedRevision: revision },
        })
      }
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas") {
        await atlasRead
        return Response.json({ error: "WORKSPACE_REPOSITORY_MOUNT_NOT_CONFIGURED" }, { status: 409 })
      }
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<EditorSurface project={unavailableAtlasProject} projectKey="terrafusion" space={space} onEditorChange={() => undefined} />)

    expect(await screen.findByRole("button", { name: "backend" })).toBeTruthy()
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/api/loom/files?path=README.md&repositoryKey=atlas",
      { cache: "no-store" },
    ))
    await act(async () => {
      resolveAtlasRead()
      await atlasRead
    })
    expect(screen.queryByRole("alert")).toBeNull()

    await user.click(screen.getByRole("button", { name: /^Repository Atlas,/i }))
    expect((await screen.findByRole("alert")).textContent).toContain("WORKSPACE_REPOSITORY_MOUNT_NOT_CONFIGURED")

    await user.click(screen.getByRole("button", { name: /^Repository OS 1\.0,/i }))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    expect(screen.getByRole("button", { name: "backend" })).toBeTruthy()
  })

  it("persists repository-qualified selection and keeps identical relative paths distinct", async () => {
    const user = userEvent.setup()
    const onEditorChange = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      if (url === "/api/loom/files?path=&repositoryKey=atlas") return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      if (url === "/api/loom/files?path=README.md&repositoryKey=os-1") return Response.json({ kind: "file", path: "README.md", content: "OS", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", mountKey: "terrafusion:os-1:configured", observedRevision: revision } })
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas") return Response.json({ kind: "file", path: "README.md", content: "Atlas", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision } })
      throw new Error(`unexpected request ${url}`)
    }))

    const view = render(<EditorSurface project={project} projectKey="terrafusion" space={defaultSpace()} onEditorChange={onEditorChange} />)
    await user.click(await screen.findByRole("button", { name: "README.md" }))
    await waitFor(() => expect(onEditorChange).toHaveBeenCalled())
    const first = onEditorChange.mock.calls.at(-1)
    expect(first?.[2]).toMatchObject({ repositoryResourceKey: "os-1", repositoryMountKey: "terrafusion:os-1:configured", path: "README.md" })

    const osSpace = { ...defaultSpace(), editor: first?.[0], selectedPath: first?.[1], selectedFileRef: first?.[2] }
    view.rerender(<EditorSurface project={project} projectKey="terrafusion" space={osSpace} onEditorChange={onEditorChange} />)
    expect(screen.getByRole("button", { name: "README.md" }).className).toContain("treeEntrySelected")
    await user.click(screen.getByRole("tab", { name: "Core Seven, 3 repositories" }))
    await user.click(screen.getByRole("button", { name: /^Repository Atlas,/i }))
    const atlasTreeEntry = await screen.findByRole("button", { name: "README.md" })
    expect(atlasTreeEntry.className).not.toContain("treeEntrySelected")
    await user.click(atlasTreeEntry)
    const second = onEditorChange.mock.calls.at(-1)
    expect(second?.[2]).toMatchObject({ repositoryResourceKey: "atlas", repositoryMountKey: "terrafusion:atlas:configured", path: "README.md" })
    expect(second?.[0].openFileRefs).toHaveLength(2)
  })

  it("reports dirty state with the exact repository-qualified file identity", async () => {
    const user = userEvent.setup()
    const osRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "os-1",
      repositoryMountKey: "terrafusion:os-1:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const atlasRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const editor = {
      ...defaultSpace().editor,
      openFiles: ["README.md", "README.md"],
      openFileRefs: [osRef, atlasRef],
      panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: osRef, selection: null }],
    }
    const onDirty = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/loom/files?path=&repositoryKey=atlas") return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/loom/files?path=README.md&repositoryKey=os-1") return Response.json({
        kind: "file", path: "README.md", content: "OS", modifiedAt: "2026-09-02T00:00:00.000Z",
        repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", mountKey: "terrafusion:os-1:configured", observedRevision: revision },
      })
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas") return Response.json({
        kind: "file", path: "README.md", content: "Atlas", modifiedAt: "2026-09-02T00:00:00.000Z",
        repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision },
      })
      throw new Error(`unexpected request ${url}`)
    }))

    const osSpace = { ...defaultSpace(), editor, selectedPath: "README.md", selectedFileRef: osRef }
    const view = render(<EditorSurface project={project} projectKey="terrafusion" space={osSpace} onEditorChange={() => undefined} onSelectedFileDirtyChange={onDirty} />)
    const source = await screen.findByRole("textbox", { name: "Test source editor" })
    await user.clear(source)
    await user.type(source, "OS dirty")
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith("README.md", true, osRef))

    const atlasSpace = {
      ...osSpace,
      selectedFileRef: atlasRef,
      editor: { ...editor, panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: atlasRef, selection: null }] },
    }
    view.rerender(<EditorSurface project={project} projectKey="terrafusion" space={atlasSpace} onEditorChange={() => undefined} onSelectedFileDirtyChange={onDirty} />)
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith("README.md", false, atlasRef))
  })

  it("loads an unloaded tab from that tab's repository instead of the active shelf repository", async () => {
    const user = userEvent.setup()
    const osRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "os-1",
      repositoryMountKey: "terrafusion:os-1:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const atlasRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const space = {
      ...defaultSpace(),
      selectedPath: "README.md",
      selectedFileRef: osRef,
      editor: {
        ...defaultSpace().editor,
        openFiles: ["README.md", "README.md"],
        openFileRefs: [osRef, atlasRef],
        panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: osRef, selection: null }],
      },
    }
    let atlasReads = 0
    let resolveInitialAtlasRead!: (response: Response) => void
    const initialAtlasRead = new Promise<Response>((resolve) => { resolveInitialAtlasRead = resolve })
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/loom/files?path=&repositoryKey=atlas") return Response.json({ kind: "directory", entries: [] })
      if (url === "/api/loom/files?path=README.md&repositoryKey=os-1") return Response.json({
        kind: "file", path: "README.md", content: "OS", modifiedAt: "2026-09-02T00:00:00.000Z",
        repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", mountKey: "terrafusion:os-1:configured", observedRevision: revision },
      })
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas") {
        atlasReads += 1
        if (atlasReads === 1) return initialAtlasRead
        return Response.json({
          kind: "file", path: "README.md", content: "Atlas", modifiedAt: "2026-09-02T00:00:00.000Z",
          repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision },
        })
      }
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    const onEditorChange = vi.fn()
    render(<EditorSurface project={project} projectKey="terrafusion" space={space} onEditorChange={onEditorChange} />)
    expect(await screen.findByDisplayValue("OS")).toBeTruthy()
    await user.click(screen.getByRole("tab", { name: "Atlas · README.md" }))

    await waitFor(() => expect(atlasReads).toBe(2))
    expect(onEditorChange.mock.calls.at(-1)?.[2]).toEqual(atlasRef)
    resolveInitialAtlasRead(Response.json({
      kind: "file", path: "README.md", content: "Atlas stale read", modifiedAt: "2026-09-02T00:00:00.000Z",
      repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision },
    }))
  })

  it("opens a Working Set search result from its named repository instead of the currently active repository", async () => {
    const user = userEvent.setup()
    const onEditorChange = vi.fn()
    const atlasRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const space = {
      ...defaultSpace(),
      selectedPath: "README.md",
      selectedFileRef: atlasRef,
      editor: {
        ...defaultSpace().editor,
        openFiles: ["README.md"],
        openFileRefs: [atlasRef],
        panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: atlasRef, selection: null }],
      },
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=atlas") return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [{ name: "AGENTS.md", path: "AGENTS.md", directory: false }] })
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas") return Response.json({ kind: "file", path: "README.md", content: "Atlas", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision } })
      if (url.startsWith("/api/loom/search?")) return Response.json({
        results: [{ repositoryKey: "os-1", repositoryIdentity: "bsvalues/terrafusion_os_1.0", repositoryMountKey: "terrafusion:os-1:configured", observedRevision: revision, path: "AGENTS.md", line: 1, excerpt: "README" }],
        unavailable: [],
        truncated: false,
      })
      if (url === "/api/loom/files?path=AGENTS.md&repositoryKey=os-1") return Response.json({ kind: "file", path: "AGENTS.md", content: "OS instructions", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", mountKey: "terrafusion:os-1:configured", observedRevision: revision } })
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<EditorSurface project={project} projectKey="terrafusion" space={space} onEditorChange={onEditorChange} />)
    await user.type(await screen.findByRole("searchbox", { name: "Search Working Set" }), "README")
    await user.click(screen.getByRole("button", { name: "Search 2 Working Set repositories" }))
    await user.click(await screen.findByRole("button", { name: "Open AGENTS.md in OS 1.0 at line 1" }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/api/loom/files?path=AGENTS.md&repositoryKey=os-1",
      { cache: "no-store" },
    ))
    expect(onEditorChange.mock.calls.at(-1)?.[2]).toMatchObject({
      repositoryResourceKey: "os-1",
      repositoryMountKey: "terrafusion:os-1:configured",
      path: "AGENTS.md",
    })
  })

  it("keeps an inactive repository-qualified editor selection pane-local until that pane is explicitly activated", async () => {
    const user = userEvent.setup()
    const onEditorChange = vi.fn()
    const osRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "os-1",
      repositoryMountKey: "terrafusion:os-1:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "AGENTS.md",
    }
    const atlasReadmeRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const atlasAgentsRef = { ...atlasReadmeRef, path: "AGENTS.md" }
    const startingSpace: WorkspaceSpace = {
      ...defaultSpace(),
      selectedPath: "AGENTS.md",
      selectedFileRef: osRef,
      editor: {
        ...defaultSpace().editor,
        openFiles: ["AGENTS.md", "README.md"],
        openFileRefs: [osRef, atlasReadmeRef],
        panes: [{ id: "primary", activePath: "AGENTS.md", activeFileRef: osRef, selection: null }],
      },
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [{ name: "AGENTS.md", path: "AGENTS.md", directory: false }] })
      if (url === "/api/loom/files?path=AGENTS.md&repositoryKey=os-1") return Response.json({ kind: "file", path: "AGENTS.md", content: "OS instructions", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", mountKey: "terrafusion:os-1:configured", observedRevision: revision } })
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas") return Response.json({ kind: "file", path: "README.md", content: "Atlas readme", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision } })
      if (url.startsWith("/api/loom/search?")) return Response.json({
        results: [{ repositoryKey: "atlas", repositoryIdentity: "bsvalues/terrafusion-atlas", repositoryMountKey: "terrafusion:atlas:configured", observedRevision: revision, path: "AGENTS.md", line: 1, excerpt: "Atlas instructions" }],
        unavailable: [],
        truncated: false,
      })
      if (url === "/api/loom/files?path=AGENTS.md&repositoryKey=atlas") return Response.json({ kind: "file", path: "AGENTS.md", content: "Atlas instructions", modifiedAt: "2026-09-02T00:00:00.000Z", repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision } })
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    function ControlledEditor() {
      const [space, setSpace] = useState(startingSpace)
      return (
        <EditorSurface
          project={project}
          projectKey="terrafusion"
          space={space}
          onEditorChange={(editor, selectedPath, selectedFileRef) => {
            onEditorChange(editor, selectedPath, selectedFileRef)
            setSpace((current) => ({ ...current, editor, selectedPath, selectedFileRef: selectedFileRef ?? null }))
          }}
        />
      )
    }

    render(<ControlledEditor />)
    expect(await screen.findByDisplayValue("OS instructions")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Split editor" }))
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "Test source editor" })).toHaveLength(2))
    await user.type(screen.getByRole("searchbox", { name: "Search Working Set" }), "Atlas instructions")
    await user.click(screen.getByRole("button", { name: "Search 2 Working Set repositories" }))
    await user.click(await screen.findByRole("button", { name: /Open AGENTS\.md in atlas at line 1/i }))
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "Test source editor" }).map((editor) => (editor as HTMLTextAreaElement).value)).toContain("Atlas instructions"))
    await waitFor(() => expect(onEditorChange.mock.calls.at(-1)?.[0].activePaneId).toBe("secondary"))
    expect(onEditorChange.mock.calls.at(-1)?.[2]).toEqual(atlasAgentsRef)

    const osEditor = screen.getByDisplayValue("OS instructions")
    osEditor.setSelectionRange(1, 3)
    fireEvent.select(osEditor)

    await waitFor(() => expect(onEditorChange.mock.calls.at(-1)?.[0].panes[0].selection).toEqual({ anchor: 1, head: 3 }))
    expect(onEditorChange.mock.calls.at(-1)?.[0].activePaneId).toBe("secondary")
    expect(onEditorChange.mock.calls.at(-1)?.[2]).toEqual(atlasAgentsRef)

    await user.click(osEditor)
    await waitFor(() => expect(onEditorChange.mock.calls.at(-1)?.[0].activePaneId).toBe("primary"))
    expect(onEditorChange.mock.calls.at(-1)?.[2]).toEqual(osRef)
  })

  it("rebinds a newly opened file to the exact revision returned by its verified mount", async () => {
    const user = userEvent.setup()
    const onEditorChange = vi.fn()
    const currentRevision = "2".repeat(40)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=os-1") return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      if (url === "/api/loom/files?path=README.md&repositoryKey=os-1") return Response.json({
        kind: "file", path: "README.md", content: "current bytes", modifiedAt: "2026-09-02T00:00:00.000Z",
        repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0", mountKey: "terrafusion:os-1:configured", observedRevision: currentRevision },
      })
      throw new Error(`unexpected request ${url}`)
    }))

    render(<EditorSurface project={project} projectKey="terrafusion" space={defaultSpace()} onEditorChange={onEditorChange} />)
    await user.click(await screen.findByRole("button", { name: "README.md" }))

    await waitFor(() => expect(onEditorChange.mock.calls.at(-1)?.[2]).toMatchObject({
      repositoryResourceKey: "os-1",
      repositoryMountKey: "terrafusion:os-1:configured",
      observedRevision: currentRevision,
      path: "README.md",
    }))
  })

  it("refuses stale restored bytes and explicitly rebinds only after the owner reopens the current revision", async () => {
    const user = userEvent.setup()
    const staleRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const space = {
      ...defaultSpace(),
      selectedPath: "README.md",
      selectedFileRef: staleRef,
      editor: {
        ...defaultSpace().editor,
        openFiles: ["README.md"],
        openFileRefs: [staleRef],
        panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: staleRef, selection: null }],
      },
    }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=atlas") return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas") return Response.json({
        kind: "file", path: "README.md", content: "new bytes", modifiedAt: "2026-09-02T00:00:00.000Z",
        repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: "3".repeat(40) },
      })
      throw new Error(`unexpected request ${url}`)
    }))

    const onEditorChange = vi.fn()
    function ControlledEditor() {
      const [currentSpace, setCurrentSpace] = useState<WorkspaceSpace>(space)
      return <EditorSurface project={project} projectKey="terrafusion" space={currentSpace} onEditorChange={(editor, selectedPath, selectedFileRef) => {
        onEditorChange(editor, selectedPath, selectedFileRef)
        setCurrentSpace((current) => ({ ...current, editor, selectedPath, selectedFileRef: selectedFileRef ?? null }))
      }} />
    }
    render(<ControlledEditor />)

    expect(await screen.findByText("WORKSPACE_FILE_REF_STALE")).toBeTruthy()
    expect(screen.queryByText("new bytes")).toBeNull()
    expect(screen.getByText("Saved file revision changed")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Reopen current revision" }))

    expect(await screen.findByDisplayValue("new bytes")).toBeTruthy()
    expect(onEditorChange.mock.calls.at(-1)?.[2]).toEqual({ ...staleRef, observedRevision: "3".repeat(40) })
    expect(screen.queryByText("WORKSPACE_FILE_REF_STALE")).toBeNull()
  })

  it("saves with the exact repository mount and revision identity used to open the tab", async () => {
    const user = userEvent.setup()
    const fileRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: revision,
      path: "README.md",
    }
    const space = {
      ...defaultSpace(),
      selectedPath: "README.md",
      selectedFileRef: fileRef,
      editor: {
        ...defaultSpace().editor,
        openFiles: ["README.md"],
        openFileRefs: [fileRef],
        panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: fileRef, selection: null }],
      },
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/loom/files?path=&repositoryKey=atlas" && !init?.method) {
        return Response.json({ kind: "directory", entries: [{ name: "README.md", path: "README.md", directory: false }] })
      }
      if (url === "/api/loom/files?path=README.md&repositoryKey=atlas" && !init?.method) {
        return Response.json({
          kind: "file", path: "README.md", content: "before\n", modifiedAt: "2026-09-02T00:00:00.000Z",
          repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision },
        })
      }
      if (url === "/api/loom/files" && init?.method === "PUT") {
        return Response.json({
          ok: true, path: "README.md", modifiedAt: "2026-09-02T00:01:00.000Z",
          fileRef,
          repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas", mountKey: "terrafusion:atlas:configured", observedRevision: revision },
        })
      }
      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal("fetch", fetcher)

    render(<EditorSurface project={project} projectKey="terrafusion" space={space} onEditorChange={() => undefined} />)
    const editor = await screen.findByRole("textbox", { name: "Test source editor" })
    await user.clear(editor)
    await user.type(editor, "after")
    await user.click(screen.getByRole("button", { name: "Save README.md" }))

    const saveRequest = fetcher.mock.calls.find((call) => call[1]?.method === "PUT")
    expect(JSON.parse(String(saveRequest?.[1]?.body))).toEqual({
      projectKey: "terrafusion",
      fileRef,
      content: "after",
      modifiedAt: "2026-09-02T00:00:00.000Z",
    })
  })
})
