import type { WilliamJudgment, WorldSpine } from "@/lib/environment/working-world"
import { isSummonedSurface } from "@/lib/environment/summon"

export type WindowId = "editor" | "running-app" | "tests" | "diff" | "terminal"

export type InspectorSeed = Readonly<{ kind: string; subject: string; payload?: string }>

export type WindowGeometry = Readonly<{
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
}>

export type EditorSelection = Readonly<{ anchor: number; head: number }>

export type EditorPane = Readonly<{
  id: "primary" | "secondary"
  activePath: string | null
  selection: EditorSelection | null
}>

export type WorkspaceSpace = Readonly<{
  revision: number
  id: "terrafusion"
  name: "TerraFusion"
  runningAppUrl: string | null
  windows: Record<WindowId, WindowGeometry>
  inspectorWindows: Record<string, WindowGeometry>
  inspectorSeeds: Record<string, InspectorSeed>
  dock: readonly WindowId[]
  activeWindowId: string | null
  selectedPath: string | null
  editor: Readonly<{
    openFiles: readonly string[]
    panes: readonly EditorPane[]
    activePaneId: EditorPane["id"]
  }>
}>

export type SpaceEnvelope = Readonly<{
  worldId: string
  space: unknown
  spine?: WorldSpine
  judgment?: WilliamJudgment | null
  project?: WorkspaceProject
  storage?: "server" | "browser"
  browserStorageKey?: string
}>

export type WorkspaceProject = Readonly<{ identity: string; name: string }>

export function defaultSpace(viewportWidth = 1440, viewportHeight = 900): WorkspaceSpace {
  const workHeight = Math.max(300, viewportHeight - 171)
  const outerGutter = viewportWidth >= 1100 ? 26 : 18
  const surfaceGap = viewportWidth >= 1100 ? 24 : 18
  const availableWidth = viewportWidth - (outerGutter * 2) - surfaceGap
  const canTileHorizontally = availableWidth >= 720
  const editorWidth = canTileHorizontally
    ? Math.max(360, Math.min(Math.round(availableWidth * 0.52), availableWidth - 360))
    : Math.max(360, viewportWidth - (outerGutter * 2))
  const companionX = canTileHorizontally ? outerGutter + editorWidth + surfaceGap : outerGutter
  const companionWidth = canTileHorizontally ? availableWidth - editorWidth : editorWidth
  const canStackTests = canTileHorizontally && workHeight >= 612
  const previewHeight = canStackTests
    ? Math.min(470, workHeight - 312)
    : workHeight - 36
  const testsY = canStackTests ? 18 + previewHeight + 16 : workHeight - 278
  return {
    revision: 0,
    id: "terrafusion",
    name: "TerraFusion",
    runningAppUrl: null,
    windows: {
      editor: {
        x: outerGutter,
        y: 18,
        width: editorWidth,
        height: Math.min(720, workHeight - 36),
        z: 4,
        minimized: false,
      },
      "running-app": {
        x: companionX,
        y: 18,
        width: companionWidth,
        height: previewHeight,
        z: 1,
        minimized: false,
      },
      tests: {
        x: companionX,
        y: testsY,
        width: companionWidth,
        height: 260,
        z: 3,
        minimized: !canStackTests,
      },
      diff: {
        x: Math.max(450, Math.round(viewportWidth * 0.42)), y: Math.max(160, workHeight - 248),
        width: Math.max(460, Math.round(viewportWidth * 0.34)), height: Math.min(230, workHeight - 12), z: 2, minimized: true,
      },
      terminal: {
        x: Math.max(260, Math.round(viewportWidth * 0.23)), y: Math.max(150, workHeight - 268),
        width: Math.max(520, Math.round(viewportWidth * 0.42)), height: Math.min(250, workHeight - 12), z: 2, minimized: true,
      },
    },
    inspectorWindows: {},
    inspectorSeeds: {},
    dock: ["editor", "running-app", "tests", "diff", "terminal"],
    activeWindowId: "editor",
    selectedPath: null,
    editor: {
      openFiles: [],
      panes: [{ id: "primary", activePath: null, selection: null }],
      activePaneId: "primary",
    },
  }
}

