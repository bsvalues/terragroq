"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db, pool } from "@/lib/db"
import {
  authorityGrant,
  decision,
  eventLog,
  governanceEvent,
  outcomeQueueItem,
  type AuthorityGrant,
  type OutcomeQueueItem,
} from "@/lib/db/schema"
import {
  projectOutcomeQueueOperatorSurface,
  type OutcomeQueueOperatorSurface,
} from "@/lib/outcome-queue/operator-surface"
import type { OutcomeQueueRecord } from "@/lib/outcome-queue/engine"
import {
  buildOutcomeQueueRuntimeMutation,
  classifyOutcomeQueueMutationError,
  isOutcomeAuthorityBindingAllowed,
  isOutcomeAuthorityLifecycleEligible,
  outcomeAuthorityGrantResult,
  shouldRebindOutcomeAuthority,
  validateOutcomeQueueMutationInput,
  type OutcomeQueueMutationActionResult,
  type OutcomeQueueMutationInput,
} from "@/lib/outcome-queue/operator-mutations"
import { getUserId } from "@/lib/session"
import { createAuthorityGrantWithResult } from "@/app/actions/authority"
import { hashRecord } from "@/lib/governance/hash"
import {
  isCanonicalV12AcceptanceCandidate,
  isExactV12AcceptanceDecision,
  isExactV12AcceptanceGrant,
  isV12AcceptanceAuthorityScope,
  v12AcceptanceAuthorityRefs,
  V1_2_ACCEPTANCE_BLOCKED_ACTIONS,
} from "@/lib/outcome-queue/v1-2-acceptance-authority"

type QueueMutationRuntimeResult = {
  replayed?: boolean
  outcome?: { outcomeKey?: string; version?: number }
  code?: string
}

const OUTCOME_GRANT_BLOCKED_ACTIONS = [
  "production mutation",
  "TerraFusion",
  "Property Workbench",
  "TerraPilot",
  "county/PACS",
  "protected data",
  "paid overage",
  "destructive action",
  "secret inspection",
  "authority expansion",
  "issue #357",
] as const

function asRecord(row: OutcomeQueueItem): OutcomeQueueRecord {
  return {
    ...row,
    dependencyKeys: row.dependencyKeys ?? [],
    terminalEvidenceRefs: row.terminalEvidenceRefs ?? [],
  } as unknown as OutcomeQueueRecord
}

function actionCovered(values: readonly string[], action: string): boolean {
  const normalized = action.toLowerCase()
  return values.some((value) => normalized.includes(value.toLowerCase()))
}

function grantMatches(
  item: OutcomeQueueRecord,
  grant: AuthorityGrant,
  now: Date,
  requireBoundReference = true,
): boolean {
  if (
    grant.ref === null
    || (requireBoundReference && grant.ref !== item.authorityGrantRef)
    || grant.status !== "active"
    || grant.revokedAt !== null
    || (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime())
    || grant.authorityLevel !== item.authorityLevel
    || grant.grantedTo !== item.authoritySubject
    || grant.scope !== item.outcomeKey
    || (grant.workOrderId !== null && grant.workOrderId !== item.activeWorkOrderId)
    || actionCovered(grant.blockedActions, item.authorityAction)
  ) {
    return false
  }
  return grant.allowedActions.length === 0
    || actionCovered(grant.allowedActions, item.authorityAction)
}

