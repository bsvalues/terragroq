/**
 * The canonical current-work reader (#762 real-operator acceptance, replacing closed #940).
 *
 * #940 answered an authoritative question ("what are we doing on TerraFusion?") through a
 * NON-authoritative association — string-matching work-order titles to projects. That is worse than
 * saying "I don't know": it lets a grounded system confidently ground itself in the wrong data. This
 * reader answers only through the canonical relationship:
 *
 *   project (key/name/alias) → workbench_thread.projectId → outcome_queue_item → work_order
 *   with evidence from evidence_record.
 *
 * The authoritative unit is the OUTCOME, not the work order: priority is the outcome-queue order
 * (`queueOrder`), "in flight" is `lifecycleState: "active"` (one per user), `suggested` is queued/
 * proposed and is NOT "currently doing", terminal is done. The SAME resolved object feeds both the
 * answer and the subsequent authorizeWorkbenchOutcomeExecution(START_WORK) call — the item named
 * highest-priority must be the exact item started.
 */

export type ProjectIdentity = Readonly<{ id: number; key: string; name: string }>

/** A single outcome as it stands in the queue, with its active work order and structured evidence. */
export type CanonicalOutcome = Readonly<{
  outcomeKey: string
  outcomeTitle: string
  lifecycleState: string
  queueOrder: number
  activeWorkOrderId: number | null
  dependencyKeys: readonly string[]
}>

/** ExecutionWorkOrderRow subset. */
export type CanonicalWorkOrder = Readonly<{ id: number; ref: string | null; status: string }>

/** ExecutionEvidenceRow subset (evidence_record — never scraped prose). */
export type CanonicalEvidence = Readonly<{
  workOrderId: number
  result: string
  notes: string | null
  createdAt: string
}>

/** One thread's canonical execution state. `loaded: false` means it could not be read — NOT empty. */
export type ThreadExecution = Readonly<{
  threadId: string
  threadTitle: string | null
  loaded: boolean
  outcomes: readonly CanonicalOutcome[]
  workOrders: readonly CanonicalWorkOrder[]
  evidence: readonly CanonicalEvidence[]
}>

/** The resolved item — this exact object is what START_WORK consumes. */
export type CanonicalCurrentWorkItem = Readonly<{
  projectId: number
  projectKey: string
  threadId: string
  threadTitle: string | null
  outcomeKey: string
  outcomeTitle: string
  lifecycleState: string
  queuePosition: number
  activeWorkOrderId: number | null
  workOrderStatus: string | null
  blockers: readonly string[]
  latestEvidence: readonly CanonicalEvidence[]
  actionable: boolean
}>

export type CanonicalCurrentWork = Readonly<{
  project: ProjectIdentity
  /** All non-terminal outcomes, canonical queue order — for the human answer. */
  items: readonly CanonicalCurrentWorkItem[]
  /** The highest-priority STARTABLE (suggested) outcome — what "continue" would START_WORK. */
  topStartable: CanonicalCurrentWorkItem | null
  threadsRead: number
  threadsTotal: number
  complete: boolean
}>

export type ProjectResolution =
  | Readonly<{ kind: "resolved"; project: ProjectIdentity }>
  | Readonly<{ kind: "unknown-named"; named: string }>
  | Readonly<{ kind: "none" }>

// Canonical lifecycle: suggested → approved → active (with blocked as a stuck non-terminal), and
// completed/declined/superseded terminal. "Current work" is every NON-terminal outcome. Only
// `suggested` is START_WORK-able: authorizeWorkbenchOutcomeExecution requires version 0 + suggested +
// unapproved (app/actions/authorize-workbench-outcome-execution.ts) — active/approved/blocked are
// past the start gate and are continuation, not a fresh start.
const TERMINAL_STATES = new Set(["completed", "declined", "superseded", "terminal", "done", "closed", "aborted", "cancelled"])
const STARTABLE_STATES = new Set(["suggested"])
const IN_PROGRESS_STATES = new Set(["active", "approved", "blocked"])

/**
 * Resolve a project ONLY through its registered key/name (alias-aware: "TerraFusion" → key
 * "terrafusion" / name "TerraFusion OS"). A named-but-unregistered project is an honest unknown, never
 * a fuzzy guess. Longer names win so "TerraFusion OS" beats a bare token. Returns "none" when the text
 * names no project at all (a general "what are we doing" — the caller decides scope).
 */
