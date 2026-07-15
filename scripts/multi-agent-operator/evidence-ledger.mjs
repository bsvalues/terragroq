import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { canonicalJson, evaluateOwnerOperationCounters } from "./authority-events.mjs"
import { inspectLaneLeaseStore } from "./lane-lease-checkpoint.mjs"
import {
  CANONICAL_LIFECYCLE_STATES,
  classifyLifecycleFailure,
  FAILURE_CLASSES,
  TERMINAL_LIFECYCLE_STATES,
  transitionLifecycle,
} from "./lifecycle-state-machine.mjs"

const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4))
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_STALE_LOCK_MS = 30_000
const HASH = /^[a-f0-9]{64}$/
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u
const SECRET_VALUE = new RegExp([
  "(?:bearer|basic)\\s+[a-z0-9._~+\\/-]+=*",
  "-----BEGIN [A-Z ]+(?:PRIVATE KEY|CREDENTIALS)-----",
  "\\b(?:gh[opsur]|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{12,}",
  "\\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}",
  "\\bAKIA[A-Z0-9]{16}",
  "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
].join("|"), "i")
const SECRET_ASSIGNMENT = /\b(?:api[\s_-]*key|access[\s_-]*key|private[\s_-]*key|client[\s_-]*secret|authorization|credential|cookie|password|passwd|pwd|passphrase|secret|session(?:[\s_-]*id)?|token|otp)\s*[:=]\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s"',;]+)/i
const SENSITIVE_ALIASES = [
  "authorization", "authheader", "credential", "cookie", "apikey", "accesskey",
  "privatekey", "clientsecret", "password", "passwd", "pwd", "passphrase",
  "secret", "session", "token", "otp", "keyring", "authcache", "rawoutput",
  "provideroutput", "prompt",
]
const SAFE_SENSITIVE_KEYS = new Set(["fencingtoken"])
const EVENT_FIELDS = [
  "schemaVersion", "artifactType", "ledgerId", "manifestHash", "eventId", "sequence",
  "occurredAt", "recordedAt", "eventType", "scope", "writer", "leaseAttribution",
  "payload", "sourceRefs", "requestDigest", "ownerCounterDelta", "sanitized",
  "rawAuthMaterialIncluded", "rawProviderOutputIncluded", "previousEventHash", "eventHash",
  "authorityGranted",
]
const REQUEST_FIELDS = [
  "schemaVersion", "artifactType", "eventId", "occurredAt", "eventType", "scope", "writer",
  "leaseAttribution", "payload", "sourceRefs", "sanitized", "rawAuthMaterialIncluded",
  "rawProviderOutputIncluded", "expectedHead",
]

export const EVIDENCE_EVENT_TYPES = Object.freeze([
  "AUTHORITY", "WORKER", "PROVIDER", "RESERVATION", "TRANSITION", "TEST", "COMMIT",
  "PR", "REVIEW", "MERGE", "CLEANUP", "FAILURE", "OWNER_CONTACT",
])
export const OWNER_TOUCH_COUNTERS = Object.freeze([
  "OWNER_OPERATION_TOUCH_COUNT", "OWNER_CREDENTIAL_TOUCH_COUNT", "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT", "OWNER_ROUTINE_CONTACT_COUNT",
])

const TYPE_FIELDS = Object.freeze({
  AUTHORITY: ["grantId", "authorityDecisionId", "status", "contentHash"],
  WORKER: ["workerId", "role", "action", "reasonCode"],
  PROVIDER: ["providerId", "adapterId", "dispatchId", "state", "reasonCode", "responseContentHash"],
  RESERVATION: ["reservationSetId", "action", "ledgerVersion", "fencingToken", "reasonCodes", "resultContentHash"],
  TRANSITION: ["from", "to", "reasonCode", "failureClass", "authorityGap", "transitionContentHash"],
  TEST: ["suiteId", "status", "passed", "failed", "skipped", "durationMs", "resultContentHash"],
  COMMIT: ["repository", "branch", "commitSha", "treeSha", "changedPaths"],
  PR: ["repository", "prNumber", "action", "state", "baseRef", "headSha", "mergeMode"],
  REVIEW: ["repository", "prNumber", "reviewerId", "verdict", "headSha", "threadCount", "unresolvedThreadCount"],
  MERGE: ["repository", "prNumber", "mergeSha", "method", "verified"],
  CLEANUP: ["resourceType", "resourceId", "action", "status", "resultContentHash"],
  FAILURE: ["failureClass", "reasonCode", "lifecycleState", "attempt", "terminal", "detailContentHash"],
  OWNER_CONTACT: ["contactClass", "touchKinds", "authorityGap", "decisionId"],
})

const OWNER_KIND_TO_COUNTER = Object.freeze({
  OPERATION: "OWNER_OPERATION_TOUCH_COUNT",
  CREDENTIAL: "OWNER_CREDENTIAL_TOUCH_COUNT",
  DIAGNOSTIC: "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  ROUTINE_DECISION: "OWNER_ROUTINE_DECISION_COUNT",
  ROUTINE_CONTACT: "OWNER_ROUTINE_CONTACT_COUNT",
})

