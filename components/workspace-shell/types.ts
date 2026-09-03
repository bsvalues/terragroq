import type { WilliamJudgment, WorldSpine } from "@/lib/environment/working-world"
import { isSummonedSurface } from "@/lib/environment/summon"
import { parseWorkspaceFileRef, type WorkspaceFileRef } from "@/lib/projects/workspace-object-ref"
import type { WorkspaceRepositoryMountView } from "@/lib/projects/core-seven-repositories"
import { parseExecutionAssignmentInspectorPayload } from "./execution-assignment-inspector"

export type WindowId = "editor" | "running-app" | "tests" | "diff" | "terminal"

export type InspectorSeed = Readonly<{ kind: string; subject: string; payload?: string }>

export type PreviewEvidenceReason = "NOT_CONFIGURED" | "URL_INVALID" | "UNREACHABLE" | "IDENTITY_MISMATCH" | "EMBEDDING_REFUSED"

export type PreviewEvidenceSnapshot = Readonly<{
  schemaVersion: 1
  status: "attached" | "unavailable"
  reason: PreviewEvidenceReason | null
  configuredUrl: string | null
  admittedUrl: string | null
  origin: string | null
  identity: "TerraFusion" | "unverified"
  reachable: boolean
  frameable: boolean
  checkedAt: string
  limitations: Readonly<{ dom: "unavailable"; console: "unavailable"; network: "unavailable" }>
  fingerprint: string
}>

export type PreviewInspectorPayload = Readonly<{
  evidence: PreviewEvidenceSnapshot
  snapshot: "live" | "saved"
}>

const PREVIEW_INSPECTOR_PAYLOAD_BYTES = 8 * 1024

function canonicalHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash) return null
    return parsed.toString() === value ? value : null
  } catch {
    return null
  }
}

function canonicalHttpOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password
      || parsed.hash || parsed.search || parsed.pathname !== "/") return null
    return parsed.origin === value ? value : null
  } catch {
    return null
  }
}

