import crypto from "node:crypto"

const HASH_PATTERN = /^[a-f0-9]{64}$/
const COUNTER_NAMES = Object.freeze([
  "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT",
  "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT",
])

export class AuthorityAssertionError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = "AuthorityAssertionError"
    this.code = code
  }
}

function wall(code, detail) {
  throw new AuthorityAssertionError(code, detail ? `${code}:${detail}` : code)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (plainObject(value)) {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${entries.join(",")}}`
  }
  wall("AUTHORITY_SCHEMA_WALL", "NON_CANONICAL_VALUE")
}

function signedPayload(record) {
  if (!plainObject(record)) wall("AUTHORITY_SCHEMA_WALL", "RECORD_REQUIRED")
  const { contentHash: _contentHash, signature: _signature, ...payload } = record
  return payload
}

export function computeAuthorityContentHash(record) {
  return crypto.createHash("sha256").update(canonicalJson(signedPayload(record)), "utf8").digest("hex")
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") wall("AUTHORITY_SCHEMA_WALL", field)
  return value
}

function requiredStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    wall("AUTHORITY_SCHEMA_WALL", field)
  }
  if (new Set(value).size !== value.length) wall("AUTHORITY_SCHEMA_WALL", `${field}_DUPLICATE`)
  return value
}

function instant(value, field) {
  requiredString(value, field)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) wall("AUTHORITY_SCHEMA_WALL", field)
  return parsed
}

function trustedOwnerFor(record, trustedOwners) {
  if (!plainObject(record.issuer) || record.issuer.role !== "OWNER") wall("AUTHORITY_ISSUER_WALL")
  const ownerId = requiredString(record.issuer.ownerId, "issuer.ownerId")
  const keyId = requiredString(record.signature?.keyId, "signature.keyId")
  if (record.signature?.algorithm !== "Ed25519") wall("AUTHORITY_SIGNATURE_WALL", "ALGORITHM")
  if (!plainObject(trustedOwners) || trustedOwners.schemaVersion !== 1 || !Array.isArray(trustedOwners.owners)) {
    wall("AUTHORITY_TRUST_STORE_WALL")
  }
  const owner = trustedOwners.owners.find((candidate) =>
    candidate?.ownerId === ownerId && candidate?.publicKeyId === keyId && candidate?.status === "ACTIVE"
  )
  if (!owner || owner.algorithm !== "Ed25519" || typeof owner.publicKeyPem !== "string") wall("AUTHORITY_ISSUER_WALL")
  return owner
}

function verifySignedRecord(record, trustedOwners) {
  if (!HASH_PATTERN.test(record.contentHash ?? "")) wall("AUTHORITY_HASH_WALL", "FORMAT")
  const payload = canonicalJson(signedPayload(record))
  const computed = crypto.createHash("sha256").update(payload, "utf8").digest("hex")
  if (!crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(record.contentHash, "hex"))) {
    wall("AUTHORITY_HASH_WALL", "MISMATCH")
  }
  const owner = trustedOwnerFor(record, trustedOwners)
  let signature
  try {
    signature = Buffer.from(requiredString(record.signature.value, "signature.value"), "base64")
    if (signature.length === 0) wall("AUTHORITY_SIGNATURE_WALL", "EMPTY")
    if (!crypto.verify(null, Buffer.from(payload, "utf8"), owner.publicKeyPem, signature)) {
      wall("AUTHORITY_SIGNATURE_WALL", "INVALID")
    }
  } catch (error) {
    if (error instanceof AuthorityAssertionError) throw error
    wall("AUTHORITY_SIGNATURE_WALL", "INVALID")
  }
}

function validateGrantSchema(grant) {
  if (grant.schemaVersion !== 1 || grant.artifactType !== "OWNER_AUTHORITY_GRANT") wall("AUTHORITY_SCHEMA_WALL", "GRANT")
  if (!(grant.grantKind === "ACTION_AUTHORITY" || grant.grantKind === "PROGRAM_ACTIVATION")) {
    wall("AUTHORITY_SCHEMA_WALL", "grantKind")
  }
  requiredString(grant.grantId, "grantId")
  requiredString(grant.authorityDecisionId, "authorityDecisionId")
  if (!plainObject(grant.subject)) wall("AUTHORITY_SCHEMA_WALL", "subject")
  requiredString(grant.subject.type, "subject.type")
  requiredString(grant.subject.id, "subject.id")
  if (!plainObject(grant.scope)) wall("AUTHORITY_SCHEMA_WALL", "scope")
  requiredStringArray(grant.scope.programIds, "scope.programIds")
  requiredStringArray(grant.scope.repositories, "scope.repositories")
  requiredStringArray(grant.scope.riskClasses, "scope.riskClasses")
  requiredStringArray(grant.scope.actions, "scope.actions")
  requiredStringArray(grant.scope.mergeModes, "scope.mergeModes")
  const issuedAt = instant(grant.issuedAt, "issuedAt")
  const expiresAt = instant(grant.expiresAt, "expiresAt")
  if (expiresAt <= issuedAt) wall("AUTHORITY_SCHEMA_WALL", "EXPIRY_ORDER")
}

function validateEventSchema(event) {
  if (event.schemaVersion !== 1 || event.artifactType !== "OWNER_AUTHORITY_STATUS_EVENT") {
    wall("AUTHORITY_EVENT_CHAIN_WALL", "SCHEMA")
  }
  requiredString(event.eventId, "eventId")
  requiredString(event.grantId, "event.grantId")
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) wall("AUTHORITY_EVENT_CHAIN_WALL", "SEQUENCE")
  if (!(["ACTIVE", "REVOKED"].includes(event.status))) wall("AUTHORITY_EVENT_CHAIN_WALL", "STATUS")
  instant(event.issuedAt, "event.issuedAt")
  if (event.previousEventHash !== null && !HASH_PATTERN.test(event.previousEventHash ?? "")) {
    wall("AUTHORITY_EVENT_CHAIN_WALL", "PREVIOUS_HASH")
  }
}

function verifyEventChain(grant, events, trustedOwners, assertionTime) {
  if (!Array.isArray(events) || events.length === 0) wall("AUTHORITY_STATUS_WALL", "MISSING")
  let previous = null
  let revoked = false
  let previousTime = Date.parse(grant.issuedAt)
  const eventIds = new Set()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    validateEventSchema(event)
    if (eventIds.has(event.eventId)) wall("AUTHORITY_EVENT_CHAIN_WALL", "DUPLICATE_EVENT")
    eventIds.add(event.eventId)
    if (event.grantId !== grant.grantId || event.sequence !== index + 1 || event.previousEventHash !== previous) {
      wall("AUTHORITY_EVENT_CHAIN_WALL", "LINK")
    }
    const eventTime = Date.parse(event.issuedAt)
    if (eventTime < previousTime || eventTime > assertionTime) wall("AUTHORITY_EVENT_CHAIN_WALL", "EVENT_TIME")
    if (event.issuer?.ownerId !== grant.issuer.ownerId) wall("AUTHORITY_ISSUER_WALL", "EVENT_OWNER")
    if (index === 0 && event.status !== "ACTIVE") wall("AUTHORITY_EVENT_CHAIN_WALL", "INITIAL_STATUS")
    if (revoked) wall("AUTHORITY_EVENT_CHAIN_WALL", "EVENT_AFTER_REVOCATION")
    if (event.status === "REVOKED") revoked = true
    verifySignedRecord(event, trustedOwners)
    previous = event.contentHash
    previousTime = eventTime
  }
  const head = trustedOwners.statusHeads?.find((candidate) => candidate?.grantId === grant.grantId)
  if (!head || head.eventCount !== events.length || head.latestEventHash !== previous) {
    wall("AUTHORITY_EVENT_HEAD_WALL")
  }
  return { status: revoked ? "REVOKED" : "ACTIVE", latestEventHash: previous, eventCount: events.length }
}

function includes(scope, field, expected) {
  if (typeof expected !== "string" || expected.trim() === "" || !scope[field].includes(expected)) {
    wall("AUTHORITY_SCOPE_WALL", field)
  }
}

export function evaluateOwnerOperationCounters(counters) {
  if (!plainObject(counters)) wall("OWNER_TOUCH_EVIDENCE_WALL")
  const normalized = {}
  for (const name of COUNTER_NAMES) {
    if (!Number.isSafeInteger(counters[name]) || counters[name] < 0) wall("OWNER_TOUCH_EVIDENCE_WALL", name)
    normalized[name] = counters[name]
  }
  const touched = COUNTER_NAMES.some((name) => normalized[name] !== 0)
  return Object.freeze({
    counters: Object.freeze(normalized),
    certified: !touched,
    lifecycleState: touched ? "FAILED_OWNER_BABYSITTING" : "CERTIFIED_ZERO_OWNER_OPERATIONS",
    reasonCode: touched ? "FAIL_OWNER_BABYSITTING" : null,
  })
}

export function assertOwnerAuthority({ grant, events, trustedOwners, request, counters, now = new Date() }) {
  validateGrantSchema(grant)
  verifySignedRecord(grant, trustedOwners)
  const at = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(at)) wall("AUTHORITY_TIME_WALL")
  const status = verifyEventChain(grant, events, trustedOwners, at)
  if (at < Date.parse(grant.issuedAt)) wall("AUTHORITY_NOT_YET_VALID_WALL")
  if (at >= Date.parse(grant.expiresAt)) wall("AUTHORITY_EXPIRED_WALL")
  if (status.status === "REVOKED") wall("AUTHORITY_REVOKED_WALL")
  if (!plainObject(request)) wall("AUTHORITY_SCOPE_WALL", "REQUEST")
  if (request.subjectType !== grant.subject.type || request.subjectId !== grant.subject.id) wall("AUTHORITY_SUBJECT_WALL")
  if ((request.action === "ACTIVATE_PROGRAM") !== (grant.grantKind === "PROGRAM_ACTIVATION")) {
    wall("AUTHORITY_GRANT_KIND_WALL")
  }
  includes(grant.scope, "programIds", request.programId)
  includes(grant.scope, "repositories", request.repository)
  includes(grant.scope, "riskClasses", request.riskClass)
  includes(grant.scope, "actions", request.action)
  includes(grant.scope, "mergeModes", request.mergeMode)
  const ownerOperations = evaluateOwnerOperationCounters(counters)
  if (!ownerOperations.certified) wall("OWNER_BABYSITTING_WALL", ownerOperations.reasonCode)
  return Object.freeze({
    status: "PASS",
    grantId: grant.grantId,
    authorityDecisionId: grant.authorityDecisionId,
    subject: Object.freeze({ ...grant.subject }),
    expiresAt: grant.expiresAt,
    currentGrantStatus: status.status,
    latestStatusEventHash: status.latestEventHash,
    statusEventCount: status.eventCount,
    ownerOperations,
  })
}

export const OWNER_OPERATION_COUNTERS = COUNTER_NAMES
