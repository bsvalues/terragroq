"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db, pool } from "@/lib/db"
import {
  authorityGrant,
  decision,
  eventLog,
  goal,
  governanceEvent,
  outcomeQueueItem,
  outcomeQueueMutationReceipt,
  type AuthorityGrant,
  type OutcomeQueueItem,
} from "@/lib/db/schema"
import {
  projectOutcomeQueueOperatorSurface,
  type OutcomeQueueOperatorRow,
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
import { getSession, getUserId } from "@/lib/session"
import { isDeclaredPrimaryEmail } from "@/lib/primary-identity"
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
import {
  exactV12CampaignDecision,
  exactV12CampaignGrant,
  exactV12CampaignRevokedGrant,
  isCanonicalV12CampaignCandidate,
  isExactRenewableV12CampaignQueueRow,
  isExactV12CampaignMaterialization,
  isV12CampaignAuthorityScope,
  V1_2_CAMPAIGN_PARENT_BODY_SHA256,
  v12CampaignAuthorityRefs,
  v12CampaignDecision,
  v12CampaignGrant,
} from "@/lib/outcome-queue/v1-2-campaign-authority"
import { isProtectedV12AuthorityScope } from "@/lib/outcome-queue/v1-2-protected-authority"

type QueueMutationRuntimeResult = {
  replayed?: boolean
  outcome?: { outcomeKey?: string; version?: number }
  code?: string
}

export type OutcomeQueueActionSurface = Omit<OutcomeQueueOperatorSurface, "rows"> & {
  rows: readonly (OutcomeQueueOperatorRow & {
    hasRetainedRuntimeBindings: boolean
  })[]
}

const MANUAL_OUTCOME_PAUSE_REASONS = new Set([
  "OPERATOR_PAUSED",
  "Primary Operator paused this outcome.",
])

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

async function getDeclaredPrimaryUserId(): Promise<string> {
  const session = await getSession()
  if (!session?.user
    || typeof session.user.email !== "string"
    || !isDeclaredPrimaryEmail(session.user.email)) {
    throw new Error("Unauthorized")
  }
  return session.user.id
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

export async function getOutcomeQueueSurface(): Promise<OutcomeQueueActionSurface> {
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

  const surface = projectOutcomeQueueOperatorSurface({
    queue,
    now,
    allowedRiskClasses: ["R0", "R1"],
    validApprovalDecisionIds,
    validAuthorityGrantRefs,
    availableApprovalDecisionIdsByOutcomeKey,
    availableAuthorityGrantRefsByOutcomeKey,
  })
  const retainedRuntimeBindings = new Map(rows.map((row) => [
    row.outcomeKey,
    row.executionBinding !== null
      || row.leaseHolder !== null
      || row.leaseToken !== null
      || row.acquisitionKey !== null,
  ]))

  return {
    ...surface,
    rows: surface.rows.map((row) => ({
      ...row,
      hasRetainedRuntimeBindings:
        retainedRuntimeBindings.get(row.outcomeKey) ?? true,
    })),
  }
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
  if (isProtectedV12AuthorityScope(outcomeKey)) {
    return {
      status: "INVALID",
      message: "Use the bounded Primary campaign authority control.",
      grantRef: null,
    }
  }
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
  let userId: string
  try {
    userId = await getUserId()
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        status: "UNAUTHORIZED",
        message: "Primary Operator authentication is required.",
        outcomeKey: input.outcomeKey,
        version: null,
      }
    }
    throw error
  }
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

export async function recordV12CampaignOutcomeAuthority(input: {
  outcomeKey: string
  expectedVersion: number
}): Promise<OutcomeQueueMutationActionResult> {
  let userId: string
  try {
    userId = await getDeclaredPrimaryUserId()
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        status: "UNAUTHORIZED",
        message: "Primary Operator authentication is required.",
        outcomeKey: input.outcomeKey,
        version: null,
      }
    }
    throw error
  }
  if (
    !isV12CampaignAuthorityScope(input.outcomeKey)
    || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 0
  ) {
    return {
      status: "INVALID",
      message: "This owner action is limited to the two fixed V1.2 product proposals.",
      outcomeKey: input.outcomeKey,
      version: null,
    }
  }
  const campaignScope = input.outcomeKey

  const result = await db.transaction(async (transaction) => {
    for (const lock of [
      `${userId}:authority-grant-allocation`,
      `${userId}:goal-outcome-intake`,
      `${userId}:outcome-queue`,
      `${userId}:v1-2-continuous-campaign`,
    ]) {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lock}))`)
    }
    await transaction.execute(
      sql`SELECT id
          FROM "outcome_queue_item"
          WHERE "userId" = ${userId}
            AND "outcomeKey" = ${campaignScope}
          FOR UPDATE`,
    )
    const [item] = await transaction
      .select()
      .from(outcomeQueueItem)
      .where(and(
        eq(outcomeQueueItem.userId, userId),
        eq(outcomeQueueItem.outcomeKey, campaignScope),
      ))
      .limit(1)
    if (!item) return { status: "STALE" as const, version: null }
    const now = new Date()

    const pausedCampaign = item.lifecycleState === "blocked"
      && MANUAL_OUTCOME_PAUSE_REASONS.has(item.lifecycleReason ?? "")
      && item.executionBinding === null
      && item.leaseHolder === null
      && item.leaseToken === null
      && item.leaseExpiresAt === null
      && item.acquisitionKey === null
    if (isExactRenewableV12CampaignQueueRow(item, userId)
      && (item.lifecycleState === "approved" || pausedCampaign)
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
        && exactV12CampaignDecision(approval, campaignScope)
        && exactV12CampaignGrant(grant, campaignScope, userId, now)) {
        return { status: "REPLAYED" as const, version: item.version, renewed: false }
      }
      if (!approval
        || !grant
        || !exactV12CampaignDecision(approval, campaignScope)
        || !exactV12CampaignGrant(
          grant,
          campaignScope,
          userId,
          now,
          { allowExpired: true },
        )
        || grant.expiresAt === null
        || grant.expiresAt.getTime() > now.getTime()
        || item.version !== input.expectedVersion
        || item.executionBinding !== null
        || item.leaseHolder !== null
        || item.leaseToken !== null
        || item.leaseExpiresAt !== null
        || item.acquisitionKey !== null
        || item.terminalResult !== null
        || item.terminalEvidenceId !== null
        || item.terminalEvidenceRefs.length !== 0
        || item.terminalKey !== null
        || item.terminalAt !== null) {
        return { status: "STALE" as const, version: item.version, renewed: false }
      }

      const renewedDraft = v12CampaignGrant(campaignScope, userId, now)
      const renewalCollision = await transaction
        .select({ id: authorityGrant.id })
        .from(authorityGrant)
        .where(and(
          eq(authorityGrant.userId, userId),
          eq(authorityGrant.ref, renewedDraft.ref),
        ))
        .limit(1)
      if (renewalCollision.length > 0) {
        return { status: "STALE" as const, version: item.version, renewed: false }
      }
      const [renewedGrant] = await transaction
        .insert(authorityGrant)
        .values({
          ...renewedDraft,
          allowedActions: [...renewedDraft.allowedActions],
          blockedActions: [...renewedDraft.blockedActions],
          expiresAt: new Date(renewedDraft.expiresAt),
          createdAt: new Date(renewedDraft.createdAt),
        })
        .returning()
      const [renewed] = await transaction
        .update(outcomeQueueItem)
        .set({
          authorityGrantRef: renewedGrant.ref,
          lifecycleReason: pausedCampaign
            ? item.lifecycleReason
            : "PRIMARY_V1_2_CAMPAIGN_AUTHORITY_RENEWAL",
          version: item.version + 1,
          updatedAt: now,
        })
        .where(and(
          eq(outcomeQueueItem.id, item.id),
          eq(outcomeQueueItem.userId, userId),
          eq(outcomeQueueItem.version, item.version),
        ))
        .returning()
      if (!renewed
        || !exactV12CampaignGrant(renewedGrant, campaignScope, userId, now)) {
        throw new Error("V1_2_CAMPAIGN_AUTHORITY_RENEWAL_ATOMICITY_WALL")
      }
      await transaction.insert(governanceEvent).values({
        userId,
        eventType: "AUTHORITY_RENEWED",
        entityType: "authority_grant",
        entityId: String(renewedGrant.id),
        actor: "operator",
        reason: renewedGrant.reason,
        beforeHash: grant.contentHash,
        afterHash: hashRecord(renewedDraft),
        metadata: {
          authorityLevel: renewedGrant.authorityLevel,
          decisionRef: approval.ref,
          grantRef: renewedGrant.ref,
          outcomeKey: item.outcomeKey,
          parentIssue: 471,
          parentBodySha256: V1_2_CAMPAIGN_PARENT_BODY_SHA256,
          replacesGrantRef: grant.ref,
        },
      })
      await transaction.insert(eventLog).values({
        userId,
        type: "authority.renewed",
        summary: `${renewedGrant.ref}: renewed ${renewedGrant.authorityLevel} for 48 hours`,
        register: "authority",
        refId: renewedGrant.id,
      })
      return { status: "RECORDED" as const, version: renewed.version, renewed: true }
    }
    if (item.outcomeKey !== campaignScope
      || item.version !== input.expectedVersion
      || !isCanonicalV12CampaignCandidate(item)) {
      return { status: "STALE" as const, version: item.version, renewed: false }
    }

    const [[materializedGoal], materializationEvents, materializationAudits] =
      await Promise.all([
        transaction
          .select()
          .from(goal)
          .where(and(
            eq(goal.userId, userId),
            eq(goal.id, item.goalId!),
          ))
          .limit(1),
        transaction
          .select()
          .from(governanceEvent)
          .where(and(
            eq(governanceEvent.userId, userId),
            eq(governanceEvent.eventType, "V1_2_CHILD_OUTCOME_SUGGESTED"),
            eq(governanceEvent.entityType, "outcome_queue_item"),
            eq(governanceEvent.entityId, item.outcomeKey),
          )),
        transaction
          .select()
          .from(eventLog)
          .where(and(
            eq(eventLog.userId, userId),
            eq(eventLog.type, "outcome.suggested"),
            eq(eventLog.register, "outcome-queue"),
            eq(eventLog.refId, item.goalId!),
          )),
      ])
    if (!materializedGoal
      || materializationEvents.length !== 1
      || materializationAudits.length !== 1
      || !isExactV12CampaignMaterialization({
        userId,
        item,
        goal: materializedGoal,
        governance: materializationEvents[0],
        audit: materializationAudits[0],
      })) {
      return { status: "STALE" as const, version: item.version, renewed: false }
    }

    const refs = v12CampaignAuthorityRefs(campaignScope)
    if (!refs) throw new Error("V1_2_CAMPAIGN_AUTHORITY_SCOPE_WALL")
    const grantDraft = v12CampaignGrant(campaignScope, userId, now)
    const [existingDecisionRef, existingGrantRef] = await Promise.all([
      transaction
        .select({ id: decision.id })
        .from(decision)
        .where(and(
          eq(decision.userId, userId),
          eq(decision.ref, refs.decisionRef),
        ))
        .limit(1),
      transaction
        .select({ id: authorityGrant.id })
        .from(authorityGrant)
        .where(and(
          eq(authorityGrant.userId, userId),
          eq(authorityGrant.ref, grantDraft.ref),
        ))
        .limit(1),
    ])
    if (existingDecisionRef.length > 0 || existingGrantRef.length > 0) {
      return { status: "STALE" as const, version: item.version, renewed: false }
    }

    const decisionDraft = v12CampaignDecision(campaignScope)
    const [approval] = await transaction
      .insert(decision)
      .values({
        userId,
        ...decisionDraft,
        evidence: [...decisionDraft.evidence],
        tags: [...decisionDraft.tags],
        decidedAt: now,
      })
      .returning()
    const [grant] = await transaction
      .insert(authorityGrant)
      .values({
        ...grantDraft,
        allowedActions: [...grantDraft.allowedActions],
        blockedActions: [...grantDraft.blockedActions],
        expiresAt: new Date(grantDraft.expiresAt),
        createdAt: new Date(grantDraft.createdAt),
      })
      .returning()
    const [approved] = await transaction
      .update(outcomeQueueItem)
      .set({
        approvalState: "approved",
        approvedBy: userId,
        approvedAt: now,
        approvalDecisionId: approval.id,
        authorityState: "matched",
        authorityGrantRef: grant.ref,
        lifecycleState: "approved",
        lifecycleReason: "PRIMARY_V1_2_CAMPAIGN_APPROVAL",
        version: item.version + 1,
        updatedAt: now,
      })
      .where(and(
        eq(outcomeQueueItem.id, item.id),
        eq(outcomeQueueItem.userId, userId),
        eq(outcomeQueueItem.version, item.version),
      ))
      .returning()
    if (!approved
      || !exactV12CampaignDecision(approval, campaignScope)
      || !exactV12CampaignGrant(grant, campaignScope, userId, now)) {
      throw new Error("V1_2_CAMPAIGN_AUTHORITY_ATOMICITY_WALL")
    }

    await transaction.insert(governanceEvent).values({
      userId,
      eventType: "AUTHORITY_GRANTED",
      entityType: "authority_grant",
      entityId: String(grant.id),
      actor: "operator",
      reason: grant.reason,
      afterHash: hashRecord(grantDraft),
      metadata: {
        authorityLevel: grant.authorityLevel,
        decisionRef: approval.ref,
        grantRef: grant.ref,
        outcomeKey: item.outcomeKey,
        parentIssue: 471,
        parentBodySha256: V1_2_CAMPAIGN_PARENT_BODY_SHA256,
        materializationEventId: materializationEvents[0].id,
        materializationAfterHash: materializationEvents[0].afterHash,
        goalId: item.goalId,
        goalRef: item.goalRef,
      },
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
        summary: `${grant.ref}: granted ${grant.authorityLevel} to operator`,
        register: "authority",
        refId: grant.id,
      },
    ])
    return { status: "RECORDED" as const, version: approved.version, renewed: false }
  })

  revalidatePath("/goal-console")
  revalidatePath("/decisions")
  revalidatePath("/governance")
  return {
    status: result.status,
    message: result.status === "RECORDED"
      ? result.renewed
        ? "This exact V1.2 product outcome authority is renewed for 48 hours."
        : "This exact V1.2 product outcome is approved and bound."
      : result.status === "REPLAYED"
        ? "This exact V1.2 product outcome is already approved."
        : "The V1.2 product proposal changed. Review current truth.",
    outcomeKey: input.outcomeKey,
    version: result.version,
  }
}

export async function revokeV12CampaignOutcomeAuthority(input: {
  outcomeKey: string
  expectedVersion: number
}): Promise<OutcomeQueueMutationActionResult> {
  let userId: string
  try {
    userId = await getDeclaredPrimaryUserId()
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        status: "UNAUTHORIZED",
        message: "Primary Operator authentication is required.",
        outcomeKey: input.outcomeKey,
        version: null,
      }
    }
    throw error
  }
  if (!isV12CampaignAuthorityScope(input.outcomeKey)
    || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 0) {
    return {
      status: "INVALID",
      message: "This owner action is limited to the two fixed V1.2 product outcomes.",
      outcomeKey: input.outcomeKey,
      version: null,
    }
  }
  const campaignScope = input.outcomeKey
  const result = await db.transaction(async (transaction) => {
    for (const lock of [
      `${userId}:authority-grant-allocation`,
      `${userId}:outcome-queue`,
      `${userId}:v1-2-continuous-campaign`,
    ]) {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lock}))`)
    }
    const [item] = await transaction
      .select()
      .from(outcomeQueueItem)
      .where(and(
        eq(outcomeQueueItem.userId, userId),
        eq(outcomeQueueItem.outcomeKey, campaignScope),
      ))
      .limit(1)
    if (!item
      || item.approvalDecisionId === null
      || item.authorityGrantRef === null) {
      return { status: "STALE" as const, version: item?.version ?? null }
    }
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
    if (!approval || !grant || !exactV12CampaignDecision(approval, campaignScope)) {
      return { status: "STALE" as const, version: item.version }
    }
    const reason = "Primary Operator revoked this exact V1.2 campaign outcome authority."
    if (grant.revokedAt instanceof Date
      && exactV12CampaignRevokedGrant(
        grant,
        campaignScope,
        userId,
        grant.revokedAt,
        reason,
      )
      && item.authorityState === "revoked") {
      return { status: "REPLAYED" as const, version: item.version }
    }
    if (item.version !== input.expectedVersion) {
      return { status: "STALE" as const, version: item.version }
    }
    if (item.lifecycleState === "active"
      || item.activeWorkOrderId != null
      || item.executionBinding != null
      || item.leaseHolder != null
      || item.leaseToken != null
      || item.leaseExpiresAt != null
      || Number(item.fencingToken ?? 0) !== 0
      || item.acquisitionKey != null
      || item.activatedAt != null) {
      return { status: "ACTIVE" as const, version: item.version }
    }
    const now = new Date()
    if (!exactV12CampaignGrant(grant, campaignScope, userId, now, {
      allowExpired: true,
    })) {
      return { status: "STALE" as const, version: item.version }
    }
    const [revokedGrant] = await transaction
      .update(authorityGrant)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedBy: userId,
        revokeReason: reason,
      })
      .where(and(
        eq(authorityGrant.id, grant.id),
        eq(authorityGrant.status, grant.status),
      ))
      .returning()
    const [revokedItem] = await transaction
      .update(outcomeQueueItem)
      .set({
        authorityState: "revoked",
        lifecycleReason: "PRIMARY_V1_2_CAMPAIGN_AUTHORITY_REVOKED",
        version: item.version + 1,
        updatedAt: now,
      })
      .where(and(
        eq(outcomeQueueItem.id, item.id),
        eq(outcomeQueueItem.userId, userId),
        eq(outcomeQueueItem.version, item.version),
      ))
      .returning()
    if (!revokedGrant
      || !revokedItem
      || !exactV12CampaignRevokedGrant(
        revokedGrant,
        campaignScope,
        userId,
        now,
        reason,
      )) {
      throw new Error("V1_2_CAMPAIGN_AUTHORITY_REVOCATION_ATOMICITY_WALL")
    }
    await transaction.insert(governanceEvent).values({
      userId,
      eventType: "AUTHORITY_REVOKED",
      entityType: "authority_grant",
      entityId: String(revokedGrant.id),
      actor: "operator",
      reason,
      beforeHash: grant.contentHash,
      afterHash: hashRecord({
        status: "revoked",
        revokedAt: now.toISOString(),
        revokedBy: userId,
        revokeReason: reason,
      }),
      metadata: {
        decisionRef: approval.ref,
        grantRef: revokedGrant.ref,
        outcomeKey: campaignScope,
        parentIssue: 471,
      },
    })
    await transaction.insert(eventLog).values({
      userId,
      type: "authority.revoked",
      summary: `${revokedGrant.ref}: REVOKED — ${reason}`,
      register: "authority",
      refId: revokedGrant.id,
    })
    return { status: "RECORDED" as const, version: revokedItem.version }
  })
  revalidatePath("/goal-console")
  revalidatePath("/governance")
  return {
    status: result.status === "ACTIVE" ? "INVALID" : result.status,
    message: result.status === "RECORDED"
      ? "This exact V1.2 product outcome authority is revoked."
      : result.status === "REPLAYED"
        ? "This exact V1.2 product outcome authority is already revoked."
        : result.status === "ACTIVE"
          ? "Pause this active outcome before revoking its authority."
        : "The V1.2 product outcome authority changed. Review current truth.",
    outcomeKey: campaignScope,
    version: result.version,
  }
}