export class EvidenceLedgerError extends Error {
  constructor(code, field = null, detail = null) {
    super(code)
    this.name = "EvidenceLedgerError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field = null, detail = null) { throw new EvidenceLedgerError(code, field, detail) }
function plainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!plainObject(value)) wall("EVIDENCE_LEDGER_SCHEMA_WALL", field, "OBJECT_REQUIRED")
  const allowed = new Set(fields)
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  const missing = fields.find((key) => !Object.hasOwn(value, key))
  if (unknown) wall("EVIDENCE_LEDGER_SCHEMA_WALL", field, `UNKNOWN_KEY_DIGEST:${sha(unknown)}`)
  if (missing) wall("EVIDENCE_LEDGER_SCHEMA_WALL", `${field}.${missing}`, "MISSING_FIELD")
}
function identifier(value, field, pattern = ID) {
  if (typeof value !== "string" || !pattern.test(value) || CONTROL.test(value)
    || SECRET_VALUE.test(value) || SECRET_ASSIGNMENT.test(value)) wall("EVIDENCE_LEDGER_VALUE_WALL", field)
  return value
}
function hash(value, field) { return identifier(value, field, HASH) }
function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) wall("EVIDENCE_LEDGER_VALUE_WALL", field)
  return value
}
function instant(value, field) {
  if (typeof value !== "string") wall("EVIDENCE_LEDGER_TIME_WALL", field)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) wall("EVIDENCE_LEDGER_TIME_WALL", field)
  return parsed
}
function enumValue(value, values, field) {
  if (!values.includes(value)) wall("EVIDENCE_LEDGER_VALUE_WALL", field)
  return value
}
function sha(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex") }
function sameHash(left, right) {
  return HASH.test(left) && HASH.test(right)
    && crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}
export function canonicalEvidenceLedgerJson(value) { return canonicalJson(value) }
function digestObject(value) { return sha(canonicalJson(value)) }
function zeroCounters() { return Object.fromEntries(OWNER_TOUCH_COUNTERS.map((name) => [name, 0])) }
function stableStrings(value, field, allowed = null) {
  if (!Array.isArray(value)) wall("EVIDENCE_LEDGER_SCHEMA_WALL", field, "ARRAY_REQUIRED")
  const result = value.map((entry, index) => {
    identifier(entry, `${field}[${index}]`)
    if (allowed && !allowed.includes(entry)) wall("EVIDENCE_LEDGER_VALUE_WALL", `${field}[${index}]`)
    return entry
  }).sort()
  if (new Set(result).size !== result.length) wall("EVIDENCE_LEDGER_VALUE_WALL", field, "DUPLICATE")
  return result
}
function safePath(value, field) {
  if (typeof value !== "string" || value.length > 512 || value.startsWith("/") || /^[A-Za-z]:/.test(value)
    || value.includes("\\") || /[*?[\]{}]/.test(value) || CONTROL.test(value)) wall("EVIDENCE_LEDGER_PATH_WALL", field)
  const parts = value.split("/")
  if (parts.some((part) => !part || part === "." || part === "..")) wall("EVIDENCE_LEDGER_PATH_WALL", field)
  return value
}
function sensitiveKey(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  return !SAFE_SENSITIVE_KEYS.has(normalized) && SENSITIVE_ALIASES.some((alias) => normalized.includes(alias))
}
function assertSanitized(value, field = "payload", depth = 0) {
  if (depth > 6) wall("EVIDENCE_SANITIZATION_WALL", field, "MAX_DEPTH")
  if (value === null || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) wall("EVIDENCE_SANITIZATION_WALL", field, "NON_FINITE")
    return
  }
  if (typeof value === "string") {
    if (value.length > 4096 || CONTROL.test(value) || SECRET_VALUE.test(value) || SECRET_ASSIGNMENT.test(value)) {
      wall("EVIDENCE_SANITIZATION_WALL", field, "UNSAFE_VALUE")
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 128) wall("EVIDENCE_SANITIZATION_WALL", field, "MAX_ITEMS")
    value.forEach((entry, index) => assertSanitized(entry, `${field}[${index}]`, depth + 1))
    return
  }
  if (!plainObject(value) || Object.keys(value).length > 128) wall("EVIDENCE_SANITIZATION_WALL", field, "PLAIN_BOUNDED_OBJECT_REQUIRED")
  for (const [key, entry] of Object.entries(value)) {
    const keyField = `${field}.{key:${sha(key)}}`
    if (sensitiveKey(key)) wall("EVIDENCE_SANITIZATION_WALL", keyField, "SENSITIVE_KEY")
    assertSanitized(entry, keyField, depth + 1)
  }
}