/** Copy only the bounded, non-sensitive Preview evidence contract into browser state. */
export function parsePreviewInspectorPayload(value: unknown): PreviewInspectorPayload | null {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    return null
  }
  if (new TextEncoder().encode(encoded).byteLength > PREVIEW_INSPECTOR_PAYLOAD_BYTES
    || !value || typeof value !== "object") return null
  const candidate = value as Record<string, unknown>
  if (candidate.snapshot !== "live" && candidate.snapshot !== "saved") return null
  if (!candidate.evidence || typeof candidate.evidence !== "object") return null
  const evidence = candidate.evidence as Record<string, unknown>
  const configuredUrl = evidence.configuredUrl === null ? null : canonicalHttpUrl(evidence.configuredUrl)
  const admittedUrl = evidence.admittedUrl === null ? null : canonicalHttpUrl(evidence.admittedUrl)
  const origin = evidence.origin === null ? null : canonicalHttpOrigin(evidence.origin)
  const reason = evidence.reason
  const limitations = evidence.limitations
  const checkedAt = typeof evidence.checkedAt === "string" ? evidence.checkedAt : ""
  const checked = new Date(checkedAt)
  const common = evidence.schemaVersion === 1
    && (evidence.status === "attached" || evidence.status === "unavailable")
    && (reason === null || reason === "NOT_CONFIGURED" || reason === "URL_INVALID" || reason === "UNREACHABLE"
      || reason === "IDENTITY_MISMATCH" || reason === "EMBEDDING_REFUSED")
    && (evidence.configuredUrl === null || configuredUrl !== null)
    && (evidence.admittedUrl === null || admittedUrl !== null)
    && (evidence.origin === null || origin !== null)
    && (evidence.identity === "TerraFusion" || evidence.identity === "unverified")
    && typeof evidence.reachable === "boolean"
    && typeof evidence.frameable === "boolean"
    && checkedAt.length <= 40 && !Number.isNaN(checked.getTime()) && checked.toISOString() === checkedAt
    && limitations && typeof limitations === "object"
    && (limitations as Record<string, unknown>).dom === "unavailable"
    && (limitations as Record<string, unknown>).console === "unavailable"
    && (limitations as Record<string, unknown>).network === "unavailable"
    && typeof evidence.fingerprint === "string" && /^[a-f0-9]{64}$/.test(evidence.fingerprint)
  if (!common) return null

  const attached = evidence.status === "attached" && reason === null && configuredUrl !== null
    && admittedUrl !== null && origin !== null && evidence.identity === "TerraFusion"
    && evidence.reachable === true && evidence.frameable === true
  const unavailable = evidence.status === "unavailable" && admittedUrl === null && evidence.identity === "unverified" && (
    ((reason === "NOT_CONFIGURED" || reason === "URL_INVALID") && configuredUrl === null && origin === null && evidence.reachable === false && evidence.frameable === false)
    || (reason === "UNREACHABLE" && configuredUrl !== null && origin !== null && evidence.reachable === false && evidence.frameable === false)
    || (reason === "IDENTITY_MISMATCH" && configuredUrl !== null && origin !== null && evidence.reachable === true && evidence.frameable === true)
    || (reason === "EMBEDDING_REFUSED" && configuredUrl !== null && origin !== null && evidence.reachable === true && evidence.frameable === false)
  )
  if (!attached && !unavailable) return null

  return {
    snapshot: candidate.snapshot,
    evidence: {
      schemaVersion: 1,
      status: evidence.status,
      reason: reason as PreviewEvidenceReason | null,
      configuredUrl,
      admittedUrl,
      origin,
      identity: evidence.identity,
      reachable: evidence.reachable,
      frameable: evidence.frameable,
      checkedAt,
      limitations: { dom: "unavailable", console: "unavailable", network: "unavailable" },
      fingerprint: evidence.fingerprint,
    } as PreviewEvidenceSnapshot,
  }
}

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
  activeFileRef?: WorkspaceFileRef | null
  selection: EditorSelection | null
}>

export type WorkspaceSpace = Readonly<{
  revision: number
  id: string
  name: string
  runningAppUrl: string | null
  windows: Record<WindowId, WindowGeometry>
  inspectorWindows: Record<string, WindowGeometry>
  inspectorSeeds: Record<string, InspectorSeed>
  dock: readonly WindowId[]
  activeWindowId: string | null
  selectedPath: string | null
  selectedFileRef?: WorkspaceFileRef | null
  editor: Readonly<{
    openFiles: readonly string[]
    openFileRefs?: readonly WorkspaceFileRef[]
    panes: readonly EditorPane[]
    activePaneId: EditorPane["id"]
  }>
}>

export type WilliamConversationTurn = Readonly<{
  role: "owner" | "williamos"
  content: string
  at: string
}>

export type SpaceEnvelope = Readonly<{
  worldId: string
  name?: string
  space: unknown
  spine?: WorldSpine
  judgment?: WilliamJudgment | null
  conversation?: readonly WilliamConversationTurn[]
  project?: WorkspaceProject
  storage?: "server" | "browser"
  browserStorageKey?: string
  preferenceStorageKey?: string
  multiSpaceAvailable?: boolean
  spaces?: readonly SpaceSummary[]
  collectionAvailable?: boolean
  collectionReason?: string
}>

export type SpaceSummary = Readonly<{
  worldId: string
  name: string
  space: unknown
  updatedAt: string
}>

export type WorkspaceProject = Readonly<{
  identity: string
  name: string
  repositories?: readonly WorkspaceRepositoryMountView[]
}>

/**
 * Legacy Spaces predate repository-qualified file identity. Their paths were always relative to the
 * one project root, so the only honest upgrade target is the server-verified default repository for
 * that same project. If no such binding exists, leave the legacy state untouched and fail closed at
 * mutation time rather than inventing a repository or revision.
 */
