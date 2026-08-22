"use server"

import { randomUUID } from "node:crypto"

import { db } from "@/lib/db"
import {
  doctrine,
  eventLog,
  goal,
  goalOutcomeIntakeReceipt,
  governanceEvent,
  outcomeQueueItem,
  project,
  projectResource,
  workbenchThread,
  workbenchThreadSource,
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
import { and, desc, eq, sql, type SQLWrapper } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { mapLegacyGoalToOutcome } from "@/lib/outcome-queue/engine"
import { routeUniversalIntent } from "@/lib/intent/router"
import { ensureOutcomeQueueHardeningSchema } from "@/scripts/hermes-bridge/outcome-queue-source.mjs"
import {
  buildOutcomeStartRequestHash,
  buildOutcomeStartResultDigest,
  buildRefusedOutcomeStartResultDigest,
  normalizeOutcomeStartInput,
  type NormalizedOutcomeStartInput,
  type StartWorkbenchOutcomeInput,
  type StartWorkbenchOutcomeResult,
} from "@/lib/workbench/outcome-start"
import {
  ISSUE_911_LIVE_NONEMPTY_ACCEPTANCE_CONTRACT_ID,
  issue911LiveAcceptanceContractIds,
  isIssue911ReliabilityOutcomeIntent,
} from "@/lib/workbench/registered-outcome-intent"

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

let outcomeQueueSchemaReady: Promise<void> | null = null

async function ensureGoalOutcomeQueueSchema(): Promise<void> {
  if (!outcomeQueueSchemaReady) {
    const pending = Promise.resolve(ensureOutcomeQueueHardeningSchema())
      .then(() => undefined)
      .catch((error) => {
        if (outcomeQueueSchemaReady === pending) outcomeQueueSchemaReady = null
        throw error
      })
    outcomeQueueSchemaReady = pending
  }
  await outcomeQueueSchemaReady
}

/* ------------------------------------------------------------------ */
/* Submit + classify                                                  */
/* ------------------------------------------------------------------ */

type GoalIntakeResult = Readonly<{
  goal: Goal | null
  start: StartWorkbenchOutcomeResult | null
}>

function exactContractIds(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
}

function issue911LiveAcceptanceSingleton(column: SQLWrapper) {
  return sql`${column} = ARRAY[${ISSUE_911_LIVE_NONEMPTY_ACCEPTANCE_CONTRACT_ID}]::text[]`
}

function unavailableOutcomeStart(
  status: "CONFLICT" | "INVALID_INTENT" | "PROJECT_NOT_FOUND",
  reason:
    | "IDEMPOTENCY_CONFLICT"
    | "CONTRACT_SINGLETON_CONFLICT"
    | "ROUTE_NOT_START_OUTCOME"
    | "PROJECT_NOT_FOUND",
  projectId: number,
): StartWorkbenchOutcomeResult {
  return {
    status,
    reason,
    projectId,
    threadId: null,
    goalId: null,
    outcomeKey: null,
    root: null,
    intakeTruth: "unknown",
    ownershipTruth: "unavailable",
    approvalGrantedByIntake: false,
    authorityGrantedByIntake: false,
    executionAuthorizedByIntake: false,
  }
}

async function persistGoalOutcome(
  command: string,
  idempotencyKey?: string,
  startInput: NormalizedOutcomeStartInput | null = null,
  authenticatedUserId?: string,
): Promise<GoalIntakeResult> {
  const userId = authenticatedUserId ?? await getUserId()
  const trimmed = command.trim()
  if (!trimmed) throw new Error("A goal command is required.")
  const intakeKey = normalizeIntakeKey(trimmed, idempotencyKey)
  const acceptedContractIds = startInput
    ? [...issue911LiveAcceptanceContractIds(startInput)]
    : []
  const intakeRequestHash = startInput
    ? buildOutcomeStartRequestHash(startInput)
    : hashRecord({ command: trimmed })

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
  await ensureGoalOutcomeQueueSchema()

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
    if (existingReceipt && !exactContractIds(existingReceipt.acceptedContractIds, acceptedContractIds)) {
      throw new Error("GOAL_INTAKE_ACCEPTED_CONTRACT_BINDING_WALL")
    }
    if (existingReceipt && existingReceipt.requestHash !== intakeRequestHash) {
      if (startInput) {
        return {
          goal: null,
          start: unavailableOutcomeStart("CONFLICT", "IDEMPOTENCY_CONFLICT", startInput.projectId),
        }
      }
      throw new Error("GOAL_INTAKE_IDEMPOTENCY_CONFLICT")
    }
    if (existingReceipt) {
      const [existingGoal] = await transaction
        .select()
        .from(goal)
        .where(and(eq(goal.userId, userId), eq(goal.id, existingReceipt.goalId)))
        .limit(1)
      if (!existingGoal) throw new Error("GOAL_INTAKE_BINDING_WALL")
      if (!exactContractIds(existingGoal.acceptedContractIds, acceptedContractIds)) {
        throw new Error("GOAL_INTAKE_ACCEPTED_CONTRACT_BINDING_WALL")
      }
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
            acceptedContractIds: outcomeQueueItem.acceptedContractIds,
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
        if (!exactContractIds(existingOutcome.acceptedContractIds, acceptedContractIds)) {
          throw new Error("GOAL_INTAKE_ACCEPTED_CONTRACT_BINDING_WALL")
        }
        outcomeBinding = existingOutcome.outcomeKey
      }
      let start: StartWorkbenchOutcomeResult | null = null
      let expectedDigest: string
      if (startInput && existingGoal.verdict === "refuse") {
        expectedDigest = buildRefusedOutcomeStartResultDigest({
          requestHash: intakeRequestHash,
          goalId: existingGoal.id,
          refusedBinding: outcomeBinding,
          acceptedContractIds,
        })
        start = {
          status: "REFUSED",
          projectId: startInput.projectId,
          threadId: null,
          goalId: existingGoal.id,
          outcomeKey: null,
          root: null,
          intakeTruth: "persisted",
          ownershipTruth: "unavailable",
          approvalGrantedByIntake: false,
          authorityGrantedByIntake: false,
          executionAuthorizedByIntake: false,
        }
      } else if (startInput) {
        const roots = await transaction
          .select({
            threadId: workbenchThreadSource.threadId,
            sourceType: workbenchThreadSource.sourceType,
            sourceId: workbenchThreadSource.sourceId,
            role: workbenchThreadSource.role,
          })
          .from(workbenchThreadSource)
          .where(and(
            eq(workbenchThreadSource.userId, userId),
            eq(workbenchThreadSource.sourceType, "outcome"),
            eq(workbenchThreadSource.sourceId, outcomeBinding),
            eq(workbenchThreadSource.role, "root"),
          ))
          .limit(2)
        if (roots.length !== 1 || roots[0].sourceId !== outcomeBinding) {
          throw new Error("WORKBENCH_OUTCOME_START_BINDING_WALL")
        }
        const [thread] = await transaction
          .select({ id: workbenchThread.id, userId: workbenchThread.userId, projectId: workbenchThread.projectId })
          .from(workbenchThread)
          .where(and(
            eq(workbenchThread.userId, userId),
            eq(workbenchThread.id, roots[0].threadId),
          ))
          .limit(1)
        if (!thread || thread.projectId !== startInput.projectId) {
          throw new Error("WORKBENCH_OUTCOME_START_BINDING_WALL")
        }
        expectedDigest = buildOutcomeStartResultDigest({
          requestHash: intakeRequestHash,
          goalId: existingGoal.id,
          outcomeKey: outcomeBinding,
          threadId: thread.id,
          rootSourceType: "outcome",
          rootSourceId: outcomeBinding,
          acceptedContractIds,
        })
        start = {
          status: "ALREADY_ACCEPTED",
          projectId: startInput.projectId,
          threadId: thread.id,
          goalId: existingGoal.id,
          outcomeKey: outcomeBinding,
          root: { sourceType: "outcome", sourceId: outcomeBinding },
          intakeTruth: "persisted",
          ownershipTruth: "project_thread_bound",
          approvalGrantedByIntake: false,
          authorityGrantedByIntake: false,
          executionAuthorizedByIntake: false,
        }
      } else {
        expectedDigest = hashRecord({
          requestHash: intakeRequestHash,
          goalId: existingGoal.id,
          outcomeKey: outcomeBinding,
        })
      }
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
      return { goal: existingGoal, start }
    }

    if (startInput) {
      const existingAcceptanceMarkers = acceptedContractIds.length === 1
        ? await transaction
            .select({ id: goal.id })
            .from(goal)
            .where(and(
              eq(goal.userId, userId),
              issue911LiveAcceptanceSingleton(goal.acceptedContractIds),
            ))
            .limit(1)
        : []
      const projects = await transaction
        .select({ id: project.id, userId: project.userId, lifecycle: project.lifecycle })
        .from(project)
        .where(and(eq(project.userId, userId), eq(project.id, startInput.projectId)))
        .limit(2)
      let registeredProjectEligible = true
      if (projects.length === 1 && isIssue911ReliabilityOutcomeIntent(startInput.intent)) {
        const primaryRepositories = await transaction
          .select({
            canonicalIdentity: projectResource.canonicalIdentity,
            relationship: projectResource.relationship,
            type: projectResource.type,
          })
          .from(projectResource)
          .where(and(
            eq(projectResource.userId, userId),
            eq(projectResource.projectId, startInput.projectId),
            eq(projectResource.type, "repo"),
            eq(projectResource.relationship, "primary-repo"),
          ))
          .limit(2)
        registeredProjectEligible = projects[0].lifecycle === "active"
          && primaryRepositories.length === 1
          && primaryRepositories[0].canonicalIdentity === "bsvalues/terragroq"
      }
      if ((projects.length !== 1 || !registeredProjectEligible)
        && existingAcceptanceMarkers.length === 0) {
        return {
          goal: null,
          start: unavailableOutcomeStart("PROJECT_NOT_FOUND", "PROJECT_NOT_FOUND", startInput.projectId),
        }
      }
    }

    if (acceptedContractIds.length === 1) {
      const [singletonGoals, singletonOutcomes, singletonReceipts] = await Promise.all([
        transaction
          .select({
            id: goal.id, ref: goal.ref, command: goal.command, lane: goal.lane,
            mode: goal.mode, risk: goal.risk, authority: goal.authority,
            verdict: goal.verdict, requiresApproval: goal.requiresApproval,
            acceptedContractIds: goal.acceptedContractIds,
          })
          .from(goal)
          .where(and(
            eq(goal.userId, userId),
            issue911LiveAcceptanceSingleton(goal.acceptedContractIds),
          ))
          .limit(2),
        transaction
          .select({
            id: outcomeQueueItem.id, goalId: outcomeQueueItem.goalId,
            goalRef: outcomeQueueItem.goalRef, outcomeKey: outcomeQueueItem.outcomeKey,
            title: outcomeQueueItem.title,
            objective: outcomeQueueItem.objective,
            acceptedContractIds: outcomeQueueItem.acceptedContractIds,
          })
          .from(outcomeQueueItem)
          .where(and(
            eq(outcomeQueueItem.userId, userId),
            issue911LiveAcceptanceSingleton(outcomeQueueItem.acceptedContractIds),
          ))
          .limit(2),
        transaction
          .select({
            id: goalOutcomeIntakeReceipt.id, idempotencyKey: goalOutcomeIntakeReceipt.idempotencyKey,
            requestHash: goalOutcomeIntakeReceipt.requestHash, goalId: goalOutcomeIntakeReceipt.goalId,
            outcomeKey: goalOutcomeIntakeReceipt.outcomeKey,
            resultDigest: goalOutcomeIntakeReceipt.resultDigest,
            acceptedContractIds: goalOutcomeIntakeReceipt.acceptedContractIds,
          })
          .from(goalOutcomeIntakeReceipt)
          .where(and(
            eq(goalOutcomeIntakeReceipt.userId, userId),
            issue911LiveAcceptanceSingleton(goalOutcomeIntakeReceipt.acceptedContractIds),
          ))
          .limit(2),
      ])
      const cardinalities = [singletonGoals.length, singletonOutcomes.length, singletonReceipts.length]
      if (cardinalities.some((count) => count > 0)) {
        if (!cardinalities.every((count) => count === 1)) {
          throw new Error("GOAL_INTAKE_ACCEPTANCE_SINGLETON_GRAPH_WALL")
        }
        const [priorGoal] = singletonGoals
        const [priorOutcome] = singletonOutcomes
        const [priorReceipt] = singletonReceipts
        const roots = await transaction
          .select({
            threadId: workbenchThreadSource.threadId,
            sourceType: workbenchThreadSource.sourceType,
            sourceId: workbenchThreadSource.sourceId,
            role: workbenchThreadSource.role,
          })
          .from(workbenchThreadSource)
          .where(and(
            eq(workbenchThreadSource.userId, userId),
            eq(workbenchThreadSource.sourceType, "outcome"),
            eq(workbenchThreadSource.sourceId, priorOutcome.outcomeKey),
            eq(workbenchThreadSource.role, "root"),
          ))
          .limit(2)
        const threads = roots.length === 1
          ? await transaction
              .select({
                id: workbenchThread.id, projectId: workbenchThread.projectId,
                title: workbenchThread.title,
              })
              .from(workbenchThread)
              .where(and(
                eq(workbenchThread.userId, userId),
                eq(workbenchThread.id, roots[0].threadId),
              ))
              .limit(2)
          : []
        const repositories = await transaction
          .select({
            canonicalIdentity: projectResource.canonicalIdentity,
            relationship: projectResource.relationship,
            type: projectResource.type,
          })
          .from(projectResource)
          .where(and(
            eq(projectResource.userId, userId),
            eq(projectResource.projectId, 1),
            eq(projectResource.type, "repo"),
            eq(projectResource.relationship, "primary-repo"),
          ))
          .limit(2)
        let priorAcceptedContractIds: readonly string[] = []
        try {
          priorAcceptedContractIds = issue911LiveAcceptanceContractIds({
            projectId: 1,
            intent: priorGoal.command,
            idempotencyKey: priorReceipt.idempotencyKey,
          })
        } catch {
          throw new Error("GOAL_INTAKE_ACCEPTANCE_SINGLETON_GRAPH_WALL")
        }
        const priorRequestHash = buildOutcomeStartRequestHash({
          projectId: 1,
          intent: priorGoal.command,
          idempotencyKey: priorReceipt.idempotencyKey,
        })
        const expectedPriorResultDigest = roots.length === 1 && threads.length === 1
          ? buildOutcomeStartResultDigest({
              requestHash: priorRequestHash,
              goalId: priorGoal.id,
              outcomeKey: priorOutcome.outcomeKey,
              threadId: threads[0].id,
              rootSourceType: "outcome",
              rootSourceId: priorOutcome.outcomeKey,
              acceptedContractIds: priorAcceptedContractIds,
            })
          : null
        const exactPriorGraph = Number.isSafeInteger(priorGoal.id)
          && typeof priorGoal.ref === "string" && /^GOAL-[0-9]{4,}$/.test(priorGoal.ref)
          && isIssue911ReliabilityOutcomeIntent(priorGoal.command)
          && priorGoal.lane === "operator-objective" && priorGoal.mode === "implement"
          && priorGoal.risk === "R1" && priorGoal.authority === "A2_WRITE_OWN"
          && priorGoal.verdict === "requires_approval" && priorGoal.requiresApproval === true
          && exactContractIds(priorGoal.acceptedContractIds, acceptedContractIds)
          && priorOutcome.goalId === priorGoal.id
          && priorOutcome.goalRef === priorGoal.ref
          && priorOutcome.outcomeKey === `goal:${priorGoal.ref}`
          && priorOutcome.title === priorGoal.command && priorOutcome.objective === priorGoal.command
          && exactContractIds(priorOutcome.acceptedContractIds, acceptedContractIds)
          && priorReceipt.goalId === priorGoal.id
          && priorReceipt.outcomeKey === priorOutcome.outcomeKey
          && priorReceipt.requestHash === priorRequestHash
          && priorReceipt.resultDigest === expectedPriorResultDigest
          && exactContractIds(priorReceipt.acceptedContractIds, acceptedContractIds)
          && exactContractIds(priorAcceptedContractIds, acceptedContractIds)
          && roots.length === 1 && roots[0].sourceType === "outcome"
          && roots[0].sourceId === priorOutcome.outcomeKey && roots[0].role === "root"
          && threads.length === 1 && threads[0].projectId === 1
          && threads[0].title === priorGoal.command
          && repositories.length === 1
          && repositories[0].canonicalIdentity === "bsvalues/terragroq"
        if (!exactPriorGraph) {
          throw new Error("GOAL_INTAKE_ACCEPTANCE_SINGLETON_GRAPH_WALL")
        }
        return {
          goal: null,
          start: unavailableOutcomeStart(
            "CONFLICT",
            "CONTRACT_SINGLETON_CONFLICT",
            startInput!.projectId,
          ),
        }
      }
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
        acceptedContractIds,
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
        acceptedContractIds,
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
    let start: StartWorkbenchOutcomeResult | null = null
    let resultDigest: string
    if (startInput && created.verdict === "refuse") {
      resultDigest = buildRefusedOutcomeStartResultDigest({
        requestHash: intakeRequestHash,
        goalId: created.id,
        refusedBinding: outcomeBinding,
        acceptedContractIds,
      })
      start = {
        status: "REFUSED",
        projectId: startInput.projectId,
        threadId: null,
        goalId: created.id,
        outcomeKey: null,
        root: null,
        intakeTruth: "persisted",
        ownershipTruth: "unavailable",
        approvalGrantedByIntake: false,
        authorityGrantedByIntake: false,
        executionAuthorizedByIntake: false,
      }
    } else if (startInput) {
      const threadId = randomUUID()
      const [insertedThread] = await transaction
        .insert(workbenchThread)
        .values({
          id: threadId,
          userId,
          projectId: startInput.projectId,
          title: trimmed.slice(0, 500),
          createdAt: submittedAt,
          updatedAt: submittedAt,
        })
        .returning({ id: workbenchThread.id })
      if (insertedThread?.id !== threadId) throw new Error("WORKBENCH_OUTCOME_START_THREAD_WRITE_WALL")
      const [insertedRoot] = await transaction
        .insert(workbenchThreadSource)
        .values({
          userId,
          threadId,
          sourceType: "outcome",
          sourceId: outcomeBinding,
          role: "root",
          createdAt: submittedAt,
        })
        .returning({ id: workbenchThreadSource.id })
      if (!insertedRoot) throw new Error("WORKBENCH_OUTCOME_START_ROOT_WRITE_WALL")
      resultDigest = buildOutcomeStartResultDigest({
        requestHash: intakeRequestHash,
        goalId: created.id,
        outcomeKey: outcomeBinding,
        threadId,
        rootSourceType: "outcome",
        rootSourceId: outcomeBinding,
        acceptedContractIds,
      })
      start = {
        status: "ACCEPTED",
        projectId: startInput.projectId,
        threadId,
        goalId: created.id,
        outcomeKey: outcomeBinding,
        root: { sourceType: "outcome", sourceId: outcomeBinding },
        intakeTruth: "persisted",
        ownershipTruth: "project_thread_bound",
        approvalGrantedByIntake: false,
        authorityGrantedByIntake: false,
        executionAuthorizedByIntake: false,
      }
    } else {
      resultDigest = hashRecord({
        requestHash: intakeRequestHash,
        goalId: created.id,
        outcomeKey: outcomeBinding,
      })
    }
    const [receipt] = await transaction
      .insert(goalOutcomeIntakeReceipt)
      .values({
        userId,
        idempotencyKey: intakeKey,
        requestHash: intakeRequestHash,
        goalId: created.id,
        outcomeKey: outcomeBinding,
        acceptedContractIds,
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
          acceptedContractIds,
          ...(start?.status === "ACCEPTED" ? {
            projectId: start.projectId,
            threadId: start.threadId,
            rootSourceType: start.root.sourceType,
            rootSourceId: start.root.sourceId,
            executionAuthorizedByIntake: false,
          } : {}),
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
        acceptedContractIds,
        ...(start?.status === "ACCEPTED" ? {
          projectId: start.projectId,
          threadId: start.threadId,
          rootSourceType: start.root.sourceType,
          rootSourceId: start.root.sourceId,
          executionAuthorizedByIntake: false,
        } : {}),
      },
    })
    return { goal: created, start }
  })
  if (!row.goal) return row
  revalidatePath("/goal-console")
  revalidatePath("/work-orders")
  return row
}

export async function submitGoal(command: string, idempotencyKey?: string): Promise<Goal> {
  const persisted = await persistGoalOutcome(command, idempotencyKey)
  if (!persisted.goal) throw new Error("GOAL_INTAKE_RESULT_WALL")
  return persisted.goal
}

export async function startGoalOutcome(
  input: StartWorkbenchOutcomeInput,
): Promise<StartWorkbenchOutcomeResult> {
  const normalized = normalizeOutcomeStartInput(input)
  const userId = await getUserId()
  const route = routeUniversalIntent(normalized.intent)
  if (route.state !== "routed" || route.destination?.action !== "start_outcome") {
    return unavailableOutcomeStart(
      "INVALID_INTENT",
      "ROUTE_NOT_START_OUTCOME",
      normalized.projectId,
    )
  }
  const persisted = await persistGoalOutcome(
    normalized.intent,
    normalized.idempotencyKey,
    normalized,
    userId,
  )
  if (!persisted.start) throw new Error("WORKBENCH_OUTCOME_START_RESULT_WALL")
  if (persisted.start.intakeTruth === "persisted") {
    revalidatePath("/")
    revalidatePath("/projects")
  }
  return persisted.start
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