export async function getOutcomeQueueSurface(): Promise<OutcomeQueueOperatorSurface> {
  const userId = await getUserId()
  const now = new Date()
  const [rows, decisions, grants] = await Promise.all([
    db.select().from(outcomeQueueItem).where(eq(outcomeQueueItem.userId, userId)),
    db
      .select()
      .from(decision)
      .where(and(
        eq(decision.userId, userId),
        eq(decision.status, "accepted"),
        eq(decision.authority, "binding"),
      )),
    db
      .select()
      .from(authorityGrant)
      .where(and(
        eq(authorityGrant.userId, userId),
        eq(authorityGrant.status, "active"),
      )),
  ])
  const queue = rows.map(asRecord)
  const byDecisionId = new Map(decisions.map((entry) => [entry.id, entry]))
  const validApprovalDecisionIds = queue.flatMap((item) => {
    if (item.approvalDecisionId === null) return []
    const approval = byDecisionId.get(item.approvalDecisionId)
    return approval && isOutcomeAuthorityBindingAllowed(item, approval)
      ? [approval.id]
      : []
  })
  const validAuthorityGrantRefs = queue.flatMap((item) => (
    decisions.some((approval) => isOutcomeAuthorityBindingAllowed(item, approval))
      && grants.some((grant) => grantMatches(item, grant, now))
      && item.authorityGrantRef
      ? [item.authorityGrantRef]
      : []
  ))
  const availableApprovalDecisionIdsByOutcomeKey = Object.fromEntries(
    queue.map((item) => [
      item.outcomeKey,
      decisions
        .filter((approval) => isOutcomeAuthorityBindingAllowed(item, approval))
        .map((approval) => approval.id),
    ]),
  )
  const availableAuthorityGrantRefsByOutcomeKey = Object.fromEntries(
    queue.map((item) => [
      item.outcomeKey,
      decisions.some((approval) => isOutcomeAuthorityBindingAllowed(item, approval))
        ? grants
          .filter((grant) => grantMatches(item, grant, now, false))
          .flatMap((grant) => grant.ref ? [grant.ref] : [])
        : [],
    ]),
  )

  return projectOutcomeQueueOperatorSurface({
    queue,
    now,
    allowedRiskClasses: ["R0", "R1"],
    validApprovalDecisionIds,
    validAuthorityGrantRefs,
    availableApprovalDecisionIdsByOutcomeKey,
    availableAuthorityGrantRefsByOutcomeKey,
  })
}

export async function recordOutcomeAuthorityGrant(input: {
  outcomeKey: string
  approvalDecisionId: number
}): Promise<{
  status: "RECORDED" | "REPLAYED" | "INVALID" | "UNAUTHORIZED"
  message: string
  grantRef: string | null
}> {
  const userId = await getUserId()
  if (
    typeof input.outcomeKey !== "string"
    || input.outcomeKey.trim() === ""
    || input.outcomeKey.length > 300
    || !Number.isSafeInteger(input.approvalDecisionId)
    || input.approvalDecisionId <= 0
  ) {
    return { status: "INVALID", message: "The authority binding is invalid.", grantRef: null }
  }

  const outcomeKey = input.outcomeKey.trim()
  const [item, approval] = await Promise.all([
    db
      .select()
      .from(outcomeQueueItem)
      .where(and(
        eq(outcomeQueueItem.userId, userId),
        eq(outcomeQueueItem.outcomeKey, outcomeKey),
      ))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(decision)
      .where(and(
        eq(decision.userId, userId),
        eq(decision.id, input.approvalDecisionId),
      ))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ])
  if (
    item === null
    || approval === null
    || !isOutcomeAuthorityLifecycleEligible(item.lifecycleState)
    || !isOutcomeAuthorityBindingAllowed(item, approval)
  ) {
    return {
      status: "UNAUTHORIZED",
      message: "An accepted exact-scope owner decision is required.",
      grantRef: null,
    }
  }

  const created = await createAuthorityGrantWithResult({
    grantedTo: item.authoritySubject,
    authorityLevel: item.authorityLevel,
    scope: item.outcomeKey,
    allowedActions: [item.authorityAction],
    blockedActions: [...OUTCOME_GRANT_BLOCKED_ACTIONS],
    reason: `${approval.ref ?? `Decision #${approval.id}`} authorizes only ${item.outcomeKey}.`,
    expiresInHours: 72,
    reuseActiveScope: true,
  })
  if (created.grant.ref === null) {
    throw new Error("Outcome authority grant is missing its durable reference.")
  }
  if (shouldRebindOutcomeAuthority(
    item.lifecycleState,
    item.authorityGrantRef,
    created.grant.ref,
  )) {
    const adapter = await import("@/scripts/hermes-bridge/outcome-queue-source.mjs") as {
      matchOutcomeAuthorityGrant?: (input: Record<string, unknown>) => Promise<unknown>
    }
    if (!adapter.matchOutcomeAuthorityGrant) {
      throw new Error("Outcome authority binding adapter is unavailable.")
    }
    await adapter.matchOutcomeAuthorityGrant({
      query: pool,
      userId,
      outcomeKey: item.outcomeKey,
      expectedVersion: item.version,
      authorityGrantRef: created.grant.ref,
      now: new Date(),
    })
  }
  revalidatePath("/goal-console")
  revalidatePath("/governance")
  return outcomeAuthorityGrantResult(created.grant.ref, created.replayed)
}

