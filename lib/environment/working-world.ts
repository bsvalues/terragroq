/**
 * S6 — the WorkingWorldSnapshot: the central data structure of the Environment (#762).
 *
 * A workspace is not an object the owner manages; it is the current working world, assembled when
 * work is named and restored meaningfully on "where were we". This snapshot is what "meaningfully"
 * means: it represents the MEANING of the work — intent, resources, branch heads, artifacts, agent
 * work, concerns, failures, pending decisions, validation truth and conversational position. The
 * binding 2026-08-25 owner contract adds one deliberate product-state exception: the Space's
 * validated window geometry, panes, selection and focus persist because spatial continuity is the
 * product.
 *
 * Arbitrary component chrome remains refused everywhere outside that tight Space contract.
 */

import { isSummonedSurface, type SummonedSurface } from "@/lib/environment/summon"

export type SurfaceKind =
  | "browser" | "editor" | "diff" | "tests" | "terminal" | "trace" | "diagram" | "document" | "agent" | "data"

export type MeaningfulSurface = Readonly<{
  kind: SurfaceKind
  /** What it shows, by meaning: a path, a URL, an artifact ref — never how it is drawn. */
  subject: string
  /** Why it mattered when it last mattered, one owner-language clause. */
  because?: string
  /** Owner pinned it: restoration must bring it back; breathing may never recede it. */
  pinned?: boolean
}>

export type PendingDecision = Readonly<{
  /** The one-sentence question exactly as the Line would ask it. */
  question: string
  /** The owner-gate category that made it genuine. */
  gate: string
  raisedAt: string
}>

export type ValidationMark = Readonly<{ ref: string; at: string }>

export type WilliamJudgmentBasis = Readonly<{
  key: string
  label: string
  value: string
}>

/** A model-authored opinion whose inspectable basis and provenance are retained with the world. */
export type WilliamJudgment = Readonly<{
  recommendation: string
  rationale: string
  basis: readonly WilliamJudgmentBasis[]
  confidence: number
  generatedAt: string
  basisFingerprint: string
  provenance: Readonly<{ provider: string; model: string }>
}>

export type SpaceWindowKind = "editor" | "running-app" | "tests" | "diff" | "terminal" | "line" | "inspector"

type SpaceWindowBase = Readonly<{
  id: string
  title: string
  frame: Readonly<{ x: number; y: number; width: number; height: number }>
  z: number
  minimized: boolean
}>

export type SpaceWindow =
  | (SpaceWindowBase & Readonly<{
      kind: "inspector"
      surfaceKind: SummonedSurface
      surfaceSubject: string
    }>)
  | (SpaceWindowBase & Readonly<{
      kind: Exclude<SpaceWindowKind, "inspector">
      surfaceKind?: never
      surfaceSubject?: never
    }>)

export type SpaceState = Readonly<{
  schemaVersion: 1
  /** Client-authored monotonic state version; server rejects stale/equal saves. */
  revision: number
  windows: readonly SpaceWindow[]
  openFiles: readonly string[]
  panes: readonly Readonly<{
    id: string
    filePath: string | null
    selection?: Readonly<{ anchor: number; head: number }> | null
  }>[]
  selection: Readonly<{ filePath: string; anchor: number; head: number }> | null
  activeWindowId: string | null
  activePaneId: string | null
  /** Server-derived canonical running product URL; null means no truthful serving path is known. */
  runningAppUrl: string | null
}>

/**
 * The execution states a mounted world can be in. These are the HERMES lifecycle as the ENVIRONMENT
 * sees it — the thing the surfaces react to. The owner's whole complaint about a static page reduces
 * to this: nothing on screen was bound to execution, so nothing could change while work happened.
 */
export type WorldExecutionState =
  | "idle"
  | "authorized"
  | "acquired"
  | "implementing"
  | "validating"
  | "reviewing"
  | "remediating"
  | "complete"
  | "blocked"

