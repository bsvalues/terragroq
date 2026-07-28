"use server"

import { db } from "@/lib/db"
import {
  doctrine,
  eventLog,
  goal,
  goalOutcomeIntakeReceipt,
  governanceEvent,
  outcomeQueueItem,
  workOrder,
  type Goal,
} from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent, getRecentEvents } from "@/lib/registers/events"
import { validateAction } from "@/app/actions/doctrine"
import { createWorkOrder } from "@/app/actions/work-orders"
import { classifyGoal } from "@/lib/goal/classifier"
import { runLoopVerifier, refuseExecution, type LoopReport } from "@/lib/goal/loop"
import type { CurrentTruth } from "@/lib/goal/current-truth"
import { lane as findLane } from "@/lib/goal/taxonomy"
import { getActiveLocks } from "@/app/actions/locks"
import { hashRecord } from "@/lib/governance/hash"
import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { mapLegacyGoalToOutcome } from "@/lib/outcome-queue/engine"
import { ensureOutcomeQueueHardeningSchema } from "@/scripts/hermes-bridge/outcome-queue-source.mjs"

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

function nextGoalRef(rows: { ref: string | null }[]): string {
  let max = 0
  for (const r of rows) {
    const m = r.ref?.match(/GOAL-(\d+)/)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return `GOAL-${String(max + 1).padStart(4, "0")}`
}

function normalizeIntakeKey(command: string, idempotencyKey?: string): string {
  if (idempotencyKey == null) {
    // Legacy callers remain fail-safe: retrying the same command cannot create
    // another goal. The Goal Console always supplies a fresh stable UUID.
    return `legacy-goal:${hashRecord({ command })}`
  }
  const key = idempotencyKey.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(key)) {
    throw new Error("GOAL_INTAKE_IDEMPOTENCY_KEY_INVALID")
  }
  return key
}

function refusedGoalBinding(goalId: number): string {
  return `refused:goal:${goalId}`
}

/* ------------------------------------------------------------------ */
/* Submit + classify                                                  */
/* ------------------------------------------------------------------ */

