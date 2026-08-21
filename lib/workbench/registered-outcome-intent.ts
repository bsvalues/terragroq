export const ISSUE_911_RELIABILITY_OUTCOME_INTENT =
  "record structured #911 reliability remediation without host mutation"

function normalizeRegisteredOutcomeIntent(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase()
}

export function isIssue911ReliabilityOutcomeIntent(value: string): boolean {
  return normalizeRegisteredOutcomeIntent(value) === ISSUE_911_RELIABILITY_OUTCOME_INTENT
}
