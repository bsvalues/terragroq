"use server"

import { db } from "@/lib/db"
import { workOrder, workOrderAssignment } from "@/lib/db/schema"
import type { WorkOrderAssignment } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import {
  canTransitionAssignment,
  decideReroute,
  isDeclineReason,
  isReclaimable,
  nextLeaseExpiry,
  LIVE_ASSIGNMENT_STATUSES,
  type AssignmentRole,
  type AssignmentStatus,
  type DeclineReason,
} from "@/lib/work-orders/assignment"
import { and, eq, inArray, lte } from "drizzle-orm"

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function requireOwnedWorkOrder(id: number, userId: string) {
  const [wo] = await db
    .select()
    .from(workOrder)
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
    .limit(1)
  if (!wo) throw new Error("Work order not found")
  return wo
}

async function loadAssignment(id: number): Promise<WorkOrderAssignment> {
  const [row] = await db
    .select()
    .from(workOrderAssignment)
    .where(eq(workOrderAssignment.id, id))
    .limit(1)
  if (!row) throw new Error("Assignment not found")
  return row
}

/* ------------------------------------------------------------------ */
/* Offer                                                               */
/* ------------------------------------------------------------------ */

/**
 * Offer a work order to an executor. Offering is not dispatch: the outcome does nothing until the
 * executor accepts. Only the owner of the work order may offer it.
 */
export async function offerWorkOrder(input: {
  workOrderId: number
  principal: string
  agentProfile?: string
  role?: AssignmentRole
}) {
  const userId = await getUserId()
  const wo = await requireOwnedWorkOrder(input.workOrderId, userId)
  const role: AssignmentRole = input.role ?? "implementer"

  // Re-offering after a decline or a reclaim is normal; a second LIVE offer to the same principal
  // in the same role is not, and would make "which assignment is this" unanswerable.
  const existing = await db
    .select()
    .from(workOrderAssignment)
    .where(
      and(
        eq(workOrderAssignment.workOrderId, input.workOrderId),
        eq(workOrderAssignment.principal, input.principal),
        eq(workOrderAssignment.role, role),
        inArray(workOrderAssignment.status, [...LIVE_ASSIGNMENT_STATUSES]),
      ),
    )
    .limit(1)
  if (existing.length > 0) {
    throw new Error(`${input.principal} already holds a live ${role} assignment on this work order`)
  }

  const [row] = await db
    .insert(workOrderAssignment)
    .values({
      workOrderId: input.workOrderId,
      principal: input.principal,
      agentProfile: input.agentProfile ?? wo.agent ?? null,
      role,
      status: "offered",
      assignedBy: userId,
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: "WO_ASSIGNMENT_OFFERED",
    entityType: "work_order",
    entityId: input.workOrderId,
    reason: `Offered to ${input.principal} as ${role}`,
    after: { assignmentId: row.id, principal: input.principal, role },
  })
  await logEvent({
    userId,
    type: "work_order.assignment.offered",
    summary: `${wo.ref ?? `#${wo.id}`}: offered to ${input.principal} (${role})`,
    register: "work-orders",
    refId: wo.id,
  })
  return row
}

/* ------------------------------------------------------------------ */
/* Accept / decline                                                    */
/* ------------------------------------------------------------------ */

/** Accept an offered assignment. Only the offeree may accept; accepting starts the lease. */
export async function acceptAssignment(assignmentId: number, opts?: { leaseMs?: number }) {
  const userId = await getUserId()
  const a = await loadAssignment(assignmentId)
  if (a.principal !== userId) throw new Error("Assignment not found")
  if (!canTransitionAssignment(a.status as AssignmentStatus, "accepted")) {
    throw new Error(`Cannot accept an assignment that is ${a.status}`)
  }

  const now = new Date()
  await db
    .update(workOrderAssignment)
    .set({
      status: "accepted",
      acceptedAt: now,
      heartbeatAt: now,
      leaseExpiresAt: nextLeaseExpiry(now, opts?.leaseMs),
      updatedAt: now,
    })
    .where(eq(workOrderAssignment.id, assignmentId))

  await appendGovernanceEvent({
    userId,
    eventType: "WO_ASSIGNMENT_ACCEPTED",
    entityType: "work_order",
    entityId: a.workOrderId,
    reason: `Accepted by ${userId}`,
    before: { status: a.status },
    after: { status: "accepted", assignmentId },
  })
}

/**
 * Decline an offered assignment.
 *
 * Declining is routine. It carries a typed reason, it ends THIS assignment, and it never touches
 * the work order's own lifecycle — the contract stays exactly where it is and becomes re-offerable.
 * The returned routing decision is what the router acts on; nobody negotiates with an executor.
 */