export async function submitGoal(command: string, idempotencyKey?: string): Promise<Goal> {
  const userId = await getUserId()
  const trimmed = command.trim()
  if (!trimmed) throw new Error("A goal command is required.")
  const intakeKey = normalizeIntakeKey(trimmed, idempotencyKey)
  const intakeRequestHash = hashRecord({ command: trimmed })

  // 1. Deterministic classification, evaluated against the live lock posture so
  //    machine-checkable doctrine (WO-015) can fire (e.g. STOP/HOLD conflicts).
  const activeLocks = await getActiveLocks()
  const cls = classifyGoal(trimmed, {
    activeLocks: activeLocks.map((l) => ({ kind: l.kind, scope: l.scope })),
  })

  // 2. Cross-check against the live DB doctrine engine. Doctrine can only make
  //    the verdict STRICTER, never looser (fail-closed).
  const doctrineVerdict = await validateAction(trimmed)
  let verdict = cls.verdict
  if (doctrineVerdict.verdict === "forbidden") verdict = "refuse"
  else if (doctrineVerdict.verdict === "requires_approval" && verdict === "allow") {
    verdict = "requires_approval"
  }
  // Merge DB doctrine refs with machine-doctrine rule ids for the audit trail.
  const matchedRules = [
    ...doctrineVerdict.matches.map((m) => m.ref).filter((r): r is string => Boolean(r)),
    ...cls.doctrineViolations.map((v) => v.ruleId),
  ]

  const requiresApproval = verdict === "requires_approval"
  await ensureOutcomeQueueHardeningSchema()

  const submittedAt = new Date()
  const row = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:goal-outcome-intake`}))`,
    )
    const existingReceipts = await transaction
      .select()
      .from(goalOutcomeIntakeReceipt)
      .where(and(
        eq(goalOutcomeIntakeReceipt.userId, userId),
        eq(goalOutcomeIntakeReceipt.idempotencyKey, intakeKey),
      ))
      .limit(2)
    if (existingReceipts.length > 1) {
      throw new Error("GOAL_INTAKE_RECEIPT_DUPLICATED")
    }
    const existingReceipt = existingReceipts[0]
    if (existingReceipt) {
      if (existingReceipt.requestHash !== intakeRequestHash) {
        throw new Error("GOAL_INTAKE_IDEMPOTENCY_CONFLICT")
      }
      const [existingGoal] = await transaction
        .select()
        .from(goal)
        .where(and(eq(goal.userId, userId), eq(goal.id, existingReceipt.goalId)))
        .limit(1)
      if (!existingGoal) throw new Error("GOAL_INTAKE_BINDING_WALL")
      let outcomeBinding: string
      if (existingGoal.verdict === "refuse") {
        outcomeBinding = refusedGoalBinding(existingGoal.id)
        if (existingReceipt.outcomeKey !== outcomeBinding) {
          throw new Error("GOAL_INTAKE_BINDING_WALL")
        }
      } else {
        const [existingOutcome] = await transaction
          .select({
            outcomeKey: outcomeQueueItem.outcomeKey,
            goalId: outcomeQueueItem.goalId,
          })
          .from(outcomeQueueItem)
          .where(and(
            eq(outcomeQueueItem.userId, userId),
            eq(outcomeQueueItem.outcomeKey, existingReceipt.outcomeKey),
          ))
          .limit(1)
        if (existingOutcome?.goalId !== existingGoal.id) {
          throw new Error("GOAL_INTAKE_BINDING_WALL")
        }
        outcomeBinding = existingOutcome.outcomeKey
      }
      const expectedDigest = hashRecord({
        requestHash: intakeRequestHash,
        goalId: existingGoal.id,
        outcomeKey: outcomeBinding,
      })
      if (expectedDigest !== existingReceipt.resultDigest) {
        throw new Error("GOAL_INTAKE_BINDING_WALL")
      }
      const [replayedReceipt] = await transaction
        .update(goalOutcomeIntakeReceipt)
        .set({
          replayCount: sql`${goalOutcomeIntakeReceipt.replayCount} + 1`,
          lastReplayedAt: submittedAt,
        })
        .where(and(
          eq(goalOutcomeIntakeReceipt.userId, userId),
          eq(goalOutcomeIntakeReceipt.idempotencyKey, intakeKey),
          eq(goalOutcomeIntakeReceipt.requestHash, intakeRequestHash),
          eq(goalOutcomeIntakeReceipt.resultDigest, expectedDigest),
        ))
        .returning({ id: goalOutcomeIntakeReceipt.id })
      if (!replayedReceipt) throw new Error("GOAL_INTAKE_REPLAY_WRITE_WALL")
      return existingGoal
    }

    const refs = await transaction
      .select({ ref: goal.ref })
      .from(goal)
      .where(eq(goal.userId, userId))
    const ref = nextGoalRef(refs)
    const [created] = await transaction
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
    let outcomeBinding: string
    if (created.verdict === "refuse") {
      outcomeBinding = refusedGoalBinding(created.id)
    } else {
      const queued = mapLegacyGoalToOutcome(created)
      await transaction.insert(outcomeQueueItem).values({
        userId: queued.userId,
        outcomeKey: queued.outcomeKey,
        goalId: queued.goalId,
        goalRef: queued.goalRef,
        title: queued.title,
        objective: queued.objective,
        queueOrder: queued.queueOrder,
        dependencyKeys: [...queued.dependencyKeys],
        riskClass: queued.riskClass,
        approvalState: queued.approvalState,
        authorityState: queued.authorityState,
        authorityLevel: queued.authorityLevel,
        authoritySubject: queued.authoritySubject,
        authorityAction: queued.authorityAction,
        lifecycleState: queued.lifecycleState,
        lifecycleReason: queued.lifecycleReason,
        terminalEvidenceRefs: [],
        suggestedAt: new Date(queued.suggestedAt!),
      })
      outcomeBinding = queued.outcomeKey
    }
    const resultDigest = hashRecord({
      requestHash: intakeRequestHash,
      goalId: created.id,
      outcomeKey: outcomeBinding,
    })
    const [receipt] = await transaction
      .insert(goalOutcomeIntakeReceipt)
      .values({
        userId,
        idempotencyKey: intakeKey,
        requestHash: intakeRequestHash,
        goalId: created.id,
        outcomeKey: outcomeBinding,
        resultDigest,
        replayCount: 0,
        firstSubmittedAt: submittedAt,
      })
      .returning({ id: goalOutcomeIntakeReceipt.id })
    const [governance] = await transaction
      .insert(governanceEvent)
      .values({
        userId,
        eventType: "GOAL_CREATED",
        entityType: "goal",
        entityId: String(created.id),
        actor: "operator",
        reason: `Classified ${cls.lane}/${cls.mode} -> ${verdict}`,
        afterHash: hashRecord({
          verdict,
          authority: cls.authority,
          doctrine: cls.doctrineViolations.map((violation) => violation.ruleId),
        }),
        metadata: {
          intakeReceiptId: receipt.id,
          requestHash: intakeRequestHash,
          resultDigest,
        },
      })
      .returning({ id: governanceEvent.id })
    await transaction.insert(eventLog).values({
      userId,
      type: "goal.classified",
      summary: `${ref} classified as ${cls.lane}/${cls.mode} -> ${verdict}`,
      register: "goals",
      refId: created.id,
      metadata: {
        verdict,
        authority: cls.authority,
        mistakePatterns: created.mistakePatterns,
        intakeReceiptId: receipt.id,
        governanceEventId: governance.id,
        requestHash: intakeRequestHash,
        resultDigest,
      },
    })
    return created
  })
  revalidatePath("/goal-console")
  revalidatePath("/work-orders")
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
    authorityLevel: g.authority,
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
