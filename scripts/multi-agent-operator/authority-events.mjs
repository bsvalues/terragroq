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

function trustedOwnerFor(record, trustedOwners, trustedOwnerKeyFingerprint) {
  if (!HASH_PATTERN.test(trustedOwnerKeyFingerprint ?? "")) wall("AUTHORITY_TRUST_ANCHOR_WALL")
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
  let actualFingerprint
  try {
    const key = crypto.createPublicKey(owner.publicKeyPem).export({ type: "spki", format: "der" })
    actualFingerprint = crypto.createHash("sha256").update(key).digest("hex")
  } catch {
    wall("AUTHORITY_TRUST_ANCHOR_WALL")
  }
  if (actualFingerprint !== trustedOwnerKeyFingerprint) wall("AUTHORITY_TRUST_ANCHOR_WALL")
  return owner
}

export function verifyTrustBundle(trustedOwners, trustedOwnerKeyFingerprint, trustedOwnerBundleContentHash) {
  if (!plainObject(trustedOwners)
    || trustedOwners.schemaVersion !== 1
    || trustedOwners.artifactType !== "OWNER_TRUST_BUNDLE"
    || !Array.isArray(trustedOwners.owners)
    || !HASH_PATTERN.test(trustedOwnerKeyFingerprint ?? "")
    || !HASH_PATTERN.test(trustedOwnerBundleContentHash ?? "")) {
    wall("AUTHORITY_TRUST_BUNDLE_WALL")
  }
  const candidates = trustedOwners.owners.filter((owner) => {
    if (owner?.status !== "ACTIVE" || owner?.algorithm !== "Ed25519" || typeof owner.publicKeyPem !== "string") return false
    try {
      const key = crypto.createPublicKey(owner.publicKeyPem).export({ type: "spki", format: "der" })
      return crypto.createHash("sha256").update(key).digest("hex") === trustedOwnerKeyFingerprint
    } catch {
      return false
    }
  })
  if (candidates.length !== 1) wall("AUTHORITY_TRUST_ANCHOR_WALL")
  const owner = candidates[0]
  if (trustedOwners.issuer?.role !== "OWNER"
    || trustedOwners.issuer?.ownerId !== owner.ownerId
    || trustedOwners.signature?.algorithm !== "Ed25519"
    || trustedOwners.signature?.keyId !== owner.publicKeyId) {
    wall("AUTHORITY_TRUST_BUNDLE_WALL")
  }
  if (!HASH_PATTERN.test(trustedOwners.contentHash ?? "")) wall("AUTHORITY_TRUST_BUNDLE_WALL")
  if (trustedOwners.contentHash !== trustedOwnerBundleContentHash) wall("AUTHORITY_TRUST_BUNDLE_REPLAY_WALL")
  const payload = canonicalJson(signedPayload(trustedOwners))
  const computed = crypto.createHash("sha256").update(payload, "utf8").digest("hex")
  if (computed !== trustedOwners.contentHash) wall("AUTHORITY_TRUST_BUNDLE_WALL")
  try {
    const signature = Buffer.from(requiredString(trustedOwners.signature.value, "signature.value"), "base64")
    if (signature.length === 0 || !crypto.verify(null, Buffer.from(payload, "utf8"), owner.publicKeyPem, signature)) {
      wall("AUTHORITY_TRUST_BUNDLE_WALL")
    }
  } catch (error) {
    if (error instanceof AuthorityAssertionError) throw error
    wall("AUTHORITY_TRUST_BUNDLE_WALL")
  }
}

function verifySignedRecord(record, trustedOwners, trustedOwnerKeyFingerprint) {
  if (!HASH_PATTERN.test(record.contentHash ?? "")) wall("AUTHORITY_HASH_WALL", "FORMAT")
  const payload = canonicalJson(signedPayload(record))
  const computed = crypto.createHash("sha256").update(payload, "utf8").digest("hex")
  if (!crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(record.contentHash, "hex"))) {
    wall("AUTHORITY_HASH_WALL", "MISMATCH")
  }
  const owner = trustedOwnerFor(record, trustedOwners, trustedOwnerKeyFingerprint)
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

