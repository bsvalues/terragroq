import crypto from "node:crypto"

import { DispatchEnvelopeError, validateDispatchEnvelope } from "./dispatch-envelope.mjs"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const HASH = /^[a-f0-9]{64}$/
const CAPABILITY_FIELDS = new Set([
  "schemaVersion", "artifactType", "providerId", "adapterId", "availability",
  "riskClasses", "requirements", "actions", "roles", "repositories", "maxConcurrency",
  "supportsCancellation", "supportsArtifacts", "supportsSanitizedEvidence",
  "serviceCompatible", "authorityMintingAllowed",
])
const AVAILABILITY = new Set(["AVAILABLE", "UNAVAILABLE", "QUARANTINED"])
const PROVIDER_STATES = new Set(["ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"])
const RESPONSE_TYPES = new Set([
  "PROVIDER_STATUS", "PROVIDER_CANCELLATION", "PROVIDER_ARTIFACT", "PROVIDER_EVIDENCE",
])
const COMMON_RESPONSE_FIELDS = new Set([
  "schemaVersion", "artifactType", "providerId", "adapterId", "dispatchId", "workOrderId",
  "laneId", "providerState", "reasonCode", "sanitized", "authorityGranted",
])
const RESPONSE_FIELDS = Object.freeze({
  PROVIDER_STATUS: new Set([...COMMON_RESPONSE_FIELDS, "progressMarker"]),
  PROVIDER_CANCELLATION: new Set([...COMMON_RESPONSE_FIELDS, "cancelAcknowledged"]),
  PROVIDER_ARTIFACT: new Set([...COMMON_RESPONSE_FIELDS, "artifactId", "artifactKind", "contentHash", "relativePath"]),
  PROVIDER_EVIDENCE: new Set([...COMMON_RESPONSE_FIELDS, "eventId", "evidenceType", "contentHash", "summary", "attributes", "rawProviderOutputIncluded"]),
})
const SENSITIVE_KEY_ALIASES = Object.freeze([
  "authorization", "authheader", "credential", "credentials", "cookie", "cookies",
  "apikey", "accesskey", "privatekey", "clientsecret", "clienttoken", "password",
  "passwd", "pwd", "passphrase", "secret", "secrets", "session", "sessionid", "token",
  "accesstoken", "refreshtoken", "idtoken", "otp", "rawoutput", "rawprovideroutput",
])
const SENSITIVE_ASSIGNMENT = /\b(?:api[\s_-]*key|access[\s_-]*key|private[\s_-]*key|client[\s_-]*secret|authorization|credential|cookie|password|passwd|pwd|passphrase|secret|session(?:[\s_-]*id)?|token|otp)\s*[:=]\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s"',;]+)/i
const SENSITIVE_VALUE = new RegExp([
  "(?:bearer|basic)\\s+[a-z0-9._~+\\/-]+=*",
  "-----BEGIN [A-Z ]+PRIVATE KEY-----",
  "\\b(?:gh[opsu]|github_pat)_[A-Za-z0-9_]{12,}",
  "\\bsk-[A-Za-z0-9_-]{12,}",
  "\\bAKIA[A-Z0-9]{12,}",
  "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
].join("|"), "i")
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u

