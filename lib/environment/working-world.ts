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

export type WorkingWorldSnapshot = Readonly<{
  schemaVersion: 1
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
  }
}

/** Parse + refuse: unknown top-level keys and chrome-shaped keys anywhere are both rejected. */
export function validateWorkingWorld(raw: unknown): WorkingWorldSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("WORLD_MALFORMED")
  const snapshot = raw as Record<string, unknown>
  if (snapshot.schemaVersion !== 1) throw new Error("WORLD_SCHEMA_UNKNOWN")
  if (typeof snapshot.intent !== "string" || snapshot.intent.trim() === "") throw new Error("WORLD_NEEDS_INTENT")

  const allowed = new Set([
    "schemaVersion", "intent", "assumption", "resources", "branchHeads", "artifacts", "agentWork",
    "surfaces", "openConcerns", "unresolvedFailures", "pendingDecisions", "lastGreenValidation",
    "lastRedValidation", "conversation", "continuation",
  ])
  for (const key of Object.keys(snapshot)) {
    if (!allowed.has(key)) throw new Error(`WORLD_UNKNOWN_KEY:${key}`)
  }
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
