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
  items: readonly CanonicalCurrentWorkItem[]
  topItem: CanonicalCurrentWorkItem | null
  threadsRead: number
  threadsTotal: number
  complete: boolean
}>

export type ProjectResolution =
  | Readonly<{ kind: "resolved"; project: ProjectIdentity }>
  | Readonly<{ kind: "unknown-named"; named: string }>
  | Readonly<{ kind: "none" }>

// "active" is the single in-flight outcome; "suggested" is queued/proposed (NOT currently doing).
// Everything else (terminal, superseded) is excluded from current work.
const IN_FLIGHT = "active"
const QUEUED = "suggested"

/**
 * Resolve a project ONLY through its registered key/name (alias-aware: "TerraFusion" → key
 * "terrafusion" / name "TerraFusion OS"). A named-but-unregistered project is an honest unknown, never
 * a fuzzy guess. Longer names win so "TerraFusion OS" beats a bare token. Returns "none" when the text
 * names no project at all (a general "what are we doing" — the caller decides scope).
 */
export function resolveProject(text: string, projects: readonly ProjectIdentity[]): ProjectResolution {
  const lower = ` ${text.toLowerCase()} `
  const ranked = [...projects].sort((a, b) => b.name.length - a.name.length)
  for (const project of ranked) {
    const key = project.key.toLowerCase()
    const name = project.name.toLowerCase()
    if (lower.includes(` ${name} `) || lower.includes(name) || new RegExp(`\\b${escapeRegExp(key)}\\b`).test(lower)) {
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
      if (outcome.lifecycleState !== IN_FLIGHT && outcome.lifecycleState !== QUEUED) continue
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
        // Both the in-flight item and a queued item are things START_WORK can act on; terminal never
        // reaches here. "Blocked" (unmet dependencies) is surfaced but does not remove actionability —
        // the caller decides, and never invents.
        actionable: true,
      })
    }
  }

  // Queue order wins over timestamps/titles; the single active outcome is always the current work, so
  // it sorts first regardless of its queueOrder.
  items.sort((a, b) => {
    const activeA = a.lifecycleState === IN_FLIGHT ? 0 : 1
    const activeB = b.lifecycleState === IN_FLIGHT ? 0 : 1
    if (activeA !== activeB) return activeA - activeB
    return a.queuePosition - b.queuePosition
  })

  return {
    project,
    items,
    topItem: items[0] ?? null,
    threadsRead: loaded.length,
    threadsTotal,
    complete: loaded.length === threadsTotal,
  }
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
export function composeCurrentWorkAnswer(resolution: ProjectResolution, work: CanonicalCurrentWork | null): string {
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

  const { project, items, topItem, threadsRead, threadsTotal } = work
  const partial = work.complete
    ? ""
    : `I can read ${threadsRead} of ${threadsTotal} governed threads for ${project.name}; one canonical ` +
      `execution state is unavailable, so I won't claim this is a complete status. From what I can read:\n`

  if (items.length === 0) {
    return (
      partial +
      `Nothing is in flight on ${project.name} — no active or queued outcome in the governed queue. ` +
      `I'm reading the register, not guessing. Name a piece of work and I'll assemble the world for it.`
    )
  }

  const lines = items.slice(0, 6).map((item) => {
    const flag = item.lifecycleState === IN_FLIGHT ? "ACTIVE" : `queued #${item.queuePosition}`
    const wo = item.activeWorkOrderId ? ` (WO ${item.workOrderStatus ?? "?"})` : ""
    const blocked = item.blockers.length > 0 ? ` — waiting on ${item.blockers.join(", ")}` : ""
    const provenance = item.threadTitle ? ` · thread "${item.threadTitle}"` : ""
    return `• [${flag}] ${item.outcomeTitle}${wo}${blocked} — ${evidenceLine(item)}${provenance}`
  })
  const top = topItem!
  const topLabel = top.lifecycleState === IN_FLIGHT ? "the active outcome" : `the top of the queue (#${top.queuePosition})`

  return (
    partial +
    `On ${project.name}, current work from the governed queue:\n${lines.join("\n")}\n\n` +
    `Highest priority is "${top.outcomeTitle}" — ${topLabel}. Say "continue the highest-priority ` +
    `${project.name} work" and I'll take that exact outcome through the governed authorization path.`
  )
}

/** The machine-usable selection for START_WORK — the exact item the answer named highest-priority. */
export function startWorkSelection(work: CanonicalCurrentWork | null): Readonly<{
  projectId: number
  threadId: string
  outcomeKey: string
  activeWorkOrderId: number | null
}> | null {
  if (!work?.topItem) return null
  const { projectId, threadId, outcomeKey, activeWorkOrderId } = work.topItem
  return { projectId, threadId, outcomeKey, activeWorkOrderId }
}
