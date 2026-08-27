"use server"

import { db } from "@/lib/db"
import {
  authorityGrant,
  decision,
  outcomeQueueItem,
  routedDependency,
  workOrder,
  workOrderBindingEvent,
  workOrderTruthBinding,
} from "@/lib/db/schema"
import { appendGovernanceEvent } from "@/lib/governance/events"
import {
  computeEnvelopeDigest,
  dependencyResolutionFor,
  formatTruthBindingRef,
  isDependencyProjectable,
  projectDependency,
  verifyProjectionForExecution,
  type DependencyEnvelope,
  type ProjectableDependency,
} from "@/lib/outcome-queue/dependency-projection"
import type { SurfaceClass } from "@/lib/work-orders/authority-surface"
import { and, eq, inArray, isNotNull } from "drizzle-orm"

/* ------------------------------------------------------------------ */
/* Project a routed dependency into the executable queue               */
/* ------------------------------------------------------------------ */

function toProjectable(row: typeof routedDependency.$inferSelect): ProjectableDependency {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    routingState: row.routingState as ProjectableDependency["routingState"],
    operation: row.operation,
    requiredResource: row.requiredResource,
    requiredClass: (row.requiredClass as SurfaceClass) ?? null,
    requiredCapability: row.requiredCapability,
    blocksAcceptance: row.blocksAcceptance,
  }
}

/**
 * Project one routed dependency onto an outcome_queue_item, so the existing HERMES loop leases and
 * runs it. Idempotent: the unique partial index guarantees one live projection per dependency, and
 * this returns the existing projection rather than creating a second.
 */
export async function projectDependencyToQueue(dependencyId: number) {
  const [dep] = await db
    .select()
    .from(routedDependency)
    .where(eq(routedDependency.id, dependencyId))
    .limit(1)
  if (!dep) throw new Error("Dependency not found")

  const projectable = toProjectable(dep)
  if (!isDependencyProjectable(projectable)) {
    return { ok: false as const, reason: `Dependency ${dep.id} (${dep.routingState}) is not projectable` }
  }

  const [wo] = await db.select().from(workOrder).where(eq(workOrder.id, dep.workOrderId)).limit(1)
  if (!wo) throw new Error("Parent work order not found")

  // Idempotency guard in code (the DB unique index is the true guarantee): if a live projection
  // already exists, return it. Running the projector twice changes nothing.
  const existing = await db
    .select()
    .from(outcomeQueueItem)
    .where(
      and(
        eq(outcomeQueueItem.canonicalDependencyId, dep.id),
        inArray(outcomeQueueItem.lifecycleState, ["suggested", "approved", "active", "blocked"]),
      ),
    )
    .limit(1)
  if (existing.length > 0) {
    return { ok: true as const, projectionId: existing[0].id, replayed: true }
  }

  const truthBindingRef = await truthBindingReference(dep.workOrderId)
  const envelope: DependencyEnvelope = {
    resource: dep.requiredResource!,
    surfaceClass: dep.requiredClass as SurfaceClass,
    capability: dep.requiredCapability!,
  }
  // Assignment role, authenticated principal, and capability envelope are THREE separate concepts.
  // The routing role (dep.assignee) records who the dependency was routed to; the projection executes
  // under the resident execution principal, and the authority is a concrete grant to THAT principal.
  const RESIDENT_EXECUTION_PRINCIPAL = "operator"
  const ACQUISITION_GRANT_TTL_MS = 24 * 60 * 60 * 1000
  const acquisitionGrantRef = `DEP-ACQ-GRANT-${dep.id}`
  const spec = projectDependency({
    dep: projectable,
    envelope,
    truthBindingRef,
    subject: RESIDENT_EXECUTION_PRINCIPAL,
    authorityGrantRef: acquisitionGrantRef,
  })

  // Grant + approval + projection are created ATOMICALLY. The runtime acquire gate joins a real
  // authority_grant on (userId, ref, grantedTo, scope, level, action, workOrder); an envelope-only
  // "matched" assertion is never trusted, so the grant must exist before the projection is live.
  const { row, approvalId } = await db.transaction(async (tx) => {
    await tx.insert(authorityGrant).values({
      userId: wo.userId,
      ref: acquisitionGrantRef,
      grantedBy: wo.userId,
      grantedTo: spec.authoritySubject,
      authorityLevel: spec.authorityLevel,
      scope: spec.outcomeKey,
      allowedActions: [spec.authorityAction],
      status: "active",
      workOrderId: dep.workOrderId,
      expiresAt: new Date(Date.now() + ACQUISITION_GRANT_TTL_MS),
      reason: `Acquisition grant for routed dependency #${dep.id} (${spec.outcomeKey}): ${spec.authorityAction}. Routing role (${dep.assignee ?? "-"}) is separate from this authenticated principal (${spec.authoritySubject}).`,
    })

    // Approval the queue's LIVE_APPROVAL_PREDICATE joins: canonical APPROVE verb, scoped to the exact
    // outcome key.
    const [approval] = await tx
      .insert(decision)
      .values({
        userId: wo.userId,
        ref: `AUTHZ-DEP-${dep.id}`,
        title: `Approval for routed dependency #${dep.id} projection`,
        decision: "APPROVE",
        scope: spec.outcomeKey,
        status: "accepted",
        authority: "binding",
      })
      .returning()

    const [inserted] = await tx
      .insert(outcomeQueueItem)
      .values({
        userId: wo.userId,
        outcomeKey: spec.outcomeKey,
        title: spec.title,
        objective: spec.objective,
        dependencyKeys: [],
        riskClass: spec.riskClass,
        approvalState: spec.approvalState,
        approvedBy: wo.userId,
        approvedAt: new Date(),
        approvalDecisionId: approval.id,
        authorityState: spec.authorityState,
        authorityLevel: spec.authorityLevel,
        authorityGrantRef: spec.authorityGrantRef,
        authoritySubject: spec.authoritySubject,
        authorityAction: spec.authorityAction,
        lifecycleState: "approved",
        activeWorkOrderId: spec.parentWorkOrderId,
        canonicalDependencyId: spec.canonicalDependencyId,
        envelopeResource: spec.envelopeResource,
        envelopeClass: spec.envelopeClass,
        envelopeCapability: spec.envelopeCapability,
        envelopeDigest: spec.envelopeDigest,
      })
      .returning()
    return { row: inserted, approvalId: approval.id }
  })

  await appendGovernanceEvent({
    userId: wo.userId,
    eventType: "DEPENDENCY_PROJECTED",
    entityType: "routed_dependency",
    entityId: String(dep.id),
    reason: `Projected dependency #${dep.id} onto outcome_queue_item #${row.id} (${spec.authorityAction}); concrete grant ${acquisitionGrantRef} to ${spec.authoritySubject} materialized atomically`,
    after: { projectionId: row.id, envelope: spec.authorityAction, approvalDecisionId: approvalId, grantRef: acquisitionGrantRef },
  })

  return { ok: true as const, projectionId: row.id, replayed: false, approvalDecisionId: approvalId }
}

