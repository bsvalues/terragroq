"use server"

import { db } from "@/lib/db"
import { workOrder } from "@/lib/db/schema"
import type { WorkOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { validateAction } from "@/app/actions/doctrine"
import {
  canTransition,
  buildClosureReport,
  checkApprovalReadiness,
  requiresExplicitApproval,
  type WoStatus,
} from "@/lib/work-orders/lifecycle"
import { checkAgentPermission } from "@/lib/goal/agent-matrix"
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
  acceptanceCriteria?: string
  lane?: string
  phase?: string
  priority?: string
  assignee?: string
  agent?: string
  authorityLevel?: string
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
      acceptanceCriteria: splitList(input.acceptanceCriteria),
      lane: input.lane ?? null,
      phase: input.phase ?? null,
      priority: input.priority ?? "medium",
      status: "draft",
      assignee: input.assignee ?? null,
      agent: input.agent ?? null,
      authorityLevel: input.authorityLevel ?? "A0_READ_ONLY",
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
  | {
      ok: false
      reason: string
      missing?: string[]
      verdict?: Awaited<ReturnType<typeof validateAction>>
    }

// Governed status transition. Validates the transition graph and enforces the
// playbook's two gates: the approval-readiness gate (§9.2) on AUTHORIZED and
// the doctrine gate on activation.
export async function transitionWorkOrder(
  id: number,
  to: WoStatus,
  opts?: { approveDoctrine?: boolean; grantAuthority?: boolean },
): Promise<TransitionResult> {
  const userId = await getUserId()
  const wo = await requireOwn(id, userId)

  if (!canTransition(wo.status, to)) {
    return {
      ok: false,
      reason: `Illegal transition: ${wo.status} → ${to}`,
    }
  }

  // Approval gate (§9.2): a WO may not become AUTHORIZED unless every
  // precondition is satisfied, AND authority above A1 needs an explicit grant.
  if (to === "approved") {
    const readiness = checkApprovalReadiness(wo)
    if (!readiness.ready) {
      return {
        ok: false,
        reason: "Not ready for authorization",
        missing: readiness.missing,
      }
    }
    // Agent Permission Matrix (§14): the WO's authority must be permitted for
    // its assigned agent.
    if (wo.agent) {
      const perm = checkAgentPermission(wo.agent, wo.authorityLevel)
      if (!perm.allowed) {
        return { ok: false, reason: perm.reason, missing: [perm.reason] }
      }
    }
    if (requiresExplicitApproval(wo.authorityLevel) && !opts?.grantAuthority) {
      return {
        ok: false,
        reason: `Authority ${wo.authorityLevel} requires explicit operator approval to grant`,
        missing: [`Grant ${wo.authorityLevel} authority explicitly`],
      }
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
  // On authorization, explicitly grant the requested authority and stamp the
  // approver — this is the only place authorityGranted is ever set.
  const granting = to === "approved"
  await db
    .update(workOrder)
    .set({
      status: to,
      authorityGranted: granting ? wo.authorityLevel : wo.authorityGranted,
      approvedBy: granting ? userId : wo.approvedBy,
      approvedAt: granting ? new Date() : wo.approvedAt,
      closedAt: terminal ? new Date() : wo.closedAt,
      completedAt: to === "closed" ? new Date() : wo.completedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))

  await logEvent({
    userId,
    type: granting ? "work_order.authorized" : "work_order.transition",
    summary: granting
      ? `${wo.ref ?? `#${id}`}: AUTHORIZED at ${wo.authorityLevel}`
      : `${wo.ref ?? `#${id}`}: ${wo.status} → ${to}`,
    register: "work-orders",
    refId: id,
  })
  revalidatePath("/work-orders")
  return { ok: true, status: to }
}

// Complete or amend the WO contract while it is still a draft/proposed. This is
// how an operator fills the fields the approval gate (§9.2) requires.
export async function updateWorkOrderContract(
  id: number,
  input: {
    scope?: string
    authorityLevel?: string
    agent?: string | null
    acceptanceCriteria?: string
    validators?: string
    forbiddenFiles?: string
    allowedFiles?: string
    stopConditions?: string
  },
) {
  const userId = await getUserId()
  const wo = await requireOwn(id, userId)
  if (wo.status !== "draft" && wo.status !== "proposed") {
    throw new Error("Contract can only be edited while the WO is a draft or proposed")
  }
  await db
    .update(workOrder)
    .set({
      scope: input.scope ?? wo.scope,
      authorityLevel: input.authorityLevel ?? wo.authorityLevel,
      agent: input.agent === undefined ? wo.agent : input.agent,
      acceptanceCriteria:
        input.acceptanceCriteria !== undefined
          ? splitList(input.acceptanceCriteria)
          : wo.acceptanceCriteria,
      validators:
        input.validators !== undefined ? splitList(input.validators) : wo.validators,
      forbiddenFiles:
        input.forbiddenFiles !== undefined
          ? splitList(input.forbiddenFiles)
          : wo.forbiddenFiles,
      allowedFiles:
        input.allowedFiles !== undefined ? splitList(input.allowedFiles) : wo.allowedFiles,
      stopConditions:
        input.stopConditions !== undefined
          ? splitList(input.stopConditions)
          : wo.stopConditions,
      updatedAt: new Date(),
    })
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
  await logEvent({
    userId,
    type: "work_order.contract",
    summary: `${wo.ref ?? `#${id}`}: contract updated`,
    register: "work-orders",
    refId: id,
  })
  revalidatePath("/work-orders")
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