function normalizeScope(value) {
  exact(value, ["programId", "goalId", "loopId", "workOrderId", "laneId", "runId"], "scope")
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, identifier(entry, `scope.${key}`)])))
}
function normalizeWriter(value) {
  exact(value, ["writerId", "writerKind", "role", "providerId", "adapterId", "trustGateEvidenceHash"], "writer")
  const writerKind = enumValue(value.writerKind, ["COORDINATOR", "BUILDER", "ASSURANCE", "PROVIDER_ADAPTER", "SYSTEM"], "writer.writerKind")
  const providerId = value.providerId === null ? null : identifier(value.providerId, "writer.providerId")
  const adapterId = value.adapterId === null ? null : identifier(value.adapterId, "writer.adapterId")
  if (writerKind === "PROVIDER_ADAPTER" && (providerId === null || adapterId === null)) wall("EVIDENCE_WRITER_ATTRIBUTION_WALL", "writer")
  return Object.freeze({
    writerId: identifier(value.writerId, "writer.writerId"), writerKind,
    role: identifier(value.role, "writer.role"), providerId, adapterId,
    trustGateEvidenceHash: hash(value.trustGateEvidenceHash, "writer.trustGateEvidenceHash"),
  })
}
function normalizeLease(value) {
  exact(value, ["storeId", "workOrderId", "laneId", "workerId", "fencingToken", "checkpointSequence", "checkpointEvidenceHash"], "leaseAttribution")
  return Object.freeze({
    storeId: identifier(value.storeId, "leaseAttribution.storeId"),
    workOrderId: identifier(value.workOrderId, "leaseAttribution.workOrderId"),
    laneId: identifier(value.laneId, "leaseAttribution.laneId"),
    workerId: identifier(value.workerId, "leaseAttribution.workerId"),
    fencingToken: integer(value.fencingToken, "leaseAttribution.fencingToken", 1),
    checkpointSequence: integer(value.checkpointSequence, "leaseAttribution.checkpointSequence", 1),
    checkpointEvidenceHash: hash(value.checkpointEvidenceHash, "leaseAttribution.checkpointEvidenceHash"),
  })
}
function normalizeRefs(value) {
  if (!Array.isArray(value) || value.length > 128) wall("EVIDENCE_LEDGER_SCHEMA_WALL", "sourceRefs", "BOUNDED_ARRAY_REQUIRED")
  const refs = value.map((entry, index) => {
    exact(entry, ["artifactType", "artifactId", "contentHash"], `sourceRefs[${index}]`)
    return Object.freeze({
      artifactType: identifier(entry.artifactType, `sourceRefs[${index}].artifactType`),
      artifactId: identifier(entry.artifactId, `sourceRefs[${index}].artifactId`),
      contentHash: hash(entry.contentHash, `sourceRefs[${index}].contentHash`),
    })
  }).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
  if (new Set(refs.map(canonicalJson)).size !== refs.length) wall("EVIDENCE_LEDGER_VALUE_WALL", "sourceRefs", "DUPLICATE")
  return Object.freeze(refs)
}
function normalizeAuthorityGap(value, field) {
  exact(value, ["present", "condition", "conditionRef"], field)
  if (typeof value.present !== "boolean") wall("EVIDENCE_LEDGER_VALUE_WALL", `${field}.present`)
  return Object.freeze({
    present: value.present,
    condition: value.condition === null ? null : identifier(value.condition, `${field}.condition`),
    conditionRef: value.conditionRef === null ? null : identifier(value.conditionRef, `${field}.conditionRef`),
  })
}
function nullableId(value, field) { return value === null ? null : identifier(value, field) }
function normalizePayload(type, input) {
  assertSanitized(input)
  exact(input, TYPE_FIELDS[type], "payload")
  const p = { ...input }
  if (type === "AUTHORITY") {
    p.grantId = identifier(p.grantId, "payload.grantId"); p.authorityDecisionId = identifier(p.authorityDecisionId, "payload.authorityDecisionId")
    p.status = enumValue(p.status, ["VALIDATED", "ACTIVE", "REVOKED", "EXPIRED", "DENIED"], "payload.status"); p.contentHash = hash(p.contentHash, "payload.contentHash")
  } else if (type === "WORKER") {
    p.workerId = identifier(p.workerId, "payload.workerId"); p.role = identifier(p.role, "payload.role")
    p.action = enumValue(p.action, ["ASSIGNED", "STARTED", "HEARTBEAT", "CANCELLED", "COMPLETED", "QUARANTINED"], "payload.action"); p.reasonCode = nullableId(p.reasonCode, "payload.reasonCode")
  } else if (type === "PROVIDER") {
    for (const key of ["providerId", "adapterId", "dispatchId"]) p[key] = identifier(p[key], `payload.${key}`)
    p.state = enumValue(p.state, ["ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"], "payload.state")
    p.reasonCode = nullableId(p.reasonCode, "payload.reasonCode"); p.responseContentHash = hash(p.responseContentHash, "payload.responseContentHash")
    const failed = ["FAILED", "CANCELLED", "UNKNOWN"].includes(p.state)
    if (failed !== (p.reasonCode !== null)) wall("EVIDENCE_LEDGER_SEMANTIC_WALL", "payload.reasonCode")
  } else if (type === "RESERVATION") {
    p.reservationSetId = identifier(p.reservationSetId, "payload.reservationSetId")
    p.action = enumValue(p.action, ["ACQUIRED", "COLLISION", "RELEASED", "REJECTED"], "payload.action")
    p.ledgerVersion = integer(p.ledgerVersion, "payload.ledgerVersion"); p.fencingToken = p.fencingToken === null ? null : integer(p.fencingToken, "payload.fencingToken", 1)
    p.reasonCodes = stableStrings(p.reasonCodes, "payload.reasonCodes"); p.resultContentHash = hash(p.resultContentHash, "payload.resultContentHash")
    if (["ACQUIRED", "RELEASED"].includes(p.action) && p.fencingToken === null) wall("EVIDENCE_LEDGER_SEMANTIC_WALL", "payload.fencingToken")
    if ((["ACQUIRED", "RELEASED"].includes(p.action) && p.reasonCodes.length !== 0)
      || (["COLLISION", "REJECTED"].includes(p.action) && p.reasonCodes.length === 0)) wall("EVIDENCE_LEDGER_SEMANTIC_WALL", "payload.reasonCodes")
  } else if (type === "TRANSITION") {
    p.from = identifier(p.from, "payload.from"); p.to = identifier(p.to, "payload.to")
    p.reasonCode = nullableId(p.reasonCode, "payload.reasonCode"); p.failureClass = nullableId(p.failureClass, "payload.failureClass")
    p.authorityGap = normalizeAuthorityGap(p.authorityGap, "payload.authorityGap")
    let transition
    try { transition = transitionLifecycle({ from: p.from, to: p.to, reasonCode: p.reasonCode, failureClass: p.failureClass, authorityGap: p.authorityGap }) } catch { wall("EVIDENCE_TRANSITION_WALL", "payload") }
    p.transitionContentHash = hash(p.transitionContentHash, "payload.transitionContentHash")
    if (p.transitionContentHash !== digestObject(transition)) wall("EVIDENCE_TRANSITION_WALL", "payload.transitionContentHash")
  } else if (type === "TEST") {
    p.suiteId = identifier(p.suiteId, "payload.suiteId"); p.status = enumValue(p.status, ["PASSED", "FAILED", "SKIPPED"], "payload.status")
    for (const key of ["passed", "failed", "skipped", "durationMs"]) p[key] = integer(p[key], `payload.${key}`)
    p.resultContentHash = hash(p.resultContentHash, "payload.resultContentHash")
    if ((p.status === "PASSED" && p.failed !== 0) || (p.status === "FAILED" && p.failed === 0)) wall("EVIDENCE_LEDGER_SEMANTIC_WALL", "payload.status")
  } else if (type === "COMMIT") {
    p.repository = identifier(p.repository, "payload.repository", REPOSITORY); p.branch = identifier(p.branch, "payload.branch", /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/)
    p.commitSha = identifier(p.commitSha, "payload.commitSha", COMMIT); p.treeSha = identifier(p.treeSha, "payload.treeSha", COMMIT)
    if (!Array.isArray(p.changedPaths) || p.changedPaths.length > 512) wall("EVIDENCE_LEDGER_SCHEMA_WALL", "payload.changedPaths")
    p.changedPaths = p.changedPaths.map((entry, index) => { exact(entry, ["path", "contentHash"], `payload.changedPaths[${index}]`); return { path: safePath(entry.path, `payload.changedPaths[${index}].path`), contentHash: hash(entry.contentHash, `payload.changedPaths[${index}].contentHash`) } }).sort((a, b) => a.path.localeCompare(b.path))
    if (new Set(p.changedPaths.map((entry) => entry.path)).size !== p.changedPaths.length) wall("EVIDENCE_LEDGER_VALUE_WALL", "payload.changedPaths", "DUPLICATE")
  } else if (type === "PR") {
    p.repository = identifier(p.repository, "payload.repository", REPOSITORY); p.prNumber = integer(p.prNumber, "payload.prNumber", 1)
    p.action = enumValue(p.action, ["OPENED", "READY", "UPDATED", "CLOSED"], "payload.action"); p.state = enumValue(p.state, ["DRAFT", "OPEN", "CLOSED", "MERGED"], "payload.state")
    p.baseRef = identifier(p.baseRef, "payload.baseRef", /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/); p.headSha = identifier(p.headSha, "payload.headSha", COMMIT); p.mergeMode = identifier(p.mergeMode, "payload.mergeMode")
  } else if (type === "REVIEW") {
    p.repository = identifier(p.repository, "payload.repository", REPOSITORY); p.prNumber = integer(p.prNumber, "payload.prNumber", 1); p.reviewerId = identifier(p.reviewerId, "payload.reviewerId")
    p.verdict = enumValue(p.verdict, ["APPROVED", "REQUEST_CHANGES", "COMMENTED", "DISMISSED"], "payload.verdict"); p.headSha = identifier(p.headSha, "payload.headSha", COMMIT)
    p.threadCount = integer(p.threadCount, "payload.threadCount"); p.unresolvedThreadCount = integer(p.unresolvedThreadCount, "payload.unresolvedThreadCount")
    if (p.unresolvedThreadCount > p.threadCount) wall("EVIDENCE_LEDGER_SEMANTIC_WALL", "payload.unresolvedThreadCount")
  } else if (type === "MERGE") {
    p.repository = identifier(p.repository, "payload.repository", REPOSITORY); p.prNumber = integer(p.prNumber, "payload.prNumber", 1); p.mergeSha = identifier(p.mergeSha, "payload.mergeSha", COMMIT)
    p.method = enumValue(p.method, ["MERGE", "SQUASH", "REBASE"], "payload.method"); if (typeof p.verified !== "boolean") wall("EVIDENCE_LEDGER_VALUE_WALL", "payload.verified")
  } else if (type === "CLEANUP") {
    p.resourceType = enumValue(p.resourceType, ["WORKTREE", "BRANCH", "RESERVATION", "LEASE", "TEMP_ARTIFACT"], "payload.resourceType")
    p.resourceId = identifier(p.resourceId, "payload.resourceId"); p.action = enumValue(p.action, ["RELEASED", "REMOVED", "PRESERVED", "SKIPPED"], "payload.action")
    p.status = enumValue(p.status, ["SUCCEEDED", "FAILED", "NOT_SAFE"], "payload.status"); p.resultContentHash = hash(p.resultContentHash, "payload.resultContentHash")
  } else if (type === "FAILURE") {
    p.failureClass = enumValue(p.failureClass, FAILURE_CLASSES, "payload.failureClass"); p.reasonCode = identifier(p.reasonCode, "payload.reasonCode"); p.lifecycleState = enumValue(p.lifecycleState, CANONICAL_LIFECYCLE_STATES, "payload.lifecycleState")
    p.attempt = integer(p.attempt, "payload.attempt"); if (typeof p.terminal !== "boolean") wall("EVIDENCE_LEDGER_VALUE_WALL", "payload.terminal"); p.detailContentHash = hash(p.detailContentHash, "payload.detailContentHash")
    if (p.terminal !== TERMINAL_LIFECYCLE_STATES.includes(p.lifecycleState)) wall("EVIDENCE_LEDGER_SEMANTIC_WALL", "payload.terminal")
  } else if (type === "OWNER_CONTACT") {
    p.contactClass = enumValue(p.contactClass, ["GENUINE_AUTHORITY_DECISION", "PROHIBITED_ROUTINE"], "payload.contactClass")
    p.authorityGap = normalizeAuthorityGap(p.authorityGap, "payload.authorityGap"); p.decisionId = p.decisionId === null ? null : identifier(p.decisionId, "payload.decisionId")
    p.touchKinds = stableStrings(p.touchKinds, "payload.touchKinds", Object.keys(OWNER_KIND_TO_COUNTER))
    if (p.contactClass === "GENUINE_AUTHORITY_DECISION") {
      if (p.touchKinds.length !== 0 || p.decisionId === null) wall("EVIDENCE_OWNER_CONTACT_WALL", "payload")
      try {
        classifyLifecycleFailure({ schemaVersion: 1, failureClass: "OWNER_AUTHORITY_GAP", reasonCode: "OWNER_AUTHORITY_GAP", attemptsUsed: 0, maxAttempts: 0, reroutesUsed: 0, maxReroutes: 0, compatibleHealthyProviders: [], portfolioHealthyProviders: [], authorityGap: p.authorityGap })
      } catch { wall("EVIDENCE_OWNER_CONTACT_WALL", "payload.authorityGap") }
    } else {
      if (p.touchKinds.length === 0 || p.decisionId !== null || p.authorityGap.present || p.authorityGap.condition !== null || p.authorityGap.conditionRef !== null) wall("EVIDENCE_OWNER_CONTACT_WALL", "payload")
      if (!p.touchKinds.includes("ROUTINE_CONTACT")) p.touchKinds = [...p.touchKinds, "ROUTINE_CONTACT"].sort()
    }
  }
  return Object.freeze(p)
}
function ownerDelta(type, payload) {
  const counters = zeroCounters()
  if (type === "OWNER_CONTACT" && payload.contactClass === "PROHIBITED_ROUTINE") {
    for (const kind of payload.touchKinds) counters[OWNER_KIND_TO_COUNTER[kind]] += 1
  }
  return Object.freeze(counters)
}
function normalizeExpectedHead(value) {
  if (value === null) return null
  exact(value, ["eventCount", "headEventHash"], "expectedHead")
  return Object.freeze({ eventCount: integer(value.eventCount, "expectedHead.eventCount"), headEventHash: value.headEventHash === null ? null : hash(value.headEventHash, "expectedHead.headEventHash") })
}
function normalizeRequest(input) {
  exact(input, REQUEST_FIELDS, "request")
  if (input.schemaVersion !== 1 || input.artifactType !== "MULTI_AGENT_EVIDENCE_APPEND_REQUEST") wall("EVIDENCE_LEDGER_SCHEMA_WALL", "request")
  if (!UUID_V4.test(input.eventId ?? "")) wall("EVIDENCE_EVENT_ID_WALL", "eventId")
  if (!EVIDENCE_EVENT_TYPES.includes(input.eventType)) wall("EVIDENCE_LEDGER_VALUE_WALL", "eventType")
  if (input.sanitized !== true || input.rawAuthMaterialIncluded !== false || input.rawProviderOutputIncluded !== false) wall("EVIDENCE_SANITIZATION_WALL", "request.flags")
  const scope = normalizeScope(input.scope); const writer = normalizeWriter(input.writer); const leaseAttribution = normalizeLease(input.leaseAttribution)
  if (scope.workOrderId !== leaseAttribution.workOrderId || scope.laneId !== leaseAttribution.laneId || writer.writerId !== leaseAttribution.workerId) wall("EVIDENCE_WRITER_ATTRIBUTION_WALL", "leaseAttribution")
  const payload = normalizePayload(input.eventType, input.payload)
  if (input.eventType === "WORKER" && payload.workerId !== writer.writerId) wall("EVIDENCE_WRITER_ATTRIBUTION_WALL", "payload.workerId")
  if (input.eventType === "PROVIDER" && writer.writerKind === "PROVIDER_ADAPTER" && (payload.providerId !== writer.providerId || payload.adapterId !== writer.adapterId)) wall("EVIDENCE_WRITER_ATTRIBUTION_WALL", "payload.providerId")
  return Object.freeze({
    schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_APPEND_REQUEST", eventId: input.eventId.toLowerCase(),
    occurredAt: new Date(instant(input.occurredAt, "occurredAt")).toISOString(), eventType: input.eventType,
    scope, writer, leaseAttribution, payload, sourceRefs: normalizeRefs(input.sourceRefs), sanitized: true,
    rawAuthMaterialIncluded: false, rawProviderOutputIncluded: false, expectedHead: normalizeExpectedHead(input.expectedHead),
  })
}
function requestIdentity(request) {
  const identity = { ...request }
  delete identity.expectedHead
  return identity
}
function rejectHolderMaterial(value, holderDigests, field = "event", depth = 0) {
  if (depth > 12) wall("EVIDENCE_HOLDER_MATERIAL_WALL", field)
  if (typeof value === "string") {
    const valueDigest = sha(value)
    if (holderDigests.some((holderDigest) => sameHash(valueDigest, holderDigest))) {
      wall("EVIDENCE_HOLDER_MATERIAL_WALL", field)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectHolderMaterial(entry, holderDigests, `${field}[${index}]`, depth + 1))
    return
  }
  if (plainObject(value)) {
    Object.keys(value).sort().forEach((key, index) => {
      rejectHolderMaterial(key, holderDigests, `${field}{key:${index}}`, depth + 1)
      rejectHolderMaterial(value[key], holderDigests, `${field}{value:${index}}`, depth + 1)
    })
  }
}

