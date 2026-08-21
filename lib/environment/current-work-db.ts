import { and, eq, inArray } from "drizzle-orm"

import { authorizeWorkbenchOutcomeExecution } from "@/app/actions/authorize-workbench-outcome-execution"
import { getOutcomeQueueSurface } from "@/app/actions/outcome-queue"
import { db } from "@/lib/db"
import { evidenceRecord, project, workOrder, workbenchThread, workbenchThreadSource } from "@/lib/db/schema"
import { composeStartWorkResult, startWorkIdempotencyKey, type StartWorkOutcome } from "@/lib/environment/start-work"
import type { RetainedStartWork } from "@/lib/environment/working-world"

import {
  aggregateCurrentWork,
  composeCurrentWorkAnswer,
  joinCanonicalWork,
  resolveProject,
  startWorkSelection,
  type CanonicalEvidence,
  type CanonicalWorkOrder,
  type JoinThread,
  type ProjectIdentity,
  type QueueSurfaceItem,
} from "@/lib/environment/canonical-current-work"

/**
 * The live canonical current-work read (#762). Answers "what are we doing on <project>" ONLY through
 * the canonical relationship — project → workbench_thread (getWorkbenchThreads) → bound
 * outcome_queue_item → queue surface (getOutcomeQueueSurface) → work_order / evidence_record — joined
 * by outcomeKey. No title matching. It fails CLOSED: if the governed readers can't be read, it says so
 * rather than falling back to a weaker source. The selected top item's tuple is returned alongside the
 * answer so the later START_WORK consumes the exact item the answer named.
 */
export type CurrentWorkAnswer = Readonly<{
  say: string
  selection: ReturnType<typeof startWorkSelection>
  /** The exact selection retained for a later "continue it" — null when nothing is startable/complete. */
  retained: RetainedStartWork | null
}>

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