export async function recordV12AcceptanceAuthority(input: {
  outcomeKey: string
  expectedVersion: number
}): Promise<OutcomeQueueMutationActionResult> {
  const userId = await getUserId()
  if (
    !isV12AcceptanceAuthorityScope(input.outcomeKey)
    || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 0
  ) {
    return {
      status: "INVALID",
      message: "This owner action is limited to the V1.2 acceptance authority proof.",
      outcomeKey: input.outcomeKey,
      version: null,
    }
  }

  const result = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:outcome-queue`}))`,
    )
    await transaction.execute(
      sql`SELECT id
          FROM "outcome_queue_item"
          WHERE "userId" = ${userId}
            AND "outcomeKey" = ${input.outcomeKey}
          FOR UPDATE`,
    )
    const [item] = await transaction
      .select()
      .from(outcomeQueueItem)
      .where(and(
        eq(outcomeQueueItem.userId, userId),
        eq(outcomeQueueItem.outcomeKey, input.outcomeKey),
      ))
      .limit(1)
    if (!item) return { status: "STALE" as const, version: null }

    if (item.lifecycleState === "approved"
      && item.approvalState === "approved"
      && item.authorityState === "matched"
      && item.approvalDecisionId !== null
      && item.authorityGrantRef !== null) {
      const [[approval], [grant]] = await Promise.all([
        transaction
          .select()
          .from(decision)
          .where(and(
            eq(decision.userId, userId),
            eq(decision.id, item.approvalDecisionId),
          ))
          .limit(1),
        transaction
          .select()
          .from(authorityGrant)
          .where(and(
            eq(authorityGrant.userId, userId),
            eq(authorityGrant.ref, item.authorityGrantRef),
          ))
          .limit(1),
      ])
      if (approval
        && grant
        && isOutcomeAuthorityBindingAllowed(asRecord(item), approval)
        && isExactV12AcceptanceDecision(approval, item.outcomeKey)
        && isExactV12AcceptanceGrant(grant, item.outcomeKey, "active", userId)) {
        return { status: "REPLAYED" as const, version: item.version }
      }
      return { status: "STALE" as const, version: item.version }
    }
    if (!isCanonicalV12AcceptanceCandidate(item, input.expectedVersion)) {
      return { status: "STALE" as const, version: item.version }
    }

    const refs = v12AcceptanceAuthorityRefs(item.outcomeKey)
    if (!refs) throw new Error("V1_2_ACCEPTANCE_AUTHORITY_SCOPE_WALL")
    const { decisionRef, grantRef } = refs
    const [existingDecisionRef, existingGrantRef] = await Promise.all([
      transaction
        .select({ id: decision.id })
        .from(decision)
        .where(and(
          eq(decision.userId, userId),
          eq(decision.ref, decisionRef),
        ))
        .limit(1),
      transaction
        .select({ id: authorityGrant.id })
        .from(authorityGrant)
        .where(and(
          eq(authorityGrant.userId, userId),
          eq(authorityGrant.ref, grantRef),
        ))
        .limit(1),
    ])
    if (existingDecisionRef.length > 0 || existingGrantRef.length > 0) {
      throw new Error("V1_2_ACCEPTANCE_AUTHORITY_REFERENCE_COLLISION_WALL")
    }
    const [approval] = await transaction
      .insert(decision)
      .values({
        userId,
        ref: decisionRef,
        title: `Approve ${item.title}`,
        context: "WO #480 requires a bounded live authority and revocation proof.",
        decision: "APPROVE",
        rationale: "The authenticated Primary explicitly approved this exact A0 acceptance scope.",
        consequences: item.outcomeKey.endsWith("authority-blocked")
          ? "The grant will be revoked before the acceptance exercise continues."
          : "The grant permits only the bounded pause/resume acceptance exercise.",
        status: "accepted",
        authority: "binding",
        owner: "Bill",
        scope: item.outcomeKey,
        evidence: ["WO #480", "PR #494"],
        tags: ["v1.2", "acceptance", "owner-approved"],
        decidedAt: new Date(),
      })
      .returning()

    const grantDraft = {
      userId,
      ref: grantRef,
      workOrderId: null,
      grantedBy: userId,
      grantedTo: "operator",
      authorityLevel: "A0_READ_ONLY",
      scope: item.outcomeKey,
      allowedActions: ["outcome:execute"],
      blockedActions: [...V1_2_ACCEPTANCE_BLOCKED_ACTIONS],
      reason: `${approval.ref} authorizes only ${item.outcomeKey}.`,
      status: "active" as const,
      expiresAt: null,
    }
    const [grant] = await transaction
      .insert(authorityGrant)
      .values({ ...grantDraft, contentHash: hashRecord(grantDraft) })
      .returning()
    const now = new Date()
    const [approved] = await transaction
      .update(outcomeQueueItem)
      .set({
        approvalState: "approved",
        approvedBy: userId,
        approvedAt: now,
        approvalDecisionId: approval.id,
        authorityState: "matched",
        authorityGrantRef: grantRef,
        lifecycleState: "approved",
        lifecycleReason: "PRIMARY_V1_2_ACCEPTANCE_APPROVAL",
        version: item.version + 1,
        updatedAt: now,
      })
      .where(and(
        eq(outcomeQueueItem.id, item.id),
        eq(outcomeQueueItem.userId, userId),
        eq(outcomeQueueItem.version, item.version),
      ))
      .returning()
    if (!approved || !isExactV12AcceptanceGrant(
      grant,
      item.outcomeKey,
      "active",
      userId,
    )) {
      throw new Error("V1_2_ACCEPTANCE_AUTHORITY_ATOMICITY_WALL")
    }
    await transaction.insert(governanceEvent).values({
      userId,
      eventType: "AUTHORITY_GRANTED",
      entityType: "authority_grant",
      entityId: String(grant.id),
      actor: "operator",
      reason: grantDraft.reason,
      afterHash: hashRecord({ ...grantDraft, contentHash: grant.contentHash }),
      metadata: { authorityLevel: grant.authorityLevel, ref: grantRef },
    })
    await transaction.insert(eventLog).values([
      {
        userId,
        type: "decision.created",
        summary: `Logged ${approval.ref}: ${approval.title}`,
        register: "decisions",
        refId: approval.id,
      },
      {
        userId,
        type: "authority.granted",
        summary: `${grantRef}: granted A0_READ_ONLY to operator`,
        register: "authority",
        refId: grant.id,
      },
    ])
    return { status: "RECORDED" as const, version: approved.version }
  })
  revalidatePath("/goal-console")
  revalidatePath("/decisions")
  revalidatePath("/governance")
  return {
    status: result.status,
    message: result.status === "RECORDED"
      ? "Exact V1.2 acceptance authority approved and bound."
      : result.status === "REPLAYED"
        ? "This exact V1.2 acceptance authority is already bound."
        : "The acceptance authority request changed. Review current truth.",
    outcomeKey: input.outcomeKey,
    version: result.version,
  }
}