export async function declineAssignment(
  assignmentId: number,
  reason: DeclineReason,
  detail?: string,
) {
  const userId = await getUserId()
  const a = await loadAssignment(assignmentId)
  if (a.principal !== userId) throw new Error("Assignment not found")
  if (!isDeclineReason(reason)) throw new Error(`Unknown decline reason: ${reason}`)
  if (!canTransitionAssignment(a.status as AssignmentStatus, "declined")) {
    throw new Error(`Cannot decline an assignment that is ${a.status}`)
  }

  const now = new Date()
  await db
    .update(workOrderAssignment)
    .set({
      status: "declined",
      declineReason: reason,
      declineDetail: detail ?? null,
      declinedAt: now,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(workOrderAssignment.id, assignmentId))

  const routing = decideReroute(reason)
  await appendGovernanceEvent({
    userId,
    eventType: "WO_ASSIGNMENT_DECLINED",
    entityType: "work_order",
    entityId: a.workOrderId,
    reason: `Declined: ${reason}`,
    before: { status: a.status },
    after: { status: "declined", declineReason: reason, routing },
  })
  await logEvent({
    userId,
    type: "work_order.assignment.declined",
    summary: `#${a.workOrderId}: declined by ${userId} — ${reason}`,
    register: "work-orders",
    refId: a.workOrderId,
  })
  return routing
}

/* ------------------------------------------------------------------ */
/* Lease                                                               */
/* ------------------------------------------------------------------ */

/** Extend the lease. An accepted executor that is still working says so here. */
export async function heartbeatAssignment(assignmentId: number, opts?: { leaseMs?: number }) {
  const userId = await getUserId()
  const a = await loadAssignment(assignmentId)
  if (a.principal !== userId) throw new Error("Assignment not found")
  if (a.status !== "accepted" && a.status !== "active") {
    throw new Error(`Cannot heartbeat an assignment that is ${a.status}`)
  }
  const now = new Date()
  await db
    .update(workOrderAssignment)
    .set({
      status: "active",
      heartbeatAt: now,
      leaseExpiresAt: nextLeaseExpiry(now, opts?.leaseMs),
      updatedAt: now,
    })
    .where(eq(workOrderAssignment.id, assignmentId))
}

/**
 * Reclaim every assignment whose lease has run out and put those outcomes back on offer.
 *
 * Reclaim is not a sanction; it is the same routing edge as a decline, arrived at later. Accepting
 * work and then going silent must not park an outcome indefinitely.
 */
export async function reclaimExpiredAssignments(now: Date = new Date()) {
  const userId = await getUserId()
  const candidates = await db
    .select()
    .from(workOrderAssignment)
    .where(
      and(
        inArray(workOrderAssignment.status, ["accepted", "active"]),
        lte(workOrderAssignment.leaseExpiresAt, now),
      ),
    )

  const reclaimed: number[] = []
  for (const a of candidates) {
    if (!isReclaimable({ status: a.status as AssignmentStatus, leaseExpiresAt: a.leaseExpiresAt }, now)) {
      continue
    }
    await db
      .update(workOrderAssignment)
      .set({ status: "released", releasedAt: now, reclaimedAt: now, updatedAt: now })
      .where(eq(workOrderAssignment.id, a.id))
    reclaimed.push(a.id)
    await appendGovernanceEvent({
      userId,
      eventType: "WO_ASSIGNMENT_RECLAIMED",
      entityType: "work_order",
      entityId: a.workOrderId,
      reason: "Lease expired without heartbeat",
      before: { status: a.status, principal: a.principal },
      after: { status: "released", reclaimed: true },
    })
  }
  return { reclaimed }
}

/* ------------------------------------------------------------------ */
/* Release / revoke                                                    */
/* ------------------------------------------------------------------ */

/** An executor hands work back. Not a failure; the outcome returns to the offer pool. */
export async function releaseAssignment(assignmentId: number) {
  const userId = await getUserId()
  const a = await loadAssignment(assignmentId)
  if (a.principal !== userId) throw new Error("Assignment not found")
  if (!canTransitionAssignment(a.status as AssignmentStatus, "released")) {
    throw new Error(`Cannot release an assignment that is ${a.status}`)
  }
  const now = new Date()
  await db
    .update(workOrderAssignment)
    .set({ status: "released", releasedAt: now, leaseExpiresAt: null, updatedAt: now })
    .where(eq(workOrderAssignment.id, assignmentId))
}

/** The owner withdraws an assignment. Owner-only, at any live stage. */
export async function revokeAssignment(assignmentId: number, reason?: string) {
  const userId = await getUserId()
  const a = await loadAssignment(assignmentId)
  await requireOwnedWorkOrder(a.workOrderId, userId)
  if (!canTransitionAssignment(a.status as AssignmentStatus, "revoked")) {
    throw new Error(`Cannot revoke an assignment that is ${a.status}`)
  }
  const now = new Date()
  await db
    .update(workOrderAssignment)
    .set({ status: "revoked", releasedAt: now, leaseExpiresAt: null, updatedAt: now })
    .where(eq(workOrderAssignment.id, assignmentId))

  await appendGovernanceEvent({
    userId,
    eventType: "WO_ASSIGNMENT_REVOKED",
    entityType: "work_order",
    entityId: a.workOrderId,
    reason: reason ?? "Revoked by owner",
    before: { status: a.status, principal: a.principal },
    after: { status: "revoked" },
  })
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Everything currently offered to, or held by, the calling principal. */
export async function getMyAssignments() {
  const userId = await getUserId()
  return db
    .select()
    .from(workOrderAssignment)
    .where(
      and(
        eq(workOrderAssignment.principal, userId),
        inArray(workOrderAssignment.status, [...LIVE_ASSIGNMENT_STATUSES]),
      ),
    )
}

/** Every assignment on one work order, for the owner's routing view. */
export async function getWorkOrderAssignments(workOrderId: number) {
  const userId = await getUserId()
  await requireOwnedWorkOrder(workOrderId, userId)
  return db
    .select()
    .from(workOrderAssignment)
    .where(eq(workOrderAssignment.workOrderId, workOrderId))
}