function validateLegacyRevocationEvent(event) {
  if (!plainObject(event)) wall("AUTHORITY_LEGACY_REVOCATION_WALL", "SCHEMA")
  if (event.schemaVersion !== 1 || event.artifactType !== "OWNER_LEGACY_AUTHORITY_REVOCATION_EVENT") {
    wall("AUTHORITY_LEGACY_REVOCATION_WALL", "SCHEMA")
  }
  requiredString(event.eventId, "eventId")
  requiredString(event.authorityRecordId, "authorityRecordId")
  requiredString(event.adapterId, "adapterId")
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) wall("AUTHORITY_LEGACY_REVOCATION_WALL", "SEQUENCE")
  if (event.status !== "REVOKED_TERMINAL") wall("AUTHORITY_LEGACY_REVOCATION_WALL", "STATUS")
  if (!Number.isSafeInteger(event.terminalIssueNumber) || event.terminalIssueNumber < 1) {
    wall("AUTHORITY_LEGACY_REVOCATION_WALL", "TERMINAL_ISSUE")
  }
  requiredString(event.terminalReason, "terminalReason")
  instant(event.issuedAt, "issuedAt")
  if (event.previousEventHash !== null && !HASH_PATTERN.test(event.previousEventHash ?? "")) {
    wall("AUTHORITY_LEGACY_REVOCATION_WALL", "PREVIOUS_HASH")
  }
}

export function assertLegacyAuthorityRevocations(input) {
  if (!plainObject(input)) wall("AUTHORITY_LEGACY_REVOCATION_WALL", "INPUT")
  const {
    events, trustedOwners, trustedOwnerKeyFingerprint, trustedOwnerBundleContentHash,
    expected, now = new Date(),
  } = input
  verifyTrustBundle(trustedOwners, trustedOwnerKeyFingerprint, trustedOwnerBundleContentHash)
  if (!plainObject(expected)) wall("AUTHORITY_LEGACY_REVOCATION_WALL", "EXPECTED")
  const adapterId = requiredString(expected.adapterId, "expected.adapterId")
  const authorityRecordIds = requiredStringArray(expected.authorityRecordIds, "expected.authorityRecordIds")
  if (!Number.isSafeInteger(expected.terminalIssueNumber) || expected.terminalIssueNumber < 1) {
    wall("AUTHORITY_LEGACY_REVOCATION_WALL", "EXPECTED_TERMINAL_ISSUE")
  }
  requiredString(expected.terminalReason, "expected.terminalReason")
  if (!Array.isArray(events) || events.length !== authorityRecordIds.length) {
    wall("AUTHORITY_LEGACY_REVOCATION_WALL", "EVENT_COUNT")
  }
  const assertionTime = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(assertionTime)) wall("AUTHORITY_TIME_WALL")

  let previous = null
  const seenRecords = new Set()
  const seenEvents = new Set()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    validateLegacyRevocationEvent(event)
    if (seenEvents.has(event.eventId) || seenRecords.has(event.authorityRecordId)) {
      wall("AUTHORITY_LEGACY_REVOCATION_WALL", "DUPLICATE")
    }
    if (event.sequence !== index + 1 || event.previousEventHash !== previous) {
      wall("AUTHORITY_LEGACY_REVOCATION_WALL", "LINK")
    }
    if (!authorityRecordIds.includes(event.authorityRecordId)
      || event.adapterId !== adapterId
      || event.terminalIssueNumber !== expected.terminalIssueNumber
      || event.terminalReason !== expected.terminalReason) {
      wall("AUTHORITY_LEGACY_REVOCATION_WALL", "SCOPE")
    }
    if (Date.parse(event.issuedAt) > assertionTime) wall("AUTHORITY_LEGACY_REVOCATION_WALL", "EVENT_TIME")
    verifySignedRecord(event, trustedOwners, trustedOwnerKeyFingerprint)
    seenEvents.add(event.eventId)
    seenRecords.add(event.authorityRecordId)
    previous = event.contentHash
  }

  if (seenRecords.size !== authorityRecordIds.length) wall("AUTHORITY_LEGACY_REVOCATION_WALL", "RECORD_SET")
  const head = trustedOwners.legacyRevocationHeads?.find((candidate) => candidate?.adapterId === adapterId)
  if (!head || head.eventCount !== events.length || head.latestEventHash !== previous) {
    wall("AUTHORITY_EVENT_HEAD_WALL")
  }
  return Object.freeze({
    status: "VERIFIED_REVOKED",
    adapterId,
    authorityRecordIds: Object.freeze([...authorityRecordIds]),
    latestEventHash: previous,
    eventCount: events.length,
  })
}

