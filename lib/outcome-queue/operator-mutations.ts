export type QueueMutationAction =
  | "pause"
  | "resume"
  | "reorder"
  | "approve"
  | "decline"
  | "supersede"

export type OutcomeQueueMutationInput = {
  action: QueueMutationAction
  outcomeKey: string
  expectedVersion: number
  idempotencyKey: string
  reason?: string
  approvalDecisionId?: number
  authorityGrantRef?: string
  orderedOutcomes?: Array<{ outcomeKey: string; expectedVersion: number }>
  replacement?: {
    title: string
    objective?: string
  }
}

export type OutcomeQueueMutationActionResult = {
  status: "RECORDED" | "REPLAYED" | "STALE" | "CONFLICT" | "INVALID" | "UNAUTHORIZED"
  message: string
  outcomeKey: string | null
  version: number | null
}

export function buildOutcomeQueueRuntimeMutation(
  input: OutcomeQueueMutationInput,
  userId: string,
  query: unknown,
) {
  return {
    query,
    userId,
    action: input.action,
    outcomeKey: input.outcomeKey,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    approvalDecisionId: input.approvalDecisionId,
    authorityGrantRef: input.authorityGrantRef,
    orderedOutcomes: input.orderedOutcomes,
    replacement: input.replacement,
  }
}

export function classifyOutcomeQueueMutationError(
  code: string,
): OutcomeQueueMutationActionResult["status"] | null {
  if (
    code.includes("STALE")
    || code.includes("VERSION")
    || code.includes("ORDERED_SNAPSHOT_INCOMPLETE")
    || code.includes("OUTCOME_NOT_FOUND")
  ) {
    return "STALE"
  }
  if (code.includes("CONFLICT") || code.includes("IDEMPOTENCY")) return "CONFLICT"
  if (code.includes("UNAUTHORIZED") || code.includes("AUTHORITY") || code.includes("APPROVAL")) {
    return "UNAUTHORIZED"
  }
  if (code.includes("INVALID") || code.includes("ILLEGAL") || code.includes("REQUIRED")) {
    return "INVALID"
  }
  return null
}

export function scopeMatchesOutcome(
  scope: string | null,
  outcomeKey: string,
  goalRef: string | null,
): boolean {
  return scope === outcomeKey || (goalRef !== null && scope === goalRef)
}