export async function answerCurrentWork(text: string, userId: string): Promise<CurrentWorkAnswer> {
  const projects: ProjectIdentity[] = await db
    .select({ id: project.id, key: project.key, name: project.name })
    .from(project)
    .where(eq(project.userId, userId))

  const resolution = resolveProject(text, projects)
  if (resolution.kind !== "resolved") {
    return { say: composeCurrentWorkAnswer(resolution, null), selection: null, retained: null }
  }
  const identity = resolution.project

  // Read the canonical sources; fail closed if any can't be read. The project's threads and the raw
  // outcome→thread bindings come from workbench_thread / workbench_thread_source (NOT the conversational
  // thread projection, whose items are OWNER_INTENT/WILLIAMOS_RESPONSE, not outcome bindings). The
  // queue surface is the authoritative priority/lifecycle source.
  let threadRows: Array<{ id: string; title: string }>
  let bindingRows: Array<{ threadId: string; outcomeKey: string }>
  let surface: Awaited<ReturnType<typeof getOutcomeQueueSurface>>
  try {
    const threadsQuery = db
      .select({ id: workbenchThread.id, title: workbenchThread.title })
      .from(workbenchThread)
      .where(and(eq(workbenchThread.userId, userId), eq(workbenchThread.projectId, identity.id)))
    const bindingsQuery = db
      .select({ threadId: workbenchThreadSource.threadId, outcomeKey: workbenchThreadSource.sourceId })
      .from(workbenchThreadSource)
      .innerJoin(
        workbenchThread,
        and(eq(workbenchThread.userId, workbenchThreadSource.userId), eq(workbenchThread.id, workbenchThreadSource.threadId)),
      )
      .where(and(
        eq(workbenchThreadSource.userId, userId),
        eq(workbenchThread.projectId, identity.id),
        // "outcome" is the table's older spelling of "outcome_queue_item"; match both.
        inArray(workbenchThreadSource.sourceType, ["outcome", "outcome_queue_item"]),
      ))
    ;[threadRows, bindingRows, surface] = await Promise.all([threadsQuery, bindingsQuery, getOutcomeQueueSurface()])
  } catch {
    return {
      say:
        `I couldn't read the governed execution state for ${identity.name} right now, so I won't guess ` +
        `at its current work — the canonical readers are the only source I'll answer from. Try again.`,
      selection: null,
      retained: null,
    }
  }

  const keysByThread = new Map<string, string[]>()
  for (const row of bindingRows) {
    const list = keysByThread.get(row.threadId) ?? []
    list.push(row.outcomeKey)
    keysByThread.set(row.threadId, list)
  }
  const joinThreads: JoinThread[] = threadRows.map((thread) => ({
    threadId: thread.id,
    threadTitle: thread.title,
    loaded: true,
    boundOutcomeKeys: distinct(keysByThread.get(thread.id) ?? []),
  }))

  const surfaceByKey = new Map<string, QueueSurfaceItem>(
    surface.rows.map((row) => [
      row.outcomeKey,
      {
        outcomeKey: row.outcomeKey,
        title: row.title,
        queueOrder: row.queueOrder,
        lifecycleState: row.lifecycleState,
        activeWorkOrderId: row.activeWorkOrderId,
        dependencyKeys: row.dependencyKeys,
      },
    ]),
  )

  // Only the work orders of outcomes bound to THIS project's threads.
  const boundKeys = new Set(joinThreads.flatMap((thread) => thread.boundOutcomeKeys))
  const woIds = distinct(
    [...boundKeys]
      .map((key) => surfaceByKey.get(key)?.activeWorkOrderId ?? null)
      .filter((id): id is number => id !== null),
  )

  const workOrdersById = new Map<number, CanonicalWorkOrder>()
  const evidenceByWorkOrder = new Map<number, CanonicalEvidence[]>()
  if (woIds.length > 0) {
    const [wos, evidence] = await Promise.all([
      db.select({ id: workOrder.id, ref: workOrder.ref, status: workOrder.status })
        .from(workOrder)
        .where(and(eq(workOrder.userId, userId), inArray(workOrder.id, woIds))),
      db.select({ workOrderId: evidenceRecord.workOrderId, result: evidenceRecord.result, notes: evidenceRecord.notes, createdAt: evidenceRecord.createdAt })
        .from(evidenceRecord)
        .where(and(eq(evidenceRecord.userId, userId), inArray(evidenceRecord.workOrderId, woIds))),
    ])
    for (const wo of wos) workOrdersById.set(wo.id, { id: wo.id, ref: wo.ref, status: wo.status })
    for (const row of evidence) {
      if (row.workOrderId === null) continue
      const list = evidenceByWorkOrder.get(row.workOrderId) ?? []
      list.push({ workOrderId: row.workOrderId, result: row.result, notes: row.notes, createdAt: row.createdAt.toISOString() })
      evidenceByWorkOrder.set(row.workOrderId, list)
    }
  }

  const joined = joinCanonicalWork(joinThreads, surfaceByKey, workOrdersById, evidenceByWorkOrder)
  const work = aggregateCurrentWork(identity, joined.threads)
  const selection = startWorkSelection(work)
  // Retain the EXACT named item for a later "continue it" — only when selection is valid (complete
  // read + a suggested top). The retained threadId must be the one authorizeWorkbenchOutcomeExecution
  // accepts: the SOLE root binding with sourceType "outcome" and sourceId = outcomeKey (not the
  // display binding, which may be an outcome_queue_item/member binding). If there isn't exactly one
  // such root thread, the outcome isn't startable through the contract → retain null (fail closed),
  // never a mismatched threadId that would authorize the wrong thread or 500.
  let retained: RetainedStartWork | null = null
  if (selection && work.topStartable) {
    const startable = work.topStartable
    const rootThreads = await db
      .select({ threadId: workbenchThreadSource.threadId })
      .from(workbenchThreadSource)
      .innerJoin(
        workbenchThread,
        and(eq(workbenchThread.userId, workbenchThreadSource.userId), eq(workbenchThread.id, workbenchThreadSource.threadId)),
      )
      .where(and(
        eq(workbenchThreadSource.userId, userId),
        eq(workbenchThread.projectId, identity.id),
        eq(workbenchThreadSource.role, "root"),
        eq(workbenchThreadSource.sourceType, "outcome"),
        eq(workbenchThreadSource.sourceId, startable.outcomeKey),
      ))
      .limit(2)
    if (rootThreads.length === 1) {
      retained = {
        projectId: identity.id,
        projectName: identity.name,
        threadId: rootThreads[0].threadId,
        outcomeKey: startable.outcomeKey,
        outcomeTitle: startable.outcomeTitle,
        activeWorkOrderId: startable.activeWorkOrderId,
      }
    }
  }
  return {
    say: composeCurrentWorkAnswer(resolution, work, { conflicts: joined.conflicts, unresolved: joined.unresolved }),
    selection,
    retained,
  }
}

/**
 * Start the retained selection through the governed authorization contract. Consumes the retained
 * tuple verbatim — no re-resolution, no re-read, no re-prioritisation. The authorization is an atomic
 * revalidate-and-act on (version 0, suggested), so a stale selection fails closed here.
 */
export async function startRetainedWork(retained: RetainedStartWork): Promise<StartWorkOutcome> {
  const idempotencyKey = startWorkIdempotencyKey(retained)
  let result: Awaited<ReturnType<typeof authorizeWorkbenchOutcomeExecution>>
  try {
    result = await authorizeWorkbenchOutcomeExecution({
      projectId: retained.projectId,
      threadId: retained.threadId,
      outcomeKey: retained.outcomeKey,
      idempotencyKey,
      confirmation: "START_WORK",
    })
  } catch (error) {
    return composeStartWorkResult(retained, {
      status: "UNAVAILABLE",
      reason: error instanceof Error ? error.message : "AUTHORIZATION_UNREACHABLE",
    })
  }
  if (result.status === "AUTHORIZED_FOR_ACQUISITION" || result.status === "ALREADY_AUTHORIZED") {
    return composeStartWorkResult(retained, {
      status: result.status,
      queueVersion: result.queueVersion,
      authorization: result.authorization,
    })
  }
  return composeStartWorkResult(retained, { status: result.status, reason: result.reason ?? "UNSPECIFIED" })
}