export function resolveProject(text: string, projects: readonly ProjectIdentity[]): ProjectResolution {
  const lower = text.toLowerCase()
  const ranked = [...projects].sort((a, b) => b.name.length - a.name.length)
  for (const project of ranked) {
    // Word-boundary match on BOTH name and key — no unbounded substring (which would let an
    // unregistered "TerraFusionX" match "TerraFusion", violating the no-fuzzy contract).
    const nameRe = new RegExp(`\\b${escapeRegExp(project.name.toLowerCase())}\\b`)
    const keyRe = new RegExp(`\\b${escapeRegExp(project.key.toLowerCase())}\\b`)
    if (nameRe.test(lower) || keyRe.test(lower)) {
      return { kind: "resolved", project }
    }
  }
  // Did the operator explicitly name something project-shaped that we do NOT recognise? Only treat a
  // capitalised proper-noun phrase after "on/for/about" as a named-but-unknown project.
  const named = /\b(?:on|for|about|with)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)/.exec(text)
  if (named) return { kind: "unknown-named", named: named[1] }
  return { kind: "none" }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Aggregate a project's threads deterministically into current work. Retains provenance (threadId +
 * outcomeKey per item). A thread whose canonical state could not be loaded is COUNTED as unread
 * (complete=false) rather than silently dropped — the caller must not claim a complete report.
 */
export function aggregateCurrentWork(
  project: ProjectIdentity,
  threads: readonly ThreadExecution[],
): CanonicalCurrentWork {
  const threadsTotal = threads.length
  const loaded = threads.filter((t) => t.loaded)
  const items: CanonicalCurrentWorkItem[] = []

  for (const thread of loaded) {
    const woById = new Map(thread.workOrders.map((w) => [w.id, w]))
    for (const outcome of thread.outcomes) {
      // Current work is every NON-terminal outcome (suggested/approved/blocked/active). An unknown
      // state is treated conservatively as terminal — never surfaced as work we can't classify.
      if (TERMINAL_STATES.has(outcome.lifecycleState) || (!STARTABLE_STATES.has(outcome.lifecycleState) && !IN_PROGRESS_STATES.has(outcome.lifecycleState))) continue
      const wo = outcome.activeWorkOrderId === null ? undefined : woById.get(outcome.activeWorkOrderId)
      const latestEvidence = outcome.activeWorkOrderId === null
        ? []
        : thread.evidence
            .filter((e) => e.workOrderId === outcome.activeWorkOrderId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 3)
      items.push({
        projectId: project.id,
        projectKey: project.key,
        threadId: thread.threadId,
        threadTitle: thread.threadTitle,
        outcomeKey: outcome.outcomeKey,
        outcomeTitle: outcome.outcomeTitle,
        lifecycleState: outcome.lifecycleState,
        queuePosition: outcome.queueOrder,
        activeWorkOrderId: outcome.activeWorkOrderId,
        workOrderStatus: wo?.status ?? null,
        blockers: [...outcome.dependencyKeys],
        latestEvidence,
        // Only `suggested` can be START_WORK'd; the rest are already past the start gate.
        actionable: STARTABLE_STATES.has(outcome.lifecycleState),
      })
    }
  }

  // In-progress work (active/approved/blocked) reads first — it is what's being done — then the queued
  // (suggested) work. Within each group, queue order is the canonical priority; it is not unique, so
  // ties break by outcomeKey (deterministic), the way the canonical comparator ends.
  items.sort((a, b) => {
    const groupA = IN_PROGRESS_STATES.has(a.lifecycleState) ? 0 : 1
    const groupB = IN_PROGRESS_STATES.has(b.lifecycleState) ? 0 : 1
    if (groupA !== groupB) return groupA - groupB
    if (a.queuePosition !== b.queuePosition) return a.queuePosition - b.queuePosition
    return a.outcomeKey.localeCompare(b.outcomeKey)
  })

  return {
    project,
    items,
    // The item "continue the highest-priority work" would START — the top STARTABLE (suggested) one.
    topStartable: items.find((item) => item.actionable) ?? null,
    threadsRead: loaded.length,
    threadsTotal,
    complete: loaded.length === threadsTotal,
  }
}

/** A project thread and the outcome keys bound to it (from the thread's outcome_queue_item items). */
export type JoinThread = Readonly<{
  threadId: string
  threadTitle: string | null
  loaded: boolean
  boundOutcomeKeys: readonly string[]
}>

