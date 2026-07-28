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

type OutcomeAuthorityCandidate = {
  outcomeKey: string
  title: string
  objective: string | null
  riskClass: string
  authorityLevel: string
  authoritySubject: string
  authorityAction: string
}

type OutcomeApprovalCandidate = {
  status: string
  authority: string
  decision: string
  scope: string | null
}

const OUTCOME_AUTHORITY_LEVELS = new Set([
  "A0_READ_ONLY",
  "A1_DRAFT",
  "A2_WRITE_OWN",
])
const PROTECTED_OUTCOME_SCOPE = [
  /\b(?:terrafusion|terrapilot|property\s+workbench)\b/i,
  /\b(?:county|pacs|parcel|taxpayer|protected\s+data)\b/i,
  /\b(?:(?:deploy|release|cutover|mutat|writ|chang|updat|configur)\w*\b[\s\S]{0,40}\bproduction|production\b[\s\S]{0,40}\b(?:deploy|release|cutover|mutat|writ|chang|updat|configur)\w*)\b/i,
  /\b(?:(?:create|publish|cut|push)\s+(?:a\s+)?(?:github\s+)?release|(?:create|publish|push)\s+(?:a\s+)?(?:git\s+)?tag|tag\s+v?\d)\b/i,
  /\b(?:secret|password|credential|api[ -]?key|access[ -]?token|cookie|session)\b/i,
  /\b(?:paid\s+overage|increase\s+(?:the\s+)?spend|new\s+spending|purchase|billing\s+upgrade)\b/i,
  /\b(?:destructive|delete|drop\s+(?:table|database)|truncate|force[ -]?push|reset\s+--hard|wipe|purge)\b/i,
  /(?:\bissue\s*)?#?357\b/i,
]

export function isOutcomeAuthorityBindingAllowed(
  item: OutcomeAuthorityCandidate,
  approval: OutcomeApprovalCandidate,
): boolean {
  const scopeText = [item.outcomeKey, item.title, item.objective ?? ""].join("\n")
  return ["R0", "R1"].includes(item.riskClass)
    && OUTCOME_AUTHORITY_LEVELS.has(item.authorityLevel)
    && item.authoritySubject === "operator"
    && item.authorityAction === "outcome:execute"
    && !PROTECTED_OUTCOME_SCOPE.some((pattern) => pattern.test(scopeText))
    && approval.status === "accepted"
    && approval.authority === "binding"
    && approval.decision.trim().toUpperCase() === "APPROVE"
    && approval.scope === item.outcomeKey
}

export function outcomeAuthorityGrantResult(grantRef: string | null, replayed: boolean) {
  return {
    status: replayed ? "REPLAYED" as const : "RECORDED" as const,
    message: replayed
      ? "The scoped authority grant is already recorded."
      : "Exact-scope outcome authority recorded.",
    grantRef,
  }
}

export function shouldRebindOutcomeAuthority(
  lifecycleState: string,
  currentGrantRef: string | null,
  nextGrantRef: string,
): boolean {
  return lifecycleState === "approved" && currentGrantRef !== nextGrantRef
}

export function isOutcomeAuthorityLifecycleEligible(lifecycleState: string): boolean {
  return ["suggested", "approved", "blocked"].includes(lifecycleState)
}

export function shouldOfferOutcomeAuthorityBinding(
  lifecycleState: string,
  boundGrantRef: string | null,
  availableGrantRef: string | null,
): boolean {
  return isOutcomeAuthorityLifecycleEligible(lifecycleState)
    && (
      availableGrantRef === null
      || (lifecycleState === "approved" && boundGrantRef !== availableGrantRef)
    )
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