export function qualifyLegacyWorkspaceFiles(space: WorkspaceSpace, project: WorkspaceProject | null | undefined): WorkspaceSpace {
  if (space.editor.openFileRefs !== undefined || space.editor.openFiles.length === 0) return space
  const repository = project?.repositories?.find((candidate) => candidate.defaultRepository)
  if (!project || !repository?.mount.verified || !repository.mount.revision) return space

  const refs = space.editor.openFiles.map((path): WorkspaceFileRef => ({
    projectIdentity: project.identity,
    repositoryResourceKey: repository.key,
    repositoryMountKey: repository.mount.key,
    worktreeKey: null,
    observedRevision: repository.mount.revision as string,
    path,
  }))
  const refForPath = (path: string | null) => path === null
    ? null
    : refs.find((ref) => ref.path === path) ?? null

  return {
    ...space,
    selectedFileRef: refForPath(space.selectedPath),
    editor: {
      ...space.editor,
      openFileRefs: refs,
      panes: space.editor.panes.map((pane) => ({ ...pane, activeFileRef: refForPath(pane.activePath) })),
    },
  }
}

export const WILLIAM_RAIL_WIDTH = 348
export const WILLIAM_RAIL_BREAKPOINT = 1040

export function workspaceCanvasWidth(viewportWidth: number): number {
  const width = Math.max(320, finite(viewportWidth, 1440))
  return width > WILLIAM_RAIL_BREAKPOINT ? Math.max(320, width - WILLIAM_RAIL_WIDTH) : width
}