/** The queue surface entry for an outcome — the authoritative priority + lifecycle source. */
export type QueueSurfaceItem = Readonly<{
  outcomeKey: string
  title: string
  queueOrder: number
  lifecycleState: string
  activeWorkOrderId: number | null
  dependencyKeys: readonly string[]
}>

export type JoinResult = Readonly<{
  threads: readonly ThreadExecution[]
  /** outcomeKeys bound to more than one project thread — never silently assigned. */
  conflicts: readonly string[]
  /** outcomeKeys bound to a project thread but absent from the queue surface — priority unknowable. */
  unresolved: readonly string[]
}>

/**
 * Join project threads to the queue surface by outcomeKey, into ThreadExecution rows. Enforces the
 * owner's invariants: an outcome bound to more than one thread is a CONFLICT (reported, never
 * silently chosen); an outcome bound to a thread but missing from the surface is UNRESOLVED (reported,
 * never guessed); queue order and lifecycle come only from the surface; evidence stays attached by
 * canonical work-order id. Every produced outcome is provably associated with a project thread.
 */
export function joinCanonicalWork(
  threads: readonly JoinThread[],
  surfaceByKey: ReadonlyMap<string, QueueSurfaceItem>,
  workOrdersById: ReadonlyMap<number, CanonicalWorkOrder>,
  evidenceByWorkOrder: ReadonlyMap<number, readonly CanonicalEvidence[]>,
): JoinResult {
  // Which threads claim each outcome key — the basis for the conflict check.
  const threadsByKey = new Map<string, string[]>()
  for (const thread of threads) {
    if (!thread.loaded) continue
    for (const key of thread.boundOutcomeKeys) {
      const list = threadsByKey.get(key) ?? []
      list.push(thread.threadId)
      threadsByKey.set(key, list)
    }
  }
  const conflicts = [...threadsByKey.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([key]) => key).sort()
  const conflictSet = new Set(conflicts)
  const unresolved: string[] = []

  const result: ThreadExecution[] = threads.map((thread) => {
    if (!thread.loaded) {
      return { threadId: thread.threadId, threadTitle: thread.threadTitle, loaded: false, outcomes: [], workOrders: [], evidence: [] }
    }
    const outcomes: CanonicalOutcome[] = []
    const workOrders: CanonicalWorkOrder[] = []
    const evidence: CanonicalEvidence[] = []
    for (const key of thread.boundOutcomeKeys) {
      if (conflictSet.has(key)) continue // ambiguous provenance — excluded, reported in conflicts
      const surface = surfaceByKey.get(key)
      if (!surface) {
        if (!unresolved.includes(key)) unresolved.push(key)
        continue
      }
      outcomes.push({
        outcomeKey: surface.outcomeKey,
        outcomeTitle: surface.title,
        lifecycleState: surface.lifecycleState,
        queueOrder: surface.queueOrder,
        activeWorkOrderId: surface.activeWorkOrderId,
        dependencyKeys: surface.dependencyKeys,
      })
      if (surface.activeWorkOrderId !== null) {
        const wo = workOrdersById.get(surface.activeWorkOrderId)
        if (wo) workOrders.push(wo)
        for (const e of evidenceByWorkOrder.get(surface.activeWorkOrderId) ?? []) evidence.push(e)
      }
    }
    return { threadId: thread.threadId, threadTitle: thread.threadTitle, loaded: true, outcomes, workOrders, evidence }
  })

  return { threads: result, conflicts, unresolved: unresolved.sort() }
}

function evidenceLine(item: CanonicalCurrentWorkItem): string {
  if (item.latestEvidence.length === 0) return "no evidence recorded yet"
  const latest = item.latestEvidence[0]
  return `latest evidence ${latest.result}${latest.notes ? ` — ${latest.notes}` : ""}`
}

/**
 * Compose the operator-facing answer from the canonical work. Honest about partial reads, never
 * fabricates, and names the exact top item that "continue the highest-priority work" will start.
 */
