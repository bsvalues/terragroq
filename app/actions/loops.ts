"use server"

import { db } from "@/lib/db"
import { loopRun, workOrder, type LoopRun, type WorkOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { validateAction } from "@/app/actions/doctrine"
import { evaluateLoop, loopType, type LoopTypeId } from "@/lib/goal/loop-engine"
import type { AuthorityId } from "@/lib/goal/taxonomy"
import { getActiveGrantForWorkOrder } from "@/app/actions/authority"
import { getBlockingConflictForWorkOrder } from "@/app/actions/conflicts"
import { getActiveLocks } from "@/app/actions/locks"
import { isGrantActive } from "@/lib/governance/authority"
import { checkDoctrineRules } from "@/lib/governance/doctrine-rules"
import { agent as agentSpec } from "@/lib/goal/agent-matrix"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getLoopRuns(limit = 25): Promise<LoopRun[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(loopRun)
    .where(eq(loopRun.userId, userId))
    .orderBy(desc(loopRun.createdAt))
    .limit(limit)
}

async function nextRef(userId: string): Promise<string> {
  const rows = await db.select({ ref: loopRun.ref }).from(loopRun).where(eq(loopRun.userId, userId))
  let max = 0
  for (const r of rows) {
    const m = r.ref?.match(/LOOP-(\d+)/)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return `LOOP-${String(max + 1).padStart(4, "0")}`
}

/* ------------------------------------------------------------------ */
/* Run a governed loop                                                */
/* ------------------------------------------------------------------ */

export interface RunLoopInput {
  loopTypeId: LoopTypeId
  authority: AuthorityId
  workOrderId?: number
  target?: string
  maxIterations?: number
  repoDirty?: boolean
}

export async function runGovernedLoop(input: RunLoopInput): Promise<LoopRun> {
  const userId = await getUserId()
  const spec = loopType(input.loopTypeId)
  if (!spec) throw new Error(`Unknown loop type: ${input.loopTypeId}`)

  // Resolve the work order target (owned by the operator), if any.
  let wo: WorkOrder | null = null
  if (input.workOrderId) {
    const [row] = await db
      .select()
      .from(workOrder)
      .where(and(eq(workOrder.id, input.workOrderId), eq(workOrder.userId, userId)))
      .limit(1)
    if (!row) throw new Error("Work order not found.")
    wo = row
  }

  const target = wo ? `${wo.ref ?? `#${wo.id}`} — ${wo.title}` : input.target?.trim() || "(no target)"

  // Cross-check the loop target against active doctrine when we have a WO. This
  // combines the DB doctrine register (validateAction) with the machine-checkable
  // constitutional rules (WO-015), evaluated against the current lock posture.
  let doctrineVerdict: "allowed" | "requires_approval" | "forbidden" | undefined
  if (wo) {
    const probe = [wo.goal, wo.scope, wo.title].filter(Boolean).join(" . ")
    const v = await validateAction(probe)
    const activeLocks = await getActiveLocks()
    const machine = checkDoctrineRules({
      intent: probe,
      authority: input.authority,
      agentMaxAuthority: wo.agent ? agentSpec(wo.agent)?.maxAuthority : undefined,
      activeLocks: activeLocks.map((l) => ({ kind: l.kind, scope: l.scope })),
    })

    // Forbidden (from either source) wins; then requires_approval; else the DB signal.
    doctrineVerdict =
      v.verdict === "forbidden" || machine.verdict === "forbidden"
        ? "forbidden"
        : v.verdict === "requires_approval" || machine.verdict === "requires_approval"
          ? "requires_approval"
          : v.verdict === "allowed"
            ? "allowed"
            : undefined
  }

  // WO-011: resolve the durable authority grant for this WO. A mutating loop is
  // blocked unless an active grant covers the requested authority.
  let activeGrant: { ref: string | null; authorityLevel: string; active: boolean; reason?: string } | null = null
  if (wo) {
    const grant = await getActiveGrantForWorkOrder(wo.id)
    if (grant) {
      const live = isGrantActive(grant)
      activeGrant = {
        ref: grant.ref,
        authorityLevel: grant.authorityLevel,
        active: live.ok,
        reason: live.ok ? undefined : live.reason,
      }
    }
  }

  // WO-018: an unresolved high-risk conflict on this WO blocks the loop.
  let blockingConflict: { ref: string | null; reason: string } | null = null
  if (wo) {
    const conflict = await getBlockingConflictForWorkOrder(wo.id)
    if (conflict) {
      blockingConflict = {
        ref: conflict.ref,
        reason: conflict.description ?? conflict.detectedBetween,
      }
    }
  }

  const outcome = evaluateLoop(
    {
      loopType: input.loopTypeId,
      target,
      authority: input.authority,
      maxIterations: input.maxIterations,
      repoDirty: input.repoDirty,
      doctrineVerdict,
      activeGrant,
      blockingConflict,
    },
    wo,
  )

  const ref = await nextRef(userId)
  const [row] = await db
    .insert(loopRun)
    .values({
      userId,
      ref,
      target,
      workOrderId: wo?.id ?? null,
      loopType: outcome.loopType,
      authority: outcome.authority,
      iteration: outcome.iteration,
      maxIterations: outcome.maxIterations,
      mode: outcome.mode,
      actionsTaken: outcome.actionsTaken,
      evidenceCollected: outcome.evidenceCollected,
      findings: outcome.findings,
      blockers: outcome.blockers,
      stopReason: outcome.stopReason,
      nextValidMove: outcome.nextValidMove,
      status: outcome.permitted ? "completed" : "stopped",
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: outcome.permitted ? "LOOP_STARTED" : "LOOP_STOPPED",
    entityType: "loop_run",
    entityId: row.id,
    actor: wo?.agent ?? "operator",
    reason: outcome.stopReason ?? `${outcome.loopType} loop permitted`,
    after: { loopType: outcome.loopType, authority: outcome.authority, permitted: outcome.permitted },
    metadata: { target, stopReason: outcome.stopReason },
  })
  await logEvent({
    userId,
    type: "loop.run",
    summary: `${ref} (${outcome.loopType}) on ${target} -> ${outcome.permitted ? "completed" : "STOPPED"}`,
    register: "loops",
    refId: row.id,
    metadata: { stopReason: outcome.stopReason, authority: outcome.authority },
  })
  revalidatePath("/goal-console")
  return row
}
