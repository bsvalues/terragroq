export const HERMES_STATUS_SCHEMA = "hermes-console-status/1"
export const HERMES_APPLIANCE_VERSION = "HERMES_APPLIANCE_V1"

export const HERMES_DOMAIN_NAMES = [
  "appliance",
  "inference",
  "protection",
  "storage",
  "security",
  "doctrine",
  "workbench",
] as const

export type HermesDomainName = (typeof HERMES_DOMAIN_NAMES)[number]
export type HermesEvidenceState = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN"
export type HermesOwnerState = "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN"

export type HermesFact = Readonly<{ label: string; value: string }>
export type HermesDomain = Readonly<{
  state: HermesEvidenceState
  headline: string
  facts: readonly HermesFact[]
}>
export type HermesOwnerAction = Readonly<{ id: string; title: string; reason: string }>
export type HermesAlert = Readonly<{ observedAt: string; severity: "WARN" | "FAIL"; message: string }>

export type HermesStatus = Readonly<{
  schema: typeof HERMES_STATUS_SCHEMA
  applianceVersion: typeof HERMES_APPLIANCE_VERSION
  observedAt: string
  overallState: HermesEvidenceState
  alerts: readonly HermesAlert[]
  ownerActions: readonly HermesOwnerAction[]
  activeWork: Readonly<{ state: string; headline: string }>
  domains: Readonly<Record<HermesDomainName, HermesDomain>>
}>

export type ValidatedHermesStatus = HermesStatus & Readonly<{
  ownerState: HermesOwnerState
  freshness: Readonly<{
    state: "FRESH" | "STALE"
    ageSeconds: number
    maxAgeSeconds: number
  }>
}>

const DOMAIN_STATES = new Set<HermesEvidenceState>(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"])

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code)
  return value as Record<string, unknown>
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code)
  return value.trim()
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  if (Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) throw new Error(code)
}

function validateDomain(value: unknown, name: HermesDomainName): HermesDomain {
  const domain = record(value, `HERMES_STATUS_${name.toUpperCase()}_INVALID`)
  exactKeys(domain, ["state", "headline", "facts"], `HERMES_STATUS_${name.toUpperCase()}_SHAPE_INVALID`)
  if (!DOMAIN_STATES.has(domain.state as HermesEvidenceState)) {
    throw new Error(`HERMES_STATUS_${name.toUpperCase()}_STATE_INVALID`)
  }
  if (!Array.isArray(domain.facts)) throw new Error(`HERMES_STATUS_${name.toUpperCase()}_FACTS_INVALID`)
  const facts = domain.facts.map((raw) => {
    const fact = record(raw, `HERMES_STATUS_${name.toUpperCase()}_FACT_INVALID`)
    exactKeys(fact, ["label", "value"], `HERMES_STATUS_${name.toUpperCase()}_FACT_SHAPE_INVALID`)
    return {
      label: text(fact.label, `HERMES_STATUS_${name.toUpperCase()}_FACT_LABEL_INVALID`),
      value: text(fact.value, `HERMES_STATUS_${name.toUpperCase()}_FACT_VALUE_INVALID`),
    }
  })
  return {
    state: domain.state as HermesEvidenceState,
    headline: text(domain.headline, `HERMES_STATUS_${name.toUpperCase()}_HEADLINE_INVALID`),
    facts,
  }
}

export function ownerHermesState(state: HermesEvidenceState): HermesOwnerState {
  return state === "CRITICAL" ? "FAILED" : state
}