export function composeCurrentWorkAnswer(
  resolution: ProjectResolution,
  work: CanonicalCurrentWork | null,
  diagnostics?: Readonly<{ conflicts: readonly string[]; unresolved: readonly string[] }>,
): string {
  const notes: string[] = []
  if (diagnostics && diagnostics.conflicts.length > 0) {
    notes.push(
      `${diagnostics.conflicts.length} outcome(s) are bound to more than one thread (${diagnostics.conflicts.join(", ")}); ` +
      `I've excluded them rather than guess which thread owns them.`,
    )
  }
  if (diagnostics && diagnostics.unresolved.length > 0) {
    notes.push(`${diagnostics.unresolved.length} bound outcome(s) aren't in the queue, so I can't place their priority; excluded.`)
  }
  const diagnosticNote = notes.length > 0 ? `${notes.join(" ")}\n` : ""
  return diagnosticNote + composeCurrentWorkAnswerCore(resolution, work)
}

function composeCurrentWorkAnswerCore(resolution: ProjectResolution, work: CanonicalCurrentWork | null): string {
  if (resolution.kind === "unknown-named") {
    return (
      `I don't have a project registered as "${resolution.named}", so I won't guess at its work — ` +
      `inventing state is the failure this surface avoids. Ask about a registered project and I'll ` +
      `read its governed state.`
    )
  }
  if (resolution.kind === "none" || !work) {
    return "Which project? Name one and I'll read its current work from the governed queue — I answer per project, not from a general guess."
  }

  const { project, items, topStartable, threadsRead, threadsTotal } = work
  const partial = work.complete
    ? ""
    : `I can read ${threadsRead} of ${threadsTotal} governed threads for ${project.name}; one canonical ` +
      `execution state is unavailable, so I won't claim this is a complete status, and I won't select ` +
      `work to continue until I can read all of it. From what I can read:\n`

  if (items.length === 0) {
    return (
      partial +
      `Nothing is in flight on ${project.name} — no non-terminal outcome in the governed queue. ` +
      `I'm reading the register, not guessing. Name a piece of work and I'll assemble the world for it.`
    )
  }

  const stateLabel = (item: CanonicalCurrentWorkItem): string => {
    const s = item.lifecycleState
    if (s === "active") return "IN PROGRESS"
    if (s === "approved") return "APPROVED"
    if (s === "blocked") return "BLOCKED"
    return `queued #${item.queuePosition}`
  }
  const lines = items.slice(0, 6).map((item) => {
    const wo = item.activeWorkOrderId ? ` (WO ${item.workOrderStatus ?? "?"})` : ""
    const blocked = item.blockers.length > 0 ? ` — waiting on ${item.blockers.join(", ")}` : ""
    const provenance = item.threadTitle ? ` · thread "${item.threadTitle}"` : ""
    return `• [${stateLabel(item)}] ${item.outcomeTitle}${wo}${blocked} — ${evidenceLine(item)}${provenance}`
  })

  // The "continue" offer is only valid when a STARTABLE outcome exists and reads are complete — that
  // is the exact item startWorkSelection returns, so told == started.
  let closer: string
  if (!work.complete) {
    closer = `I won't name work to continue until the unreadable thread is available — that's where a higher-priority outcome could be.`
  } else if (topStartable) {
    closer =
      `The next startable outcome is "${topStartable.outcomeTitle}" (queued #${topStartable.queuePosition}). ` +
      `Say "continue the highest-priority ${project.name} work" and I'll take that exact outcome through the governed authorization path.`
  } else {
    const inProgress = items.find((item) => IN_PROGRESS_STATES.has(item.lifecycleState))
    closer = inProgress
      ? `Nothing is queued to start — "${inProgress.outcomeTitle}" is already ${inProgress.lifecycleState}; continuing it is a governed step of its own, not a fresh start.`
      : `Nothing here is in a startable state.`
  }

  return partial + `On ${project.name}, current work from the governed queue:\n${lines.join("\n")}\n\n${closer}`
}

/**
 * The machine-usable selection for START_WORK — the exact STARTABLE item the answer named. Returns
 * null when reads were incomplete (an unread thread could hold a higher-priority outcome, so we must
 * not claim a selection), or when nothing is startable. Only a `suggested` outcome is ever selected;
 * active/approved/blocked are continuation, which START_WORK does not do.
 */
export function startWorkSelection(work: CanonicalCurrentWork | null): Readonly<{
  projectId: number
  threadId: string
  outcomeKey: string
  activeWorkOrderId: number | null
}> | null {
  if (!work || !work.complete || !work.topStartable) return null
  const { projectId, threadId, outcomeKey, activeWorkOrderId } = work.topStartable
  return { projectId, threadId, outcomeKey, activeWorkOrderId }
}