export function defaultSpace(viewportWidth = 1440, viewportHeight = 900, id = "terrafusion", name = "TerraFusion"): WorkspaceSpace {
  viewportWidth = workspaceCanvasWidth(viewportWidth)
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
    id,
    name,
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
  const viewportWidth = workspaceCanvasWidth(viewport.width)
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
  const rawInspectorWindows = Object.fromEntries(rawWindows.flatMap((window) => {
    if (!window || typeof window !== "object") return []
    const item = window as Record<string, unknown>
    if (item.kind !== "inspector" || typeof item.id !== "string") return []
    const frame = item.frame && typeof item.frame === "object" ? item.frame as Record<string, unknown> : {}
    return [[item.id, geometryInViewport(frame, item, {
      x: 120, y: 90, width: 560, height: 480, z: 3, minimized: false,
    }, viewport)]]
  }))
  const rawInspectorSeeds = Object.fromEntries(rawWindows.flatMap((window) => {
    if (!window || typeof window !== "object") return []
    const item = window as Record<string, unknown>
    if (item.kind !== "inspector" || typeof item.id !== "string"
      || typeof item.surfaceKind !== "string" || typeof item.surfaceSubject !== "string") return []
    const persistedPayload = item.surfaceKind === "review" || item.surfaceKind === "execution-assignment"
    if (persistedPayload && typeof item.surfacePayload !== "string") return []
    if (item.surfaceKind === "execution-assignment") {
      const snapshot = parseExecutionAssignmentInspectorPayload(item.surfacePayload)
      if (!snapshot || snapshot.worldId !== fallback.id) return []
    }
    return [[item.id, {
      kind: item.surfaceKind,
      subject: item.surfaceSubject,
      ...(persistedPayload ? { payload: item.surfacePayload as string } : {}),
    } satisfies InspectorSeed]]
  }))
  const retainedInspectorIds = new Set<string>()
  const summonedSingletons = new Map<string, string>()
  for (const [id, seed] of Object.entries(rawInspectorSeeds)) {
    if (!isSummonedSurface(seed.kind)) {
      retainedInspectorIds.add(id)
      continue
    }
    const key = `${seed.kind}\0${seed.subject}`
    const retainedId = summonedSingletons.get(key)
    if (!retainedId) {
      summonedSingletons.set(key, id)
      retainedInspectorIds.add(id)
      continue
    }
    const retainedGeometry = rawInspectorWindows[retainedId]
    const candidateGeometry = rawInspectorWindows[id]
    const preferCandidate = candidate.activeWindowId === id
      || candidate.activeWindowId !== retainedId && (candidateGeometry?.z ?? -1) > (retainedGeometry?.z ?? -1)
    if (preferCandidate) {
      retainedInspectorIds.delete(retainedId)
      retainedInspectorIds.add(id)
      summonedSingletons.set(key, id)
    }
  }
  const inspectorSeeds = Object.fromEntries(
    Object.entries(rawInspectorSeeds).filter(([id]) => retainedInspectorIds.has(id)),
  ) as Record<string, InspectorSeed>
  const inspectorWindows = Object.fromEntries(
    Object.entries(rawInspectorWindows).filter(([id]) => retainedInspectorIds.has(id)),
  ) as Record<string, WindowGeometry>
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
  const openFileRefs = candidate.fileRefs === undefined ? undefined : Array.isArray(candidate.fileRefs)
    ? candidate.fileRefs.flatMap((value) => {
      try { return [parseWorkspaceFileRef(value)] } catch { return [] }
    })
    : undefined
  const panes: EditorPane[] = rawPanes.flatMap((pane, index) => {
    if (!pane || typeof pane !== "object") return []
    const item = pane as Record<string, unknown>
    let activeFileRef: WorkspaceFileRef | null | undefined
    if (item.fileRef === null) activeFileRef = null
    else if (item.fileRef !== undefined) {
      try { activeFileRef = parseWorkspaceFileRef(item.fileRef) } catch { activeFileRef = undefined }
    }
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
      ...(activeFileRef !== undefined ? { activeFileRef } : {}),
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
    id: fallback.id,
    name: fallback.name,
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
      : panes[activePaneIndex]?.activePath ?? null,
    selectedFileRef: (() => {
      if (rawSelection?.fileRef !== undefined) {
        try { return parseWorkspaceFileRef(rawSelection.fileRef) } catch { return null }
      }
      return panes[activePaneIndex]?.activeFileRef ?? null
    })(),
    editor: {
      openFiles: Array.isArray(candidate.openFiles)
        ? candidate.openFiles.filter((path): path is string => typeof path === "string")
        : fallback.editor.openFiles,
      ...(openFileRefs !== undefined ? { openFileRefs } : {}),
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
        || seed.kind === "review" && typeof seed.payload === "string" && seed.payload.length > 0
        || seed.kind === "execution-assignment" && typeof seed.payload === "string"
          && parseExecutionAssignmentInspectorPayload(seed.payload)?.worldId === space.id)
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
        title: seed.kind === "review" ? "Review report"
          : seed.kind === "execution-assignment" ? "Execution assignment" : "Inspector",
        surfaceKind: seed.kind,
        surfaceSubject: seed.subject,
        ...(seed.kind === "review" || seed.kind === "execution-assignment" ? { surfacePayload: seed.payload } : {}),
        frame: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
        z: Math.max(0, Math.min(10_000, Math.round(geometry.z))),
        minimized: geometry.minimized,
      }
    })],
    openFiles: space.editor.openFiles,
    ...(space.editor.openFileRefs ? { fileRefs: space.editor.openFileRefs } : {}),
    panes: space.editor.panes.map((pane) => ({
      id: pane.id === "primary" ? "workspace-pane" : "workspace-pane-secondary",
      filePath: pane.activePath,
      ...(pane.activeFileRef !== undefined ? { fileRef: pane.activeFileRef } : {}),
      selection: pane.activePath && pane.selection ? {
        anchor: Math.max(0, Math.round(pane.selection.anchor)),
        head: Math.max(0, Math.round(pane.selection.head)),
      } : null,
    })),
    selection: activePane?.activePath && activePane.selection ? {
      filePath: activePane.activePath,
      ...(activePane.activeFileRef ? { fileRef: activePane.activeFileRef } : {}),
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