export function validateHermesStatus(
  value: unknown,
  { now = new Date(), maxAgeSeconds = 300 }: { now?: Date; maxAgeSeconds?: number } = {},
): ValidatedHermesStatus {
  const status = record(value, "HERMES_STATUS_INVALID")
  exactKeys(
    status,
    ["schema", "applianceVersion", "observedAt", "overallState", "alerts", "ownerActions", "activeWork", "domains"],
    "HERMES_STATUS_SHAPE_INVALID",
  )
  if (status.schema !== HERMES_STATUS_SCHEMA) throw new Error("HERMES_STATUS_SCHEMA_INVALID")
  if (status.applianceVersion !== HERMES_APPLIANCE_VERSION) throw new Error("HERMES_STATUS_VERSION_INVALID")
  if (!DOMAIN_STATES.has(status.overallState as HermesEvidenceState)) throw new Error("HERMES_STATUS_OVERALL_STATE_INVALID")
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) throw new Error("HERMES_STATUS_AGE_BOUND_INVALID")

  const observedAt = text(status.observedAt, "HERMES_STATUS_OBSERVED_AT_INVALID")
  const observedAtMs = Date.parse(observedAt)
  if (!Number.isFinite(observedAtMs)) throw new Error("HERMES_STATUS_OBSERVED_AT_INVALID")
  const ageSeconds = (now.getTime() - observedAtMs) / 1000
  if (ageSeconds < -60) throw new Error("HERMES_STATUS_CLOCK_INVALID")

  const rawDomains = record(status.domains, "HERMES_STATUS_DOMAINS_INVALID")
  exactKeys(rawDomains, HERMES_DOMAIN_NAMES, "HERMES_STATUS_DOMAIN_SET_INVALID")
  const domains = Object.fromEntries(
    HERMES_DOMAIN_NAMES.map((name) => [name, validateDomain(rawDomains[name], name)]),
  ) as Record<HermesDomainName, HermesDomain>

  if (!Array.isArray(status.ownerActions)) throw new Error("HERMES_STATUS_OWNER_ACTIONS_INVALID")
  const ownerActions = status.ownerActions.map((raw) => {
    const action = record(raw, "HERMES_STATUS_OWNER_ACTION_INVALID")
    exactKeys(action, ["id", "title", "reason"], "HERMES_STATUS_OWNER_ACTION_SHAPE_INVALID")
    return {
      id: text(action.id, "HERMES_STATUS_OWNER_ACTION_ID_INVALID"),
      title: text(action.title, "HERMES_STATUS_OWNER_ACTION_TITLE_INVALID"),
      reason: text(action.reason, "HERMES_STATUS_OWNER_ACTION_REASON_INVALID"),
    }
  })

  if (!Array.isArray(status.alerts)) throw new Error("HERMES_STATUS_ALERTS_INVALID")
  const alerts = status.alerts.map((raw) => {
    const alert = record(raw, "HERMES_STATUS_ALERT_INVALID")
    exactKeys(alert, ["observedAt", "severity", "message"], "HERMES_STATUS_ALERT_SHAPE_INVALID")
    if (alert.severity !== "WARN" && alert.severity !== "FAIL") throw new Error("HERMES_STATUS_ALERT_SEVERITY_INVALID")
    return {
      observedAt: text(alert.observedAt, "HERMES_STATUS_ALERT_OBSERVED_AT_INVALID"),
      severity: alert.severity,
      message: text(alert.message, "HERMES_STATUS_ALERT_MESSAGE_INVALID"),
    } satisfies HermesAlert
  })

  const activeWork = record(status.activeWork, "HERMES_STATUS_ACTIVE_WORK_INVALID")
  exactKeys(activeWork, ["state", "headline"], "HERMES_STATUS_ACTIVE_WORK_SHAPE_INVALID")

  const domainStates = HERMES_DOMAIN_NAMES.map((name) => domains[name].state)
  const derivedOverall: HermesEvidenceState = domainStates.includes("CRITICAL")
    ? "CRITICAL"
    : domainStates.some((state) => state === "DEGRADED" || state === "UNKNOWN")
      ? "DEGRADED"
      : "HEALTHY"
  if (status.overallState !== derivedOverall) throw new Error("HERMES_STATUS_OVERALL_STATE_FALSE")

  const freshness = {
    state: ageSeconds <= maxAgeSeconds ? "FRESH" as const : "STALE" as const,
    ageSeconds: Math.max(0, Math.round(ageSeconds)),
    maxAgeSeconds,
  }
  return {
    schema: HERMES_STATUS_SCHEMA,
    applianceVersion: HERMES_APPLIANCE_VERSION,
    observedAt,
    overallState: derivedOverall,
    ownerState: freshness.state === "FRESH" ? ownerHermesState(derivedOverall) : "UNKNOWN",
    freshness,
    alerts,
    ownerActions,
    activeWork: {
      state: text(activeWork.state, "HERMES_STATUS_ACTIVE_WORK_STATE_INVALID"),
      headline: text(activeWork.headline, "HERMES_STATUS_ACTIVE_WORK_HEADLINE_INVALID"),
    },
    domains,
  }
}

export function unavailableHermesStatus(reason = "Current HERMES evidence is unavailable."): ValidatedHermesStatus {
  const domain = (headline: string): HermesDomain => ({ state: "UNKNOWN", headline, facts: [] })
  return {
    schema: HERMES_STATUS_SCHEMA,
    applianceVersion: HERMES_APPLIANCE_VERSION,
    observedAt: new Date(0).toISOString(),
    overallState: "DEGRADED",
    ownerState: "UNKNOWN",
    freshness: { state: "STALE", ageSeconds: 301, maxAgeSeconds: 300 },
    alerts: [],
    ownerActions: [],
    activeWork: { state: "WAITING_FOR_EVIDENCE", headline: reason },
    domains: {
      appliance: domain("Native HERMES health unavailable"),
      inference: domain("Local AI evidence unavailable"),
      protection: domain("Recovery evidence unavailable"),
      storage: domain("Storage evidence unavailable"),
      security: domain("Security evidence unavailable"),
      doctrine: domain("Doctrine evidence unavailable"),
      workbench: domain("Workbench evidence unavailable"),
    },
  }
}