export async function revokeV12AcceptanceAuthority(input: {
  outcomeKey: string
}): Promise<{
  status: "RECORDED" | "REPLAYED" | "INVALID" | "STALE"
  message: string
}> {
  const userId = await getUserId()
  if (input.outcomeKey !== "acceptance:v1-2:authority-blocked") {
    return { status: "INVALID", message: "Only the revocation proof scope may be revoked here." }
  }
  const result = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:outcome-queue`}))`,
    )
    await transaction.execute(
      sql`SELECT id
          FROM "outcome_queue_item"
          WHERE "userId" = ${userId}
            AND "outcomeKey" = ${input.outcomeKey}
          FOR UPDATE`,
    )
    const [item] = await transaction
      .select()
      .from(outcomeQueueItem)
      .where(and(
        eq(outcomeQueueItem.userId, userId),
        eq(outcomeQueueItem.outcomeKey, input.outcomeKey),
      ))
      .limit(1)
    if (!item?.authorityGrantRef || item.lifecycleState !== "approved") {
      return "STALE" as const
    }
    await transaction.execute(
      sql`SELECT id
          FROM "authority_grant"
          WHERE "userId" = ${userId}
            AND ref = ${item.authorityGrantRef}
          FOR UPDATE`,
    )
    const [grant] = await transaction
      .select()
      .from(authorityGrant)
      .where(and(
        eq(authorityGrant.userId, userId),
        eq(authorityGrant.ref, item.authorityGrantRef),
      ))
      .limit(1)
    if (!grant) return "STALE" as const
    if (isExactV12AcceptanceGrant(grant, item.outcomeKey, "revoked", userId)) {
      return "REPLAYED" as const
    }
    if (!isExactV12AcceptanceGrant(grant, item.outcomeKey, "active", userId)) {
      return "STALE" as const
    }
    const now = new Date()
    const reason = "Primary Operator revoked the exact V1.2 acceptance proof grant."
    const [revoked] = await transaction
      .update(authorityGrant)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedBy: userId,
        revokeReason: reason,
      })
      .where(and(
        eq(authorityGrant.id, grant.id),
        eq(authorityGrant.status, "active"),
      ))
      .returning()
    if (!revoked || !isExactV12AcceptanceGrant(
      revoked,
      item.outcomeKey,
      "revoked",
      userId,
    )) {
      throw new Error("V1_2_ACCEPTANCE_REVOCATION_ATOMICITY_WALL")
    }
    await transaction.insert(governanceEvent).values({
      userId,
      eventType: "AUTHORITY_REVOKED",
      entityType: "authority_grant",
      entityId: String(grant.id),
      actor: "operator",
      reason,
      beforeHash: hashRecord({ status: "active" }),
      afterHash: hashRecord({ status: "revoked", revokeReason: reason }),
    })
    await transaction.insert(eventLog).values({
      userId,
      type: "authority.revoked",
      summary: `${grant.ref}: REVOKED — ${reason}`,
      register: "authority",
      refId: grant.id,
    })
    return "RECORDED" as const
  })
  revalidatePath("/goal-console")
  revalidatePath("/governance")
  return {
    status: result,
    message: result === "RECORDED"
      ? "Acceptance proof authority revoked."
      : result === "REPLAYED"
        ? "The acceptance authority is already revoked."
        : "The revocation proof is not ready.",
  }
}