export class ProviderContractError extends Error {
  constructor(code, field, detail = null) {
    super(`${code}:${field}${detail === null ? "" : `:${detail}`}`)
    this.name = "ProviderContractError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail = null) {
  throw new ProviderContractError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("PROVIDER_CONTRACT_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("PROVIDER_CONTRACT_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("PROVIDER_CONTRACT_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function text(value, field, pattern = undefined) {
  if (typeof value !== "string" || value === "" || value.trim() !== value || CONTROL.test(value)) {
    wall("PROVIDER_CONTRACT_VALUE_WALL", field, "SAFE_NON_EMPTY_STRING_REQUIRED")
  }
  if (pattern && !pattern.test(value)) wall("PROVIDER_CONTRACT_VALUE_WALL", field, "FORMAT")
  return value
}

function stringSet(value, field, { nonEmpty = false, pattern = IDENTIFIER } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    wall("PROVIDER_CONTRACT_TYPE_WALL", field, nonEmpty ? "NON_EMPTY_ARRAY_REQUIRED" : "ARRAY_REQUIRED")
  }
  const result = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(result).size !== result.length) wall("PROVIDER_CONTRACT_DUPLICATE_WALL", field)
  return result
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

function sensitiveKey(value) {
  const canonicalKey = value.toLowerCase().replace(/[^a-z0-9]/g, "")
  return SENSITIVE_KEY_ALIASES.some((alias) => canonicalKey.includes(alias))
}

function residualSecret(value) {
  return SENSITIVE_VALUE.test(value) || SENSITIVE_ASSIGNMENT.test(value)
}

export function canonicalProviderContractJson(value) {
  return JSON.stringify(canonical(value))
}

function sanitizeMetadata(value, field, depth = 0) {
  if (depth > 4) wall("PROVIDER_EVIDENCE_SANITIZATION_WALL", field, "MAX_DEPTH")
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value
  if (typeof value === "string") {
    if (value.length > 512 || CONTROL.test(value) || residualSecret(value)) wall("PROVIDER_EVIDENCE_SANITIZATION_WALL", field, "RESIDUAL_SECRET_OR_UNSAFE_STRING")
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 32) wall("PROVIDER_EVIDENCE_SANITIZATION_WALL", field, "MAX_ITEMS")
    return value.map((entry, index) => sanitizeMetadata(entry, `${field}[${index}]`, depth + 1))
  }
  if (!plainObject(value) || Object.keys(value).length > 32) {
    wall("PROVIDER_EVIDENCE_SANITIZATION_WALL", field, "PLAIN_BOUNDED_OBJECT_REQUIRED")
  }
  const output = {}
  for (const key of Object.keys(value).sort()) {
    if (sensitiveKey(key)) wall("PROVIDER_EVIDENCE_SANITIZATION_WALL", `${field}.${key}`, "SENSITIVE_KEY_ALIAS")
    text(key, `${field}.key`, IDENTIFIER)
    output[key] = sanitizeMetadata(value[key], `${field}.${key}`, depth + 1)
  }
  return output
}

export function normalizeProviderCapability(input) {
  exactFields(input, CAPABILITY_FIELDS, "capability")
  if (input.schemaVersion !== 1 || input.artifactType !== "PROVIDER_CAPABILITY_SNAPSHOT") {
    wall("PROVIDER_CAPABILITY_SCHEMA_WALL", "capability", "V1_SNAPSHOT_REQUIRED")
  }
  if (!AVAILABILITY.has(input.availability)) wall("PROVIDER_CAPABILITY_VALUE_WALL", "availability")
  if (!Number.isSafeInteger(input.maxConcurrency) || input.maxConcurrency < 0 || input.maxConcurrency > 64) {
    wall("PROVIDER_CAPABILITY_VALUE_WALL", "maxConcurrency", "0..64")
  }
  for (const field of ["supportsCancellation", "supportsArtifacts", "supportsSanitizedEvidence", "serviceCompatible", "authorityMintingAllowed"]) {
    if (typeof input[field] !== "boolean") wall("PROVIDER_CONTRACT_TYPE_WALL", field, "BOOLEAN_REQUIRED")
  }
  if (input.authorityMintingAllowed !== false) wall("PROVIDER_AUTHORITY_MINT_WALL", "authorityMintingAllowed", "FALSE_REQUIRED")
  const normalized = {
    schemaVersion: 1,
    artifactType: "PROVIDER_CAPABILITY_SNAPSHOT",
    providerId: text(input.providerId, "providerId", IDENTIFIER),
    adapterId: text(input.adapterId, "adapterId", IDENTIFIER),
    availability: input.availability,
    riskClasses: stringSet(input.riskClasses, "riskClasses", { nonEmpty: true }),
    requirements: stringSet(input.requirements, "requirements"),
    actions: stringSet(input.actions, "actions"),
    roles: stringSet(input.roles, "roles", { nonEmpty: true }),
    repositories: stringSet(input.repositories, "repositories", { nonEmpty: true, pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/ }),
    maxConcurrency: input.maxConcurrency,
    supportsCancellation: input.supportsCancellation,
    supportsArtifacts: input.supportsArtifacts,
    supportsSanitizedEvidence: input.supportsSanitizedEvidence,
    serviceCompatible: input.serviceCompatible,
    authorityMintingAllowed: false,
  }
  if (normalized.availability === "AVAILABLE" && (normalized.maxConcurrency === 0 || !normalized.serviceCompatible)) {
    wall("PROVIDER_CAPABILITY_CONTRADICTION_WALL", "availability", "AVAILABLE_REQUIRES_EXECUTABLE_CAPACITY")
  }
  return Object.freeze(normalized)
}

function missing(required, supported) {
  const set = new Set(supported)
  return required.filter((entry) => !set.has(entry)).sort()
}

export function evaluateProviderDispatch(input) {
  exactFields(input, new Set(["envelope", "capability", "requestedRole"]), "dispatchEvaluation")
  let envelopeResult
  try {
    envelopeResult = validateDispatchEnvelope(input.envelope)
  } catch (error) {
    if (!(error instanceof DispatchEnvelopeError)) throw error
    wall("PROVIDER_DISPATCH_ENVELOPE_WALL", error.field, error.code)
  }
  const envelope = envelopeResult.envelope
  const capability = normalizeProviderCapability(input.capability)
  const requestedRole = text(input.requestedRole, "requestedRole", IDENTIFIER)
  const selectedProviders = [...envelope.preferredProviders, ...envelope.fallbackProviders]
  const gaps = {
    provider: selectedProviders.includes(capability.providerId) ? [] : [capability.providerId],
    riskClasses: missing([envelope.riskClass], capability.riskClasses),
    requirements: missing(envelope.providerRequirements, capability.requirements),
    actions: missing(envelope.allowedActions, capability.actions),
    roles: missing([requestedRole], capability.roles),
    repositories: missing(envelope.repositories, capability.repositories),
  }
  const gapFields = Object.entries(gaps).filter(([, values]) => values.length > 0).map(([field]) => field)
  const reasons = []
  if (capability.availability !== "AVAILABLE") reasons.push(`PROVIDER_${capability.availability}`)
  if (capability.maxConcurrency < 1) reasons.push("PROVIDER_NO_CAPACITY")
  if (!capability.serviceCompatible) reasons.push("PROVIDER_NOT_SERVICE_COMPATIBLE")
  if (!capability.supportsCancellation) reasons.push("PROVIDER_CANCELLATION_UNSUPPORTED")
  if (!capability.supportsArtifacts) reasons.push("PROVIDER_ARTIFACT_UNSUPPORTED")
  if (!capability.supportsSanitizedEvidence) reasons.push("PROVIDER_SANITIZED_EVIDENCE_UNSUPPORTED")
  reasons.push(...gapFields.map((field) => `PROVIDER_CAPABILITY_GAP:${field}`))
  const eligible = reasons.length === 0
  return Object.freeze({
    ok: true,
    code: eligible ? "PROVIDER_DISPATCH_ELIGIBLE" : "PROVIDER_DISPATCH_UNSUPPORTED",
    eligible,
    capabilityMatched: eligible,
    dispatchAllowed: false,
    dispatchPerformed: false,
    requiresIndependentAuthorityMatch: true,
    authorityGranted: false,
    providerId: capability.providerId,
    adapterId: capability.adapterId,
    workOrderId: envelope.workOrderId,
    laneId: envelope.laneId,
    requestedRole,
    envelopeContentHash: envelopeResult.contentHash,
    reasons: Object.freeze([...new Set(reasons)].sort()),
    gaps: Object.freeze(gaps),
  })
}

function relativePath(value, field) {
  const result = text(value, field)
  const parts = result.split("/")
  if (result.startsWith("/")
    || /^[A-Za-z]:\//.test(result)
    || result.includes("\\")
    || /[*?[\]{}]/.test(result)
    || parts.includes(".")
    || parts.includes("..")
    || parts.some((part) => part === "")) {
    wall("PROVIDER_ARTIFACT_PATH_WALL", field, "SAFE_RELATIVE_POSIX_PATH_REQUIRED")
  }
  return result
}

export function validateProviderResponse(input) {
  if (!plainObject(input) || !RESPONSE_TYPES.has(input.artifactType)) {
    wall("PROVIDER_RESPONSE_TYPE_WALL", "artifactType")
  }
  exactFields(input, RESPONSE_FIELDS[input.artifactType], "response")
  if (input.schemaVersion !== 1) wall("PROVIDER_RESPONSE_SCHEMA_WALL", "schemaVersion", "1_REQUIRED")
  if (!PROVIDER_STATES.has(input.providerState)) wall("PROVIDER_RESPONSE_VALUE_WALL", "providerState")
  if (input.sanitized !== true) wall("PROVIDER_EVIDENCE_SANITIZATION_WALL", "sanitized", "TRUE_REQUIRED")
  if (input.authorityGranted !== false) wall("PROVIDER_AUTHORITY_MINT_WALL", "authorityGranted", "FALSE_REQUIRED")
  const result = {
    schemaVersion: 1,
    artifactType: input.artifactType,
    providerId: text(input.providerId, "providerId", IDENTIFIER),
    adapterId: text(input.adapterId, "adapterId", IDENTIFIER),
    dispatchId: text(input.dispatchId, "dispatchId", IDENTIFIER),
    workOrderId: text(input.workOrderId, "workOrderId", IDENTIFIER),
    laneId: text(input.laneId, "laneId", IDENTIFIER),
    providerState: input.providerState,
    reasonCode: input.reasonCode === null ? null : text(input.reasonCode, "reasonCode", IDENTIFIER),
    sanitized: true,
    authorityGranted: false,
  }
  const failureLikeState = input.providerState === "FAILED" || input.providerState === "CANCELLED" || input.providerState === "UNKNOWN"
  if (failureLikeState && result.reasonCode === null) {
    wall("PROVIDER_RESPONSE_SEMANTIC_WALL", "reasonCode", `${input.providerState}_REQUIRES_TYPED_REASON`)
  }
  if (!failureLikeState && result.reasonCode !== null) {
    wall("PROVIDER_RESPONSE_SEMANTIC_WALL", "reasonCode", `${input.providerState}_REQUIRES_NULL_REASON`)
  }
  if (input.artifactType === "PROVIDER_STATUS") result.progressMarker = input.progressMarker === null ? null : text(input.progressMarker, "progressMarker")
  if (input.artifactType === "PROVIDER_CANCELLATION") {
    if (typeof input.cancelAcknowledged !== "boolean") wall("PROVIDER_CONTRACT_TYPE_WALL", "cancelAcknowledged", "BOOLEAN_REQUIRED")
    if (input.cancelAcknowledged !== (input.providerState === "CANCELLED")) {
      wall("PROVIDER_RESPONSE_SEMANTIC_WALL", "cancelAcknowledged", "ACKNOWLEDGED_IFF_CANCELLED")
    }
    result.cancelAcknowledged = input.cancelAcknowledged
  }
  if (input.artifactType === "PROVIDER_ARTIFACT") {
    if (input.providerState !== "SUCCEEDED") wall("PROVIDER_RESPONSE_SEMANTIC_WALL", "providerState", "ARTIFACT_REQUIRES_SUCCEEDED")
    result.artifactId = text(input.artifactId, "artifactId", IDENTIFIER)
    result.artifactKind = text(input.artifactKind, "artifactKind", IDENTIFIER)
    result.contentHash = text(input.contentHash, "contentHash", HASH)
    result.relativePath = relativePath(input.relativePath, "relativePath")
  }
  if (input.artifactType === "PROVIDER_EVIDENCE") {
    result.eventId = text(input.eventId, "eventId", IDENTIFIER)
    result.evidenceType = text(input.evidenceType, "evidenceType", IDENTIFIER)
    result.contentHash = text(input.contentHash, "contentHash", HASH)
    result.summary = text(input.summary, "summary")
    if (input.summary.length > 512 || residualSecret(input.summary)) wall("PROVIDER_EVIDENCE_SANITIZATION_WALL", "summary", "RESIDUAL_SECRET_OR_UNSAFE_STRING")
    if (input.rawProviderOutputIncluded !== false) wall("PROVIDER_EVIDENCE_SANITIZATION_WALL", "rawProviderOutputIncluded", "FALSE_REQUIRED")
    result.attributes = sanitizeMetadata(input.attributes, "attributes")
    result.rawProviderOutputIncluded = false
  }
  return Object.freeze(result)
}

export function hashProviderResponse(response) {
  return crypto.createHash("sha256").update(canonicalProviderContractJson(validateProviderResponse(response))).digest("hex")
}