/**
 * The worker executing the current outcome, as DATA.
 *
 * WilliamOS delegates to lanes; it never becomes one. A lane id belongs here the way a disk name
 * belongs in a file listing — which is precisely what makes "I am Claude" impossible to render: no
 * surface carries a provider persona, only a lane fact.
 */
export type WorldWorker = Readonly<{
  lane: string
  state: WorldExecutionState
  since: string
}>

/** Evidence the world has actually accumulated — never a claim, always a record that exists. */
export type WorldEvidence = Readonly<{
  kind: string
  detail: string
  result: string | null
  at: string
}>

/**
 * The governed spine of a mounted world.
 *
 * Phase 2 of the primary experience replacement: ONE store owns project, objective, thread, outcome,
 * execution, workers, surfaces, evidence and operator context, and everything renders from it. Before
 * this, the environment held a conversation and some surfaces while the governed reality lived
 * elsewhere — so the screen could not move when execution did, and "what is happening?" had nothing
 * authoritative to answer from. Null means genuinely unbound, never "unknown yet": an empty spine is
 * an honest world with no work in it.
 */
export type WorldSpine = Readonly<{
  projectId: number | null
  projectName: string | null
  threadId: string | null
  outcomeKey: string | null
  outcomeTitle: string | null
  workOrderId: number | null
  execution: WorldExecutionState
  worker: WorldWorker | null
  evidence: readonly WorldEvidence[]
}>

const WORLD_EXECUTION_STATES: ReadonlySet<string> = new Set<WorldExecutionState>([
  "idle", "authorized", "acquired", "implementing", "validating", "reviewing", "remediating",
  "complete", "blocked",
])

export const EMPTY_SPINE: WorldSpine = Object.freeze({
  projectId: null,
  projectName: null,
  threadId: null,
  outcomeKey: null,
  outcomeTitle: null,
  workOrderId: null,
  execution: "idle",
  worker: null,
  evidence: [],
})

export type WorkingWorldSnapshot = Readonly<{
  schemaVersion: 1
  /** The governed spine: what work this world IS, and where its execution stands. */
  spine: WorldSpine
  /** The work, in the owner's words — the sentence that assembled this world. */
  intent: string
  /** Stated corrigible assumption currently in force, if any (S1). */
  assumption: string | null
  /** Repositories and resources attached to the work, by canonical identity. */
  resources: readonly string[]
  /** Branch heads that matter: name -> sha. */
  branchHeads: Readonly<Record<string, string>>
  /** Artifacts the work currently cares about (diff refs, run ids, documents). */
  artifacts: readonly string[]
  /** Agent work in flight or paused, by owner-meaningful description. */
  agentWork: readonly string[]
  /** The surfaces that mattered last, by meaning (drives restoration; never layout). */
  surfaces: readonly MeaningfulSurface[]
  /** Open concerns in owner language ("the rename is still undecided"). */
  openConcerns: readonly string[]
  /** Failures seen and not yet resolved. */
  unresolvedFailures: readonly string[]
  /** Genuine owner decisions raised and unanswered. */
  pendingDecisions: readonly PendingDecision[]
  lastGreenValidation: ValidationMark | null
  lastRedValidation: ValidationMark | null
  /** Conversational position: the last few turns, oldest first, roles owner|williamos. */
  conversation: readonly Readonly<{ role: "owner" | "williamos"; content: string; at: string }>[]
  /** William's latest real model judgment, distinct from deterministic safety facts in the UI. */
  judgment: WilliamJudgment | null
  /** Whether Hermes should continue this work unattended, and where it stands. */
  continuation: "active" | "paused" | "settled"
  /**
   * The governed outcome the last current-work read named "next startable" — retained verbatim so
   * "continue it" starts THIS exact item, never a re-selected one. Null when nothing was selectable
   * (no startable outcome, or the read was incomplete). Meaning, not chrome.
   */
  pendingStartWork: RetainedStartWork | null
  /** Owner-authorized spatial state. Unlike arbitrary component chrome, this is product state. */
  space?: SpaceState
}>

