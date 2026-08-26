"use server"

import { db } from "@/lib/db"
import {
  project,
  projectResource,
  workOrder,
  workOrderAcceptanceAttempt,
  workOrderBindingEvent,
  workOrderBoundResource,
  workOrderTruthBinding,
} from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import {
  checkBindingReadiness,
  checkPremise,
  dispositionFor,
  validateLineage,
  type BindingEvent,
  type BoundResourceRole,
  type ObservedBinding,
  type TruthBindingLike,
} from "@/lib/work-orders/truth-binding"
import { and, eq } from "drizzle-orm"

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */

/**
 * The binding in force for a work order, assembled into the shape the pure rules consume.
 *
 * Exported so the activation gate in `transitionWorkOrder` can refuse an unbound contract without
 * duplicating the assembly.
 */
export async function loadTruthBinding(
  workOrderId: number,
): Promise<(TruthBindingLike & { id: number }) | null> {
  const [binding] = await db
    .select()
    .from(workOrderTruthBinding)
    .where(
      and(
        eq(workOrderTruthBinding.workOrderId, workOrderId),
        eq(workOrderTruthBinding.status, "bound"),
      ),
    )
    .limit(1)
  if (!binding) return null

  const resources = await db
    .select()
    .from(workOrderBoundResource)
    .where(eq(workOrderBoundResource.bindingId, binding.id))

  const lineage = await db
    .select()
    .from(workOrderBindingEvent)
    .where(eq(workOrderBindingEvent.bindingId, binding.id))

  return {
    id: binding.id,
    projectId: binding.projectId,
    runtimeResourceKey: binding.runtimeResourceKey,
    resources: resources.map((r) => ({
      resourceKey: r.resourceKey,
      resourceType: r.resourceType,
      canonicalIdentity: r.canonicalIdentity,
      role: r.role as BoundResourceRole,
      ratifiedAt: r.ratifiedAt,
    })),
    lineage: lineage.map((e) => ({
      resourceKey: e.resourceKey,
      event: e.event as BindingEvent,
      sha: e.sha,
      reason: e.reason,
      at: e.at,
    })),
  }
}

async function requireOwnedWorkOrder(id: number, userId: string) {
  const [wo] = await db
    .select()
    .from(workOrder)
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
    .limit(1)
  if (!wo) throw new Error("Work order not found")
  return wo
}

/* ------------------------------------------------------------------ */
/* Bind                                                                */
/* ------------------------------------------------------------------ */

export interface BindResourceInput {
  resourceKey: string
  role?: BoundResourceRole
  /** Required for `source` resources — the revision at activation. */
  sha?: string
}

/**
 * Capture the base truth binding for a work order.
 *
 * Identity and ratification are SNAPSHOTTED from `project_resource` here, not referenced live: if
 * the resource record is edited later, acceptance must still be judged against what the contract
 * was actually activated against.
 */
export async function bindWorkOrderTruth(input: {
  workOrderId: number
  projectId: number
  resources: BindResourceInput[]
  runtimeResourceKey?: string
}) {
  const userId = await getUserId()
  const wo = await requireOwnedWorkOrder(input.workOrderId, userId)

  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, input.projectId), eq(project.userId, userId)))
    .limit(1)
  if (!proj) throw new Error("Project not found")

  const existing = await loadTruthBinding(input.workOrderId)
  if (existing) {
    throw new Error(
      "This work order is already bound — record a rebind or successor rather than re-binding",
    )
  }

  const [binding] = await db
    .insert(workOrderTruthBinding)
    .values({
      workOrderId: input.workOrderId,
      projectId: input.projectId,
      runtimeResourceKey: input.runtimeResourceKey ?? null,
      status: "bound",
      boundBy: userId,
    })
    .returning()

  for (const r of input.resources) {
    const [pr] = await db
      .select()
      .from(projectResource)
      .where(
        and(
          eq(projectResource.projectId, input.projectId),
          eq(projectResource.resourceKey, r.resourceKey),
        ),
      )
      .limit(1)
    if (!pr) {
      throw new Error(
        `Resource "${r.resourceKey}" is not a resource of this Project — bind canonical resources, not names`,
      )
    }

    await db.insert(workOrderBoundResource).values({
      bindingId: binding.id,
      resourceKey: r.resourceKey,
      projectResourceId: pr.id,
      resourceType: pr.type,
      canonicalIdentity: pr.canonicalIdentity,
      role: r.role ?? "source",
      ratifiedAt: pr.ratifiedAt,
    })

    if (r.sha) {
      await db.insert(workOrderBindingEvent).values({
        bindingId: binding.id,
        resourceKey: r.resourceKey,
        event: "bound",
        sha: r.sha,
        reason: "Base binding captured at activation",
        recordedBy: userId,
      })
    }
  }

  await appendGovernanceEvent({
    userId,
    eventType: "WO_TRUTH_BOUND",
    entityType: "work_order",
    entityId: input.workOrderId,
    reason: `Bound to project ${proj.key}`,
    after: {
      bindingId: binding.id,
      projectId: input.projectId,
      resources: input.resources.map((r) => r.resourceKey),
    },
  })
  await logEvent({
    userId,
    type: "work_order.truth.bound",
    summary: `${wo.ref ?? `#${wo.id}`}: bound to ${proj.key}`,
    register: "work-orders",
    refId: wo.id,
  })
  return binding
}

