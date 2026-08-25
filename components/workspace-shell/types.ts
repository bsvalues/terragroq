import type { WorldSpine } from "@/lib/environment/working-world"
import { isSummonedSurface } from "@/lib/environment/summon"

export type WindowId = "editor" | "running-app"

export type InspectorSeed = Readonly<{ kind: string; subject: string }>

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
}>

export function defaultSpace(viewportWidth = 1440, viewportHeight = 900): WorkspaceSpace {
  const workHeight = Math.max(560, viewportHeight - 58)
  const editorWidth = Math.max(620, Math.round(viewportWidth * 0.64))
  return {
    revision: 0,
    id: "terrafusion",
    name: "TerraFusion",
    runningAppUrl: null,
    windows: {
      editor: {
        x: 26,
        y: 38,
        width: editorWidth,
        height: Math.min(720, workHeight - 28),
        z: 2,
        minimized: false,
      },
      "running-app": {
        x: Math.max(300, viewportWidth - Math.round(viewportWidth * 0.43) - 26),
        y: 78,
        width: Math.max(520, Math.round(viewportWidth * 0.43)),
        height: Math.min(650, workHeight - 68),
        z: 1,
        minimized: false,
      },
    },
    inspectorWindows: {},
    inspectorSeeds: {},
    dock: ["editor", "running-app"],
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
  const width = Math.min(Math.max(360, viewportWidth - 16), Math.max(360, finite(frame?.width, base.width)))
  const height = Math.min(Math.max(260, viewportHeight - 44), Math.max(260, finite(frame?.height, base.height)))
  // Keep at least a draggable title-bar segment visible after display/browser size changes.
  const x = Math.min(Math.max(0, viewportWidth - 180), Math.max(-width + 180, finite(frame?.x, base.x)))
  const y = Math.min(Math.max(28, viewportHeight - 90), Math.max(28, finite(frame?.y, base.y)))
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
    return item.kind === "editor" || item.kind === "running-app" ? [[item.kind, item] as const] : []
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
    return [[item.id, { kind: item.surfaceKind, subject: item.surfaceSubject } satisfies InspectorSeed]]
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
  return {
    revision: Number.isSafeInteger(candidate.revision) && (candidate.revision as number) >= 0
      ? candidate.revision as number : fallback.revision,
    id: "terrafusion",
    name: "TerraFusion",
    runningAppUrl: typeof candidate.runningAppUrl === "string" && candidate.runningAppUrl.length > 0
      ? candidate.runningAppUrl
      : null,
    windows: { editor: normalizeWindow("editor"), "running-app": normalizeWindow("running-app") },
    inspectorWindows,
    inspectorSeeds,
    dock: ["editor", "running-app"],
    activeWindowId: candidate.activeWindowId === "workspace-editor" ? "editor"
      : candidate.activeWindowId === "workspace-running-app" ? "running-app"
      : typeof candidate.activeWindowId === "string" && inspectorWindows[candidate.activeWindowId]
        ? candidate.activeWindowId
      : candidate.activeWindowId === null ? null : fallback.activeWindowId,
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
    .filter(([id]) => Boolean(space.inspectorSeeds[id]) && isSummonedSurface(space.inspectorSeeds[id].kind))
    .slice(0, 22)
  const persistedInspectorIds = new Set(persistedInspectors.map(([id]) => id))
  return {
    schemaVersion: 1 as const,
    revision,
    windows: [...(["editor", "running-app"] as const).map((id) => ({
      id: id === "editor" ? "workspace-editor" : "workspace-running-app",
      kind: id,
      title: id === "editor" ? "Source" : "TerraFusion",
      frame: {
        x: space.windows[id].x,
        y: space.windows[id].y,
        width: space.windows[id].width,
        height: space.windows[id].height,
      },
      z: Math.max(0, Math.min(10_000, Math.round(space.windows[id].z))),
      minimized: space.windows[id].minimized,
    })), ...persistedInspectors.map(([id, geometry]) => ({
      id,
      kind: "inspector" as const,
      title: "Inspector",
      surfaceKind: space.inspectorSeeds[id].kind,
      surfaceSubject: space.inspectorSeeds[id].subject,
      frame: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
      z: Math.max(0, Math.min(10_000, Math.round(geometry.z))),
      minimized: geometry.minimized,
    }))],
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
        : space.activeWindowId && persistedInspectorIds.has(space.activeWindowId) ? space.activeWindowId : null,
    activePaneId: activePane ? activePane.id === "primary" ? "workspace-pane" : "workspace-pane-secondary" : null,
    runningAppUrl: space.runningAppUrl,
  }
}
