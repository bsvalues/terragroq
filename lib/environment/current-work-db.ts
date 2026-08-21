import { and, eq, inArray } from "drizzle-orm"

import { getOutcomeQueueSurface } from "@/app/actions/outcome-queue"
import { db } from "@/lib/db"
import { evidenceRecord, project, workOrder, workbenchThread, workbenchThreadSource } from "@/lib/db/schema"

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
    return { say: composeCurrentWorkAnswer(resolution, null), selection: null }
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
  return {
    say: composeCurrentWorkAnswer(resolution, work, { conflicts: joined.conflicts, unresolved: joined.unresolved }),
    selection: startWorkSelection(work),
  }
}