const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

type ViewportBounds = Readonly<{ width: number; height: number }>

function geometryInViewport(
  frame: Record<string, unknown> | undefined,
  input: Record<string, unknown> | undefined,
  base: WindowGeometry,
  viewport: ViewportBounds,
): WindowGeometry {
  const viewportWidth = Math.max(320, finite(viewport.width, 1440))
  const viewportHeight = Math.max(240, finite(viewport.height, 900))
  const canvasHeight = Math.max(260, viewportHeight - 171)
  const width = Math.min(Math.max(360, viewportWidth - 16), Math.max(360, finite(frame?.width, base.width)))
  const height = Math.min(canvasHeight, Math.max(220, finite(frame?.height, base.height)))
  // Keep at least a draggable title-bar segment visible after display/browser size changes.
  const x = Math.min(Math.max(0, viewportWidth - 180), Math.max(-width + 180, finite(frame?.x, base.x)))
  const y = Math.min(Math.max(0, canvasHeight - 32), Math.max(0, finite(frame?.y, base.y)))
  return {
    x,
    y,
    width,
    height,
    z: finite(input?.z, base.z),
    minimized: typeof input?.minimized === "boolean" ? input.minimized : base.minimized,
  }
}

export function normalizeSpace(
  value: unknown,
  fallback: WorkspaceSpace,
  viewport: ViewportBounds = { width: 1440, height: 900 },
): WorkspaceSpace {
  if (!value || typeof value !== "object") return fallback
  const candidate = value as Record<string, unknown>
  const rawWindows = Array.isArray(candidate.windows) ? candidate.windows : []
  const windowsByKind = new Map(rawWindows.flatMap((window) => {
    if (!window || typeof window !== "object") return []
    const item = window as Record<string, unknown>
    return item.kind === "editor" || item.kind === "running-app" || item.kind === "tests"
      || item.kind === "diff" || item.kind === "terminal" ? [[item.kind, item] as const] : []
  }))
  const inspectorWindows = Object.fromEntries(rawWindows.flatMap((window) => {
    if (!window || typeof window !== "object") return []
    const item = window as Record<string, unknown>
    if (item.kind !== "inspector" || typeof item.id !== "string") return []
    const frame = item.frame && typeof item.frame === "object" ? item.frame as Record<string, unknown> : {}
    return [[item.id, geometryInViewport(frame, item, {
      x: 120, y: 90, width: 560, height: 480, z: 3, minimized: false,
    }, viewport)]]
  }))
  const inspectorSeeds = Object.fromEntries(rawWindows.flatMap((window) => {
    if (!window || typeof window !== "object") return []
    const item = window as Record<string, unknown>
    if (item.kind !== "inspector" || typeof item.id !== "string"
      || typeof item.surfaceKind !== "string" || typeof item.surfaceSubject !== "string") return []
    if (item.surfaceKind === "review" && typeof item.surfacePayload !== "string") return []
    return [[item.id, {
      kind: item.surfaceKind,
      subject: item.surfaceSubject,
      ...(item.surfaceKind === "review" ? { payload: item.surfacePayload as string } : {}),
    } satisfies InspectorSeed]]
  }))
  const normalizeWindow = (id: WindowId): WindowGeometry => {
    const input = windowsByKind.get(id) as Record<string, unknown> | undefined
    const frame = input?.frame && typeof input.frame === "object" ? input.frame as Record<string, unknown> : undefined
    const base = fallback.windows[id]
    return geometryInViewport(frame, input, base, viewport)
  }
  const rawPanes = Array.isArray(candidate.panes) ? candidate.panes.slice(0, 2) : []
  const rawActivePaneId = typeof candidate.activePaneId === "string" ? candidate.activePaneId : null
  const rawSelection = candidate.selection && typeof candidate.selection === "object"
    ? candidate.selection as Record<string, unknown>
    : null
  const panes: EditorPane[] = rawPanes.flatMap((pane, index) => {
    if (!pane || typeof pane !== "object") return []
    const item = pane as Record<string, unknown>
    const paneSelection = item.selection && typeof item.selection === "object"
      ? item.selection as Record<string, unknown>
      : null
    const legacySelection = item.id === rawActivePaneId ? rawSelection : null
    const selected = paneSelection ?? legacySelection
    const selection = selected && Number.isFinite(selected.anchor) && Number.isFinite(selected.head)
      ? { anchor: selected.anchor as number, head: selected.head as number }
      : null
    return [{
      id: index === 0 ? "primary" : "secondary",
      activePath: typeof item.filePath === "string" ? item.filePath : null,
      selection,
    }]
  })
  const activePaneIndex = rawPanes.findIndex((pane) => pane && typeof pane === "object" && (pane as Record<string, unknown>).id === rawActivePaneId)
  const normalizedWindows: Record<WindowId, WindowGeometry> = {
    editor: normalizeWindow("editor"),
    "running-app": normalizeWindow("running-app"),
    tests: normalizeWindow("tests"),
    diff: normalizeWindow("diff"),
    terminal: normalizeWindow("terminal"),
  }
  const activeWindowId = candidate.activeWindowId === "workspace-editor" ? "editor"
    : candidate.activeWindowId === "workspace-running-app" ? "running-app"
    : candidate.activeWindowId === "workspace-tests" ? "tests"
    : candidate.activeWindowId === "workspace-diff" ? "diff"
    : candidate.activeWindowId === "workspace-terminal" ? "terminal"
    : typeof candidate.activeWindowId === "string" && inspectorWindows[candidate.activeWindowId]
      ? candidate.activeWindowId
    : candidate.activeWindowId === null ? null : fallback.activeWindowId
  if (activeWindowId && activeWindowId in normalizedWindows) {
    const durableId = activeWindowId as WindowId
    const highest = Math.max(...Object.values(normalizedWindows).map((window) => window.z), ...Object.values(inspectorWindows).map((window) => window.z))
    normalizedWindows[durableId] = { ...normalizedWindows[durableId], minimized: false, z: highest + 1 }
  }
  return {
    revision: Number.isSafeInteger(candidate.revision) && (candidate.revision as number) >= 0
      ? candidate.revision as number : fallback.revision,
    id: "terrafusion",
    name: "TerraFusion",
    runningAppUrl: typeof candidate.runningAppUrl === "string" && candidate.runningAppUrl.length > 0
      ? candidate.runningAppUrl
      : null,
    windows: normalizedWindows,
    inspectorWindows,
    inspectorSeeds,
    dock: ["editor", "running-app", "tests", "diff", "terminal"],
    activeWindowId,
    selectedPath: typeof rawSelection?.filePath === "string"
      ? rawSelection.filePath
      : panes[activePaneIndex]?.selection ? panes[activePaneIndex].activePath : null,
    editor: {
      openFiles: Array.isArray(candidate.openFiles)
        ? candidate.openFiles.filter((path): path is string => typeof path === "string")
        : fallback.editor.openFiles,
      panes: panes.length > 0 ? panes : fallback.editor.panes,
      activePaneId: activePaneIndex === 1 ? "secondary" : "primary",
    },
  }
}

