// Every caller uses the same governed transition checks.
import { and, desc, eq } from "drizzle-orm"

import { doctrine, eventLog, governanceEvent, workOrder, type AuthorityGrant, type WorkOrder } from "@/lib/db/schema"
import { checkAgentPermission } from "@/lib/goal/agent-matrix"
import { evaluateDoctrine, type DoctrineVerdict } from "@/lib/governance/doctrine-evaluator"
import { createAuthorityGrantInTransaction, type GovernanceTransaction } from "@/lib/governance/authority-grant-write"
import { hashRecord } from "@/lib/governance/hash"
import { authorityRank } from "@/lib/goal/taxonomy"
import { canTransition, checkApprovalReadiness, requiresExplicitApproval, type WoStatus } from "@/lib/work-orders/lifecycle"

export type GovernedTransitionResult =
  | Readonly<{
      ok: true
      status: WoStatus
      workOrder: WorkOrder
      authorityGrant?: AuthorityGrant
      doctrineVerdict?: DoctrineVerdict
    }>
  | Readonly<{ ok: false; reason: string; missing?: readonly string[]; verdict?: DoctrineVerdict }>

export async function transitionWorkOrderInTransaction(input: Readonly<{
  transaction: GovernanceTransaction
  userId: string
  workOrderId: number
  to: WoStatus
  now: Date
  grantAuthority?: boolean
  approveDoctrine?: boolean
  grantExpiresAt?: Date | null
}>): Promise<GovernedTransitionResult> {
  const rows = await input.transaction.select().from(workOrder).where(and(
    eq(workOrder.id, input.workOrderId), eq(workOrder.userId, input.userId),
  )).limit(1).for("update")
  const current = rows[0]
  if (!current) return { ok: false, reason: "Work order not found" }
  if (!canTransition(current.status, input.to)) {
    return { ok: false, reason: `Illegal transition: ${current.status} → ${input.to}` }
  }
  if (input.to === "approved") {
    const readiness = checkApprovalReadiness(current)
    if (!readiness.ready) return { ok: false, reason: "Not ready for authorization", missing: readiness.missing }
    if (current.agent) {
      const permission = checkAgentPermission(current.agent, current.authorityLevel)
      if (!permission.allowed) return { ok: false, reason: permission.reason, missing: [permission.reason] }
    }
    if (requiresExplicitApproval(current.authorityLevel) && !input.grantAuthority) {
      return {
        ok: false,
        reason: `Authority ${current.authorityLevel} requires explicit operator approval to grant`,
        missing: [`Grant ${current.authorityLevel} authority explicitly`],
      }
    }
  }
  let verdict: DoctrineVerdict | undefined
  if (input.to === "active") {
    const rules = await input.transaction.select().from(doctrine).where(and(
      eq(doctrine.userId, input.userId), eq(doctrine.active, true), eq(doctrine.status, "active"),
    )).orderBy(desc(doctrine.priority))
    const probe = [current.goal, current.scope, current.title, current.description].filter(Boolean).join(" . ")
    verdict = evaluateDoctrine(probe, rules)
    if (verdict.verdict === "forbidden") return { ok: false, reason: "Activation blocked by doctrine", verdict }
    if (verdict.verdict === "requires_approval" && !input.approveDoctrine) {
      return { ok: false, reason: "Activation requires explicit operator approval", verdict }
    }
  }
  const granting = input.to === "approved"
  const terminal = input.to === "closed" || input.to === "aborted"
  const [updated] = await input.transaction.update(workOrder).set({
    status: input.to,
    authorityGranted: granting ? current.authorityLevel : current.authorityGranted,
    approvedBy: granting ? input.userId : current.approvedBy,
    approvedAt: granting ? input.now : current.approvedAt,
    closedAt: terminal ? input.now : current.closedAt,
    completedAt: input.to === "closed" ? input.now : current.completedAt,
    updatedAt: input.now,
  }).where(and(eq(workOrder.id, input.workOrderId), eq(workOrder.userId, input.userId))).returning()
  let createdGrant: AuthorityGrant | undefined
  if (granting && authorityRank(current.authorityLevel) > authorityRank("A0_READ_ONLY")) {
    const result = await createAuthorityGrantInTransaction(input.transaction, input.userId, {
      workOrderId: current.id, grantedTo: current.agent ?? "operator",
      authorityLevel: current.authorityLevel, scope: current.scope,
      allowedActions: current.allowedFiles, blockedActions: current.forbiddenFiles,
      reason: `Granted on authorization of ${current.ref ?? `#${current.id}`}`,
      expiresAt: input.grantExpiresAt ?? null,
    }, input.now)
    createdGrant = result.grant
  }
  const eventType = granting ? "WO_AUTHORIZED" : "WO_TRANSITION"
  const reason = granting ? `Authorized at ${current.authorityLevel}` : `${current.status} → ${input.to}`
  await input.transaction.insert(governanceEvent).values({
    userId: input.userId, eventType, entityType: "work_order", entityId: String(current.id),
    actor: input.userId, reason, beforeHash: hashRecord({ status: current.status }),
    afterHash: hashRecord({ status: input.to }),
    metadata: verdict ? {
      doctrineVerdict: verdict.verdict, doctrineMatches: verdict.matches,
      ...(verdict.verdict === "requires_approval" ? { doctrineApprovedBy: input.userId } : {}),
    } : null,
    createdAt: input.now,
  })
  await input.transaction.insert(eventLog).values({
    userId: input.userId, type: granting ? "work_order.authorized" : "work_order.transition",
    summary: granting ? `${current.ref ?? `#${current.id}`}: AUTHORIZED at ${current.authorityLevel}`
      : `${current.ref ?? `#${current.id}`}: ${current.status} → ${input.to}`,
    register: "work-orders", refId: current.id, createdAt: input.now,
    metadata: verdict?.verdict === "requires_approval"
      ? { doctrineApproval: "explicit", doctrineMatches: verdict.matches } : null,
  })
  return {
    ok: true, status: input.to, workOrder: updated,
    ...(createdGrant ? { authorityGrant: createdGrant } : {}),
    ...(verdict ? { doctrineVerdict: verdict } : {}),
  }
}
