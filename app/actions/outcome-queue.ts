"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db, pool } from "@/lib/db"
import {
  authorityGrant,
  decision,
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
