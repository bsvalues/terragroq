import crypto from "node:crypto"

const INPUT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "workOrderId",
  "providers",
  "observations",
  "rerouteRequests",
  "budgets",
])
const PROVIDER_FIELDS = new Set([
  "providerId",
  "status",
  "roles",
  "repositories",
  "secretIsolation",
  "workspaceIsolation",
  "rawCredentialAccess",
])
const OBSERVATION_FIELDS = new Set([
  "observationId",
  "providerId",
  "kind",
  "httpStatus",
  "reasonCode",
  "observedAt",
  "retryAfterMs",
  "deterministic",
])
const REROUTE_REQUEST_FIELDS = new Set([
  "requestId",
  "workOrderId",
  "repository",
  "requiredRoles",
  "fromProviderId",
  "fallbackProviders",
])
const BUDGET_FIELDS = new Set(["maxRetryDelayMs", "maxReroutesPerWorkOrder"])
const PROVIDER_STATUS = new Set(["ACTIVE", "UNAVAILABLE", "DISABLED", "QUARANTINED", "BACKOFF"])
const OBSERVATION_KIND = new Set(["HTTP", "NETWORK", "MALFORMED_OUTPUT", "TIMEOUT", "DETERMINISTIC_FAILURE"])
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/

export class ProviderHealthRerouteError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "ProviderHealthRerouteError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new ProviderHealthRerouteError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("PROVIDER_HEALTH_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("PROVIDER_HEALTH_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("PROVIDER_HEALTH_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function safeIdentifier(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || !pattern.test(value)) {
    wall("PROVIDER_HEALTH_FORMAT_WALL", field, "SAFE_IDENTIFIER_REQUIRED")
  }
  return value
}

function stringSet(value, field, pattern = IDENTIFIER, nonempty = true) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) {
    wall("PROVIDER_HEALTH_TYPE_WALL", field, "ARRAY_REQUIRED")
  }
  const output = value.map((entry, index) => safeIdentifier(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(output).size !== output.length) wall("PROVIDER_HEALTH_DUPLICATE_WALL", field)
  return output
}

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    wall("PROVIDER_HEALTH_VALUE_WALL", field, `INTEGER_${minimum}_OR_GREATER_REQUIRED`)
  }
  return value
}

function instant(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    wall("PROVIDER_HEALTH_TIME_WALL", field, "CANONICAL_INSTANT_REQUIRED")
  }
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")
}

function normalizeProviders(value) {
  if (!Array.isArray(value) || value.length === 0) wall("PROVIDER_HEALTH_TYPE_WALL", "providers", "NON_EMPTY_ARRAY_REQUIRED")
  const providers = value.map((raw, index) => {
    exactFields(raw, PROVIDER_FIELDS, `providers[${index}]`)
    if (!PROVIDER_STATUS.has(raw.status)) wall("PROVIDER_HEALTH_STATUS_WALL", `providers[${index}].status`, "KNOWN_STATUS_REQUIRED")
    for (const field of ["secretIsolation", "workspaceIsolation"]) {
      if (raw[field] !== true) wall("PROVIDER_HEALTH_ISOLATION_WALL", `providers[${index}].${field}`, "TRUE_REQUIRED")
    }
    if (raw.rawCredentialAccess !== false) wall("PROVIDER_HEALTH_SECRET_WALL", `providers[${index}].rawCredentialAccess`, "FALSE_REQUIRED")
    return {
      providerId: safeIdentifier(raw.providerId, `providers[${index}].providerId`),
      status: raw.status,
      roles: stringSet(raw.roles, `providers[${index}].roles`, IDENTIFIER, raw.status === "ACTIVE"),
      repositories: stringSet(raw.repositories, `providers[${index}].repositories`, REPOSITORY),
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
    }
  }).sort((left, right) => left.providerId.localeCompare(right.providerId))
  if (new Set(providers.map(({ providerId }) => providerId)).size !== providers.length) {
    wall("PROVIDER_HEALTH_DUPLICATE_WALL", "providers")
  }
  return providers
}

function normalizeObservations(value) {
  if (!Array.isArray(value)) wall("PROVIDER_HEALTH_TYPE_WALL", "observations", "ARRAY_REQUIRED")
  const observations = value.map((raw, index) => {
    exactFields(raw, OBSERVATION_FIELDS, `observations[${index}]`)
    if (!OBSERVATION_KIND.has(raw.kind)) wall("PROVIDER_HEALTH_OBSERVATION_WALL", `observations[${index}].kind`, "KNOWN_KIND_REQUIRED")
    if (raw.httpStatus !== null) integer(raw.httpStatus, `observations[${index}].httpStatus`, 100)
    if (raw.retryAfterMs !== null) integer(raw.retryAfterMs, `observations[${index}].retryAfterMs`, 0)
    if (typeof raw.deterministic !== "boolean") wall("PROVIDER_HEALTH_TYPE_WALL", `observations[${index}].deterministic`, "BOOLEAN_REQUIRED")
    return {
      observationId: safeIdentifier(raw.observationId, `observations[${index}].observationId`),
      providerId: safeIdentifier(raw.providerId, `observations[${index}].providerId`),
      kind: raw.kind,
      httpStatus: raw.httpStatus,
      reasonCode: safeIdentifier(raw.reasonCode, `observations[${index}].reasonCode`),
      observedAt: instant(raw.observedAt, `observations[${index}].observedAt`),
      retryAfterMs: raw.retryAfterMs,
      deterministic: raw.deterministic,
    }
  }).sort((left, right) => left.observationId.localeCompare(right.observationId))
  if (new Set(observations.map(({ observationId }) => observationId)).size !== observations.length) {
    wall("PROVIDER_HEALTH_DUPLICATE_WALL", "observations")
  }
  return observations
}

