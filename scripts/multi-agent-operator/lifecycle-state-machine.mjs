const SUCCESS_STATES = Object.freeze([
  "PLANNED", "AUTHORITY_MATCHED", "DEPENDENCY_CLEARED", "RESERVED", "LEASED",
  "PROVIDER_DISPATCHED", "EXECUTING", "VALIDATING", "PR_OPEN", "INDEPENDENT_REVIEW",
  "REMEDIATING", "MERGE_ELIGIBLE", "MERGED", "VERIFIED", "COMPLETE", "DEPENDENTS_RELEASED",
])
const NON_SUCCESS_STATES = Object.freeze([
  "RETRY_SCHEDULED", "REROUTE_PENDING", "DEFERRED", "BLOCKED_DEPENDENCY",
  "BLOCKED_RESERVATION", "BLOCKED_NO_ELIGIBLE_PROVIDER", "BLOCKED_POLICY_CHANGED",
  "FAILED_VALIDATION_TERMINAL", "FAILED_REVIEW_TERMINAL", "FAILED_SECURITY_TERMINAL",
  "FAILED_OWNER_BABYSITTING", "FAILED_TERMINAL", "QUARANTINED_TERMINAL",
  "OWNER_DECISION_REQUIRED",
])
export const CANONICAL_LIFECYCLE_STATES = Object.freeze([...SUCCESS_STATES, ...NON_SUCCESS_STATES])
export const TERMINAL_LIFECYCLE_STATES = Object.freeze([
  "DEPENDENTS_RELEASED", "FAILED_VALIDATION_TERMINAL", "FAILED_REVIEW_TERMINAL",
  "FAILED_SECURITY_TERMINAL", "FAILED_OWNER_BABYSITTING", "FAILED_TERMINAL",
  "QUARANTINED_TERMINAL",
])
export const FAILURE_CLASSES = Object.freeze([
  "TRANSIENT_TRANSPORT", "PROVIDER_AUTHENTICATION", "RATE_LIMIT", "PROVIDER_SERVER",
  "PROVIDER_UNAVAILABLE", "WORKER_DEATH", "COORDINATOR_DEATH", "DUPLICATE_DELIVERY",
  "RESERVATION_COLLISION", "DEPENDENCY_INCOMPLETE", "DETERMINISTIC_VALIDATION",
  "FLAKY_CI", "REVIEW_CHANGES", "STALE_BASE", "POLICY_CHANGED", "SECURITY_BOUNDARY",
  "OWNER_AUTHORITY_GAP",
])
const STATE_SET = new Set(CANONICAL_LIFECYCLE_STATES)
const TERMINAL_SET = new Set(TERMINAL_LIFECYCLE_STATES)
const FAILURE_SET = new Set(FAILURE_CLASSES)
const IDENTIFIER = /^[A-Z0-9][A-Z0-9_.:-]{1,127}$/
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const OWNER_CONDITIONS = new Set([
  "MATERIAL_PRODUCT_SCOPE", "NEW_SPENDING_OR_CONTRACT", "NEW_PROVIDER_OR_ACCOUNT_GRANT",
  "PRODUCTION_DATA_MUTATION", "RELEASE_OR_CUTOVER_AUTHORITY",
  "DESTRUCTIVE_OR_IRREVERSIBLE_ACTION", "LEGAL_PRIVACY_SECURITY_RISK_ACCEPTANCE",
])
const ACTIVE_STATES = SUCCESS_STATES.filter((state) => !TERMINAL_SET.has(state))
const OPERATIONAL_TARGETS = [
  "RETRY_SCHEDULED", "REROUTE_PENDING", "DEFERRED", "BLOCKED_DEPENDENCY",
  "BLOCKED_RESERVATION", "BLOCKED_NO_ELIGIBLE_PROVIDER", "BLOCKED_POLICY_CHANGED",
  "FAILED_VALIDATION_TERMINAL", "FAILED_REVIEW_TERMINAL", "FAILED_SECURITY_TERMINAL",
  "FAILED_OWNER_BABYSITTING", "FAILED_TERMINAL", "QUARANTINED_TERMINAL",
  "OWNER_DECISION_REQUIRED",
]