/** The exact selection to hand to authorizeWorkbenchOutcomeExecution — no re-resolution, no re-read. */
export type RetainedStartWork = Readonly<{
  projectId: number
  projectName: string
  threadId: string
  outcomeKey: string
  outcomeTitle: string
  activeWorkOrderId: number | null
}>

/**
 * Chrome never enters the snapshot. These are shapes of the mistake, not an exhaustive list — the
 * check is a tripwire that keeps the honest rule visible at the boundary, and it is case-insensitive
 * because chrome sneaks in wearing many cases.
 */
const CHROME_KEY_PATTERN = /(pixel|width|height|paneSize|panewidth|paneheight|layoutRect|x[0-9]|coord|scrollTop|scrollLeft|zIndex|domNode|reactState)/i

export function createWorkingWorld({
  intent,
  assumption = null,
  resources = [],
}: {
  intent: string
  assumption?: string | null
  resources?: readonly string[]
}): WorkingWorldSnapshot {
  const trimmed = intent.trim()
  if (!trimmed) throw new Error("WORLD_NEEDS_INTENT")
  return {
    schemaVersion: 1,
    spine: EMPTY_SPINE,
    intent: trimmed,
    assumption,
    resources,
    branchHeads: {},
    artifacts: [],
    agentWork: [],
    surfaces: [],
    openConcerns: [],
    unresolvedFailures: [],
    pendingDecisions: [],
    lastGreenValidation: null,
    lastRedValidation: null,
    conversation: [],
    judgment: null,
    continuation: "active",
    pendingStartWork: null,
  }
}

/** Parse + refuse: unknown top-level keys and chrome-shaped keys anywhere are both rejected. */
export function validateWorkingWorld(raw: unknown): WorkingWorldSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("WORLD_MALFORMED")
  const snapshot = raw as Record<string, unknown>
  if (snapshot.schemaVersion !== 1) throw new Error("WORLD_SCHEMA_UNKNOWN")
  if (typeof snapshot.intent !== "string" || snapshot.intent.trim() === "") throw new Error("WORLD_NEEDS_INTENT")

  const allowed = new Set([
    "schemaVersion", "spine", "intent", "assumption", "resources", "branchHeads", "artifacts", "agentWork",
    "surfaces", "openConcerns", "unresolvedFailures", "pendingDecisions", "lastGreenValidation",
    "lastRedValidation", "conversation", "judgment", "continuation", "pendingStartWork",
    "space",
  ])
  for (const key of Object.keys(snapshot)) {
    if (!allowed.has(key)) throw new Error(`WORLD_UNKNOWN_KEY:${key}`)
  }
  // The spine is REQUIRED. A world without one is the old shape — a conversation and some surfaces
  // while the governed reality lives somewhere else — which is exactly what phase 2 removes. Worlds
  // persisted before the spine existed migrate forward to an honest empty spine rather than being
  // rejected: an owner should never lose a world to a schema addition.
  if (snapshot.spine === undefined) snapshot.spine = { ...EMPTY_SPINE }
  const spine = snapshot.spine as Record<string, unknown> | null
  if (!spine || typeof spine !== "object" || Array.isArray(spine)) throw new Error("WORLD_SPINE_MALFORMED")
  if (!WORLD_EXECUTION_STATES.has(String(spine.execution))) throw new Error("WORLD_SPINE_EXECUTION_UNKNOWN")
  if (!Array.isArray(spine.evidence)) throw new Error("WORLD_SPINE_EVIDENCE_MALFORMED")

  // Additive migration for worlds saved before William's persistent judgment existed.
  if (snapshot.judgment === undefined) snapshot.judgment = null
  if (snapshot.judgment !== null) snapshot.judgment = validateWilliamJudgment(snapshot.judgment)

  if (snapshot.space !== undefined) snapshot.space = validateSpaceState(snapshot.space)
  // The 2026-08-25 owner contract makes a Space's window geometry durable product state. Continue
  // rejecting layout-shaped keys everywhere else, while validating Space geometry explicitly.
  const meaning: Record<string, unknown> = { ...snapshot }
  delete meaning.space
  assertNoChrome(meaning, "")
  return snapshot as unknown as WorkingWorldSnapshot
}

