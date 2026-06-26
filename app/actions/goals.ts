"use server"

import { db } from "@/lib/db"
import { goal, doctrine, workOrder, type Goal } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent, getRecentEvents } from "@/lib/registers/events"
import { validateAction } from "@/app/actions/doctrine"
import { createWorkOrder } from "@/app/actions/work-orders"
import { classifyGoal } from "@/lib/goal/classifier"
import { runLoopVerifier, refuseExecution, type LoopReport } from "@/lib/goal/loop"
import type { CurrentTruth } from "@/lib/goal/current-truth"
import { lane as findLane } from "@/lib/goal/taxonomy"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getGoals(): Promise<Goal[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(goal)
    .where(eq(goal.userId, userId))
    .orderBy(desc(goal.createdAt))
}

// Assemble the Current Truth snapshot from the authoritative registers. Read
// only — this is what the operator must consult before acting (MP-006).
export async function getCurrentTruth(): Promise<CurrentTruth> {
  const userId = await getUserId()

  const [wos, doctrineRules, goals, events] = await Promise.all([
    db.select({ status: workOrder.status }).from(workOrder).where(eq(workOrder.userId, userId)),
    db
      .select({ forbidden: doctrine.forbidden, requiresApproval: doctrine.requiresApproval })
      .from(doctrine)
      .where(and(eq(doctrine.userId, userId), eq(doctrine.active, true))),
    db.select({ status: goal.status }).from(goal).where(eq(goal.userId, userId)),
    getRecentEvents(userId, 1),
  ])

  const activeWorkOrders = wos.filter((w) => w.status === "active").length
  const blockedWorkOrders = wos.filter((w) => w.status === "blocked").length
  const openGoals = goals.filter((g) => g.status === "classified").length
  const forbiddenDoctrineRules = doctrineRules.filter((d) => (d.forbidden?.length ?? 0) > 0).length
  const approvalGatedRules = doctrineRules.filter((d) => (d.requiresApproval?.length ?? 0) > 0).length
  const last = events[0]

  return {
    capturedAt: new Date().toISOString(),
    activeWorkOrders,
    blockedWorkOrders,
    openGoals,
    forbiddenDoctrineRules,
    approvalGatedRules,
    lastEventSummary: last?.summary ?? null,
    lastEventAt: last?.createdAt ? new Date(last.createdAt).toISOString() : null,
    // The console grants no authority on its own. Always read-only here.
    grantedAuthority: "A0_READ_ONLY",
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function nextRef(userId: string): Promise<string> {
  const rows = await db.select({ ref: goal.ref }).from(goal).where(eq(goal.userId, userId))
  let max = 0
  for (const r of rows) {
    const m = r.ref?.match(/GOAL-(\d+)/)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return `GOAL-${String(max + 1).padStart(4, "0")}`
}

/* ------------------------------------------------------------------ */
/* Submit + classify                                                  */
/* ------------------------------------------------------------------ */

export async function submitGoal(command: string): Promise<Goal> {
  const userId = await getUserId()
  const trimmed = command.trim()
  if (!trimmed) throw new Error("A goal command is required.")

  // 1. Deterministic classification.
  const cls = classifyGoal(trimmed)

  // 2. Cross-check against the live doctrine engine. Doctrine can only make the
  //    verdict STRICTER, never looser (fail-closed).
  const doctrineVerdict = await validateAction(trimmed)
  let verdict = cls.verdict
  if (doctrineVerdict.verdict === "forbidden") verdict = "refuse"
  else if (doctrineVerdict.verdict === "requires_approval" && verdict === "allow") {
    verdict = "requires_approval"
  }
  const matchedRules = doctrineVerdict.matches
    .map((m) => m.ref)
    .filter((r): r is string => Boolean(r))

  const requiresApproval = verdict === "requires_approval"
  const ref = await nextRef(userId)

  const [row] = await db
    .insert(goal)
    .values({
      userId,
      ref,
      command: trimmed,
      lane: cls.lane,
      mode: cls.mode,
      risk: cls.risk,
      authority: cls.authority,
      verdict,
      rationale: cls.rationale,
      mistakePatterns: cls.mistakePatterns.map((m) => m.id),
      matchedRules,
      recommendedMove: cls.recommendedMove,
      requiresApproval,
      status: "classified",
    })
    .returning()

  await logEvent({
    userId,
    type: "goal.classified",
    summary: `${ref} classified as ${cls.lane}/${cls.mode} -> ${verdict}`,
    register: "goals",
    refId: row.id,
    metadata: { verdict, authority: cls.authority, mistakePatterns: row.mistakePatterns },
  })
  revalidatePath("/goal-console")
  return row
}

/* ------------------------------------------------------------------ */
/* Read-only loop                                                     */
/* ------------------------------------------------------------------ */

export async function runLoop(goalId: number): Promise<LoopReport> {
  const userId = await getUserId()
  const [g] = await db
    .select()
    .from(goal)
    .where(and(eq(goal.id, goalId), eq(goal.userId, userId)))
  if (!g) throw new Error("Goal not found.")

  // Rebuild a Classification view from the stored record (no re-mutation).
  const cls = classifyGoal(g.command)
  const truth = await getCurrentTruth()
  const report = runLoopVerifier(cls, truth)

  await logEvent({
    userId,
    type: "goal.loop",
    summary: `Ran read-only loop for ${g.ref ?? `#${g.id}`} -> ${report.clearToProceed ? "clear" : "blocked"}`,
    register: "goals",
    refId: g.id,
  })
  return report
}

// Explicit guard surface: the console will never execute a goal. Any attempt
// resolves to a refusal, by design.
export async function attemptExecute(): Promise<{ ok: false; reason: string }> {
  return refuseExecution()
}

/* ------------------------------------------------------------------ */
/* Handoff: goal -> draft work order                                  */
/* ------------------------------------------------------------------ */

export async function convertGoalToWorkOrder(goalId: number): Promise<{ workOrderId: number }> {
  const userId = await getUserId()
  const [g] = await db
    .select()
    .from(goal)
    .where(and(eq(goal.id, goalId), eq(goal.userId, userId)))
  if (!g) throw new Error("Goal not found.")
  if (g.verdict === "refuse") {
    throw new Error("This goal was refused by doctrine/mistake-pattern checks and cannot become a work order.")
  }
  if (g.linkedWorkOrderId) {
    return { workOrderId: g.linkedWorkOrderId }
  }

  const laneDef = findLane(g.lane)
  // The WO is created as a DRAFT only. No authority is granted; commit/tag/push
  // gates stay closed (their defaults). Execution still requires approval.
  const wo = await createWorkOrder({
    title: g.command.length > 80 ? `${g.command.slice(0, 77)}...` : g.command,
    goal: g.command,
    description: g.rationale ?? undefined,
    lane: laneDef?.label ?? g.lane,
    scope: `Authority required: ${g.authority}. Risk: ${g.risk}.`,
    stopConditions: g.requiresApproval ? "Requires explicit operator approval before execution" : undefined,
    priority: g.risk === "critical" ? "critical" : g.risk === "high" ? "high" : "medium",
  })

  await db
    .update(goal)
    .set({ linkedWorkOrderId: wo.id, status: "converted", updatedAt: new Date() })
    .where(and(eq(goal.id, goalId), eq(goal.userId, userId)))

  await logEvent({
    userId,
    type: "goal.converted",
    summary: `${g.ref ?? `#${g.id}`} converted to draft work order ${wo.ref ?? `#${wo.id}`}`,
    register: "goals",
    refId: g.id,
    metadata: { workOrderId: wo.id },
  })
  revalidatePath("/goal-console")
  revalidatePath("/work-orders")
  return { workOrderId: wo.id }
}

export async function dismissGoal(goalId: number): Promise<void> {
  const userId = await getUserId()
  await db
    .update(goal)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(and(eq(goal.id, goalId), eq(goal.userId, userId)))
  await logEvent({
    userId,
    type: "goal.dismissed",
    summary: `Goal #${goalId} dismissed`,
    register: "goals",
    refId: goalId,
  })
  revalidatePath("/goal-console")
}