function commonResult(status, detail = {}) {
  return Object.freeze({ schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_LEDGER_RESULT", status, ...detail, localContractOnly: true, providerDispatchPerformed: false, networkCallPerformed: false, authorityGranted: false, rawAuthMaterialPersisted: false, rawProviderOutputPersisted: false })
}
function wallResult(error) {
  const typed = error instanceof EvidenceLedgerError ? error : new EvidenceLedgerError("EVIDENCE_LEDGER_IO_WALL")
  return commonResult(typed.code, { ok: false, reasonCodes: Object.freeze([typed.code]), ...(typed.field ? { field: typed.field } : {}), ...(typed.detail ? { detail: typed.detail } : {}) })
}
function confirmedDeadProcess(pid) {
  try { process.kill(pid, 0); return false } catch (error) { return error?.code === "ESRCH" }
}
function staleLock(lockPath, staleAfterMs) {
  try {
    const stat = fs.lstatSync(lockPath)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false
    if (Date.now() - stat.mtimeMs < staleAfterMs) return false
    const owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"))
    if (!plainObject(owner)
      || Object.keys(owner).sort().join(",") !== "createdAt,hostname,pid"
      || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.pid > 2_147_483_647
      || typeof owner.hostname !== "string" || owner.hostname !== os.hostname()
      || typeof owner.createdAt !== "string") return false
    const createdAt = Date.parse(owner.createdAt)
    if (!Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== owner.createdAt
      || Date.now() - createdAt < staleAfterMs) return false
    return confirmedDeadProcess(owner.pid)
  } catch { return false }
}
function acquireLock(ledgerDir, options) {
  const lockPath = `${ledgerDir}.lock`; const timeout = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS; const stale = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS; const started = Date.now()
  fs.mkdirSync(path.dirname(ledgerDir), { recursive: true, mode: 0o700 })
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 })
      try {
        fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, hostname: os.hostname(), createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 })
      } catch {
        try { fs.rmSync(lockPath, { recursive: true, force: true }) } catch { /* fail closed below */ }
        wall("EVIDENCE_LEDGER_LOCK_WALL")
      }
      return () => fs.rmSync(lockPath, { recursive: true, force: true })
    } catch (error) {
      if (error?.code !== "EEXIST") wall("EVIDENCE_LEDGER_LOCK_WALL")
      if (staleLock(lockPath, stale)) {
        const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`
        try {
          fs.renameSync(lockPath, stalePath)
          fs.rmSync(stalePath, { recursive: true })
          continue
        } catch (renameError) {
          if (renameError?.code === "ENOENT") continue
          wall("EVIDENCE_LEDGER_LOCK_WALL")
        }
      }
      if (Date.now() - started >= timeout) wall("EVIDENCE_LEDGER_LOCK_TIMEOUT")
      Atomics.wait(WAIT_BUFFER, 0, 0, 10)
    }
  }
}
function locked(ledgerDir, options, fn) { let unlock; try { unlock = acquireLock(ledgerDir, options); return fn() } finally { if (unlock) unlock() } }
function fsyncDirectory(directory) { const handle = fs.openSync(directory, "r"); try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) } }
function durableNoClobber(filePath, content) {
  const parent = path.dirname(filePath); fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
  const temporary = path.join(path.dirname(parent), `.evidence-pending-${process.pid}-${crypto.randomUUID()}`)
  let handle
  try {
    handle = fs.openSync(temporary, "wx", 0o600); fs.writeFileSync(handle, content, "utf8"); fs.fsyncSync(handle); fs.closeSync(handle); handle = null
    fs.linkSync(temporary, filePath); fs.unlinkSync(temporary); fsyncDirectory(parent); if (path.dirname(parent) !== parent) fsyncDirectory(path.dirname(parent))
  } catch (error) {
    if (handle) try { fs.closeSync(handle) } catch { /* typed wall below */ }
    try { fs.rmSync(temporary, { force: true }) } catch { /* typed wall below */ }
    if (error?.code === "EEXIST") wall("EVIDENCE_LEDGER_NO_CLOBBER_WALL")
    wall("EVIDENCE_LEDGER_IO_WALL")
  }
}
function manifestPayload(ledgerId, createdAt) { return { schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_LEDGER_MANIFEST", ledgerId, createdAt, canonicalization: "WILLIAMOS-CANONICAL-JSON-V1", hashAlgorithm: "SHA-256" } }
function createManifest(ledgerDir, ledgerId, now, holderDigests) {
  fs.mkdirSync(ledgerDir, { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(ledgerDir, "events"), { recursive: true, mode: 0o700 })
  const payload = manifestPayload(ledgerId, new Date(now).toISOString()); const manifest = { ...payload, manifestHash: digestObject(payload) }
  rejectHolderMaterial(manifest, holderDigests, "manifest")
  durableNoClobber(path.join(ledgerDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`); return manifest
}
function readJson(file, code = "EVIDENCE_LEDGER_CORRUPT") { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { wall(code) } }
function requireRegularFile(file, field) {
  try { if (!fs.lstatSync(file).isFile()) wall("EVIDENCE_LEDGER_CORRUPT", field) } catch (error) {
    if (error instanceof EvidenceLedgerError) throw error
    wall("EVIDENCE_LEDGER_CORRUPT", field)
  }
}
function validateManifest(raw, ledgerId) {
  exact(raw, ["schemaVersion", "artifactType", "ledgerId", "createdAt", "canonicalization", "hashAlgorithm", "manifestHash"], "manifest")
  if (raw.schemaVersion !== 1 || raw.artifactType !== "MULTI_AGENT_EVIDENCE_LEDGER_MANIFEST" || raw.ledgerId !== ledgerId || raw.canonicalization !== "WILLIAMOS-CANONICAL-JSON-V1" || raw.hashAlgorithm !== "SHA-256") wall("EVIDENCE_LEDGER_CORRUPT", "manifest")
  instant(raw.createdAt, "manifest.createdAt"); hash(raw.manifestHash, "manifest.manifestHash")
  const { manifestHash, ...payload } = raw
  if (digestObject(payload) !== manifestHash) wall("EVIDENCE_LEDGER_CORRUPT", "manifest.manifestHash")
  return raw
}
function anchorFor(manifest, events) {
  const last = events.at(-1)
  return Object.freeze({ schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_LEDGER_ANCHOR", ledgerId: manifest.ledgerId, manifestHash: manifest.manifestHash, eventCount: events.length, headEventId: last?.eventId ?? null, headEventHash: last?.eventHash ?? null })
}
function normalizeAnchor(value, field = "expectedAnchor") {
  exact(value, ["schemaVersion", "artifactType", "ledgerId", "manifestHash", "eventCount", "headEventId", "headEventHash"], field)
  if (value.schemaVersion !== 1 || value.artifactType !== "MULTI_AGENT_EVIDENCE_LEDGER_ANCHOR") wall("EVIDENCE_LEDGER_ANCHOR_WALL", field)
  const eventCount = integer(value.eventCount, `${field}.eventCount`)
  if ((eventCount === 0) !== (value.headEventId === null && value.headEventHash === null)) wall("EVIDENCE_LEDGER_ANCHOR_WALL", field)
  return { ...value, ledgerId: identifier(value.ledgerId, `${field}.ledgerId`), manifestHash: hash(value.manifestHash, `${field}.manifestHash`), headEventId: value.headEventId === null ? null : identifier(value.headEventId, `${field}.headEventId`, UUID_V4_LOWER), headEventHash: value.headEventHash === null ? null : hash(value.headEventHash, `${field}.headEventHash`) }
}
function validateStoredEvent(raw, index, previousHash, manifest) {
  exact(raw, EVENT_FIELDS, `event[${index}]`)
  if (raw.schemaVersion !== 1 || raw.artifactType !== "MULTI_AGENT_EVIDENCE_EVENT" || raw.ledgerId !== manifest.ledgerId || raw.manifestHash !== manifest.manifestHash || raw.sequence !== index + 1 || raw.previousEventHash !== previousHash || raw.authorityGranted !== false || raw.sanitized !== true || raw.rawAuthMaterialIncluded !== false || raw.rawProviderOutputIncluded !== false) wall("EVIDENCE_LEDGER_CORRUPT", `event[${index}]`)
  if (!UUID_V4_LOWER.test(raw.eventId ?? "")) wall("EVIDENCE_LEDGER_CORRUPT", `event[${index}].eventId`)
  if (!EVIDENCE_EVENT_TYPES.includes(raw.eventType)) wall("EVIDENCE_LEDGER_CORRUPT", `event[${index}].eventType`)
  instant(raw.occurredAt, `event[${index}].occurredAt`); instant(raw.recordedAt, `event[${index}].recordedAt`)
  const scope = normalizeScope(raw.scope); const writer = normalizeWriter(raw.writer); const leaseAttribution = normalizeLease(raw.leaseAttribution); const payload = normalizePayload(raw.eventType, raw.payload); const sourceRefs = normalizeRefs(raw.sourceRefs)
  if (scope.workOrderId !== leaseAttribution.workOrderId || scope.laneId !== leaseAttribution.laneId || writer.writerId !== leaseAttribution.workerId) wall("EVIDENCE_LEDGER_CORRUPT", `event[${index}].attribution`)
  const normalized = { schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_APPEND_REQUEST", eventId: raw.eventId, occurredAt: raw.occurredAt, eventType: raw.eventType, scope, writer, leaseAttribution, payload, sourceRefs, sanitized: true, rawAuthMaterialIncluded: false, rawProviderOutputIncluded: false }
  if (raw.requestDigest !== digestObject(normalized)) wall("EVIDENCE_LEDGER_CORRUPT", `event[${index}].requestDigest`)
  const delta = ownerDelta(raw.eventType, payload); exact(raw.ownerCounterDelta, OWNER_TOUCH_COUNTERS, `event[${index}].ownerCounterDelta`)
  if (canonicalJson(raw.ownerCounterDelta) !== canonicalJson(delta)) wall("EVIDENCE_LEDGER_CORRUPT", `event[${index}].ownerCounterDelta`)
  hash(raw.eventHash, `event[${index}].eventHash`); const { eventHash, ...withoutHash } = raw
  if (digestObject(withoutHash) !== eventHash) wall("EVIDENCE_LEDGER_CORRUPT", `event[${index}].eventHash`)
  return raw
}
function loadVerified(ledgerDir, ledgerId) {
  const manifestPath = path.join(ledgerDir, "manifest.json"); if (!fs.existsSync(manifestPath)) wall("EVIDENCE_LEDGER_NOT_FOUND")
  requireRegularFile(manifestPath, "manifest")
  let manifest
  try { manifest = validateManifest(readJson(manifestPath), ledgerId) } catch (error) {
    if (error instanceof EvidenceLedgerError && error.code === "EVIDENCE_LEDGER_CORRUPT") throw error
    wall("EVIDENCE_LEDGER_CORRUPT", "manifest")
  }
  const eventDir = path.join(ledgerDir, "events")
  let names; try { names = fs.readdirSync(eventDir).sort() } catch { wall("EVIDENCE_LEDGER_CORRUPT", "events") }
  const events = []; const ids = new Set(); let previous = null; let priorRecorded = instant(manifest.createdAt, "manifest.createdAt")
  for (let index = 0; index < names.length; index += 1) {
    const match = /^(\d{12})-([0-9a-f-]{36})\.json$/.exec(names[index]); if (!match || Number(match[1]) !== index + 1) wall("EVIDENCE_LEDGER_CORRUPT", "event-filename")
    const eventPath = path.join(eventDir, names[index]); requireRegularFile(eventPath, `event[${index}]`)
    let event
    try { event = validateStoredEvent(readJson(eventPath), index, previous, manifest) } catch (error) {
      if (error instanceof EvidenceLedgerError && error.code === "EVIDENCE_LEDGER_CORRUPT") throw error
      wall("EVIDENCE_LEDGER_CORRUPT", `event[${index}]`)
    }
    if (event.eventId !== match[2] || ids.has(event.eventId)) wall("EVIDENCE_LEDGER_CORRUPT", "event-identity")
    const recorded = instant(event.recordedAt, "event.recordedAt"); if (recorded < priorRecorded || instant(event.occurredAt, "event.occurredAt") > recorded) wall("EVIDENCE_LEDGER_CORRUPT", "event-time")
    ids.add(event.eventId); events.push(event); previous = event.eventHash; priorRecorded = recorded
  }
  return { manifest, events, anchor: anchorFor(manifest, events) }
}
function verifyAnchor(actual, expected) {
  if (expected === null) return false
  const normalized = normalizeAnchor(expected)
  if (canonicalJson(actual) !== canonicalJson(normalized)) wall("EVIDENCE_LEDGER_ANCHOR_WALL")
  return true
}
function validateLeaseBinding(request, options, now) {
  if (typeof options.leaseStorePath !== "string" || !options.leaseStorePath || request.leaseAttribution.storeId !== options.leaseStoreId) wall("EVIDENCE_LEASE_ATTRIBUTION_WALL", "leaseStore")
  const inspected = inspectLaneLeaseStore(options.leaseStorePath, options.leaseStoreId)
  if (!inspected.ok) wall("EVIDENCE_LEASE_ATTRIBUTION_WALL", "leaseStore", inspected.status)
  const holderDigests = inspected.lanes.map((candidate) => candidate.holderTokenDigest)
  if (holderDigests.length === 0 || holderDigests.some((candidate) => !HASH.test(candidate))) wall("EVIDENCE_LEASE_ATTRIBUTION_WALL", "leaseStore")
  rejectHolderMaterial(requestIdentity(request), holderDigests)
  const lane = inspected.lanes.find((candidate) => candidate.workOrderId === request.scope.workOrderId && candidate.laneId === request.scope.laneId)
  if (!lane || lane.status !== "ACTIVE" || lane.workerId !== request.writer.writerId || lane.workerId !== request.leaseAttribution.workerId || lane.fencingToken !== request.leaseAttribution.fencingToken || lane.checkpointSequence !== request.leaseAttribution.checkpointSequence || Date.parse(lane.expiresAt) <= now || digestObject(lane.checkpointEvidence) !== request.leaseAttribution.checkpointEvidenceHash) wall("EVIDENCE_LEASE_ATTRIBUTION_WALL", "leaseAttribution")
  return holderDigests
}

export function appendEvidenceEvent(ledgerDir, ledgerId, input, options = {}) {
  try {
    identifier(ledgerId, "ledgerId"); if (typeof ledgerDir !== "string" || !ledgerDir || ledgerDir.includes("\0")) wall("EVIDENCE_LEDGER_CONFIGURATION_WALL")
    const request = normalizeRequest(input); const now = options.now?.() ?? Date.now(); if (!Number.isSafeInteger(now) || now < 0) wall("EVIDENCE_LEDGER_TIME_WALL", "now")
    if (instant(request.occurredAt, "occurredAt") > now) wall("EVIDENCE_LEDGER_TIME_WALL", "occurredAt", "FUTURE")
    return locked(ledgerDir, options, () => {
      const manifestPath = path.join(ledgerDir, "manifest.json")
      let holderDigests = null
      if (!fs.existsSync(manifestPath)) {
        holderDigests = validateLeaseBinding(request, options, now)
        rejectHolderMaterial(ledgerId, holderDigests, "ledgerId")
        createManifest(ledgerDir, ledgerId, now, holderDigests)
      }
      const state = loadVerified(ledgerDir, ledgerId); const requestDigest = digestObject(requestIdentity(request))
      const prior = state.events.find((event) => event.eventId === request.eventId)
      if (prior) {
        if (prior.requestDigest !== requestDigest) wall("EVIDENCE_EVENT_ID_REUSE_WALL", "eventId")
        return commonResult("EVIDENCE_EVENT_APPEND_IDEMPOTENT", { ok: true, idempotent: true, event: prior, headAnchor: state.anchor })
      }
      holderDigests ??= validateLeaseBinding(request, options, now)
      rejectHolderMaterial(ledgerId, holderDigests, "ledgerId")
      if (request.expectedHead !== null && (request.expectedHead.eventCount !== state.anchor.eventCount || request.expectedHead.headEventHash !== state.anchor.headEventHash)) wall("EVIDENCE_LEDGER_HEAD_CONFLICT", "expectedHead")
      const priorRecorded = state.events.at(-1)?.recordedAt ?? state.manifest.createdAt; if (now < Date.parse(priorRecorded)) wall("EVIDENCE_LEDGER_TIME_WALL", "now", "BACKWARD")
      const sequence = state.events.length + 1; const eventBase = {
        schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_EVENT", ledgerId, manifestHash: state.manifest.manifestHash,
        eventId: request.eventId, sequence, occurredAt: request.occurredAt, recordedAt: new Date(now).toISOString(), eventType: request.eventType,
        scope: request.scope, writer: request.writer, leaseAttribution: request.leaseAttribution, payload: request.payload,
        sourceRefs: request.sourceRefs, requestDigest, ownerCounterDelta: ownerDelta(request.eventType, request.payload), sanitized: true,
        rawAuthMaterialIncluded: false, rawProviderOutputIncluded: false, previousEventHash: state.anchor.headEventHash, authorityGranted: false,
      }
      rejectHolderMaterial(eventBase, holderDigests)
      const event = Object.freeze({ ...eventBase, eventHash: digestObject(eventBase) })
      rejectHolderMaterial(event, holderDigests)
      const name = `${String(sequence).padStart(12, "0")}-${event.eventId}.json`
      rejectHolderMaterial(name, holderDigests, "eventFilename")
      durableNoClobber(path.join(ledgerDir, "events", name), `${JSON.stringify(event, null, 2)}\n`)
      const headAnchor = anchorFor(state.manifest, [...state.events, event])
      return commonResult("EVIDENCE_EVENT_APPENDED", { ok: true, idempotent: false, event, headAnchor })
    })
  } catch (error) { return wallResult(error) }
}
function normalizeVerifyRequest(input, artifactType) {
  exact(input, ["schemaVersion", "artifactType", "expectedAnchor"], "request")
  if (input.schemaVersion !== 1 || input.artifactType !== artifactType) wall("EVIDENCE_LEDGER_SCHEMA_WALL", "request")
  return input.expectedAnchor === null ? null : normalizeAnchor(input.expectedAnchor)
}
export function verifyEvidenceLedger(ledgerDir, ledgerId, input, options = {}) {
  try {
    identifier(ledgerId, "ledgerId"); const expected = normalizeVerifyRequest(input, "MULTI_AGENT_EVIDENCE_VERIFY_REQUEST")
    return locked(ledgerDir, options, () => { const state = loadVerified(ledgerDir, ledgerId); const anchorVerified = verifyAnchor(state.anchor, expected); return commonResult("EVIDENCE_LEDGER_VALID", { ok: true, valid: true, eventCount: state.events.length, headAnchor: state.anchor, anchorVerified, independentlyAnchored: anchorVerified, certified: false }) })
  } catch (error) { return wallResult(error) }
}
export function inspectVerifiedEvidenceEvent(ledgerDir, ledgerId, input, options = {}) {
  try {
    identifier(ledgerId, "ledgerId")
    exact(input, ["schemaVersion", "artifactType", "eventId", "expectedAnchor"], "request")
    if (input.schemaVersion !== 1 || input.artifactType !== "MULTI_AGENT_EVIDENCE_EVENT_INSPECT_REQUEST") wall("EVIDENCE_LEDGER_SCHEMA_WALL", "request")
    const eventId = identifier(input.eventId, "eventId", UUID_V4_LOWER)
    const expected = input.expectedAnchor === null ? null : normalizeAnchor(input.expectedAnchor)
    return locked(ledgerDir, options, () => {
      const state = loadVerified(ledgerDir, ledgerId)
      const anchorVerified = verifyAnchor(state.anchor, expected)
      const event = state.events.find((candidate) => candidate.eventId === eventId)
      if (!event) wall("EVIDENCE_EVENT_NOT_FOUND_WALL", "eventId")
      return commonResult("EVIDENCE_EVENT_VERIFIED", { ok: true, valid: true, event: Object.freeze({ ...event }), headAnchor: state.anchor, anchorVerified, independentlyAnchored: anchorVerified })
    })
  } catch (error) { return wallResult(error) }
}
export function deriveOwnerTouchMeter(ledgerDir, ledgerId, input, options = {}) {
  try {
    identifier(ledgerId, "ledgerId"); const expected = normalizeVerifyRequest(input, "MULTI_AGENT_OWNER_TOUCH_METER_REQUEST")
    return locked(ledgerDir, options, () => {
      const state = loadVerified(ledgerDir, ledgerId); const anchorVerified = verifyAnchor(state.anchor, expected); const counters = zeroCounters()
      for (const event of state.events) for (const name of OWNER_TOUCH_COUNTERS) counters[name] += event.ownerCounterDelta[name]
      const assessment = evaluateOwnerOperationCounters(counters)
      return commonResult("OWNER_TOUCH_METER_VALID", { ok: true, valid: true, counters: Object.freeze(counters), lifecycleState: assessment.lifecycleState, reasonCode: assessment.reasonCode, eventCount: state.events.length, evidenceHeadHash: state.anchor.headEventHash, headAnchor: state.anchor, anchorVerified, independentlyAnchored: anchorVerified, certified: false })
    })
  } catch (error) { return wallResult(error) }
}