export async function revokeV12AcceptanceAuthority(input: {
  outcomeKey: string
}): Promise<{
  status: "RECORDED" | "REPLAYED" | "INVALID" | "STALE" | "UNAUTHORIZED"
  message: string
}> {
  let userId: string
  try {
    userId = await getUserId()
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return {
        status: "UNAUTHORIZED",
        message: "Primary Operator authentication is required.",
      }
    }
    throw error
  }
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

function isProtectedV12Outcome(outcomeKey: string): boolean {
  return isV12AcceptanceAuthorityScope(outcomeKey)
    || isV12CampaignAuthorityScope(outcomeKey)
}
const V1_2_CAMPAIGN_RECOVERY_ACTIONS = new Set([
  "pause",
  "resume",
  "decline",
])

async function protectedReorderSnapshotIsImmutable(
  input: OutcomeQueueMutationInput,
  userId: string,
): Promise<boolean> {
  if (input.action !== "reorder" || !input.orderedOutcomes) return true
  const rows = await db
    .select({
      outcomeKey: outcomeQueueItem.outcomeKey,
      queueOrder: outcomeQueueItem.queueOrder,
      lifecycleState: outcomeQueueItem.lifecycleState,
      version: outcomeQueueItem.version,
      createdAt: outcomeQueueItem.createdAt,
    })
    .from(outcomeQueueItem)
    .where(eq(outcomeQueueItem.userId, userId))
  const snapshot = rows
    .filter((row) => (
      ["suggested", "approved", "blocked"].includes(row.lifecycleState)
      || (row.lifecycleState === "active" && isProtectedV12Outcome(row.outcomeKey))
    ))
    .sort((left, right) => (
      left.queueOrder - right.queueOrder
      || left.createdAt.getTime() - right.createdAt.getTime()
      || left.outcomeKey.localeCompare(right.outcomeKey)
    ))
  const orderedKeys = input.orderedOutcomes.map((entry) => entry.outcomeKey)
  if (input.orderedOutcomes.length !== snapshot.length
    || new Set(orderedKeys).size !== orderedKeys.length) {
    return false
  }

  return snapshot.every((row, currentIndex) => {
    if (!isProtectedV12Outcome(row.outcomeKey)) return true
    const requestedIndex = orderedKeys.indexOf(row.outcomeKey)
    const requested = requestedIndex >= 0
      ? input.orderedOutcomes![requestedIndex]
      : null
    return requested !== null
      && requestedIndex === currentIndex
      && requested.expectedVersion === row.version
  })
}