function validateGrantSchema(grant) {
  if (!plainObject(grant)) wall("AUTHORITY_SCHEMA_WALL", "GRANT")
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
  requiredStringArray(grant.scope.goalIds, "scope.goalIds")
  requiredStringArray(grant.scope.loopIds, "scope.loopIds")
  requiredStringArray(grant.scope.workOrderIds, "scope.workOrderIds")
  requiredStringArray(grant.scope.decisionIds, "scope.decisionIds")
  requiredStringArray(grant.scope.repositories, "scope.repositories")
  requiredStringArray(grant.scope.riskClasses, "scope.riskClasses")
  requiredStringArray(grant.scope.actions, "scope.actions")
  requiredStringArray(grant.scope.mergeModes, "scope.mergeModes")
  const issuedAt = instant(grant.issuedAt, "issuedAt")
  const expiresAt = instant(grant.expiresAt, "expiresAt")
  if (expiresAt <= issuedAt) wall("AUTHORITY_SCHEMA_WALL", "EXPIRY_ORDER")
}

function validateEventSchema(event) {
  if (!plainObject(event)) wall("AUTHORITY_EVENT_CHAIN_WALL", "SCHEMA")
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

function verifyEventChain(grant, events, trustedOwners, trustedOwnerKeyFingerprint, assertionTime) {
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
    verifySignedRecord(event, trustedOwners, trustedOwnerKeyFingerprint)
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
  const keys = Object.keys(counters).sort()
  const expectedKeys = [...COUNTER_NAMES].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    wall("OWNER_TOUCH_EVIDENCE_WALL", "COUNTER_SET")
  }
  const normalized = {}
  for (const name of COUNTER_NAMES) {
    if (!Number.isSafeInteger(counters[name]) || counters[name] < 0) wall("OWNER_TOUCH_EVIDENCE_WALL", name)
    normalized[name] = counters[name]
  }
  const touched = COUNTER_NAMES.some((name) => normalized[name] !== 0)
  return Object.freeze({
    counters: Object.freeze(normalized),
    certified: false,
    lifecycleState: touched ? "FAILED_OWNER_BABYSITTING" : "UNVERIFIED_ZERO_OWNER_OPERATIONS",
    reasonCode: touched ? "FAIL_OWNER_BABYSITTING" : "OWNER_OPERATION_EVIDENCE_UNVERIFIED",
    evidenceHeadHash: null,
    runId: null,
  })
}

export function validateOwnerAuthorityArtifacts(input) {
  if (!plainObject(input)) wall("AUTHORITY_SCHEMA_WALL", "VALIDATION_INPUT")
  const {
    grant, events, trustedOwners, trustedOwnerKeyFingerprint, trustedOwnerBundleContentHash,
    request, counters, now = new Date(),
  } = input
  verifyTrustBundle(trustedOwners, trustedOwnerKeyFingerprint, trustedOwnerBundleContentHash)
  validateGrantSchema(grant)
  verifySignedRecord(grant, trustedOwners, trustedOwnerKeyFingerprint)
  const at = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(at)) wall("AUTHORITY_TIME_WALL")
  const status = verifyEventChain(grant, events, trustedOwners, trustedOwnerKeyFingerprint, at)
  if (at < Date.parse(grant.issuedAt)) wall("AUTHORITY_NOT_YET_VALID_WALL")
  if (at >= Date.parse(grant.expiresAt)) wall("AUTHORITY_EXPIRED_WALL")
  if (status.status === "REVOKED") wall("AUTHORITY_REVOKED_WALL")
  if (!plainObject(request)) wall("AUTHORITY_SCOPE_WALL", "REQUEST")
  if (request.subjectType !== grant.subject.type || request.subjectId !== grant.subject.id) wall("AUTHORITY_SUBJECT_WALL")
  if ((request.action === "ACTIVATE_PROGRAM") !== (grant.grantKind === "PROGRAM_ACTIVATION")) {
    wall("AUTHORITY_GRANT_KIND_WALL")
  }
  includes(grant.scope, "programIds", request.programId)
  includes(grant.scope, "goalIds", request.goalId)
  includes(grant.scope, "loopIds", request.loopId)
  includes(grant.scope, "workOrderIds", request.workOrderId)
  includes(grant.scope, "decisionIds", request.decisionId)
  includes(grant.scope, "repositories", request.repository)
  includes(grant.scope, "riskClasses", request.riskClass)
  includes(grant.scope, "actions", request.action)
  includes(grant.scope, "mergeModes", request.mergeMode)
  const ownerOperations = evaluateOwnerOperationCounters(counters)
  if (ownerOperations.lifecycleState === "FAILED_OWNER_BABYSITTING") {
    wall("OWNER_BABYSITTING_WALL", ownerOperations.reasonCode)
  }
  return Object.freeze({
    status: "ARTIFACTS_VALIDATED_NOT_AUTHORIZED",
    authorityGranted: false,
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
