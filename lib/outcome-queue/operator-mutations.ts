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

const ACTIONS = new Set<QueueMutationAction>([
  "pause", "resume", "reorder", "approve", "decline", "supersede",
])
const EXACT_STATUS_BY_CODE: Record<string, OutcomeQueueMutationActionResult["status"]> = {
  OUTCOME_QUEUE_ORDERED_SNAPSHOT_INCOMPLETE: "STALE",
  OUTCOME_QUEUE_OUTCOME_NOT_FOUND: "STALE",
  OUTCOME_QUEUE_IDEMPOTENCY_CONFLICT: "CONFLICT",
  OUTCOME_QUEUE_APPROVAL_AUTHORITY_REQUIRED: "INVALID",
  OUTCOME_QUEUE_APPROVAL_AUTHORITY_INVALID: "UNAUTHORIZED",
}

export function validateOutcomeQueueMutationInput(
  value: unknown,
): OutcomeQueueMutationInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (
    typeof input.action !== "string"
    || !ACTIONS.has(input.action as QueueMutationAction)
    || typeof input.outcomeKey !== "string"
    || input.outcomeKey.trim() === ""
    || input.outcomeKey.length > 300
    || !Number.isSafeInteger(input.expectedVersion)
    || Number(input.expectedVersion) < 0
    || typeof input.idempotencyKey !== "string"
    || input.idempotencyKey.trim() === ""
    || input.idempotencyKey.length > 200
    || (input.reason !== undefined
      && (typeof input.reason !== "string" || input.reason.length > 2_000))
  ) {
    return null
  }
  if (input.orderedOutcomes !== undefined) {
    if (!Array.isArray(input.orderedOutcomes) || input.orderedOutcomes.length > 500) return null
    if (input.orderedOutcomes.some((entry) => (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || typeof (entry as Record<string, unknown>).outcomeKey !== "string"
      || !Number.isSafeInteger((entry as Record<string, unknown>).expectedVersion)
    ))) return null
  }
  if (input.replacement !== undefined) {
    if (!input.replacement || typeof input.replacement !== "object"
      || Array.isArray(input.replacement)) return null
    const replacement = input.replacement as Record<string, unknown>
    if (
      typeof replacement.title !== "string"
      || replacement.title.trim() === ""
      || replacement.title.length > 500
      || (replacement.objective !== undefined
        && (typeof replacement.objective !== "string"
          || replacement.objective.length > 2_000))
    ) return null
  }
  if (input.action === "reorder" && input.orderedOutcomes === undefined) return null
  if (input.action === "supersede" && input.replacement === undefined) return null
  return input as OutcomeQueueMutationInput
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
  const exact = EXACT_STATUS_BY_CODE[code]
  if (exact) return exact
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