async function campaignDeclinePreflight(
  input: OutcomeQueueMutationInput,
  userId: string,
): Promise<"OK" | "AUTHORITY_ACTIVE" | "RUNTIME_BOUND"> {
  if (input.action !== "decline" || !isV12CampaignAuthorityScope(input.outcomeKey)) {
    return "OK"
  }
  const [row] = await db
    .select({
      activeWorkOrderId: outcomeQueueItem.activeWorkOrderId,
      authorityGrantRef: outcomeQueueItem.authorityGrantRef,
      executionBinding: outcomeQueueItem.executionBinding,
      leaseHolder: outcomeQueueItem.leaseHolder,
      leaseToken: outcomeQueueItem.leaseToken,
      leaseExpiresAt: outcomeQueueItem.leaseExpiresAt,
      fencingToken: outcomeQueueItem.fencingToken,
      acquisitionKey: outcomeQueueItem.acquisitionKey,
      activatedAt: outcomeQueueItem.activatedAt,
    })
    .from(outcomeQueueItem)
    .where(and(
      eq(outcomeQueueItem.userId, userId),
      eq(outcomeQueueItem.outcomeKey, input.outcomeKey),
    ))
    .limit(1)
  if (!row) return "AUTHORITY_ACTIVE"
  if (row.activeWorkOrderId !== null
    || row.executionBinding !== null
    || row.leaseHolder !== null
    || row.leaseToken !== null
    || row.leaseExpiresAt !== null
    || row.fencingToken !== 0
    || row.acquisitionKey !== null
    || row.activatedAt !== null) {
    return "RUNTIME_BOUND"
  }
  if (row.authorityGrantRef === null) return "OK"
  const [grant] = await db
    .select({
      status: authorityGrant.status,
      expiresAt: authorityGrant.expiresAt,
    })
    .from(authorityGrant)
    .where(and(
      eq(authorityGrant.userId, userId),
      eq(authorityGrant.ref, row.authorityGrantRef),
    ))
    .limit(1)
  if (!grant || (grant.expiresAt !== null
    && (!(grant.expiresAt instanceof Date)
      || !Number.isFinite(grant.expiresAt.getTime())))) {
    return "AUTHORITY_ACTIVE"
  }
  return grant.status === "revoked"
    || grant.status === "expired"
    || (grant.status === "active"
      && grant.expiresAt instanceof Date
      && grant.expiresAt.getTime() <= Date.now())
    ? "OK"
    : "AUTHORITY_ACTIVE"
}

