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
  "ORPHANED_ACTIVE_MISSION",
  "PARENT_MISSION_BINDING_REQUIRED",
])

export const EXTERNAL_PARENT_MISSION_BINDING_VERSION =
  "external-parent-mission-binding.v1"
export const EXTERNAL_PARENT_MISSION_DECOMPOSITION_VERSION =
  "external-parent-mission-decomposition.v2"
export const EXTERNAL_PARENT_MISSION_DECOMPOSITION_OPERATION =
  "space.external_parent_mission.decomposition.bind"
export const EXTERNAL_PARENT_MISSION_BIND_OPERATION =
  "space.external_parent_mission.bind"
export const EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION =
  "space.external_parent_mission.terminal"
export const EXTERNAL_PARENT_MISSION_TERMINAL_VERSION =
  "external-parent-mission-terminal.v1"

// JavaScript's default string ordering compares UTF-16 code units. Keep this
// explicit so admission and the raw HERMES reader cannot drift with host locale.
export function compareCanonicalStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function isCanonicalNonemptyStringArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === "string" && entry.trim() === entry && entry !== "")
    && new Set(value).size === value.length
    && value.every((entry, index) => (
      index === 0 || compareCanonicalStrings(value[index - 1], entry) < 0
    ))
}

export function isCanonicalGitHubRepositoryIdentity(value) {
  return typeof value === "string"
    && value.length <= 200
    && value.trim() === value
    && value === value.toLowerCase()
    && !value.toLowerCase().endsWith(".git")
    && !value.includes("\0")
    && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(value)
}

export function mapLegacyRiskClass(risk) {
  return risk === "low" || risk === "R1" ? "R1" : "R2"
}

export function mapLegacyLifecycleState(status, completed) {
  if (completed) return "completed"
  if (status === "converted") return "blocked"
  if (status === "dismissed") return "declined"
  return "suggested"
}