function judgmentString(value: unknown, error: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\0")) {
    throw new Error(error)
  }
  return value.trim()
}

/** Strict persistence boundary for inference-authored judgment data. */
export function validateWilliamJudgment(raw: unknown): WilliamJudgment {
  const judgment = record(raw, "WORLD_JUDGMENT_MALFORMED")
  exactKeys(judgment, [
    "recommendation", "rationale", "basis", "confidence", "generatedAt", "basisFingerprint", "provenance",
  ], "WORLD_JUDGMENT_UNKNOWN_KEY")
  const recommendation = judgmentString(judgment.recommendation, "WORLD_JUDGMENT_RECOMMENDATION_INVALID", 400)
  const rationale = judgmentString(judgment.rationale, "WORLD_JUDGMENT_RATIONALE_INVALID", 1_200)
  if (!Array.isArray(judgment.basis) || judgment.basis.length === 0 || judgment.basis.length > 8) {
    throw new Error("WORLD_JUDGMENT_BASIS_INVALID")
  }
  const keys = new Set<string>()
  const basis = judgment.basis.map((rawBasis) => {
    const item = record(rawBasis, "WORLD_JUDGMENT_BASIS_MALFORMED")
    exactKeys(item, ["key", "label", "value"], "WORLD_JUDGMENT_BASIS_UNKNOWN_KEY")
    const key = judgmentString(item.key, "WORLD_JUDGMENT_BASIS_KEY_INVALID", 80)
    if (keys.has(key)) throw new Error("WORLD_JUDGMENT_BASIS_DUPLICATE")
    keys.add(key)
    return {
      key,
      label: judgmentString(item.label, "WORLD_JUDGMENT_BASIS_LABEL_INVALID", 120),
      value: judgmentString(item.value, "WORLD_JUDGMENT_BASIS_VALUE_INVALID", 500),
    }
  })
  if (typeof judgment.confidence !== "number" || !Number.isFinite(judgment.confidence)
    || judgment.confidence < 0 || judgment.confidence > 1) {
    throw new Error("WORLD_JUDGMENT_CONFIDENCE_INVALID")
  }
  const generatedAt = judgmentString(judgment.generatedAt, "WORLD_JUDGMENT_TIME_INVALID", 40)
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("WORLD_JUDGMENT_TIME_INVALID")
  const basisFingerprint = judgmentString(judgment.basisFingerprint, "WORLD_JUDGMENT_FINGERPRINT_INVALID", 64)
  if (!/^[0-9a-f]{64}$/.test(basisFingerprint)) throw new Error("WORLD_JUDGMENT_FINGERPRINT_INVALID")
  const provenance = record(judgment.provenance, "WORLD_JUDGMENT_PROVENANCE_MALFORMED")
  exactKeys(provenance, ["provider", "model"], "WORLD_JUDGMENT_PROVENANCE_UNKNOWN_KEY")
  return {
    recommendation,
    rationale,
    basis,
    confidence: judgment.confidence,
    generatedAt,
    basisFingerprint,
    provenance: {
      provider: judgmentString(provenance.provider, "WORLD_JUDGMENT_PROVIDER_INVALID", 120),
      model: judgmentString(provenance.model, "WORLD_JUDGMENT_MODEL_INVALID", 200),
    },
  }
}

const SPACE_WINDOW_KINDS: ReadonlySet<string> = new Set<SpaceWindowKind>([
  "editor", "running-app", "tests", "diff", "terminal", "line", "inspector",
])

function record(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], error: string): void {
  const keys = new Set(allowed)
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new Error(`${error}:${key}`)
}