async function genericCampaignResumeIsManualPause(
  input: OutcomeQueueMutationInput,
  userId: string,
): Promise<boolean> {
  if (input.action !== "resume" || !isV12CampaignAuthorityScope(input.outcomeKey)) {
    return true
  }
  const [item] = await db
    .select({
      lifecycleState: outcomeQueueItem.lifecycleState,
      lifecycleReason: outcomeQueueItem.lifecycleReason,
      executionBinding: outcomeQueueItem.executionBinding,
      leaseHolder: outcomeQueueItem.leaseHolder,
      leaseToken: outcomeQueueItem.leaseToken,
      leaseExpiresAt: outcomeQueueItem.leaseExpiresAt,
      acquisitionKey: outcomeQueueItem.acquisitionKey,
    })
    .from(outcomeQueueItem)
    .where(and(
      eq(outcomeQueueItem.userId, userId),
      eq(outcomeQueueItem.outcomeKey, input.outcomeKey),
    ))
    .limit(1)

  return item !== undefined
    && item.lifecycleState === "blocked"
    && MANUAL_OUTCOME_PAUSE_REASONS.has(item.lifecycleReason ?? "")
    && item.executionBinding === null
    && item.leaseHolder === null
    && item.leaseToken === null
    && item.leaseExpiresAt === null
    && item.acquisitionKey === null
}