/** A stable reference to the parent work order's active truth binding, for the envelope digest. */
async function truthBindingReference(workOrderId: number): Promise<string> {
  const [binding] = await db
    .select({ id: workOrderTruthBinding.id, projectId: workOrderTruthBinding.projectId })
    .from(workOrderTruthBinding)
    .where(
      and(
        eq(workOrderTruthBinding.workOrderId, workOrderId),
        eq(workOrderTruthBinding.status, "bound"),
      ),
    )
    .limit(1)
  if (!binding) return `wo:${workOrderId}:unbound`
  // Fold in the head revision of every resource lineage, so a rebound changes the reference and the
  // drift guard fires. Ordered by time; last event per resource wins (that is its expected revision).
  const events = await db
    .select({ resourceKey: workOrderBindingEvent.resourceKey, sha: workOrderBindingEvent.sha })
    .from(workOrderBindingEvent)
    .where(eq(workOrderBindingEvent.bindingId, binding.id))
    .orderBy(workOrderBindingEvent.at)
  const resourceRevisions: Record<string, string> = {}
  for (const e of events) resourceRevisions[e.resourceKey] = e.sha
  return formatTruthBindingRef({ bindingId: binding.id, projectId: binding.projectId, resourceRevisions })
}

/* ------------------------------------------------------------------ */
/* Acquisition-time verification (called by the executor before run)   */
/* ------------------------------------------------------------------ */

/**
 * Re-verify a projection against the LIVE canonical dependency and its envelope before execution.
 * This is the guard that refuses to run stale authority. Called by the HERMES executor between
 * leasing the queue item and running the work.
 */