function transitionMap() {
  const map = new Map(CANONICAL_LIFECYCLE_STATES.map((state) => [state, new Set()]))
  for (let index = 0; index < SUCCESS_STATES.length - 1; index += 1) {
    map.get(SUCCESS_STATES[index]).add(SUCCESS_STATES[index + 1])
  }
  // Review may pass cleanly or request bounded remediation. Remediation is never merge-eligible
  // until it has returned through validation and independent review.
  map.get("INDEPENDENT_REVIEW").add("MERGE_ELIGIBLE")
  map.get("REMEDIATING").delete("MERGE_ELIGIBLE")
  map.get("REMEDIATING").add("VALIDATING")
  map.get("REMEDIATING").add("INDEPENDENT_REVIEW")
  for (const state of ACTIVE_STATES) {
    for (const target of OPERATIONAL_TARGETS) map.get(state).add(target)
  }
  for (const state of ["RETRY_SCHEDULED", "REROUTE_PENDING"]) {
    map.get(state).add("PROVIDER_DISPATCHED")
    map.get(state).add("DEFERRED")
    map.get(state).add("BLOCKED_NO_ELIGIBLE_PROVIDER")
    map.get(state).add("FAILED_TERMINAL")
    map.get(state).add("FAILED_SECURITY_TERMINAL")
  }
  map.get("DEFERRED").add("DEPENDENCY_CLEARED")
  map.get("DEFERRED").add("BLOCKED_NO_ELIGIBLE_PROVIDER")
  map.get("BLOCKED_DEPENDENCY").add("DEPENDENCY_CLEARED")
  map.get("BLOCKED_RESERVATION").add("DEPENDENCY_CLEARED")
  map.get("BLOCKED_NO_ELIGIBLE_PROVIDER").add("DEPENDENCY_CLEARED")
  map.get("BLOCKED_POLICY_CHANGED").add("AUTHORITY_MATCHED")
  map.get("OWNER_DECISION_REQUIRED").add("AUTHORITY_MATCHED")
  return map
}

const TRANSITIONS = transitionMap()

export class LifecycleStateError extends Error {
  constructor(code, field, detail = null) {
    super(`${code}:${field}${detail === null ? "" : `:${detail}`}`)
    this.name = "LifecycleStateError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail = null) {
  throw new LifecycleStateError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("LIFECYCLE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("LIFECYCLE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("LIFECYCLE_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function enumValue(value, allowed, field) {
  if (typeof value !== "string" || !allowed.has(value)) wall("LIFECYCLE_VALUE_WALL", field)
  return value
}

function id(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || !pattern.test(value)) wall("LIFECYCLE_VALUE_WALL", field, "IDENTIFIER_REQUIRED")
  return value
}

function bounded(value, field, maximum = 5) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) wall("LIFECYCLE_BUDGET_WALL", field, `0..${maximum}`)
  return value
}

function providerSet(value, field) {
  if (!Array.isArray(value)) wall("LIFECYCLE_TYPE_WALL", field, "ARRAY_REQUIRED")
  const result = value.map((entry, index) => id(entry, `${field}[${index}]`, PROVIDER_ID)).sort()
  if (new Set(result).size !== result.length) wall("LIFECYCLE_DUPLICATE_WALL", field)
  return result
}

export function isTerminalLifecycleState(state) {
  enumValue(state, STATE_SET, "state")
  return TERMINAL_SET.has(state)
}

export function allowedLifecycleTransitions(state) {
  enumValue(state, STATE_SET, "state")
  return Object.freeze([...TRANSITIONS.get(state)].sort())
}

function normalizeAuthorityGap(value, failureClass) {
  exactFields(value, new Set(["present", "condition", "conditionRef"]), "authorityGap")
  if (typeof value.present !== "boolean") wall("LIFECYCLE_TYPE_WALL", "authorityGap.present", "BOOLEAN_REQUIRED")
  const condition = value.condition === null ? null : enumValue(value.condition, OWNER_CONDITIONS, "authorityGap.condition")
  const conditionRef = value.conditionRef === null ? null : id(value.conditionRef, "authorityGap.conditionRef", PROVIDER_ID)
  const gapComplete = value.present && condition !== null && conditionRef !== null
  if (failureClass === "OWNER_AUTHORITY_GAP" && !gapComplete) {
    wall("LIFECYCLE_OWNER_DECISION_WALL", "authorityGap", "GENUINE_AUTHORITY_GAP_EVIDENCE_REQUIRED")
  }
  if (failureClass !== "OWNER_AUTHORITY_GAP" && (value.present || condition !== null || conditionRef !== null)) {
    wall("LIFECYCLE_OWNER_DECISION_WALL", "authorityGap", "FORBIDDEN_WITHOUT_AUTHORITY_GAP_CLASS")
  }
  if (!value.present && (condition !== null || conditionRef !== null)) {
    wall("LIFECYCLE_OWNER_DECISION_WALL", "authorityGap", "CONTRADICTORY")
  }
  return Object.freeze({ present: value.present, condition, conditionRef })
}