function boundedString(value: unknown, error: string, max = 500): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0")) {
    throw new Error(error)
  }
  return value
}

function workspaceRelativePath(value: unknown): string {
  const raw = boundedString(value, "SPACE_FILE_PATH_INVALID", 1000).replace(/\\/g, "/")
  if (raw.startsWith("/") || raw.startsWith("//") || /^[A-Za-z]:/.test(raw)) {
    throw new Error("SPACE_FILE_PATH_INVALID")
  }
  const segments = raw.split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    throw new Error("SPACE_FILE_PATH_INVALID")
  }
  return segments.join("/")
}

/** Strict boundary for browser-supplied spatial state before it enters the working-world snapshot. */
export function validateSpaceState(raw: unknown): SpaceState {
  const space = record(raw, "SPACE_MALFORMED")
  exactKeys(space, [
    "schemaVersion", "revision", "windows", "openFiles", "panes", "selection", "activeWindowId", "activePaneId",
    "runningAppUrl",
  ], "SPACE_UNKNOWN_KEY")
  if (space.schemaVersion !== 1) throw new Error("SPACE_SCHEMA_UNKNOWN")
  if (!Number.isSafeInteger(space.revision) || (space.revision as number) < 0) {
    throw new Error("SPACE_REVISION_INVALID")
  }
  if (!Array.isArray(space.windows) || space.windows.length > 24) throw new Error("SPACE_WINDOWS_INVALID")
  if (!Array.isArray(space.openFiles) || space.openFiles.length > 64) throw new Error("SPACE_OPEN_FILES_INVALID")
  if (!Array.isArray(space.panes) || space.panes.length > 16) throw new Error("SPACE_PANES_INVALID")

  const ids = new Set<string>()
  const windows = space.windows.map((rawWindow) => {
    const window = record(rawWindow, "SPACE_WINDOW_MALFORMED")
    exactKeys(window, [
      "id", "kind", "title", "frame", "z", "minimized", "surfaceKind", "surfaceSubject",
    ], "SPACE_WINDOW_UNKNOWN_KEY")
    const id = boundedString(window.id, "SPACE_WINDOW_ID_INVALID", 120)
    if (ids.has(id)) throw new Error("SPACE_WINDOW_ID_DUPLICATE")
    ids.add(id)
    if (!SPACE_WINDOW_KINDS.has(String(window.kind))) throw new Error("SPACE_WINDOW_KIND_INVALID")
    if (window.kind === "inspector") {
      if (window.surfaceKind === undefined || window.surfaceSubject === undefined) {
        throw new Error("SPACE_INSPECTOR_IDENTITY_REQUIRED")
      }
      if (!isSummonedSurface(window.surfaceKind)) throw new Error("SPACE_INSPECTOR_SURFACE_KIND_INVALID")
      boundedString(window.surfaceSubject, "SPACE_INSPECTOR_SURFACE_SUBJECT_INVALID", 1000)
    } else if (window.surfaceKind !== undefined || window.surfaceSubject !== undefined) {
      throw new Error("SPACE_CORE_WINDOW_IDENTITY_FORBIDDEN")
    }
    boundedString(window.title, "SPACE_WINDOW_TITLE_INVALID", 200)
    const frame = record(window.frame, "SPACE_WINDOW_FRAME_INVALID")
    exactKeys(frame, ["x", "y", "width", "height"], "SPACE_WINDOW_FRAME_UNKNOWN_KEY")
    const coordinates = [frame.x, frame.y, frame.width, frame.height]
    if (!coordinates.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("SPACE_WINDOW_FRAME_INVALID")
    }
    if ((frame.width as number) < 240 || (frame.height as number) < 120
      || Math.abs(frame.x as number) > 100_000 || Math.abs(frame.y as number) > 100_000
      || (frame.width as number) > 100_000 || (frame.height as number) > 100_000) {
      throw new Error("SPACE_WINDOW_FRAME_INVALID")
    }
    if (!Number.isSafeInteger(window.z) || (window.z as number) < 0 || (window.z as number) > 10_000) {
      throw new Error("SPACE_WINDOW_Z_INVALID")
    }
    if (typeof window.minimized !== "boolean") throw new Error("SPACE_WINDOW_MINIMIZED_INVALID")
    return window
  })

  const openFiles = space.openFiles.map(workspaceRelativePath)
  const openFileSet = new Set(openFiles)
  if (openFileSet.size !== openFiles.length) throw new Error("SPACE_OPEN_FILES_DUPLICATE")
  const paneIds = new Set<string>()
  const panes = space.panes.map((rawPane) => {
    const pane = record(rawPane, "SPACE_PANE_MALFORMED")
    exactKeys(pane, ["id", "filePath", "selection"], "SPACE_PANE_UNKNOWN_KEY")
    const id = boundedString(pane.id, "SPACE_PANE_ID_INVALID", 120)
    if (paneIds.has(id)) throw new Error("SPACE_PANE_ID_DUPLICATE")
    paneIds.add(id)
    const filePath = pane.filePath === null ? null : workspaceRelativePath(pane.filePath)
    if (filePath !== null && !openFileSet.has(filePath)) throw new Error("SPACE_PANE_FILE_NOT_OPEN")
    let paneSelection: { anchor: number; head: number } | null | undefined
    if (pane.selection === null) {
      paneSelection = null
    } else if (pane.selection !== undefined) {
      if (filePath === null) throw new Error("SPACE_PANE_SELECTION_WITHOUT_FILE")
      const rawPaneSelection = record(pane.selection, "SPACE_PANE_SELECTION_MALFORMED")
      exactKeys(rawPaneSelection, ["anchor", "head"], "SPACE_PANE_SELECTION_UNKNOWN_KEY")
      if (!Number.isSafeInteger(rawPaneSelection.anchor) || (rawPaneSelection.anchor as number) < 0
        || !Number.isSafeInteger(rawPaneSelection.head) || (rawPaneSelection.head as number) < 0) {
        throw new Error("SPACE_PANE_SELECTION_INVALID")
      }
      paneSelection = { anchor: rawPaneSelection.anchor as number, head: rawPaneSelection.head as number }
    }
    return paneSelection === undefined ? { id, filePath } : { id, filePath, selection: paneSelection }
  })

  let selection: SpaceState["selection"] = null
  if (space.selection !== null) {
    const rawSelection = record(space.selection, "SPACE_SELECTION_MALFORMED")
    exactKeys(rawSelection, ["filePath", "anchor", "head"], "SPACE_SELECTION_UNKNOWN_KEY")
    const filePath = workspaceRelativePath(rawSelection.filePath)
    if (!openFileSet.has(filePath)) throw new Error("SPACE_SELECTION_FILE_NOT_OPEN")
    if (!Number.isSafeInteger(rawSelection.anchor) || (rawSelection.anchor as number) < 0
      || !Number.isSafeInteger(rawSelection.head) || (rawSelection.head as number) < 0) {
      throw new Error("SPACE_SELECTION_INVALID")
    }
    selection = { filePath, anchor: rawSelection.anchor as number, head: rawSelection.head as number }
  }
  if (space.activeWindowId !== null && (typeof space.activeWindowId !== "string" || !ids.has(space.activeWindowId))) {
    throw new Error("SPACE_ACTIVE_WINDOW_INVALID")
  }
  if (space.activePaneId !== null && (typeof space.activePaneId !== "string" || !paneIds.has(space.activePaneId))) {
    throw new Error("SPACE_ACTIVE_PANE_INVALID")
  }
  if (selection !== null) {
    const activePane = panes.find((pane) => pane.id === space.activePaneId)
    if (!activePane || activePane.filePath !== selection.filePath) throw new Error("SPACE_SELECTION_NOT_ACTIVE")
  }
  if (space.runningAppUrl !== null) {
    let url: URL
    try { url = new URL(String(space.runningAppUrl)) } catch { throw new Error("SPACE_RUNNING_APP_URL_INVALID") }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("SPACE_RUNNING_APP_URL_INVALID")
  }

  return { ...space, windows, openFiles, panes, selection } as unknown as SpaceState
}