async function runtimeMutation(input: OutcomeQueueMutationInput, userId: string) {
  const adapter = await import("@/scripts/hermes-bridge/outcome-queue-source.mjs") as {
    mutateOutcomeQueueItem?: (input: Record<string, unknown>) => Promise<QueueMutationRuntimeResult>
  }
  if (!adapter.mutateOutcomeQueueItem) {
    throw Object.assign(new Error("Outcome queue mutation adapter is unavailable"), {
      code: "OUTCOME_QUEUE_MUTATION_ADAPTER_UNAVAILABLE",
    })
  }
  return adapter.mutateOutcomeQueueItem(
    buildOutcomeQueueRuntimeMutation(input, userId, pool),
  )
}

function runtimeCode(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error
    && typeof error.code === "string"
    ? error.code
    : ""
}

export async function mutateOutcomeQueue(
  input: OutcomeQueueMutationInput,
): Promise<OutcomeQueueMutationActionResult> {
  let userId: string
  try {
    userId = await getUserId()
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        status: "UNAUTHORIZED",
        message: "Primary Operator authentication is required.",
        outcomeKey: null,
        version: null,
      }
    }
    throw error
  }

  const validated = validateOutcomeQueueMutationInput(input)
  if (validated === null) {
    return {
      status: "INVALID",
      message: "The queue decision payload is invalid.",
      outcomeKey: null,
      version: null,
    }
  }
  if (isV12AcceptanceAuthorityScope(validated.outcomeKey)) {
    return {
      status: "INVALID",
      message: "Use the bounded V1.2 acceptance authority controls.",
      outcomeKey: validated.outcomeKey,
      version: null,
    }
  }

  try {
    const result = await runtimeMutation(validated, userId)
    revalidatePath("/goal-console")
    revalidatePath("/work-orders")
    return {
      status: result.replayed ? "REPLAYED" : "RECORDED",
      message: result.replayed
        ? "This queue decision was already recorded."
        : "Queue decision recorded.",
      outcomeKey: result.outcome?.outcomeKey ?? validated.outcomeKey,
      version: result.outcome?.version ?? null,
    }
  } catch (error) {
    const code = runtimeCode(error)
    const status = classifyOutcomeQueueMutationError(code)
    if (status === "STALE") {
      return {
        status: "STALE",
        message: "The queue changed before this decision was recorded. Refresh and review current truth.",
        outcomeKey: validated.outcomeKey,
        version: null,
      }
    }
    if (status === "CONFLICT") {
      return {
        status: "CONFLICT",
        message: "This request key is already bound to a different queue decision.",
        outcomeKey: validated.outcomeKey,
        version: null,
      }
    }
    if (status === "UNAUTHORIZED") {
      return {
        status: "UNAUTHORIZED",
        message: "A current binding decision and live scoped authority are required.",
        outcomeKey: validated.outcomeKey,
        version: null,
      }
    }
    if (status === "INVALID") {
      return {
        status: "INVALID",
        message: "The queue decision is invalid for the current outcome state.",
        outcomeKey: validated.outcomeKey,
        version: null,
      }
    }
    throw error
  }
}
