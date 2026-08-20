export const OUTCOME_LIFECYCLE_STATES = Object.freeze([
  "suggested",
  "approved",
  "blocked",
  "active",
  "completed",
  "declined",
  "superseded",
])

export const TERMINAL_OUTCOME_STATES = Object.freeze([
  "completed",
  "declined",
  "superseded",
])

// Completion is intentionally absent. It must use the evidence-bearing
// completion API rather than the generic lifecycle transition.
export const LEGAL_OUTCOME_TRANSITIONS = Object.freeze({
  suggested: Object.freeze(["approved", "declined", "superseded"]),
  approved: Object.freeze(["blocked", "active", "declined", "superseded"]),
  blocked: Object.freeze(["approved", "declined", "superseded"]),
  active: Object.freeze(["blocked"]),
  completed: Object.freeze([]),
  declined: Object.freeze([]),
  superseded: Object.freeze([]),
})

export const NO_SELECTION_REASONS = Object.freeze([
  "EMPTY_QUEUE",
  "ACTIVE_LEASE_HELD",
  "DEPENDENCIES_UNSATISFIED",
  "AUTHORITY_INELIGIBLE",
  "AWAITING_APPROVAL",
  "RISK_INELIGIBLE",
  "ONLY_BLOCKED_OUTCOMES",
  "ALL_OUTCOMES_TERMINAL",
  "NO_ELIGIBLE_OUTCOME",
])

export function mapLegacyRiskClass(risk) {
  return risk === "low" || risk === "R1" ? "R1" : "R2"
}

export function mapLegacyLifecycleState(status, completed) {
  if (completed) return "completed"
  if (status === "converted") return "blocked"
  if (status === "dismissed") return "declined"
  return "suggested"
}