function assertNoChrome(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoChrome(entry, `${path}[${index}]`))
    return
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (CHROME_KEY_PATTERN.test(key)) throw new Error(`WORLD_CHROME_REFUSED:${path ? `${path}.` : ""}${key}`)
      assertNoChrome(child, path ? `${path}.${key}` : key)
    }
  }
}

/** Append a conversation turn, keeping the position bounded to what restoration needs. */
export function withTurn(
  world: WorkingWorldSnapshot,
  role: "owner" | "williamos",
  content: string,
  at: () => string = () => new Date().toISOString(),
): WorkingWorldSnapshot {
  const turn = { role, content: content.trim(), at: at() }
  if (!turn.content) return world
  return { ...world, conversation: [...world.conversation, turn].slice(-40) }
}

/** Record that a surface mattered. Pinned surfaces are kept unique by kind+subject and never dropped. */
export function withSurface(world: WorkingWorldSnapshot, surface: MeaningfulSurface): WorkingWorldSnapshot {
  const rest = world.surfaces.filter(
    (candidate) => !(candidate.kind === surface.kind && candidate.subject === surface.subject),
  )
  return { ...world, surfaces: [...rest, surface].slice(-12) }
}

/**
 * Apply a governed execution change to a mounted world.
 *
 * Criterion 6 of the primary experience replacement: real HERMES state changes must mutate the
 * MOUNTED workspace, rather than the owner navigating somewhere to discover them. This is the single
 * seam that does it, so there is one place where execution reality enters the environment — and one
 * place to test that the environment actually moved.
 *
 * Deliberately additive and total: it returns a new world, never mutates, and it cannot invent work.
 * Advancing execution requires an outcome to advance; a state change with no bound outcome is refused
 * rather than quietly minting a world around nothing, because a workspace that shows work the governed
 * queue does not have is the exact failure this replacement exists to end.
 */
