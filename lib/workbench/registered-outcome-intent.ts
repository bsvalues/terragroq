export const ISSUE_911_RELIABILITY_OUTCOME_INTENT =
  "record structured #911 reliability remediation without host mutation"
export const ISSUE_911_LIVE_NONEMPTY_ACCEPTANCE_CONTRACT_ID =
  "issue-911-live-nonempty-acceptance.v1"
export const ISSUE_911_LIVE_NONEMPTY_ACCEPTANCE_KEY_PREFIX =
  `workbench-outcome:${ISSUE_911_LIVE_NONEMPTY_ACCEPTANCE_CONTRACT_ID}:`

const LIVE_ACCEPTANCE_KEY_RE = new RegExp(
  `^${ISSUE_911_LIVE_NONEMPTY_ACCEPTANCE_KEY_PREFIX.replaceAll(".", "\\.")}`
    + "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
)

function normalizeRegisteredOutcomeIntent(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase()
}

export function isIssue911ReliabilityOutcomeIntent(value: string): boolean {
  return normalizeRegisteredOutcomeIntent(value) === ISSUE_911_RELIABILITY_OUTCOME_INTENT
}

export function issue911LiveAcceptanceContractIds(input: Readonly<{
  projectId: number
  intent: string
  idempotencyKey: string
}>): readonly string[] {
  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : ""
  const resemblesAcceptanceKey = key.startsWith(
    "workbench-outcome:issue-911-live-nonempty-acceptance",
  )
  if (!resemblesAcceptanceKey) return []
  if (
    input.projectId !== 1
    || !isIssue911ReliabilityOutcomeIntent(input.intent)
    || !LIVE_ACCEPTANCE_KEY_RE.test(key)
  ) {
    throw new Error("ISSUE_911_LIVE_ACCEPTANCE_INPUT_WALL")
  }
  return [ISSUE_911_LIVE_NONEMPTY_ACCEPTANCE_CONTRACT_ID]
}