export async function verifyProjectionBeforeExecution(projectionId: number) {
  const [proj] = await db
    .select()
    .from(outcomeQueueItem)
    .where(eq(outcomeQueueItem.id, projectionId))
    .limit(1)
  if (!proj || proj.canonicalDependencyId == null) {
    return { ok: false as const, refusal: "DEPENDENCY_STATE_CHANGED" as const, detail: "Not a dependency projection" }
  }

  const [dep] = await db
    .select()
    .from(routedDependency)
    .where(eq(routedDependency.id, proj.canonicalDependencyId))
    .limit(1)
  if (!dep) {
    return { ok: false as const, refusal: "DEPENDENCY_TERMINAL" as const, detail: "Canonical dependency is gone" }
  }

  const liveEnvelope: DependencyEnvelope = {
    resource: dep.requiredResource!,
    surfaceClass: dep.requiredClass as SurfaceClass,
    capability: dep.requiredCapability!,
  }
  const liveTruthBindingRef = await truthBindingReference(dep.workOrderId)

  return verifyProjectionForExecution({
    projection: {
      canonicalDependencyId: proj.canonicalDependencyId,
      envelopeResource: proj.envelopeResource!,
      envelopeClass: proj.envelopeClass as SurfaceClass,
      envelopeCapability: proj.envelopeCapability!,
      envelopeDigest: proj.envelopeDigest!,
    },
    liveDep: {
      id: dep.id,
      routingState: dep.routingState as ProjectableDependency["routingState"],
      requiredClass: (dep.requiredClass as SurfaceClass) ?? null,
      requiredCapability: dep.requiredCapability,
      requiredResource: dep.requiredResource,
    },
    liveEnvelope,
    liveTruthBindingRef,
  })
}

/* ------------------------------------------------------------------ */
/* Return path: settle the canonical dependency from queue completion  */
/* ------------------------------------------------------------------ */

/**
 * When a projection completes, settle its CANONICAL dependency -- not the parent outcome. The queue
 * item completing means the dependency resolved (or was refused); the parent work order recomputes
 * separately, and whether that unlocks the next edge is the graph's question, not the queue's.
 */
export async function settleDependencyFromProjection(input: {
  projectionId: number
  queueResult: string
  evidence: string[]
}) {
  const [proj] = await db
    .select()
    .from(outcomeQueueItem)
    .where(eq(outcomeQueueItem.id, input.projectionId))
    .limit(1)
  if (!proj || proj.canonicalDependencyId == null) throw new Error("Not a dependency projection")

  const resolution = dependencyResolutionFor(input.queueResult)
  const [dep] = await db
    .select()
    .from(routedDependency)
    .where(eq(routedDependency.id, proj.canonicalDependencyId))
    .limit(1)
  if (!dep) throw new Error("Canonical dependency not found")

  const now = new Date()
  await db
    .update(routedDependency)
    .set({
      routingState: resolution.routingState,
      resolvedAt: now,
      resolution: `Settled from queue projection #${input.projectionId}: ${input.queueResult}`,
      evidence: [...dep.evidence, ...input.evidence],
      updatedAt: now,
    })
    .where(eq(routedDependency.id, dep.id))

  await appendGovernanceEvent({
    userId: proj.userId,
    eventType: resolution.routingState === "resolved" ? "DEPENDENCY_RESOLVED" : "DEPENDENCY_ROUTED",
    entityType: "routed_dependency",
    entityId: String(dep.id),
    reason: `Dependency #${dep.id} ${resolution.routingState} from projection #${input.projectionId}. Parent WO ${dep.workOrderId} recomputes; the queue item completing does NOT pass the outcome.`,
    after: { dependencyId: dep.id, routingState: resolution.routingState, settlesParent: false },
  })

  return { dependencyId: dep.id, routingState: resolution.routingState, parentWorkOrderId: dep.workOrderId }
}

/** Every routed dependency that still needs a queue projection (raised/routed, none live yet). */
export async function pendingDependencyProjections() {
  const rows = await db
    .select({ id: routedDependency.id, routingState: routedDependency.routingState })
    .from(routedDependency)
    .where(inArray(routedDependency.routingState, ["raised", "routed", "accepted"]))
  const projected = await db
    .select({ depId: outcomeQueueItem.canonicalDependencyId })
    .from(outcomeQueueItem)
    .where(
      and(
        isNotNull(outcomeQueueItem.canonicalDependencyId),
        inArray(outcomeQueueItem.lifecycleState, ["suggested", "approved", "active", "blocked"]),
      ),
    )
  const live = new Set(projected.map((p) => p.depId))
  return rows.filter((r) => !live.has(r.id)).map((r) => r.id)
}