export function transitionLifecycle(input) {
  exactFields(input, new Set(["from", "to", "reasonCode", "failureClass", "authorityGap"]), "transition")
  const from = enumValue(input.from, STATE_SET, "from")
  const to = enumValue(input.to, STATE_SET, "to")
  if (TERMINAL_SET.has(from)) wall("LIFECYCLE_TERMINAL_IMMUTABILITY_WALL", "from", from)
  if (from === to || !TRANSITIONS.get(from).has(to)) wall("LIFECYCLE_ILLEGAL_TRANSITION_WALL", "to", `${from}->${to}`)
  const failureClass = input.failureClass === null ? null : enumValue(input.failureClass, FAILURE_SET, "failureClass")
  const reasonCode = input.reasonCode === null ? null : id(input.reasonCode, "reasonCode")
  const authorityGap = normalizeAuthorityGap(input.authorityGap, failureClass)
  if (to === "OWNER_DECISION_REQUIRED" && failureClass !== "OWNER_AUTHORITY_GAP") {
    wall("LIFECYCLE_OWNER_DECISION_WALL", "failureClass", "GENUINE_AUTHORITY_GAP_REQUIRED")
  }
  if (failureClass === "OWNER_AUTHORITY_GAP" && to !== "OWNER_DECISION_REQUIRED") {
    wall("LIFECYCLE_OWNER_DECISION_WALL", "to", "OWNER_DECISION_REQUIRED_EXPECTED")
  }
  if (failureClass !== null && reasonCode === null) wall("LIFECYCLE_REASON_WALL", "reasonCode", "REQUIRED_FOR_FAILURE")
  return Object.freeze({
    ok: true,
    code: "LIFECYCLE_TRANSITION_ALLOWED",
    from,
    to,
    reasonCode,
    failureClass,
    terminal: TERMINAL_SET.has(to),
    ownerDecisionRequired: to === "OWNER_DECISION_REQUIRED",
    authorityGap,
  })
}

function operationalResult({ failureClass, reasonCode, state, resolution, retry, reroute, defer = false, block = false, security = false, owner = false, compatibleProviders, portfolioProviders }) {
  const healthyProviders = [...new Set([...compatibleProviders, ...portfolioProviders])].sort()
  return Object.freeze({
    ok: true,
    code: "LIFECYCLE_FAILURE_CLASSIFIED",
    failureClass,
    reasonCode,
    state,
    resolution,
    retryScheduled: retry,
    reroutePending: reroute,
    affectedLaneDeferred: defer,
    blocked: block,
    securityTerminal: security,
    ownerDecisionRequired: owner,
    ownerContactAllowed: owner,
    healthyProvidersRemainEligible: healthyProviders.length > 0,
    eligibleProviderIds: Object.freeze(healthyProviders),
    rerouteProviderIds: Object.freeze(compatibleProviders),
    portfolioHealthyProviderIds: Object.freeze(portfolioProviders),
    authorityGranted: false,
  })
}

