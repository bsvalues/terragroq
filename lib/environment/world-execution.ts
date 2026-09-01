import type { WorldEvidence, WorldExecutionState, WorldWorker } from "@/lib/environment/working-world"

/**
 * Projecting real runtime execution into the mounted world (phase 2, criterion 6).
 *
 * The environment does NOT get its own event bus. The governed database is already the record of what
 * execution did — outcome lifecycle, the bound work order, evidence records — and inventing a parallel
 * event stream beside it would create a second truth that can disagree with the first. So the world
 * reads canonical state and projects it; the runtime keeps writing exactly what it already writes.
 *
 * This file is deliberately PURE. The mapping is the part that can be wrong in a way nobody notices —
 * a screen confidently showing "implementing" for work that is actually blocked is worse than a screen
 * showing nothing — so it is total, tested state by state, and it never guesses a lane.
 */

export type CanonicalExecution = Readonly<{
  /** outcome_queue_item.lifecycleState for the bound outcome. */
  lifecycleState: string
  /** The work order the acquirer bound, if it has bound one yet. */
  activeWorkOrderId: number | null
  /** work_order.status, when a work order exists. */
  workOrderStatus: string | null
  /** The lane actually executing, when the runtime recorded one. Never inferred. */
  lane: string | null
  /** Evidence records that actually exist for this work. */
  evidence: readonly WorldEvidence[]
  observedAt: string
}>

export type ProjectedExecution = Readonly<{
  execution: WorldExecutionState
  worker: WorldWorker | null
  evidence: readonly WorldEvidence[]
}>

export type ProjectedWorldWorkerSession = Readonly<{
  id: string
  worldId: string
  workOrderId: number
  assignee: string
  agent: string | null
  role: "HERMES" | "Executor"
  providerLabel: string
  assignment: string
  status: WorldExecutionState
  evidence: string
  observedAt: string
}>

export type WorldWorkerSessionProjectionInput = Readonly<{
  worldId: string
  outcome: Readonly<{ key: string; title: string }>
  workOrder: Readonly<{
    id: number
    ref: string | null
    title: string
    assignee: string | null
    agent: string | null
    lane: string | null
  }>
  status: WorldExecutionState
  evidence: readonly WorldEvidence[]
  observedAt: string
}>

function exactIdentity(value: string | null): string | null {
  return value && value === value.trim() && value.length <= 200 && !value.includes("\0") ? value : null
}

function boundedCopy(value: string, fallback: string, max = 500): string {
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ")
  if (!text) return fallback
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Project one exact persisted Work Order executor without inferring identity from its lane. */
export function projectWorldWorkerSession(
  input: WorldWorkerSessionProjectionInput,
): ProjectedWorldWorkerSession | null {
  const assignee = exactIdentity(input.workOrder.assignee)
  if (!assignee || !Number.isSafeInteger(input.workOrder.id) || input.workOrder.id <= 0) return null
  const agent = exactIdentity(input.workOrder.agent)
  const hermes = assignee === "hermes-codex-bridge" && agent === "codex"
  const outcome = boundedCopy(input.outcome.title, input.outcome.key, 240)
  const workOrderRef = exactIdentity(input.workOrder.ref) ?? `Work Order #${input.workOrder.id}`
  const workOrderTitle = boundedCopy(input.workOrder.title, "Bounded assignment", 240)
  const latest = input.evidence.at(-1)
  const evidence = latest
    ? boundedCopy(`${latest.kind}: ${latest.detail}${latest.result ? ` · ${latest.result}` : ""}`, "Persisted execution evidence", 500)
    : "No persisted execution evidence yet"

  return {
    id: `world-worker:${encodeURIComponent(input.worldId)}:${input.workOrder.id}:${encodeURIComponent(assignee)}`,
    worldId: input.worldId,
    workOrderId: input.workOrder.id,
    assignee,
    agent,
    role: hermes ? "HERMES" : "Executor",
    providerLabel: hermes ? "Local execution" : `${assignee}${agent ? ` · ${agent}` : ""}`,
    assignment: boundedCopy(`${outcome} · ${workOrderRef}: ${workOrderTitle}`, "Bounded assignment"),
    status: input.status,
    evidence,
    observedAt: input.observedAt,
  }
}

/**
 * Canonical lifecycle → what the owner is watching.
 *
 * `suggested` is deliberately `idle`: an outcome sitting in the queue is not work in flight, and
 * painting it as active is how a dashboard starts lying about progress. `declined` and `superseded`
 * map to `blocked` rather than `complete` — they are terminal, but nothing was delivered, and the one
 * thing the owner must never read as done is work that stopped.
 */
function fromLifecycle(state: string): WorldExecutionState | null {
  switch (state) {
    case "suggested":
      return "idle"
    case "approved":
      return "authorized"
    case "active":
      return "acquired"
    case "blocked":
    case "declined":
    case "superseded":
      return "blocked"
    case "completed":
      return "complete"
    default:
      return null
  }
}

/**
 * A bound work order refines `acquired` into what the worker is actually doing. Only a status the
 * runtime genuinely writes moves the world; anything unrecognised leaves the lifecycle's answer
 * standing rather than inventing a more specific-sounding one.
 */
function fromWorkOrder(status: string): WorldExecutionState | null {
  switch (status) {
    case "active":
    case "in_progress":
    case "implementing":
      return "implementing"
    case "validating":
    case "validation":
      return "validating"
    case "review":
    case "reviewing":
      return "reviewing"
    case "remediating":
    case "remediation":
      return "remediating"
    case "blocked":
      return "blocked"
    case "completed":
    case "merged":
      return "complete"
    default:
      return null
  }
}

/**
 * Project canonical execution into the world.
 *
 * Terminal lifecycle wins over work-order status: an outcome the queue calls completed or blocked is
 * settled, and a stale work-order row must not drag the world back into "implementing". Otherwise the
 * work order refines the lifecycle, because it is the closer record of what the worker is doing.
 */
export function projectWorldExecution(canonical: CanonicalExecution): ProjectedExecution {
  const lifecycle = fromLifecycle(canonical.lifecycleState)
  // An unknown lifecycle is not mapped to a cheerful default: the world stays blocked, which is the
  // state that asks a human to look, rather than one that implies progress.
  const base: WorldExecutionState = lifecycle ?? "blocked"

  const terminal = base === "complete" || base === "blocked"
  const refined = !terminal && canonical.workOrderStatus
    ? fromWorkOrder(canonical.workOrderStatus)
    : null
  const execution: WorldExecutionState = refined ?? base

  // The lane is a fact the runtime recorded, or it is absent. A worker is never inferred from "some
  // work is happening, so presumably the default lane" — attribution the system cannot prove is
  // exactly the kind of confident wrongness this environment exists to stop rendering.
  const worker: WorldWorker | null = canonical.lane
    ? { lane: canonical.lane, state: execution, since: canonical.observedAt }
    : null

  return { execution, worker, evidence: canonical.evidence }
}

/** Work the runtime is still moving through — the world should keep watching while this is true. */
export function isExecutionLive(execution: WorldExecutionState): boolean {
  return execution !== "idle" && execution !== "complete" && execution !== "blocked"
}
