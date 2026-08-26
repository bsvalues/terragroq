"use server"

import { db } from "@/lib/db"
import { routedDependency, workOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import {
  canTransitionRouting,
  evaluateBlocked,
  isUnsatisfied,
  type RoutedDependencyLike,
  type RoutingState,
} from "@/lib/work-orders/routed-dependency"
import { isSurfaceClass, type SurfaceClass } from "@/lib/work-orders/authority-surface"
import { and, eq, inArray } from "drizzle-orm"

async function loadWorkOrder(id: number) {
  const [wo] = await db.select().from(workOrder).where(eq(workOrder.id, id)).limit(1)
  if (!wo) throw new Error("Work order not found")
  return wo
}

/* ------------------------------------------------------------------ */
/* Raise                                                               */
/* ------------------------------------------------------------------ */

/**
 * Record an operation the executor cannot perform, and keep going.
 *
 * Raising a dependency never changes the work order's status. That is the entire point: the
 * contract stays active and every independent path continues while the router places this
 * elsewhere.
 */
export async function raiseDependency(input: {
  workOrderId: number
  operation: string
  requiredResource?: string
  requiredClass?: SurfaceClass
  requiredCapability?: string
  requiredCapabilityNonAuth?: string
  evidence?: string[]
  blocksAcceptance?: boolean
}) {
  const userId = await getUserId()
  const wo = await loadWorkOrder(input.workOrderId)

  if (input.requiredClass && !isSurfaceClass(input.requiredClass)) {
    throw new Error(`Unknown surface class: ${input.requiredClass}`)
  }
  if (!input.requiredClass && !input.requiredCapabilityNonAuth) {
    throw new Error(
      "A dependency must name what was unavailable — an authority class or a concrete capability",
    )
  }

  const [row] = await db
    .insert(routedDependency)
    .values({
      workOrderId: input.workOrderId,
      operation: input.operation,
      requiredResource: input.requiredResource ?? null,
      requiredClass: input.requiredClass ?? null,
      requiredCapability: input.requiredCapability ?? null,
      requiredCapabilityNonAuth: input.requiredCapabilityNonAuth ?? null,
      evidence: input.evidence ?? [],
      blocksAcceptance: input.blocksAcceptance ?? false,
      routingState: "raised",
      raisedBy: userId,
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: "DEPENDENCY_RAISED",
    entityType: "work_order",
    entityId: input.workOrderId,
    reason: input.operation,
    after: {
      dependencyId: row.id,
      requiredClass: input.requiredClass ?? null,
      blocksAcceptance: row.blocksAcceptance,
    },
  })
  await logEvent({
    userId,
    type: "work_order.dependency.raised",
    summary: `${wo.ref ?? `#${wo.id}`}: raised — ${input.operation}`,
    register: "work-orders",
    refId: wo.id,
  })
  return row
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

/** Hand a dependency to an envelope that can actually perform it. */
export async function routeDependency(input: {
  dependencyId: number
  assignedWorkOrderId?: number
  assignee?: string
}) {
  const userId = await getUserId()
  const [dep] = await db
    .select()
    .from(routedDependency)
    .where(eq(routedDependency.id, input.dependencyId))
    .limit(1)
  if (!dep) throw new Error("Dependency not found")
  if (!canTransitionRouting(dep.routingState as RoutingState, "routed")) {
    throw new Error(`Cannot route a dependency that is ${dep.routingState}`)
  }
  if (input.assignedWorkOrderId === dep.workOrderId) {
    throw new Error("Routing a dependency back to the work order that raised it is a loop")
  }

  const now = new Date()
  await db
    .update(routedDependency)
    .set({
      routingState: "routed",
      assignedWorkOrderId: input.assignedWorkOrderId ?? null,
      assignee: input.assignee ?? null,
      routedAt: now,
      updatedAt: now,
    })
    .where(eq(routedDependency.id, input.dependencyId))

  await appendGovernanceEvent({
    userId,
    eventType: "DEPENDENCY_ROUTED",
    entityType: "work_order",
    entityId: dep.workOrderId,
    reason: `Routed to ${input.assignee ?? `#${input.assignedWorkOrderId}`}`,
    before: { routingState: dep.routingState },
    after: { routingState: "routed", assignedWorkOrderId: input.assignedWorkOrderId ?? null },
  })
}

/** Move a dependency along its routing lifecycle. */
export async function transitionDependency(
  dependencyId: number,
  to: RoutingState,
  resolution?: string,
) {
  const userId = await getUserId()
  const [dep] = await db
    .select()
    .from(routedDependency)
    .where(eq(routedDependency.id, dependencyId))
    .limit(1)
  if (!dep) throw new Error("Dependency not found")
  if (!canTransitionRouting(dep.routingState as RoutingState, to)) {
    throw new Error(`Illegal routing transition: ${dep.routingState} → ${to}`)
  }

  const now = new Date()
  const closing = to === "resolved" || to === "refused"
  await db
    .update(routedDependency)
    .set({
      routingState: to,
      resolution: resolution ?? dep.resolution,
      resolvedAt: closing ? now : dep.resolvedAt,
      updatedAt: now,
    })
    .where(eq(routedDependency.id, dependencyId))

  await appendGovernanceEvent({
    userId,
    eventType: to === "resolved" ? "DEPENDENCY_RESOLVED" : "DEPENDENCY_ROUTED",
    entityType: "work_order",
    entityId: dep.workOrderId,
    reason: resolution ?? `${dep.routingState} → ${to}`,
    before: { routingState: dep.routingState },
    after: { routingState: to },
  })
}

/* ------------------------------------------------------------------ */
/* The `blocked` guard                                                 */
/* ------------------------------------------------------------------ */

function toLike(rows: (typeof routedDependency.$inferSelect)[]): RoutedDependencyLike[] {
  return rows.map((d) => ({
    id: d.id,
    operation: d.operation,
    requiredResource: d.requiredResource,
    requiredClass: (d.requiredClass as SurfaceClass) ?? null,
    requiredCapability: d.requiredCapability,
    requiredCapabilityNonAuth: d.requiredCapabilityNonAuth,
    routingState: d.routingState as RoutingState,
    blocksAcceptance: d.blocksAcceptance,
  }))
}

/**
 * Whether this work order may become `blocked`.
 *
 * Exported so the lifecycle guard in `transitionWorkOrder` refuses the transition rather than
 * trusting a caller's judgement about whether things feel stuck.
 */
export async function evaluateWorkOrderBlocked(
  workOrderId: number,
  opts?: { anyAcceptancePathExecutable?: boolean },
) {
  const rows = await db
    .select()
    .from(routedDependency)
    .where(eq(routedDependency.workOrderId, workOrderId))
  return evaluateBlocked({
    dependencies: toLike(rows),
    anyAcceptancePathExecutable: opts?.anyAcceptancePathExecutable,
  })
}

/** Dependencies still standing between this work order and acceptance. */
export async function getOpenDependencies(workOrderId: number) {
  const rows = await db
    .select()
    .from(routedDependency)
    .where(eq(routedDependency.workOrderId, workOrderId))
  return rows.filter((d) => isUnsatisfied(d.routingState as RoutingState))
}

/** The router's queue: everything raised and not yet placed, across all work orders. */
export async function getUnroutedDependencies() {
  await getUserId()
  return db
    .select()
    .from(routedDependency)
    .where(inArray(routedDependency.routingState, ["raised"]))
}

export async function getWorkOrderDependencies(workOrderId: number) {
  const userId = await getUserId()
  const [wo] = await db
    .select()
    .from(workOrder)
    .where(and(eq(workOrder.id, workOrderId), eq(workOrder.userId, userId)))
    .limit(1)
  if (!wo) throw new Error("Work order not found")
  return db
    .select()
    .from(routedDependency)
    .where(eq(routedDependency.workOrderId, workOrderId))
}
