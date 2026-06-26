"use server"

import { db } from "@/lib/db"
import { workOrder } from "@/lib/db/schema"
import type { WorkOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { validateAction } from "@/app/actions/doctrine"
import { canTransition, buildClosureReport, type WoStatus } from "@/lib/work-orders/lifecycle"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// Compute the next WO reference (WO-0001, WO-0002, …) per operator.
async function nextRef(userId: string): Promise<string> {
  const rows = await db
    .select({ ref: workOrder.ref })
    .from(workOrder)
    .where(eq(workOrder.userId, userId))
  let max = 0
  for (const r of rows) {
    const m = r.ref?.match(/WO-(\d+)/)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return `WO-${String(max + 1).padStart(4, "0")}`
}

function splitList(v?: string | string[]): string[] {
  if (!v) return []
  const arr = Array.isArray(v) ? v : v.split(/[\n,]/)
  return arr.map((s) => s.trim()).filter(Boolean)
}

async function requireOwn(id: number, userId: string): Promise<WorkOrder> {
  const [row] = await db
    .select()
    .from(workOrder)
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
    .limit(1)
  if (!row) throw new Error("Work order not found")
  return row
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getWorkOrders() {
  const userId = await getUserId()
  return db
    .select()
    .from(workOrder)
    .where(eq(workOrder.userId, userId))
    .orderBy(desc(workOrder.createdAt))
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

export async function createWorkOrder(input: {
  title: string
  goal?: string
  description?: string
  loop?: string
  scope?: string
  nonGoals?: string
  allowedFiles?: string
  forbiddenFiles?: string
  validators?: string
  stopConditions?: string
  lane?: string
  phase?: string
  priority?: string
  assignee?: string
  linkedDecisionId?: number
}) {
  const userId = await getUserId()
  const ref = await nextRef(userId)
  const [row] = await db
    .insert(workOrder)
    .values({
      userId,
      ref,
      title: input.title,
      goal: input.goal ?? null,
      description: input.description ?? null,
      loop: input.loop ?? null,
      scope: input.scope ?? null,
      nonGoals: splitList(input.nonGoals),
      allowedFiles: splitList(input.allowedFiles),
      forbiddenFiles: splitList(input.forbiddenFiles),
      validators: splitList(input.validators),
      stopConditions: splitList(input.stopConditions),
      lane: input.lane ?? null,
      phase: input.phase ?? null,
      priority: input.priority ?? "medium",
      status: "draft",
      assignee: input.assignee ?? null,
      linkedDecisionId: input.linkedDecisionId ?? null,
    })
    .returning()

  await logEvent({
    userId,
    type: "work_order.created",
    summary: `Drafted ${ref}: ${input.title}`,
    register: "work-orders",
    refId: row.id,
  })
  revalidatePath("/work-orders")
  return row
}

export type TransitionResult =
  | { ok: true; status: WoStatus }
  | { ok: false; reason: string; verdict?: Awaited<ReturnType<typeof validateAction>> }

// Governed status transition. Validates the transition graph and, for the
// activation step, checks the WO goal/scope against active doctrine.
export async function transitionWorkOrder(
  id: number,
  to: WoStatus,
  opts?: { approveDoctrine?: boolean },
): Promise<TransitionResult> {
  const userId = await getUserId()
  const wo = await requireOwn(id, userId)

  if (!canTransition(wo.status, to)) {
    return {
      ok: false,
      reason: `Illegal transition: ${wo.status} → ${to}`,
    }
  }

  // Doctrine gate on activation: the work itself must not be forbidden.
  if (to === "active") {
    const probe = [wo.goal, wo.scope, wo.title, wo.description]
      .filter(Boolean)
      .join(" . ")
    const verdict = await validateAction(probe)
    if (verdict.verdict === "forbidden") {
      return {
        ok: false,
        reason: "Activation blocked by doctrine",
        verdict,
      }
    }
    if (verdict.verdict === "requires_approval" && !opts?.approveDoctrine) {
      return {
        ok: false,
        reason: "Activation requires explicit operator approval",
        verdict,
      }
    }
  }

  const terminal = to === "closed" || to === "aborted"
  await db
    .update(workOrder)
    .set({
      status: to,
      closedAt: terminal ? new Date() : wo.closedAt,
      completedAt: to === "closed" ? new Date() : wo.completedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))

  await logEvent({
    userId,
    type: "work_order.transition",
    summary: `${wo.ref ?? `#${id}`}: ${wo.status} → ${to}`,
    register: "work-orders",
    refId: id,
  })
  revalidatePath("/work-orders")
  return { ok: true, status: to }
}

export async function linkWorkOrderEvidence(id: number, evidence: string) {
  const userId = await getUserId()
  const wo = await requireOwn(id, userId)
  const next = [...wo.evidence, evidence.trim()].filter(Boolean)
  await db
    .update(workOrder)
    .set({ evidence: next, updatedAt: new Date() })
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
  await logEvent({
    userId,
    type: "work_order.evidence",
    summary: `${wo.ref ?? `#${id}`}: linked evidence`,
    register: "work-orders",
    refId: id,
  })
  revalidatePath("/work-orders")
}

// Record the closure outcome and (optionally) the release artifacts. Commit/tag
// refs may only be recorded when their gate has been opened.
export async function recordWorkOrderResult(
  id: number,
  input: { result: "PASS" | "FAIL" | "PARTIAL"; commitRef?: string; tagRef?: string },
) {
  const userId = await getUserId()
  const wo = await requireOwn(id, userId)

  if (input.commitRef && !wo.commitAllowed) {
    throw new Error("Commit gate is closed — open it before recording a commit ref")
  }
  if (input.tagRef && !wo.tagAllowed) {
    throw new Error("Tag gate is closed — open it before recording a tag ref")
  }

  await db
    .update(workOrder)
    .set({
      result: input.result,
      commitRef: input.commitRef ?? wo.commitRef,
      tagRef: input.tagRef ?? wo.tagRef,
      updatedAt: new Date(),
    })
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
  await logEvent({
    userId,
    type: "work_order.result",
    summary: `${wo.ref ?? `#${id}`}: result ${input.result}`,
    register: "work-orders",
    refId: id,
  })
  revalidatePath("/work-orders")
}

// Open or close a release gate. Gates default closed; opening one is an
// explicit operator act, recorded to the audit log.
export async function setWorkOrderGate(
  id: number,
  gate: "commit" | "tag" | "push",
  open: boolean,
) {
  const userId = await getUserId()
  const wo = await requireOwn(id, userId)
  const field =
    gate === "commit" ? "commitAllowed" : gate === "tag" ? "tagAllowed" : "pushAllowed"
  await db
    .update(workOrder)
    .set({ [field]: open, updatedAt: new Date() })
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
  await logEvent({
    userId,
    type: "work_order.gate",
    summary: `${wo.ref ?? `#${id}`}: ${gate} gate ${open ? "OPENED" : "closed"}`,
    register: "work-orders",
    refId: id,
  })
  revalidatePath("/work-orders")
}

export async function deleteWorkOrder(id: number) {
  const userId = await getUserId()
  await db
    .delete(workOrder)
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
  revalidatePath("/work-orders")
}

/* ------------------------------------------------------------------ */
/* Closure report                                                     */
/* ------------------------------------------------------------------ */

// Server action wrapper so the client can request the report by id.
export async function getClosureReport(id: number): Promise<string> {
  const userId = await getUserId()
  const wo = await requireOwn(id, userId)
  return buildClosureReport(wo)
}
