/**
 * S6 — the WorkingWorldSnapshot: the central data structure of the Environment (#762).
 *
 * A workspace is not an object the owner manages; it is the current working world, assembled when
 * work is named and restored meaningfully on "where were we". This snapshot is what "meaningfully"
 * means: it represents the MEANING of the work — intent, resources, branch heads, artifacts, agent
 * work, concerns, failures, pending decisions, validation truth, conversational position — and never
 * chrome. No pixel positions. No pane widths. No serialized component state. The layout engine
 * reconstructs a useful Desk FROM this; it never persists INTO it.
 *
 * That rule is enforced, not documented: a snapshot carrying chrome-shaped keys is refused outright.
 * Job 6 is possible exactly to the degree this structure stays honest.
 */

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
  /** Whether Hermes should continue this work unattended, and where it stands. */
  continuation: "active" | "paused" | "settled"
  /**
   * The governed outcome the last current-work read named "next startable" — retained verbatim so
   * "continue it" starts THIS exact item, never a re-selected one. Null when nothing was selectable
   * (no startable outcome, or the read was incomplete). Meaning, not chrome.
   */
  pendingStartWork: RetainedStartWork | null
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
    "lastRedValidation", "conversation", "continuation", "pendingStartWork",
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

  assertNoChrome(snapshot, "")
  return snapshot as unknown as WorkingWorldSnapshot
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
