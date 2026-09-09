export const STATUS_SCHEMA = "hermes-console-status/1"
export const DOMAIN_NAMES = Object.freeze([
  "appliance",
  "inference",
  "protection",
  "storage",
  "security",
  "doctrine",
  "workbench",
])

const STATES = new Set(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"])

function asString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label}_INVALID`)
  return value.trim()
}

function validateDomain(domain, name) {
  if (!domain || typeof domain !== "object" || Array.isArray(domain)) {
    throw new Error(`HERMES_STATUS_${name.toUpperCase()}_INVALID`)
  }
  if (!STATES.has(domain.state)) throw new Error(`HERMES_STATUS_${name.toUpperCase()}_STATE_INVALID`)
  asString(domain.headline, `HERMES_STATUS_${name.toUpperCase()}_HEADLINE`)
  if (!Array.isArray(domain.facts)) throw new Error(`HERMES_STATUS_${name.toUpperCase()}_FACTS_INVALID`)
  for (const fact of domain.facts) {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
      throw new Error(`HERMES_STATUS_${name.toUpperCase()}_FACT_INVALID`)
    }
    asString(fact.label, `HERMES_STATUS_${name.toUpperCase()}_FACT_LABEL`)
    asString(fact.value, `HERMES_STATUS_${name.toUpperCase()}_FACT_VALUE`)
  }
}

export function validateHermesStatus(status, { now = new Date(), maxAgeSeconds = 300 } = {}) {
  if (!status || typeof status !== "object" || Array.isArray(status)) throw new Error("HERMES_STATUS_INVALID")
  if (status.schema !== STATUS_SCHEMA) throw new Error("HERMES_STATUS_SCHEMA_INVALID")
  if (status.applianceVersion !== "HERMES_APPLIANCE_V1") throw new Error("HERMES_STATUS_VERSION_INVALID")
  const observedAtMs = Date.parse(status.observedAt)
  if (!Number.isFinite(observedAtMs)) throw new Error("HERMES_STATUS_OBSERVED_AT_INVALID")
  const ageSeconds = (now.getTime() - observedAtMs) / 1000
  if (ageSeconds < -60) throw new Error("HERMES_STATUS_CLOCK_INVALID")
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) throw new Error("HERMES_STATUS_AGE_BOUND_INVALID")
  if (!status.domains || Object.keys(status.domains).sort().join("|") !== [...DOMAIN_NAMES].sort().join("|")) {
    throw new Error("HERMES_STATUS_DOMAIN_SET_INVALID")
  }
  for (const name of DOMAIN_NAMES) validateDomain(status.domains[name], name)
  if (!Array.isArray(status.ownerActions)) throw new Error("HERMES_STATUS_OWNER_ACTIONS_INVALID")
  for (const action of status.ownerActions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("HERMES_STATUS_OWNER_ACTION_INVALID")
    asString(action.id, "HERMES_STATUS_OWNER_ACTION_ID")
    asString(action.title, "HERMES_STATUS_OWNER_ACTION_TITLE")
    asString(action.reason, "HERMES_STATUS_OWNER_ACTION_REASON")
  }
  if (!Array.isArray(status.alerts)) throw new Error("HERMES_STATUS_ALERTS_INVALID")
  for (const alert of status.alerts) {
    if (!alert || typeof alert !== "object" || Array.isArray(alert)) throw new Error("HERMES_STATUS_ALERT_INVALID")
    asString(alert.observedAt, "HERMES_STATUS_ALERT_OBSERVED_AT")
    if (!new Set(["WARN", "FAIL", "RECOVERY"]).has(alert.severity)) throw new Error("HERMES_STATUS_ALERT_SEVERITY_INVALID")
    asString(alert.message, "HERMES_STATUS_ALERT_MESSAGE")
  }
  if (!status.activeWork || typeof status.activeWork !== "object") throw new Error("HERMES_STATUS_ACTIVE_WORK_INVALID")
  asString(status.activeWork.state, "HERMES_STATUS_ACTIVE_WORK_STATE")
  asString(status.activeWork.headline, "HERMES_STATUS_ACTIVE_WORK_HEADLINE")

  const domainStates = DOMAIN_NAMES.map((name) => status.domains[name].state)
  const derivedState = domainStates.includes("CRITICAL")
    ? "CRITICAL"
    : domainStates.some((state) => state === "DEGRADED" || state === "UNKNOWN")
      ? "DEGRADED"
      : "HEALTHY"
  if (status.overallState !== derivedState) throw new Error("HERMES_STATUS_OVERALL_STATE_FALSE")

  return {
    ...status,
    authorityState: status.authorityState === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
    freshness: {
      state: ageSeconds <= maxAgeSeconds ? "FRESH" : "STALE",
      ageSeconds: Math.max(0, Math.round(ageSeconds)),
      maxAgeSeconds,
    },
  }
}

export function unavailableHermesStatus(reason = "No current appliance observation is available.") {
  const domain = (headline) => ({ state: "UNKNOWN", headline, facts: [] })
  return {
    schema: STATUS_SCHEMA,
    applianceVersion: "HERMES_APPLIANCE_V1",
    observedAt: new Date(0).toISOString(),
    overallState: "DEGRADED",
    alerts: [],
    ownerActions: [],
    activeWork: { state: "WAITING_FOR_EVIDENCE", headline: reason },
    domains: {
      appliance: domain("Native HERMES health unavailable"),
      inference: domain("Inference evidence unavailable"),
      protection: domain("Recovery evidence unavailable"),
      storage: domain("Storage evidence unavailable"),
      security: domain("Security evidence unavailable"),
      doctrine: domain("Doctrine evidence unavailable"),
      workbench: domain("Workbench evidence unavailable"),
    },
    freshness: { state: "STALE", ageSeconds: null, maxAgeSeconds: 300 },
  }
}