function normalizeRerouteRequests(value) {
  if (!Array.isArray(value)) wall("PROVIDER_HEALTH_TYPE_WALL", "rerouteRequests", "ARRAY_REQUIRED")
  const requests = value.map((raw, index) => {
    exactFields(raw, REROUTE_REQUEST_FIELDS, `rerouteRequests[${index}]`)
    return {
      requestId: safeIdentifier(raw.requestId, `rerouteRequests[${index}].requestId`),
      workOrderId: safeIdentifier(raw.workOrderId, `rerouteRequests[${index}].workOrderId`),
      repository: safeIdentifier(raw.repository, `rerouteRequests[${index}].repository`, REPOSITORY),
      requiredRoles: stringSet(raw.requiredRoles, `rerouteRequests[${index}].requiredRoles`),
      fromProviderId: safeIdentifier(raw.fromProviderId, `rerouteRequests[${index}].fromProviderId`),
      fallbackProviders: stringSet(raw.fallbackProviders, `rerouteRequests[${index}].fallbackProviders`),
    }
  }).sort((left, right) => left.requestId.localeCompare(right.requestId))
  if (new Set(requests.map(({ requestId }) => requestId)).size !== requests.length) {
    wall("PROVIDER_HEALTH_DUPLICATE_WALL", "rerouteRequests")
  }
  return requests
}

function normalizeBudgets(value) {
  exactFields(value, BUDGET_FIELDS, "budgets")
  return {
    maxRetryDelayMs: integer(value.maxRetryDelayMs, "budgets.maxRetryDelayMs", 0),
    maxReroutesPerWorkOrder: integer(value.maxReroutesPerWorkOrder, "budgets.maxReroutesPerWorkOrder", 0),
  }
}

function classifyObservation(observation, budgets) {
  if (observation.kind === "HTTP" && [401, 403].includes(observation.httpStatus)) {
    return { state: "QUARANTINED", reasonCode: "AUTHORIZATION_WALL", retryAfterMs: null, rerouteAllowed: true }
  }
  if (observation.kind === "HTTP" && observation.httpStatus === 429) {
    return {
      state: "BACKOFF",
      reasonCode: "RATE_LIMITED",
      retryAfterMs: Math.min(observation.retryAfterMs ?? budgets.maxRetryDelayMs, budgets.maxRetryDelayMs),
      rerouteAllowed: true,
    }
  }
  if (observation.kind === "HTTP" && observation.httpStatus >= 500) {
    return { state: "BACKOFF", reasonCode: "PROVIDER_5XX", retryAfterMs: budgets.maxRetryDelayMs, rerouteAllowed: true }
  }
  if (observation.kind === "NETWORK") {
    return { state: "BACKOFF", reasonCode: "NETWORK_WALL", retryAfterMs: budgets.maxRetryDelayMs, rerouteAllowed: true }
  }
  if (observation.kind === "TIMEOUT") {
    return { state: "BACKOFF", reasonCode: "TIMEOUT", retryAfterMs: budgets.maxRetryDelayMs, rerouteAllowed: true }
  }
  if (observation.kind === "MALFORMED_OUTPUT") {
    return { state: "QUARANTINED", reasonCode: "MALFORMED_OUTPUT", retryAfterMs: null, rerouteAllowed: true }
  }
  if (observation.kind === "DETERMINISTIC_FAILURE" || observation.deterministic) {
    return { state: "QUARANTINED", reasonCode: "DETERMINISTIC_FAILURE", retryAfterMs: null, rerouteAllowed: false }
  }
  return { state: "ACTIVE", reasonCode: "HEALTHY", retryAfterMs: null, rerouteAllowed: false }
}

function providerSupports(provider, request) {
  return provider.status === "ACTIVE"
    && provider.repositories.includes(request.repository)
    && request.requiredRoles.every((role) => provider.roles.includes(role))
}