/** Recontain every durable window when the desktop viewport changes. */
export function spaceInViewport(space: WorkspaceSpace, viewport: ViewportBounds): WorkspaceSpace {
  const contain = (geometry: WindowGeometry) => geometryInViewport(
    { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
    geometry as unknown as Record<string, unknown>,
    geometry,
    viewport,
  )
  return {
    ...space,
    windows: {
      editor: contain(space.windows.editor),
      "running-app": contain(space.windows["running-app"]),
      tests: contain(space.windows.tests),
      diff: contain(space.windows.diff),
      terminal: contain(space.windows.terminal),
    },
    inspectorWindows: Object.fromEntries(
      Object.entries(space.inspectorWindows).map(([id, geometry]) => [id, contain(geometry)]),
    ),
  }
}

/** Serialize only the strict server contract; browser-only conveniences never enter WorkingWorld. */
export function nextSpaceRevision(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error("SPACE_REVISION_EXHAUSTED")
  }
  return current + 1
}

export function spaceToServer(space: WorkspaceSpace, revision = space.revision) {
  const activePane = space.editor.panes.find((pane) => pane.id === space.editor.activePaneId) ?? space.editor.panes[0]
  const persistedInspectors = Object.entries(space.inspectorWindows)
    .filter(([id]) => {
      const seed = space.inspectorSeeds[id]
      return Boolean(seed) && (isSummonedSurface(seed.kind)
        || seed.kind === "review" && typeof seed.payload === "string" && seed.payload.length > 0)
    })
    .slice(0, 22)
  const persistedInspectorIds = new Set(persistedInspectors.map(([id]) => id))
  // A tab restored from the pre-Experience-V2 shape can still be alive while the
  // upgraded client loads. Persist the windows it actually has; normalizeSpace
  // will add the new utility windows on the next hydration.
  const durableWindowIds = (["editor", "running-app", "tests", "diff", "terminal"] as const)
    .filter((id) => Boolean(space.windows[id]))
  return {
    schemaVersion: 1 as const,
    revision,
    windows: [...durableWindowIds.map((id) => ({
      id: id === "editor" ? "workspace-editor" : id === "running-app" ? "workspace-running-app" : `workspace-${id}`,
      kind: id,
      title: id === "editor" ? "Source" : id === "running-app" ? "TerraFusion" : id === "tests" ? "Tests" : id === "diff" ? "Changes" : "Terminal",
      frame: {
        x: space.windows[id].x,
        y: space.windows[id].y,
        width: space.windows[id].width,
        height: space.windows[id].height,
      },
      z: Math.max(0, Math.min(10_000, Math.round(space.windows[id].z))),
      minimized: space.windows[id].minimized,
    })), ...persistedInspectors.map(([id, geometry]) => {
      const seed = space.inspectorSeeds[id]
      return {
        id,
        kind: "inspector" as const,
        title: seed.kind === "review" ? "Review report" : "Inspector",
        surfaceKind: seed.kind,
        surfaceSubject: seed.subject,
        ...(seed.kind === "review" ? { surfacePayload: seed.payload } : {}),
        frame: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
        z: Math.max(0, Math.min(10_000, Math.round(geometry.z))),
        minimized: geometry.minimized,
      }
    })],
    openFiles: space.editor.openFiles,
    panes: space.editor.panes.map((pane) => ({
      id: pane.id === "primary" ? "workspace-pane" : "workspace-pane-secondary",
      filePath: pane.activePath,
      selection: pane.activePath && pane.selection ? {
        anchor: Math.max(0, Math.round(pane.selection.anchor)),
        head: Math.max(0, Math.round(pane.selection.head)),
      } : null,
    })),
    selection: activePane?.activePath && activePane.selection ? {
      filePath: activePane.activePath,
      anchor: Math.max(0, Math.round(activePane.selection.anchor)),
      head: Math.max(0, Math.round(activePane.selection.head)),
    } : null,
    activeWindowId: space.activeWindowId === "editor" ? "workspace-editor"
      : space.activeWindowId === "running-app" ? "workspace-running-app"
        : space.activeWindowId === "tests" || space.activeWindowId === "diff" || space.activeWindowId === "terminal"
          ? `workspace-${space.activeWindowId}`
        : space.activeWindowId && persistedInspectorIds.has(space.activeWindowId) ? space.activeWindowId : null,
    activePaneId: activePane ? activePane.id === "primary" ? "workspace-pane" : "workspace-pane-secondary" : null,
    runningAppUrl: space.runningAppUrl,
  }
}
