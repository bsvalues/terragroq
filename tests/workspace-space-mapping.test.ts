import { describe, expect, it } from "vitest"

import { defaultSpace, normalizeSpace, qualifyLegacyWorkspaceFiles, spaceInViewport, spaceToServer } from "@/components/workspace-shell/types"
import { validateSpaceState } from "@/lib/environment/working-world"
import type { WorkspaceFileRef } from "@/lib/projects/workspace-object-ref"

const geometry = (z: number) => ({ x: 100, y: 90, width: 560, height: 480, z, minimized: false })

describe("browser-to-server Space mapping", () => {
  it("round-trips repository, mount, worktree and observed-revision identity for same-path files", () => {
    const base = defaultSpace(1440, 900)
    const atlas: WorkspaceFileRef = {
      projectIdentity: "project:terrafusion",
      repositoryResourceKey: "repo:terrafusion-atlas",
      repositoryMountKey: "mount:hermes:terrafusion-atlas:protected-main",
      worktreeKey: null,
      observedRevision: "a".repeat(40),
      path: "README.md",
    }
    const os1: WorkspaceFileRef = {
      ...atlas,
      repositoryResourceKey: "repo:terrafusion-os-1",
      repositoryMountKey: "mount:hermes:terrafusion-os-1:protected-main",
    }

    const mapped = spaceToServer({
      ...base,
      selectedPath: atlas.path,
      selectedFileRef: atlas,
      editor: {
        openFiles: [atlas.path, os1.path],
        openFileRefs: [atlas, os1],
        panes: [
          { id: "primary", activePath: atlas.path, activeFileRef: atlas, selection: { anchor: 1, head: 2 } },
          { id: "secondary", activePath: os1.path, activeFileRef: os1, selection: { anchor: 3, head: 4 } },
        ],
        activePaneId: "primary",
      },
    })

    expect(mapped.fileRefs).toEqual([atlas, os1])
    expect(mapped.panes.map((pane) => pane.fileRef)).toEqual([atlas, os1])
    expect(mapped.selection?.fileRef).toEqual(atlas)
    expect(() => validateSpaceState(mapped)).not.toThrow()

    const restored = normalizeSpace(validateSpaceState(mapped), base)
    expect(restored.selectedFileRef).toEqual(atlas)
    expect(restored.editor.openFileRefs).toEqual([atlas, os1])
    expect(restored.editor.panes.map((pane) => pane.activeFileRef)).toEqual([atlas, os1])
  })

  it("keeps legacy path-only editor state path-only until a repository-qualified file is opened", () => {
    const base = defaultSpace(1440, 900)
    const legacy = spaceToServer({
      ...base,
      selectedPath: "README.md",
      editor: {
        openFiles: ["README.md"],
        panes: [{ id: "primary", activePath: "README.md", selection: { anchor: 0, head: 0 } }],
        activePaneId: "primary",
      },
    })

    expect(legacy.fileRefs).toBeUndefined()
    const restored = normalizeSpace(validateSpaceState(legacy), base)
    expect(restored.editor.openFileRefs).toBeUndefined()
    expect(() => validateSpaceState(spaceToServer(restored))).not.toThrow()
  })

  it("restores the active file from its pane even when no cursor range was persisted", () => {
    const base = defaultSpace(1440, 900)
    const persisted = spaceToServer({
      ...base,
      selectedPath: "README.md",
      editor: {
        openFiles: ["README.md"],
        panes: [{ id: "primary", activePath: "README.md", selection: null }],
        activePaneId: "primary",
      },
    })

    expect(persisted.selection).toBeNull()
    const restored = normalizeSpace(validateSpaceState(persisted), base)
    expect(restored.selectedPath).toBe("README.md")
    expect(restored.editor.panes[0]).toMatchObject({ activePath: "README.md", selection: null })
  })

  it("upgrades legacy path-only state from the server-verified default repository binding", () => {
    const base = defaultSpace(1440, 900)
    const legacy = normalizeSpace(validateSpaceState(spaceToServer({
      ...base,
      selectedPath: "README.md",
      editor: {
        openFiles: ["README.md"],
        panes: [{ id: "primary", activePath: "README.md", selection: { anchor: 2, head: 4 } }],
        activePaneId: "primary",
      },
    })), base)
    const project = {
      identity: "c:/repos/terrafusion_os_1.0",
      name: "TerraFusion",
      repositories: [{
        key: "os-1",
        identity: "bsvalues/terrafusion_os_1.0",
        label: "OS 1.0",
        role: "integrated-runtime" as const,
        suite: null,
        previewSource: true,
        defaultRepository: true,
        mount: {
          key: "terrafusion:os-1:configured",
          configured: true,
          verified: true,
          branch: "main",
          revision: "a".repeat(40),
          refusal: null,
        },
      }],
    }

    const upgraded = qualifyLegacyWorkspaceFiles(legacy, project)
    expect(upgraded.editor.openFileRefs).toHaveLength(1)
    expect(upgraded.editor.openFileRefs?.[0]).toMatchObject({
      projectIdentity: project.identity,
      repositoryResourceKey: "os-1",
      repositoryMountKey: "terrafusion:os-1:configured",
      worktreeKey: null,
      observedRevision: "a".repeat(40),
      path: "README.md",
    })
    expect(upgraded.editor.panes[0].activeFileRef).toEqual(upgraded.editor.openFileRefs?.[0])
    expect(upgraded.selectedFileRef).toEqual(upgraded.editor.openFileRefs?.[0])
    expect(() => validateSpaceState(spaceToServer(upgraded))).not.toThrow()
  })

  it("keeps server Space identity and place separate across two durable snapshots", () => {
    const aBase = defaultSpace(1440, 900, "world-a", "Build")
    const bBase = defaultSpace(1440, 900, "world-b", "Recovery")
    const a = normalizeSpace(spaceToServer({
      ...aBase,
      selectedPath: "src/a.ts",
      windows: { ...aBase.windows, editor: { ...aBase.windows.editor, x: 37 } },
      editor: { openFiles: ["src/a.ts"], panes: [{ id: "primary", activePath: "src/a.ts", selection: { anchor: 1, head: 4 } }], activePaneId: "primary" },
      inspectorWindows: { "inspect-a": geometry(9) },
      inspectorSeeds: { "inspect-a": { kind: "review", subject: "src/a.ts", payload: "A report" } },
      activeWindowId: "inspect-a",
    }), aBase)
    const b = normalizeSpace(spaceToServer({
      ...bBase,
      selectedPath: "src/b.ts",
      windows: { ...bBase.windows, editor: { ...bBase.windows.editor, x: 211 } },
      editor: { openFiles: ["src/b.ts"], panes: [{ id: "primary", activePath: "src/b.ts", selection: { anchor: 8, head: 12 } }], activePaneId: "primary" },
    }), bBase)

    expect(a).toMatchObject({ id: "world-a", name: "Build", selectedPath: "src/a.ts", activeWindowId: "inspect-a" })
    expect(a.windows.editor.x).toBe(37)
    expect(a.editor.panes[0].selection).toEqual({ anchor: 1, head: 4 })
    expect(a.inspectorSeeds["inspect-a"]).toMatchObject({ subject: "src/a.ts", payload: "A report" })
    expect(b).toMatchObject({ id: "world-b", name: "Recovery", selectedPath: "src/b.ts", activeWindowId: "editor" })
    expect(b.windows.editor.x).toBe(211)
    expect(b.editor.openFiles).toEqual(["src/b.ts"])
  })

  it("opens new desktop Spaces with source, preview, and tests visibly composed", () => {
    const space = defaultSpace(1440, 900)
    const source = space.windows.editor
    const preview = space.windows["running-app"]
    const tests = space.windows.tests

    expect(source.x + source.width).toBeLessThan(preview.x)
    expect(preview.x).toBe(tests.x)
    expect(preview.width).toBe(tests.width)
    expect(preview.y + preview.height).toBeLessThan(tests.y)
    expect(tests.y + tests.height).toBeLessThanOrEqual(900 - 171)
    expect(tests.minimized).toBe(false)
  })

  it.each([
    { width: 800, height: 600 },
    { width: 1440, height: 650 },
  ])("keeps short or reduced desktop defaults inside $width×$height", ({ width, height }) => {
    const space = defaultSpace(width, height)
    const workHeight = Math.max(300, height - 171)

    for (const window of [space.windows.editor, space.windows["running-app"], space.windows.tests]) {
      expect(window.x).toBeGreaterThanOrEqual(0)
      expect(window.x + window.width).toBeLessThanOrEqual(width)
      expect(window.y).toBeGreaterThanOrEqual(0)
      expect(window.y + window.height).toBeLessThanOrEqual(workHeight)
    }
    expect(space.windows["running-app"].minimized).toBe(false)
    expect(space.windows.tests.minimized).toBe(true)
  })

  it("persists reconstructable summoned Inspectors while transient payload surfaces cannot break core continuity", () => {
    const base = defaultSpace(1400, 900)
    const mapped = spaceToServer({
      ...base,
      inspectorWindows: {
        "inspector-project": geometry(3),
        "inspector-browser": geometry(4),
        "inspector-trace": geometry(5),
      },
      inspectorSeeds: {
        "inspector-project": { kind: "project", subject: "TerraFusion projects" },
        "inspector-browser": { kind: "browser", subject: "/sign-in" },
        "inspector-trace": { kind: "trace", subject: "auth probe" },
      },
      activeWindowId: "inspector-trace",
    })

    expect(mapped.windows.map((window) => window.id)).toEqual([
      "workspace-editor", "workspace-running-app", "workspace-tests", "workspace-diff", "workspace-terminal", "inspector-project",
    ])
    // An unsupported transient Inspector never becomes an invalid active-window reference.
    expect(mapped.activeWindowId).toBeNull()
    expect(() => validateSpaceState(mapped)).not.toThrow()
    expect(validateSpaceState(mapped).windows.at(-1)).toMatchObject({
      kind: "inspector", surfaceKind: "project", surfaceSubject: "TerraFusion projects",
    })
  })

  it("round-trips a path-bound Review report and its exact Inspector geometry", () => {
    const base = defaultSpace(1400, 900)
    const reviewGeometry = { x: 233, y: 117, width: 612, height: 503, z: 19, minimized: false }
    const mapped = spaceToServer({
      ...base,
      inspectorWindows: { "inspector-review": reviewGeometry },
      inspectorSeeds: {
        "inspector-review": {
          kind: "review",
          subject: "src/app.ts",
          payload: "P1: authorization can be bypassed",
        },
      },
      activeWindowId: "inspector-review",
    })

    const validated = validateSpaceState(mapped)
    expect(validated.windows.at(-1)).toEqual({
      id: "inspector-review",
      kind: "inspector",
      title: "Review report",
      surfaceKind: "review",
      surfaceSubject: "src/app.ts",
      surfacePayload: "P1: authorization can be bypassed",
      frame: { x: 233, y: 117, width: 612, height: 503 },
      z: 19,
      minimized: false,
    })

    const restored = normalizeSpace(validated, base, { width: 1400, height: 900 })
    expect(restored.inspectorWindows["inspector-review"]).toEqual(reviewGeometry)
    expect(restored.inspectorSeeds["inspector-review"]).toEqual({
      kind: "review",
      subject: "src/app.ts",
      payload: "P1: authorization can be bypassed",
    })
    expect(restored.activeWindowId).toBe("inspector-review")
  })

  it("reconciles restored geometry to the current viewport and round-trips each pane selection", () => {
    const fallback = defaultSpace(800, 600)
    const persisted = spaceToServer({
      ...fallback,
      windows: {
        ...fallback.windows,
        editor: { ...fallback.windows.editor, x: 3_000, y: 2_000, width: 1_600, height: 1_200 },
        "running-app": { ...fallback.windows["running-app"], x: -2_000, y: -400, width: 1_400, height: 1_000 },
      },
      selectedPath: "src/right.ts",
      editor: {
        openFiles: ["src/left.ts", "src/right.ts"],
        panes: [
          { id: "primary", activePath: "src/left.ts", selection: { anchor: 2, head: 7 } },
          { id: "secondary", activePath: "src/right.ts", selection: { anchor: 11, head: 19 } },
        ],
        activePaneId: "secondary",
      },
    })

    expect(persisted.panes).toEqual([
      { id: "workspace-pane", filePath: "src/left.ts", selection: { anchor: 2, head: 7 } },
      { id: "workspace-pane-secondary", filePath: "src/right.ts", selection: { anchor: 11, head: 19 } },
    ])
    expect(() => validateSpaceState(persisted)).not.toThrow()

    const restored = normalizeSpace(persisted, fallback, { width: 800, height: 600 })
    for (const window of Object.values(restored.windows)) {
      expect(window.width).toBeLessThanOrEqual(784)
      expect(window.height).toBeLessThanOrEqual(556)
      expect(window.x).toBeLessThanOrEqual(620)
      expect(window.x + window.width).toBeGreaterThanOrEqual(180)
      expect(window.y).toBeGreaterThanOrEqual(0)
      expect(window.y).toBeLessThanOrEqual(510)
    }
    expect(restored.editor.panes).toEqual([
      { id: "primary", activePath: "src/left.ts", selection: { anchor: 2, head: 7 } },
      { id: "secondary", activePath: "src/right.ts", selection: { anchor: 11, head: 19 } },
    ])
  })

  it("recontains already-open windows after a desktop viewport shrinks", () => {
    const open = defaultSpace(1440, 900)
    const resized = spaceInViewport(open, { width: 800, height: 600 })

    for (const window of Object.values(resized.windows)) {
      expect(window.x).toBeLessThanOrEqual(620)
      expect(window.x + window.width).toBeGreaterThanOrEqual(180)
      expect(window.y).toBeLessThanOrEqual(510)
    }
  })
})