export function evaluateProviderHealthReroute(input) {
  wall(
    "PROVIDER_HEALTH_REROUTE_INVALIDATED_PENDING_REPROOF",
    "providerHealth",
    "WO_MAO_031_THEN_WO_MAO_034_THEN_WO_MAO_035_REPROOF_REQUIRED",
  )
  exactFields(input, INPUT_FIELDS, "providerHealth")
  if (input.schemaVersion !== 1) wall("PROVIDER_HEALTH_INPUT_WALL", "schemaVersion", "1_REQUIRED")
  if (input.artifactType !== "PROVIDER_HEALTH_REROUTE_INPUT") {
    wall("PROVIDER_HEALTH_INPUT_WALL", "artifactType", "PROVIDER_HEALTH_REROUTE_INPUT_REQUIRED")
  }
  if (input.workOrderId !== "WO-MAO-035") wall("PROVIDER_HEALTH_INPUT_WALL", "workOrderId", "WO-MAO-035_REQUIRED")
  const providers = normalizeProviders(input.providers)
  const observations = normalizeObservations(input.observations)
  const rerouteRequests = normalizeRerouteRequests(input.rerouteRequests)
  const budgets = normalizeBudgets(input.budgets)
  const providerById = new Map(providers.map((provider) => [provider.providerId, provider]))
  for (const observation of observations) {
    if (!providerById.has(observation.providerId)) wall("PROVIDER_HEALTH_OBSERVATION_WALL", observation.observationId, "KNOWN_PROVIDER_REQUIRED")
  }

  const observationsByProvider = new Map()
  for (const observation of observations) {
    const entries = observationsByProvider.get(observation.providerId) ?? []
    entries.push(observation)
    observationsByProvider.set(observation.providerId, entries)
  }
  const health = providers.map((provider) => {
    const providerObservations = observationsByProvider.get(provider.providerId) ?? []
    const classified = provider.status === "UNAVAILABLE"
      ? { state: "UNAVAILABLE", reasonCode: "PROVIDER_UNAVAILABLE", retryAfterMs: null, rerouteAllowed: false }
      : provider.status === "DISABLED"
        ? { state: "DISABLED", reasonCode: "PROVIDER_DISABLED", retryAfterMs: null, rerouteAllowed: false }
        : providerObservations.length === 0
          ? { state: provider.status, reasonCode: provider.status === "ACTIVE" ? "HEALTHY" : provider.status, retryAfterMs: null, rerouteAllowed: false }
          : providerObservations.map((observation) => classifyObservation(observation, budgets))
            .sort((left, right) => ["QUARANTINED", "BACKOFF", "ACTIVE"].indexOf(left.state) - ["QUARANTINED", "BACKOFF", "ACTIVE"].indexOf(right.state))[0]
    return {
      providerId: provider.providerId,
      state: classified.state,
      reasonCode: classified.reasonCode,
      retryAfterMs: classified.retryAfterMs,
      rerouteAllowed: classified.rerouteAllowed,
      observationIds: providerObservations.map(({ observationId }) => observationId).sort(),
    }
  })

  const healthByProvider = new Map(health.map((entry) => [entry.providerId, entry]))
  const reroutes = rerouteRequests.map((request) => {
    if (!providerById.has(request.fromProviderId)) wall("PROVIDER_HEALTH_REROUTE_WALL", request.requestId, "FROM_PROVIDER_REQUIRED")
    const selectedFallbacks = request.fallbackProviders
      .map((providerId) => providerById.get(providerId))
      .filter((provider) => provider && providerSupports(provider, request) && healthByProvider.get(provider.providerId)?.state === "ACTIVE")
      .map(({ providerId }) => providerId)
      .slice(0, budgets.maxReroutesPerWorkOrder)
    const fromHealth = healthByProvider.get(request.fromProviderId)
    const reroutePermitted = fromHealth?.rerouteAllowed === true && selectedFallbacks.length > 0
    return {
      requestId: request.requestId,
      workOrderId: request.workOrderId,
      fromProviderId: request.fromProviderId,
      selectedFallbackProviders: selectedFallbacks,
      permitted: reroutePermitted,
      reasonCode: reroutePermitted
        ? "REROUTE_PERMITTED"
        : fromHealth?.rerouteAllowed !== true
          ? fromHealth?.reasonCode ?? "PROVIDER_NOT_REROUTABLE"
          : "NO_HEALTHY_FALLBACK_PROVIDER",
    }
  })

  const output = {
    schemaVersion: 1,
    artifactType: "PROVIDER_HEALTH_REROUTE_RESULT",
    workOrderId: "WO-MAO-035",
    status: "PROVIDER_HEALTH_REROUTE_PROVEN",
    health,
    reroutes,
    circuitBreakers: health
      .filter(({ state }) => ["BACKOFF", "QUARANTINED"].includes(state))
      .map(({ providerId, state, reasonCode, retryAfterMs }) => ({ providerId, state, reasonCode, retryAfterMs })),
    deferredProviders: health
      .filter(({ state }) => state === "UNAVAILABLE")
      .map(({ providerId, reasonCode }) => ({ providerId, reasonCode })),
    dispatchPerformed: false,
    providerCallPerformed: false,
    durablePersistenceClaimed: false,
    serviceWorkerClaimed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}

export function canonicalProviderHealthRerouteJson(value) {
  return JSON.stringify(canonicalize(value))
}