export function withExecution(
  world: WorkingWorldSnapshot,
  change: Readonly<{
    execution: WorldExecutionState
    lane?: string | null
    at: string
    evidence?: WorldEvidence | null
  }>,
): WorkingWorldSnapshot {
  if (!WORLD_EXECUTION_STATES.has(change.execution)) throw new Error("WORLD_SPINE_EXECUTION_UNKNOWN")
  const bound = world.spine.outcomeKey !== null
  if (!bound && change.execution !== "idle") throw new Error("WORLD_EXECUTION_WITHOUT_OUTCOME")
  const worker = change.lane
    ? { lane: change.lane, state: change.execution, since: change.at }
    : world.spine.worker
      // The lane keeps executing across states; only its state moves with the world.
      ? { ...world.spine.worker, state: change.execution }
      : null
  return {
    ...world,
    spine: {
      ...world.spine,
      execution: change.execution,
      worker,
      evidence: change.evidence
        ? [...world.spine.evidence, change.evidence]
        : world.spine.evidence,
    },
  }
}

/**
 * Bind a mounted world to a governed outcome — the moment a world stops being empty and becomes work.
 *
 * Takes the retained selection verbatim (the same tuple START_WORK consumes), so the world is bound to
 * the exact outcome the environment named, never a re-resolved one.
 */
export function withBoundOutcome(
  world: WorkingWorldSnapshot,
  selection: RetainedStartWork,
): WorkingWorldSnapshot {
  return {
    ...world,
    spine: {
      ...world.spine,
      projectId: selection.projectId,
      projectName: selection.projectName,
      threadId: selection.threadId,
      outcomeKey: selection.outcomeKey,
      outcomeTitle: selection.outcomeTitle,
      workOrderId: selection.activeWorkOrderId,
    },
  }
}