export function classifyLifecycleFailure(input) {
  exactFields(input, new Set([
    "schemaVersion", "failureClass", "reasonCode", "attemptsUsed", "maxAttempts",
    "reroutesUsed", "maxReroutes", "compatibleHealthyProviders", "portfolioHealthyProviders",
    "authorityGap",
  ]), "failure")
  if (input.schemaVersion !== 1) wall("LIFECYCLE_SCHEMA_WALL", "schemaVersion", "1_REQUIRED")
  const failureClass = enumValue(input.failureClass, FAILURE_SET, "failureClass")
  const reasonCode = id(input.reasonCode, "reasonCode")
  const attemptsUsed = bounded(input.attemptsUsed, "attemptsUsed")
  const maxAttempts = bounded(input.maxAttempts, "maxAttempts")
  const reroutesUsed = bounded(input.reroutesUsed, "reroutesUsed")
  const maxReroutes = bounded(input.maxReroutes, "maxReroutes")
  if (attemptsUsed > maxAttempts) wall("LIFECYCLE_BUDGET_WALL", "attemptsUsed", "EXCEEDS_MAX_ATTEMPTS")
  if (reroutesUsed > maxReroutes) wall("LIFECYCLE_BUDGET_WALL", "reroutesUsed", "EXCEEDS_MAX_REROUTES")
  const compatible = providerSet(input.compatibleHealthyProviders, "compatibleHealthyProviders")
  const portfolio = providerSet(input.portfolioHealthyProviders, "portfolioHealthyProviders")
  normalizeAuthorityGap(input.authorityGap, failureClass)

  const result = (settings) => operationalResult({
    failureClass,
    reasonCode,
    compatibleProviders: compatible,
    portfolioProviders: portfolio,
    retry: false,
    reroute: false,
    ...settings,
  })
  const canRetry = attemptsUsed < maxAttempts
  const canReroute = compatible.length > 0 && reroutesUsed < maxReroutes
  const deferOrBlock = () => portfolio.length > 0
    ? result({ state: "DEFERRED", resolution: "DEFER_AFFECTED_LANE_CONTINUE_HEALTHY_PROVIDERS", defer: true })
    : result({ state: "BLOCKED_NO_ELIGIBLE_PROVIDER", resolution: "BLOCK_AFFECTED_LANE", block: true })

  if (failureClass === "OWNER_AUTHORITY_GAP") {
    return result({ state: "OWNER_DECISION_REQUIRED", resolution: "PRESENT_GENUINE_AUTHORITY_DECISION", owner: true })
  }
  if (failureClass === "SECURITY_BOUNDARY") {
    return result({ state: "FAILED_SECURITY_TERMINAL", resolution: "QUARANTINE_AND_PRESERVE_SANITIZED_EVIDENCE", security: true })
  }
  if (failureClass === "POLICY_CHANGED") {
    return result({ state: "BLOCKED_POLICY_CHANGED", resolution: "STOP_WITHOUT_POLICY_BYPASS", block: true })
  }
  if (failureClass === "DEPENDENCY_INCOMPLETE") {
    return result({ state: "BLOCKED_DEPENDENCY", resolution: "WAIT_FOR_DECLARED_DEPENDENCY", block: true })
  }
  if (failureClass === "RESERVATION_COLLISION") {
    return result({ state: "BLOCKED_RESERVATION", resolution: "REPLAN_BEFORE_WRITE", block: true })
  }
  if (failureClass === "DUPLICATE_DELIVERY") {
    return result({ state: "DEFERRED", resolution: "IDEMPOTENT_NOOP", defer: true })
  }
  if (failureClass === "DETERMINISTIC_VALIDATION" || failureClass === "REVIEW_CHANGES") {
    if (canRetry) return result({ state: "REMEDIATING", resolution: "RETURN_TO_ORIGINAL_BUILDER", retry: true })
    return result({
      state: failureClass === "REVIEW_CHANGES" ? "FAILED_REVIEW_TERMINAL" : "FAILED_VALIDATION_TERMINAL",
      resolution: "BOUNDED_REMEDIATION_EXHAUSTED",
    })
  }
  if (failureClass === "FLAKY_CI" || failureClass === "STALE_BASE") {
    if (canRetry) return result({ state: "RETRY_SCHEDULED", resolution: "BOUNDED_RETRY", retry: true })
    return result({ state: "FAILED_TERMINAL", resolution: "BOUNDED_OPERATIONAL_RECOVERY_EXHAUSTED" })
  }
  if (failureClass === "WORKER_DEATH" || failureClass === "COORDINATOR_DEATH") {
    if (canRetry) return result({ state: "RETRY_SCHEDULED", resolution: "BOUNDED_RETRY", retry: true })
    if (canReroute) return result({ state: "REROUTE_PENDING", resolution: "REROUTE_COMPATIBLE_PROVIDER", reroute: true })
    return deferOrBlock()
  }
  if (failureClass === "PROVIDER_AUTHENTICATION") {
    if (canReroute) return result({ state: "REROUTE_PENDING", resolution: "QUARANTINE_PROVIDER_AND_REROUTE", reroute: true })
    return deferOrBlock()
  }
  if (failureClass === "PROVIDER_UNAVAILABLE") {
    if (canReroute) return result({ state: "REROUTE_PENDING", resolution: "REROUTE_COMPATIBLE_PROVIDER", reroute: true })
    return deferOrBlock()
  }
  if (canRetry) return result({ state: "RETRY_SCHEDULED", resolution: "BOUNDED_RETRY", retry: true })
  if (canReroute) return result({ state: "REROUTE_PENDING", resolution: "REROUTE_COMPATIBLE_PROVIDER", reroute: true })
  return deferOrBlock()
}
