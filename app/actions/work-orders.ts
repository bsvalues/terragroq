"use server"

import { db } from "@/lib/db"
import { workOrder } from "@/lib/db/schema"
import type { WorkOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import {
  buildClosureReport,
  type WoStatus,
} from "@/lib/work-orders/lifecycle"
import type { DoctrineVerdict } from "@/lib/governance/doctrine-evaluator"
import { transitionWorkOrderInTransaction } from "@/lib/work-orders/governed-transition"
import { writeAuthorityGrantArtifact } from "@/lib/governance/authority-grant-write"
import { and, desc, eq } from "drizzle-orm"

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
  return row
}

export type TransitionResult =
  | { ok: true; status: WoStatus }
  | {
      ok: false
      reason: string
      missing?: readonly string[]
      verdict?: DoctrineVerdict
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
  const result = await db.transaction((transaction) => transitionWorkOrderInTransaction({
    transaction, userId, workOrderId: id, to, now: new Date(),
    grantAuthority: opts?.grantAuthority, approveDoctrine: opts?.approveDoctrine,
  }))
  if (result.ok && result.authorityGrant) await writeAuthorityGrantArtifact(result.authorityGrant)
  return result.ok ? { ok: true, status: result.status } : result
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
}

// Record the closure outcome and (optionally) the release artifacts. Commit/tag
// refs may only be recorded when their gate has been opened.


/**
 * Release gates and the closure result.
 *
 * These three were DELETED when /work-orders was, not merely left without a surface, and that is a
 * different thing. `commitAllowed` / `tagAllowed` / `pushAllowed` are live governance inputs: they
 * travel in the delivery authority contract that `lib/workbench/outcome-execution-authorization.ts`
 * emits and the Hermes bridge consumes, and `lib/work-orders/lifecycle.ts` prints their state. With
 * `setWorkOrderGate` gone, a gate could no longer be opened or closed by anyone -- a governance
 * control frozen at whatever the row already held, with the surface that used to operate it as the
 * only casualty anybody noticed.
 *
 * So they are restored intact and left doorless, the way the decision register's unreplaced writes
 * were: alive means the capability is recoverable, and its guards travel with it. The gap is typed in
 * docs/product/deleted-route-capability-gaps.md and enforced by
 * tests/deleted-route-capability-gaps.test.ts. The `revalidatePath("/work-orders")` each of these
 * used to end with is deliberately NOT restored -- that route no longer exists.
 */

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
}

export async function deleteWorkOrder(id: number) {
  const userId = await getUserId()
  await db
    .delete(workOrder)
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
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
