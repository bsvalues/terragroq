import { describe, expect, it } from "vitest"

import { defaultSpace, normalizeSpace, spaceInViewport, spaceToServer } from "@/components/workspace-shell/types"
import { validateSpaceState } from "@/lib/environment/working-world"

const geometry = (z: number) => ({ x: 100, y: 90, width: 560, height: 480, z, minimized: false })

describe("browser-to-server Space mapping", () => {
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