async function exactCampaignResumeReplayExists(
  input: OutcomeQueueMutationInput,
  userId: string,
): Promise<boolean> {
  if (input.action !== "resume" || !isV12CampaignAuthorityScope(input.outcomeKey)) {
    return false
  }
  const requestBinding = {
    action: input.action,
    outcomeKey: input.outcomeKey.trim(),
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey.trim(),
    reason: input.reason?.trim() ?? null,
    approvalDecisionId: input.approvalDecisionId ?? null,
    authorityGrantRef: input.authorityGrantRef?.trim() ?? null,
    orderedOutcomes: null,
    dependencyKeys: null,
    replacement: null,
  }
  const requestHash = hashRecord(requestBinding)
  const [receipt] = await db
    .select({
      operation: outcomeQueueMutationReceipt.operation,
      outcomeKey: outcomeQueueMutationReceipt.outcomeKey,
      requestHash: outcomeQueueMutationReceipt.requestHash,
      requestBinding: outcomeQueueMutationReceipt.requestBinding,
    })
    .from(outcomeQueueMutationReceipt)
    .where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.idempotencyKey, requestBinding.idempotencyKey),
    ))
    .limit(1)

  return receipt !== undefined
    && receipt.operation === "resume"
    && receipt.outcomeKey === requestBinding.outcomeKey
    && receipt.requestHash === requestHash
    && hashRecord(receipt.requestBinding) === requestHash
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
  if (isV12AcceptanceAuthorityScope(validated.outcomeKey)
    || (
      isV12CampaignAuthorityScope(validated.outcomeKey)
      && !V1_2_CAMPAIGN_RECOVERY_ACTIONS.has(validated.action)
    )) {
    return {
      status: "INVALID",
      message: "Use the bounded V1.2 authority controls.",
      outcomeKey: validated.outcomeKey,
      version: null,
    }
  }
  if (isV12CampaignAuthorityScope(validated.outcomeKey)) {
    try {
      userId = await getDeclaredPrimaryUserId()
    } catch (error) {
      if (error instanceof Error && error.message === "Unauthorized") {
        return {
          status: "UNAUTHORIZED",
          message: "Primary Operator authentication is required.",
          outcomeKey: validated.outcomeKey,
          version: null,
        }
      }
      throw error
    }
  }
  if (
    validated.action === "reorder"
    && !await protectedReorderSnapshotIsImmutable(validated, userId)
  ) {
    return {
      status: "INVALID",
      message: "Protected V1.2 rows must remain at their exact position and version.",
      outcomeKey: validated.outcomeKey,
      version: null,
    }
  }
  const campaignDeclineState = await campaignDeclinePreflight(validated, userId)
  if (campaignDeclineState !== "OK") {
    return {
      status: "INVALID",
      message: campaignDeclineState === "RUNTIME_BOUND"
        ? "Runtime-bound campaign outcomes must complete through Hermes."
        : "Revoke this product outcome authority before declining it.",
      outcomeKey: validated.outcomeKey,
      version: null,
    }
  }
  const manualCampaignResume =
    await genericCampaignResumeIsManualPause(validated, userId)
  if (!manualCampaignResume
    && !await exactCampaignResumeReplayExists(validated, userId)) {
    return {
      status: "INVALID",
      message: "Owner-decision campaign recovery must resume through the retained runtime binding.",
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