/**
 * Record that a bound revision moved.
 *
 * `rebound` — moved for a reason outside this contract (upstream advance, deliberate rebase).
 * `successor` — a revision this contract itself produced.
 *
 * Either way it is recorded, never assumed. An unrecorded move is what turns into a premise failure
 * at acceptance.
 */
export async function recordBindingMovement(input: {
  workOrderId: number
  resourceKey: string
  event: Extract<BindingEvent, "rebound" | "successor">
  sha: string
  reason?: string
}) {
  const userId = await getUserId()
  await requireOwnedWorkOrder(input.workOrderId, userId)

  const binding = await loadTruthBinding(input.workOrderId)
  if (!binding) throw new Error("Work order has no truth binding to move")
  if (!binding.resources.some((r) => r.resourceKey === input.resourceKey)) {
    throw new Error(`Resource "${input.resourceKey}" is not bound to this work order`)
  }
  const lineage = validateLineage(binding.lineage, input.resourceKey)
  if (!lineage.valid) throw new Error(`Cannot move an invalid lineage: ${lineage.problem}`)

  await db.insert(workOrderBindingEvent).values({
    bindingId: binding.id,
    resourceKey: input.resourceKey,
    event: input.event,
    sha: input.sha,
    reason: input.reason ?? null,
    recordedBy: userId,
  })

  await appendGovernanceEvent({
    userId,
    eventType: "WO_TRUTH_REBOUND",
    entityType: "work_order",
    entityId: input.workOrderId,
    reason: input.reason ?? `Recorded ${input.event}`,
    after: { resourceKey: input.resourceKey, event: input.event, sha: input.sha },
  })
}

/* ------------------------------------------------------------------ */
/* Acceptance                                                          */
/* ------------------------------------------------------------------ */

/**
 * Record an acceptance attempt against what was actually observed.
 *
 * The premise is judged before the operations. "Every mechanic worked, against the wrong thing" is
 * `PREMISE_FAILED` — neither an ordinary FAIL nor a PARTIAL — and it does not close the contract.
 */
export async function recordAcceptanceAttempt(input: {
  workOrderId: number
  observed: ObservedBinding
  operationsPassed: boolean
  partial?: boolean
  verifiedBy: string
  verifierKind?: "deterministic" | "principal"
  /** The principal that did the work; a principal verifier must not be it. */
  implementedBy?: string
}) {
  const userId = await getUserId()
  const wo = await requireOwnedWorkOrder(input.workOrderId, userId)

  const binding = await loadTruthBinding(input.workOrderId)
  if (!binding) throw new Error("Cannot judge acceptance against an unbound work order")

  const premise = checkPremise(binding, input.observed)
  const kind = input.verifierKind ?? "deterministic"
  // A deterministic verifier observes the system rather than the agent's account of itself, so it
  // is independent by construction. A principal verifier must not be the implementer.
  const verifierIsIndependent =
    kind === "deterministic" ? true : input.verifiedBy !== input.implementedBy

  const outcome = dispositionFor({
    operationsPassed: input.operationsPassed,
    partial: input.partial,
    premise,
    verifierIsIndependent,
  })

  const [attempt] = await db
    .insert(workOrderAcceptanceAttempt)
    .values({
      workOrderId: input.workOrderId,
      bindingId: binding.id,
      disposition: outcome.disposition,
      reason: outcome.reason,
      verifiedBy: input.verifiedBy,
      verifierKind: kind,
      observed: input.observed as unknown as object,
      divergences: premise.divergences as unknown as object,
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: "WO_ACCEPTANCE_ATTEMPTED",
    entityType: "work_order",
    entityId: input.workOrderId,
    reason: outcome.reason,
    after: {
      attemptId: attempt.id,
      disposition: outcome.disposition,
      certifies: outcome.certifies,
      divergences: premise.divergences,
    },
  })
  await logEvent({
    userId,
    type: "work_order.acceptance",
    summary: `${wo.ref ?? `#${wo.id}`}: ${outcome.disposition} — ${outcome.reason}`,
    register: "work-orders",
    refId: wo.id,
  })

  return { attempt, ...outcome, premise }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Whether this work order is bound well enough to activate. Drives the activation gate. */
export async function getBindingReadiness(workOrderId: number) {
  const binding = await loadTruthBinding(workOrderId)
  return checkBindingReadiness(binding)
}

export async function getAcceptanceAttempts(workOrderId: number) {
  const userId = await getUserId()
  await requireOwnedWorkOrder(workOrderId, userId)
  return db
    .select()
    .from(workOrderAcceptanceAttempt)
    .where(eq(workOrderAcceptanceAttempt.workOrderId, workOrderId))
}
