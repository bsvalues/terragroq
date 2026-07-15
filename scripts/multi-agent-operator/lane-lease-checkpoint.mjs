import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  allowedLifecycleTransitions,
  CANONICAL_LIFECYCLE_STATES,
  TERMINAL_LIFECYCLE_STATES,
  transitionLifecycle,
} from "./lifecycle-state-machine.mjs"

const STORE_SCHEMA_VERSION = 1
const STORE_ARTIFACT_TYPE = "MULTI_AGENT_LANE_LEASE_CHECKPOINT_STORE"
const RESULT_ARTIFACT_TYPE = "MULTI_AGENT_LANE_LEASE_CHECKPOINT_RESULT"
const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4))
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_STALE_LOCK_MS = 30_000
const MIN_LEASE_MS = 100
const MAX_LEASE_MS = 86_400_000
const MAX_CLOCK_MS = 8_640_000_000_000_000 - MAX_LEASE_MS
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/
const DIGEST = /^[a-f0-9]{64}$/
const STATES = new Set(CANONICAL_LIFECYCLE_STATES)
const TERMINAL_STATES = new Set(TERMINAL_LIFECYCLE_STATES)
const LEASE_STATUSES = new Set(["ACTIVE", "RELEASED", "EXPIRED"])
const OPERATION_TYPES = new Set(["ACQUIRE", "RECLAIM", "RENEW", "HEARTBEAT", "CHECKPOINT", "RELEASE", "EXPIRE", "SETTLE_TERMINAL"])
const OPERATION_STATUS = Object.freeze({
  ACQUIRE: "LANE_LEASE_ACQUIRED",
  RECLAIM: "LANE_LEASE_RECLAIMED",
  RENEW: "LANE_LEASE_RENEWED",
  HEARTBEAT: "LANE_LEASE_HEARTBEAT_RECORDED",
  CHECKPOINT: "LANE_CHECKPOINT_WRITTEN",
  RELEASE: "LANE_LEASE_RELEASED",
  EXPIRE: "LANE_LEASE_EXPIRED_RECORDED",
  SETTLE_TERMINAL: "LANE_LEASE_EXPIRED_TERMINAL_RELEASED",
})
const EVIDENCE_ANCHOR_FIELDS = Object.freeze(["evidenceLedgerId", "eventCount", "headEventHash", "manifestHash"])
const SENSITIVE_KEY_ALIASES = Object.freeze([
  "authorization", "authheader", "credential", "credentials", "cookie", "cookies",
  "apikey", "accesskey", "privatekey", "clientsecret", "clienttoken", "password",
  "passwd", "pwd", "passphrase", "secret", "secrets", "session", "sessionid", "token",
  "accesstoken", "refreshtoken", "idtoken", "holder", "leaseholder", "otp", "rawoutput", "rawprovideroutput",
])
const SENSITIVE_ASSIGNMENT = /\b(?:api[\s_-]*key|access[\s_-]*key|private[\s_-]*key|client[\s_-]*secret|authorization|credential|cookie|password|passwd|pwd|passphrase|secret|session(?:[\s_-]*id)?|token|otp)\s*[:=]\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s"',;]+)/i
const FORBIDDEN_EVIDENCE_VALUE = /(-----BEGIN [A-Z ]*(?:PRIVATE KEY|CREDENTIALS)-----|\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/-]+=*|\b(?:sk-(?:proj|ant)-|sk_|gh[pousr]_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i

export class LaneLeaseCheckpointError extends Error {
  constructor(code, detail = null) {
    super(code)
    this.name = "LaneLeaseCheckpointError"
    this.code = code
    this.detail = detail
  }
}

function wall(code, detail = null) {
  throw new LaneLeaseCheckpointError(code, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, allowed, required = allowed) {
  if (!plainObject(value)) return false
  const keys = Object.keys(value)
  const allowedSet = new Set(allowed)
  return keys.every((key) => allowedSet.has(key))
    && required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function id(value) {
  return typeof value === "string" && IDENTIFIER.test(value) ? value : null
}

function idempotencyKey(value) {
  return typeof value === "string" && IDEMPOTENCY_KEY.test(value) ? value : null
}

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum
}

function instant(value) {
  if (typeof value !== "string") return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : null
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

function digest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex")
}

function sameDigest(left, right) {
  return DIGEST.test(left) && DIGEST.test(right)
    && crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}

function iso(now) {
  return new Date(now).toISOString()
}

function validateConfiguration(storePath, storeId) {
  if (typeof storePath !== "string" || storePath.trim() === "" || storePath.includes("\0") || id(storeId) === null) {
    wall("LANE_LEASE_CONFIGURATION_WALL")
  }
}

function mutationNow(options, store) {
  const now = options.now?.() ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_CLOCK_MS) wall("LANE_LEASE_CLOCK_WALL", "invalid-clock")
  if (store.updatedAt !== null && now < instant(store.updatedAt)) wall("LANE_LEASE_CLOCK_WALL", "backward-clock")
  return now
}

function ownerCounters() {
  return {
    ownerOperationTouchCount: 0,
    ownerCredentialTouchCount: 0,
    ownerDiagnosticTouchCount: 0,
    ownerRoutineDecisionCount: 0,
    ownerRoutineContactCount: 0,
  }
}

function result(status, detail = {}) {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: RESULT_ARTIFACT_TYPE,
    status,
    ...detail,
    localContractOnly: true,
    providerDispatchPerformed: false,
    networkCallPerformed: false,
    authorityGranted: false,
    rawHolderTokenPersisted: false,
    ...ownerCounters(),
  })
}

function wallResult(error) {
  const code = error instanceof LaneLeaseCheckpointError
    ? error.code
    : "LANE_LEASE_CHECKPOINT_IO_WALL"
  return result(code, {
    ok: false,
    reasonCodes: Object.freeze([code]),
    ...(error instanceof LaneLeaseCheckpointError && error.detail !== null ? { detail: error.detail } : {}),
  })
}

function sensitiveEvidenceKey(value) {
  const canonicalKey = value.toLowerCase().replace(/[^a-z0-9]/g, "")
  return SENSITIVE_KEY_ALIASES.some((alias) => canonicalKey.includes(alias))
}

function sanitizeEvidence(value, forbiddenValues = [], forbiddenDigests = [], depth = 0, key = null) {
  if (depth > 8) wall("CHECKPOINT_EVIDENCE_UNSAFE", "maximum-depth")
  if (key !== null && sensitiveEvidenceKey(key)) wall("CHECKPOINT_EVIDENCE_UNSAFE", `forbidden-key:${key}`)
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) wall("CHECKPOINT_EVIDENCE_UNSAFE", "non-finite-number")
    return value
  }
  if (typeof value === "string") {
    if (value.length > 4096 || value.includes("\0") || FORBIDDEN_EVIDENCE_VALUE.test(value) || SENSITIVE_ASSIGNMENT.test(value)
      || forbiddenValues.some((forbidden) => value.includes(forbidden))
      || forbiddenDigests.some((forbiddenDigest) => sameDigest(forbiddenDigest, digest(value)))) {
      wall("CHECKPOINT_EVIDENCE_UNSAFE", "forbidden-value")
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 128) wall("CHECKPOINT_EVIDENCE_UNSAFE", "maximum-array-length")
    return value.map((entry) => sanitizeEvidence(entry, forbiddenValues, forbiddenDigests, depth + 1))
  }
  if (!plainObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    wall("CHECKPOINT_EVIDENCE_UNSAFE", "plain-json-required")
  }
  const keys = Object.keys(value).sort()
  if (keys.length > 128) wall("CHECKPOINT_EVIDENCE_UNSAFE", "maximum-object-keys")
  return Object.fromEntries(keys.map((entryKey) => [entryKey, sanitizeEvidence(value[entryKey], forbiddenValues, forbiddenDigests, depth + 1, entryKey)]))
}

function validateEvidenceAnchors(value) {
  if (Array.isArray(value)) {
    for (const entry of value) validateEvidenceAnchors(entry)
  } else if (plainObject(value)) {
    const sanitized = value
    const fields = Object.keys(sanitized)
    const anchorPresent = fields.some((field) => EVIDENCE_ANCHOR_FIELDS.includes(field))
    if (anchorPresent && (!exactFields(sanitized, EVIDENCE_ANCHOR_FIELDS)
      || id(sanitized.evidenceLedgerId) === null
      || !integer(sanitized.eventCount, 1)
      || !DIGEST.test(sanitized.headEventHash)
      || !DIGEST.test(sanitized.manifestHash))) {
      wall("CHECKPOINT_EVIDENCE_ANCHOR_INVALID")
    }
    if (!anchorPresent) for (const entry of Object.values(sanitized)) validateEvidenceAnchors(entry)
  }
}

function validateEvidence(value, forbiddenValues = [], forbiddenDigests = []) {
  const sanitized = sanitizeEvidence(value, forbiddenValues, forbiddenDigests)
  if (Buffer.byteLength(canonical(sanitized), "utf8") > 64 * 1024) wall("CHECKPOINT_EVIDENCE_UNSAFE", "maximum-bytes")
  validateEvidenceAnchors(sanitized)
  return sanitized
}

function emptyStore(storeId) {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    artifactType: STORE_ARTIFACT_TYPE,
    storeId,
    version: 0,
    nextFencingToken: 1,
    updatedAt: null,
    lanes: [],
    operations: [],
    localContractOnly: true,
    authorityGranted: false,
  }
}

function validateCheckpoint(raw) {
  if (!exactFields(raw, ["sequence", "lifecycleState", "recordedAt", "evidence"])
    || !integer(raw.sequence, 1)
    || !STATES.has(raw.lifecycleState)
    || instant(raw.recordedAt) === null) wall("LANE_LEASE_STORE_CORRUPT", "invalid-checkpoint")
  return { ...raw, evidence: validateEvidence(raw.evidence) }
}

function validateLane(raw, storeVersion) {
  if (!exactFields(raw, [
    "workOrderId", "laneId", "workerId", "generation", "status", "holderTokenDigest", "fencingToken",
    "acquiredAt", "renewedAt", "heartbeatAt", "expiresAt", "releasedAt", "expiredAt", "checkpoint",
  ])
    || id(raw.workOrderId) === null || id(raw.laneId) === null || id(raw.workerId) === null
    || !integer(raw.generation, 1) || !LEASE_STATUSES.has(raw.status)
    || !DIGEST.test(raw.holderTokenDigest) || !integer(raw.fencingToken, 1)
    || raw.fencingToken > storeVersion || instant(raw.acquiredAt) === null
    || instant(raw.renewedAt) === null || instant(raw.heartbeatAt) === null
    || instant(raw.expiresAt) === null
    || (raw.releasedAt !== null && instant(raw.releasedAt) === null)
    || (raw.expiredAt !== null && instant(raw.expiredAt) === null)) {
    wall("LANE_LEASE_STORE_CORRUPT", "invalid-lane")
  }
  const acquired = instant(raw.acquiredAt)
  const renewed = instant(raw.renewedAt)
  const heartbeat = instant(raw.heartbeatAt)
  const expires = instant(raw.expiresAt)
  if (acquired > renewed || acquired > heartbeat || renewed > expires) wall("LANE_LEASE_STORE_CORRUPT", "invalid-lane-time-order")
  if (raw.status === "ACTIVE" && (raw.releasedAt !== null || raw.expiredAt !== null || heartbeat > expires)) wall("LANE_LEASE_STORE_CORRUPT", "active-terminal-time")
  if (raw.status === "RELEASED" && (raw.releasedAt === null || raw.expiredAt !== null || raw.releasedAt !== raw.expiresAt)) wall("LANE_LEASE_STORE_CORRUPT", "release-time")
  if (raw.status === "EXPIRED" && (raw.expiredAt === null || raw.releasedAt !== null || instant(raw.expiredAt) < expires)) wall("LANE_LEASE_STORE_CORRUPT", "expiry-time")
  const checkpoint = validateCheckpoint(raw.checkpoint)
  if (checkpoint.sequence > storeVersion) wall("LANE_LEASE_STORE_CORRUPT", "checkpoint-sequence-ahead-of-store")
  return { ...raw, checkpoint }
}

function validateOperation(raw, storeVersion) {
  if (!exactFields(raw, [
    "idempotencyKey", "operation", "requestDigest", "workOrderId", "laneId", "workerId",
    "storeVersion", "fencingToken", "status", "recordedAt", "checkpointLifecycleState",
    "checkpointEvidenceHash", "checkpointRecordedAt", "checkpointTransition", "recoveryEvidence", "recoveryEvidenceHash",
    "leaseStatus", "expiresAt", "checkpointSequence", "lifecycleState",
  ])
    || idempotencyKey(raw.idempotencyKey) === null || !OPERATION_TYPES.has(raw.operation)
    || !DIGEST.test(raw.requestDigest) || id(raw.workOrderId) === null || id(raw.laneId) === null || id(raw.workerId) === null
    || !integer(raw.storeVersion, 1) || raw.storeVersion > storeVersion
    || !integer(raw.fencingToken, 1) || instant(raw.recordedAt) === null
    || raw.status !== OPERATION_STATUS[raw.operation]
    || !STATES.has(raw.checkpointLifecycleState) || !DIGEST.test(raw.checkpointEvidenceHash)
    || instant(raw.checkpointRecordedAt) === null
    || !["ACTIVE", "RELEASED", "EXPIRED"].includes(raw.leaseStatus)
    || instant(raw.expiresAt) === null || !integer(raw.checkpointSequence, 1)
    || !STATES.has(raw.lifecycleState) || raw.lifecycleState !== raw.checkpointLifecycleState) {
    wall("LANE_LEASE_STORE_CORRUPT", "invalid-operation")
  }
  if (raw.operation === "CHECKPOINT") {
    if (!exactFields(raw.checkpointTransition, ["from", "to", "reasonCode", "failureClass", "authorityGap"])) {
      wall("LANE_LEASE_STORE_CORRUPT", "invalid-checkpoint-transition")
    }
    try { transitionLifecycle(raw.checkpointTransition) } catch {
      wall("LANE_LEASE_STORE_CORRUPT", "invalid-checkpoint-transition")
    }
    if (raw.checkpointTransition.to !== raw.checkpointLifecycleState) wall("LANE_LEASE_STORE_CORRUPT", "checkpoint-transition-state-mismatch")
  } else if (raw.checkpointTransition !== null) {
    wall("LANE_LEASE_STORE_CORRUPT", "unexpected-checkpoint-transition")
  }
  if (raw.operation === "RECLAIM") {
    let recoveryEvidence
    try { recoveryEvidence = validateEvidence(raw.recoveryEvidence) } catch {
      wall("LANE_LEASE_STORE_CORRUPT", "invalid-recovery-evidence")
    }
    if (!DIGEST.test(raw.recoveryEvidenceHash)
      || digest(canonical(recoveryEvidence)) !== raw.recoveryEvidenceHash) {
      wall("LANE_LEASE_STORE_CORRUPT", "recovery-evidence-hash-mismatch")
    }
  } else if (raw.recoveryEvidence !== null || raw.recoveryEvidenceHash !== null) {
    wall("LANE_LEASE_STORE_CORRUPT", "unexpected-recovery-evidence")
  }
  return { ...raw }
}

function assertOperationSnapshot(operation, state) {
  if (operation.leaseStatus !== state.status || operation.expiresAt !== state.expiresAt
    || operation.checkpointSequence !== state.checkpointSequence
    || operation.lifecycleState !== state.checkpointLifecycleState) {
    wall("LANE_LEASE_STORE_CORRUPT", "operation-response-snapshot-mismatch")
  }
}

function validateOperationHistory(operations, lanes, storeVersion, updatedAt) {
  if (operations.length !== storeVersion) wall("LANE_LEASE_STORE_CORRUPT", "non-contiguous-operation-count")
  const reconstructed = new Map()
  const issuedFences = new Set()
  let nextIssuedFence = 1
  let priorTimestamp = null
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]
    if (operation.storeVersion !== index + 1) wall("LANE_LEASE_STORE_CORRUPT", "non-contiguous-operation-version")
    const timestamp = instant(operation.recordedAt)
    if ((priorTimestamp !== null && timestamp < priorTimestamp)
      || (updatedAt !== null && timestamp > instant(updatedAt))) {
      wall("LANE_LEASE_STORE_CORRUPT", "non-monotonic-operation-time")
    }
    priorTimestamp = timestamp
    const key = `${operation.workOrderId}\0${operation.laneId}`
    const prior = reconstructed.get(key)
    if (operation.operation === "ACQUIRE") {
      if (prior || operation.fencingToken !== nextIssuedFence || operation.checkpointLifecycleState !== "LEASED"
        || operation.checkpointRecordedAt !== operation.recordedAt) {
        wall("LANE_LEASE_STORE_CORRUPT", "invalid-acquire-history")
      }
      issuedFences.add(operation.fencingToken)
      nextIssuedFence += 1
      reconstructed.set(key, {
        status: "ACTIVE", fencingToken: operation.fencingToken, workerId: operation.workerId, generation: 1,
        acquiredAt: operation.recordedAt, renewedAt: operation.recordedAt, heartbeatAt: operation.recordedAt,
        expiresAt: operation.expiresAt, releasedAt: null, expiredAt: null, checkpointSequence: 1,
        checkpointLifecycleState: operation.checkpointLifecycleState,
        checkpointEvidenceHash: operation.checkpointEvidenceHash,
        checkpointRecordedAt: operation.checkpointRecordedAt,
      })
      assertOperationSnapshot(operation, reconstructed.get(key))
      continue
    }
    if (!prior) wall("LANE_LEASE_STORE_CORRUPT", "operation-without-lane")
    if (operation.operation === "RECLAIM") {
      if (prior.status !== "EXPIRED" || operation.fencingToken !== nextIssuedFence || issuedFences.has(operation.fencingToken)) {
        wall("LANE_LEASE_STORE_CORRUPT", "invalid-reclaim-history")
      }
      if (operation.checkpointLifecycleState !== prior.checkpointLifecycleState
        || operation.checkpointEvidenceHash !== prior.checkpointEvidenceHash
        || operation.checkpointRecordedAt !== prior.checkpointRecordedAt) {
        wall("LANE_LEASE_STORE_CORRUPT", "reclaim-checkpoint-mismatch")
      }
      issuedFences.add(operation.fencingToken)
      nextIssuedFence += 1
      reconstructed.set(key, {
        ...prior, status: "ACTIVE", fencingToken: operation.fencingToken, workerId: operation.workerId, generation: prior.generation + 1,
        acquiredAt: operation.recordedAt, renewedAt: operation.recordedAt, heartbeatAt: operation.recordedAt,
        expiresAt: operation.expiresAt, releasedAt: null, expiredAt: null,
      })
      assertOperationSnapshot(operation, reconstructed.get(key))
      continue
    }
    if (operation.operation === "SETTLE_TERMINAL") {
      if (prior.status !== "EXPIRED" || operation.fencingToken !== prior.fencingToken
        || operation.workerId !== prior.workerId || !TERMINAL_STATES.has(prior.checkpointLifecycleState)
        || operation.checkpointLifecycleState !== prior.checkpointLifecycleState
        || operation.checkpointEvidenceHash !== prior.checkpointEvidenceHash
        || operation.checkpointRecordedAt !== prior.checkpointRecordedAt) {
        wall("LANE_LEASE_STORE_CORRUPT", "invalid-expired-terminal-settlement-history")
      }
      prior.status = "RELEASED"
      prior.expiresAt = operation.expiresAt
      prior.releasedAt = operation.recordedAt
      prior.expiredAt = null
      assertOperationSnapshot(operation, prior)
      continue
    }
    if (prior.status !== "ACTIVE" || operation.fencingToken !== prior.fencingToken) {
      wall("LANE_LEASE_STORE_CORRUPT", "operation-on-inactive-lane")
    }
    if (operation.operation !== "EXPIRE" && operation.workerId !== prior.workerId) {
      wall("LANE_LEASE_STORE_CORRUPT", "operation-worker-mismatch")
    }
    if (operation.operation === "CHECKPOINT") {
      if (operation.checkpointTransition.from !== prior.checkpointLifecycleState
        || !allowedLifecycleTransitions(prior.checkpointLifecycleState).includes(operation.checkpointLifecycleState)
        || operation.checkpointRecordedAt !== operation.recordedAt) {
        wall("LANE_LEASE_STORE_CORRUPT", "checkpoint-history-transition-mismatch")
      }
      prior.checkpointLifecycleState = operation.checkpointLifecycleState
      prior.checkpointEvidenceHash = operation.checkpointEvidenceHash
      prior.checkpointRecordedAt = operation.checkpointRecordedAt
    } else if (operation.checkpointLifecycleState !== prior.checkpointLifecycleState
      || operation.checkpointEvidenceHash !== prior.checkpointEvidenceHash
      || operation.checkpointRecordedAt !== prior.checkpointRecordedAt) {
      wall("LANE_LEASE_STORE_CORRUPT", "operation-checkpoint-mismatch")
    }
    if (operation.operation === "RENEW") {
      prior.renewedAt = operation.recordedAt
      prior.expiresAt = operation.expiresAt
    }
    if (operation.operation === "HEARTBEAT") prior.heartbeatAt = operation.recordedAt
    if (operation.operation === "CHECKPOINT") prior.checkpointSequence += 1
    if (operation.operation === "RELEASE") {
      prior.status = "RELEASED"
      prior.expiresAt = operation.expiresAt
      prior.releasedAt = operation.recordedAt
    }
    if (operation.operation === "EXPIRE") {
      prior.status = "EXPIRED"
      prior.expiredAt = operation.recordedAt
    }
    assertOperationSnapshot(operation, prior)
  }
  if ((storeVersion === 0 && updatedAt !== null)
    || (storeVersion > 0 && operations.at(-1).recordedAt !== updatedAt)) {
    wall("LANE_LEASE_STORE_CORRUPT", "store-update-time-mismatch")
  }
  if (reconstructed.size !== lanes.length) wall("LANE_LEASE_STORE_CORRUPT", "lane-history-count-mismatch")
  for (const lane of lanes) {
    const state = reconstructed.get(`${lane.workOrderId}\0${lane.laneId}`)
    if (!state || state.status !== lane.status || state.fencingToken !== lane.fencingToken
      || state.workerId !== lane.workerId || state.generation !== lane.generation
      || state.acquiredAt !== lane.acquiredAt || state.renewedAt !== lane.renewedAt
      || state.heartbeatAt !== lane.heartbeatAt || state.releasedAt !== lane.releasedAt
      || state.expiredAt !== lane.expiredAt || state.checkpointSequence !== lane.checkpoint.sequence
      || state.checkpointLifecycleState !== lane.checkpoint.lifecycleState
      || state.checkpointEvidenceHash !== digest(canonical(lane.checkpoint.evidence))
      || state.checkpointRecordedAt !== lane.checkpoint.recordedAt) {
      wall("LANE_LEASE_STORE_CORRUPT", "lane-history-mismatch")
    }
    const updated = updatedAt === null ? null : instant(updatedAt)
    if (updated !== null && [lane.acquiredAt, lane.renewedAt, lane.heartbeatAt, lane.checkpoint.recordedAt]
      .some((value) => instant(value) > updated)) wall("LANE_LEASE_STORE_CORRUPT", "lane-time-ahead-of-store")
    if (lane.releasedAt !== null && instant(lane.releasedAt) > updated) wall("LANE_LEASE_STORE_CORRUPT", "release-time-ahead-of-store")
    if (lane.expiredAt !== null && instant(lane.expiredAt) > updated) wall("LANE_LEASE_STORE_CORRUPT", "expiry-time-ahead-of-store")
  }
  return nextIssuedFence
}

function validateStore(raw, expectedStoreId) {
  if (!exactFields(raw, ["schemaVersion", "artifactType", "storeId", "version", "nextFencingToken", "updatedAt", "lanes", "operations", "localContractOnly", "authorityGranted"])
    || raw.schemaVersion !== STORE_SCHEMA_VERSION || raw.artifactType !== STORE_ARTIFACT_TYPE
    || id(raw.storeId) === null || raw.storeId !== expectedStoreId
    || !integer(raw.version) || !integer(raw.nextFencingToken, 1)
    || (raw.updatedAt !== null && instant(raw.updatedAt) === null)
    || !Array.isArray(raw.lanes) || !Array.isArray(raw.operations)
    || raw.localContractOnly !== true || raw.authorityGranted !== false) {
    wall("LANE_LEASE_STORE_CORRUPT", "invalid-store-schema")
  }
  const lanes = raw.lanes.map((entry) => validateLane(entry, raw.version))
  const operations = raw.operations.map((entry) => validateOperation(entry, raw.version))
  const laneKeys = lanes.map((entry) => `${entry.workOrderId}\0${entry.laneId}`)
  if (new Set(laneKeys).size !== laneKeys.length) wall("LANE_LEASE_STORE_CORRUPT", "duplicate-lane")
  if (new Set(operations.map((entry) => entry.idempotencyKey)).size !== operations.length) wall("LANE_LEASE_STORE_CORRUPT", "duplicate-idempotency-key")
  const fences = lanes.map((entry) => entry.fencingToken)
  if (new Set(fences).size !== fences.length) wall("LANE_LEASE_STORE_CORRUPT", "duplicate-fencing-token")
  const maxFence = [...fences, ...operations.map((entry) => entry.fencingToken)]
    .reduce((maximum, value) => Math.max(maximum, value), 0)
  const expectedNextFence = validateOperationHistory(operations, lanes, raw.version, raw.updatedAt)
  if (raw.nextFencingToken !== expectedNextFence || raw.nextFencingToken !== maxFence + 1) wall("LANE_LEASE_STORE_CORRUPT", "invalid-next-fencing-token")
  return { ...raw, lanes, operations }
}

function readStore(storePath, storeId, createIfMissing) {
  validateConfiguration(storePath, storeId)
  try {
    return validateStore(JSON.parse(fs.readFileSync(storePath, "utf8")), storeId)
  } catch (error) {
    if (error?.code === "ENOENT" && createIfMissing) return emptyStore(storeId)
    if (error?.code === "ENOENT") wall("LANE_LEASE_STORE_NOT_FOUND")
    if (error instanceof LaneLeaseCheckpointError) throw error
    if (error instanceof SyntaxError) wall("LANE_LEASE_STORE_CORRUPT", "invalid-json")
    wall("LANE_LEASE_CHECKPOINT_IO_WALL")
  }
}

function durableWrite(storePath, store) {
  const directory = path.dirname(storePath)
  const temporary = `${storePath}.tmp-${process.pid}-${crypto.randomUUID()}`
  let handle = null
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    handle = fs.openSync(temporary, "wx", 0o600)
    fs.writeFileSync(handle, `${JSON.stringify(store, null, 2)}\n`, "utf8")
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = null
    fs.renameSync(temporary, storePath)
    const directoryHandle = fs.openSync(directory, "r")
    try { fs.fsyncSync(directoryHandle) } finally { fs.closeSync(directoryHandle) }
  } catch {
    if (handle !== null) try { fs.closeSync(handle) } catch { /* typed wall wins */ }
    try { fs.rmSync(temporary, { force: true }) } catch { /* typed wall wins */ }
    wall("LANE_LEASE_CHECKPOINT_IO_WALL")
  }
}

function processAlive(pid) {
  if (!integer(pid, 1)) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === "EPERM" }
}

function staleLock(lockPath, staleAfterMs, now) {
  try {
    const stats = fs.statSync(lockPath)
    if (now - stats.mtimeMs < staleAfterMs) return false
    const owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"))
    return owner.hostname === os.hostname() && !processAlive(owner.pid)
  } catch { return true }
}

function acquireLock(storePath, options) {
  const lockPath = `${storePath}.lock`
  const timeoutMs = integer(options.lockTimeoutMs) ? options.lockTimeoutMs : DEFAULT_LOCK_TIMEOUT_MS
  const staleAfterMs = integer(options.staleLockMs) ? options.staleLockMs : DEFAULT_STALE_LOCK_MS
  const started = Date.now()
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 })
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 })
      fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
        pid: process.pid, hostname: os.hostname(), createdAt: iso(Date.now()), nonce: crypto.randomUUID(),
      }), { encoding: "utf8", mode: 0o600, flag: "wx" })
      return () => fs.rmSync(lockPath, { recursive: true, force: true })
    } catch (error) {
      if (error?.code !== "EEXIST") wall("LANE_LEASE_LOCK_WALL")
      if (staleLock(lockPath, staleAfterMs, Date.now())) {
        try {
          const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`
          fs.renameSync(lockPath, stalePath)
          fs.rmSync(stalePath, { recursive: true, force: true })
          continue
        } catch (staleError) { if (staleError?.code === "ENOENT") continue }
      }
      if (Date.now() - started >= timeoutMs) wall("LANE_LEASE_LOCK_TIMEOUT")
      Atomics.wait(WAIT_BUFFER, 0, 0, 10)
    }
  }
}

function locked(storePath, options, callback) {
  let unlock
  try { unlock = acquireLock(storePath, options); return callback() } finally { if (unlock) unlock() }
}

function validateCommon(request, artifactType, extraFields, requiredExtra = extraFields) {
  const base = ["schemaVersion", "artifactType", "workOrderId", "laneId", "workerId", "idempotencyKey", "expectedVersion"]
  if (!exactFields(request, [...base, ...extraFields], [...base.slice(0, 6), ...requiredExtra])
    || request.schemaVersion !== 1 || request.artifactType !== artifactType
    || id(request.workOrderId) === null || id(request.laneId) === null || id(request.workerId) === null
    || idempotencyKey(request.idempotencyKey) === null
    || (request.expectedVersion !== undefined && !integer(request.expectedVersion))) wall(`${artifactType}_INVALID`)
  return request
}

function holderRequest(request, artifactType, extraFields = [], requiredExtra = extraFields) {
  validateCommon(request, artifactType, ["holderToken", "fencingToken", ...extraFields], ["holderToken", "fencingToken", ...requiredExtra])
  if (typeof request.holderToken !== "string" || request.holderToken.length < 16 || request.holderToken.length > 4096 || request.holderToken.includes("\0")
    || !integer(request.fencingToken, 1)) wall(`${artifactType}_INVALID`)
  return { ...request, holderTokenDigest: digest(request.holderToken) }
}

function requestDigest(operation, request) {
  const safe = { ...request, holderToken: undefined, holderTokenDigest: request.holderTokenDigest ?? (request.holderToken ? digest(request.holderToken) : undefined) }
  return digest(canonical({ operation, ...safe }))
}

function idempotentResult(store, operation, request) {
  const prior = store.operations.find((entry) => entry.idempotencyKey === request.idempotencyKey)
  if (!prior) return null
  if (prior.operation !== operation || prior.requestDigest !== requestDigest(operation, request)) wall("IDEMPOTENCY_KEY_REUSE_WALL")
  return result(`${prior.status}_IDEMPOTENT`, {
    ok: true, workOrderId: prior.workOrderId, laneId: prior.laneId, workerId: prior.workerId,
    storeVersion: prior.storeVersion, fencingToken: prior.fencingToken,
    leaseStatus: prior.leaseStatus, expiresAt: prior.expiresAt,
    checkpointSequence: prior.checkpointSequence,
    lifecycleState: prior.lifecycleState,
    idempotent: true,
  })
}

function locate(store, request) {
  const lane = store.lanes.find((entry) => entry.workOrderId === request.workOrderId && entry.laneId === request.laneId)
  if (!lane) wall("LANE_LEASE_NOT_FOUND")
  return lane
}

function assertVersion(store, request) {
  if (request.expectedVersion !== undefined && request.expectedVersion !== store.version) wall("LANE_LEASE_VERSION_CONFLICT")
}

function assertHolder(lane, request) {
  if (lane.status !== "ACTIVE" || lane.workerId !== request.workerId || lane.fencingToken !== request.fencingToken || !sameDigest(lane.holderTokenDigest, request.holderTokenDigest)) {
    wall("LANE_LEASE_NOT_HOLDER")
  }
}

function assertNotExpired(lane, now) {
  if (instant(lane.expiresAt) <= now) wall("LANE_LEASE_EXPIRED")
}

function writeOperation(storePath, store, lane, operation, request, status, now) {
  const version = store.version + 1
  const recoveryEvidence = operation === "RECLAIM"
    ? validateEvidence(request.checkpointEvidence, [request.holderToken])
    : null
  const next = {
    ...store,
    version,
    updatedAt: iso(now),
    lanes: store.lanes.map((entry) => entry.workOrderId === lane.workOrderId && entry.laneId === lane.laneId ? lane : entry),
    operations: [...store.operations, {
      idempotencyKey: request.idempotencyKey,
      operation,
      requestDigest: requestDigest(operation, request),
      workOrderId: lane.workOrderId,
      laneId: lane.laneId,
      workerId: request.workerId,
      storeVersion: version,
      fencingToken: lane.fencingToken,
      status,
      recordedAt: iso(now),
      checkpointLifecycleState: lane.checkpoint.lifecycleState,
      checkpointEvidenceHash: digest(canonical(lane.checkpoint.evidence)),
      checkpointRecordedAt: lane.checkpoint.recordedAt,
      checkpointTransition: operation === "CHECKPOINT" ? request.transition : null,
      recoveryEvidence,
      recoveryEvidenceHash: recoveryEvidence === null ? null : digest(canonical(recoveryEvidence)),
      leaseStatus: lane.status,
      expiresAt: lane.expiresAt,
      checkpointSequence: lane.checkpoint.sequence,
      lifecycleState: lane.checkpoint.lifecycleState,
    }],
  }
  const validated = validateStore(next, store.storeId)
  durableWrite(storePath, validated)
  return result(status, {
    ok: true, workOrderId: lane.workOrderId, laneId: lane.laneId, workerId: lane.workerId,
    storeVersion: version, fencingToken: lane.fencingToken,
    leaseStatus: lane.status, expiresAt: lane.expiresAt,
    checkpointSequence: lane.checkpoint.sequence,
    lifecycleState: lane.checkpoint.lifecycleState,
    idempotent: false,
  })
}

function leaseDuration(value, code) {
  if (!integer(value, MIN_LEASE_MS) || value > MAX_LEASE_MS) wall(code)
  return value
}

function initialCheckpoint(evidence, now, holderToken) {
  return { sequence: 1, lifecycleState: "LEASED", recordedAt: iso(now), evidence: validateEvidence(evidence, [holderToken]) }
}

export function acquireLaneLease(storePath, storeId, request, options = {}) {
  try {
    validateConfiguration(storePath, storeId)
    validateCommon(request, "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST", ["holderToken", "leaseDurationMs", "checkpointEvidence"], ["holderToken", "leaseDurationMs", "checkpointEvidence"])
    if (typeof request.holderToken !== "string" || request.holderToken.length < 16 || request.holderToken.length > 4096 || request.holderToken.includes("\0")) wall("MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST_INVALID")
    leaseDuration(request.leaseDurationMs, "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST_INVALID")
    const normalized = { ...request, holderTokenDigest: digest(request.holderToken) }
    validateEvidence(request.checkpointEvidence, [request.holderToken])
    return locked(storePath, options, () => {
      const store = readStore(storePath, storeId, true)
      const prior = idempotentResult(store, "ACQUIRE", normalized)
      if (prior) return prior
      assertVersion(store, request)
      if (store.lanes.some((entry) => entry.workOrderId === request.workOrderId && entry.laneId === request.laneId)) wall("LANE_LEASE_ALREADY_EXISTS")
      const now = mutationNow(options, store)
      const fencingToken = store.nextFencingToken
      const lane = {
        workOrderId: request.workOrderId, laneId: request.laneId, workerId: request.workerId, generation: 1, status: "ACTIVE",
        holderTokenDigest: normalized.holderTokenDigest, fencingToken,
        acquiredAt: iso(now), renewedAt: iso(now), heartbeatAt: iso(now), expiresAt: iso(now + request.leaseDurationMs),
        releasedAt: null, expiredAt: null, checkpoint: initialCheckpoint(request.checkpointEvidence, now, request.holderToken),
      }
      const candidate = { ...store, nextFencingToken: fencingToken + 1, lanes: [...store.lanes, lane] }
      return writeOperation(storePath, candidate, lane, "ACQUIRE", normalized, "LANE_LEASE_ACQUIRED", now)
    })
  } catch (error) { return wallResult(error) }
}

export function reclaimLaneLease(storePath, storeId, request, options = {}) {
  try {
    validateConfiguration(storePath, storeId)
    validateCommon(request, "MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST", ["holderToken", "leaseDurationMs", "expectedFencingToken", "checkpointEvidence"], ["holderToken", "leaseDurationMs", "expectedFencingToken", "checkpointEvidence"])
    if (typeof request.holderToken !== "string" || request.holderToken.length < 16 || request.holderToken.length > 4096 || request.holderToken.includes("\0")
      || !integer(request.expectedFencingToken, 1)) wall("MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST_INVALID")
    leaseDuration(request.leaseDurationMs, "MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST_INVALID")
    validateEvidence(request.checkpointEvidence, [request.holderToken])
    const normalized = { ...request, holderTokenDigest: digest(request.holderToken) }
    return locked(storePath, options, () => {
      const store = readStore(storePath, storeId, false)
      validateEvidence(request.checkpointEvidence, [request.holderToken], store.lanes.map((lane) => lane.holderTokenDigest))
      const prior = idempotentResult(store, "RECLAIM", normalized)
      if (prior) return prior
      assertVersion(store, request)
      const existing = locate(store, request)
      const now = mutationNow(options, store)
      if (existing.fencingToken !== request.expectedFencingToken) wall("LANE_LEASE_FENCE_CONFLICT")
      if (existing.status !== "EXPIRED") wall("LANE_LEASE_RECLAIM_REQUIRES_DURABLE_EXPIRY")
      const expiryOperation = store.operations.findLast((entry) => entry.workOrderId === existing.workOrderId
        && entry.laneId === existing.laneId && entry.operation === "EXPIRE")
      if (!expiryOperation || expiryOperation.fencingToken !== existing.fencingToken
        || expiryOperation.status !== OPERATION_STATUS.EXPIRE) wall("LANE_LEASE_RECLAIM_REQUIRES_DURABLE_EXPIRY")
      if (TERMINAL_STATES.has(existing.checkpoint.lifecycleState)) wall("LANE_CHECKPOINT_TERMINAL_IMMUTABILITY_WALL")
      const fencingToken = store.nextFencingToken
      const lane = {
        workOrderId: existing.workOrderId, laneId: existing.laneId, workerId: request.workerId, generation: existing.generation + 1, status: "ACTIVE",
        holderTokenDigest: normalized.holderTokenDigest, fencingToken,
        acquiredAt: iso(now), renewedAt: iso(now), heartbeatAt: iso(now), expiresAt: iso(now + request.leaseDurationMs),
        releasedAt: null, expiredAt: null, checkpoint: existing.checkpoint,
      }
      const candidate = { ...store, nextFencingToken: fencingToken + 1 }
      return writeOperation(storePath, candidate, lane, "RECLAIM", normalized, "LANE_LEASE_RECLAIMED", now)
    })
  } catch (error) { return wallResult(error) }
}

export function renewLaneLease(storePath, storeId, request, options = {}) {
  return mutateHolder(storePath, storeId, request, options, "RENEW", "MULTI_AGENT_LANE_LEASE_RENEW_REQUEST", ["leaseDurationMs", "expectedExpiresAt"], (lane, normalized, now) => {
    leaseDuration(normalized.leaseDurationMs, "MULTI_AGENT_LANE_LEASE_RENEW_REQUEST_INVALID")
    if (instant(normalized.expectedExpiresAt) === null) wall("MULTI_AGENT_LANE_LEASE_RENEW_REQUEST_INVALID")
    if (lane.expiresAt !== normalized.expectedExpiresAt) wall("LANE_LEASE_EXPIRY_CONFLICT")
    const expiresAt = now + normalized.leaseDurationMs
    if (expiresAt <= instant(lane.expiresAt)) wall("LANE_LEASE_RENEWAL_NOT_EXTENDING")
    return { ...lane, renewedAt: iso(now), expiresAt: iso(expiresAt) }
  }, "LANE_LEASE_RENEWED")
}

export function heartbeatLaneLease(storePath, storeId, request, options = {}) {
  return mutateHolder(storePath, storeId, request, options, "HEARTBEAT", "MULTI_AGENT_LANE_LEASE_HEARTBEAT_REQUEST", ["expectedHeartbeatAt"], (lane, normalized, now) => {
    if (instant(normalized.expectedHeartbeatAt) === null) wall("MULTI_AGENT_LANE_LEASE_HEARTBEAT_REQUEST_INVALID")
    if (lane.heartbeatAt !== normalized.expectedHeartbeatAt) wall("LANE_LEASE_HEARTBEAT_CONFLICT")
    return { ...lane, heartbeatAt: iso(now) }
  }, "LANE_LEASE_HEARTBEAT_RECORDED")
}

function mutateHolder(storePath, storeId, request, options, operation, artifactType, extraFields, transform, status) {
  try {
    validateConfiguration(storePath, storeId)
    const normalized = holderRequest(request, artifactType, extraFields)
    return locked(storePath, options, () => {
      const store = readStore(storePath, storeId, false)
      const prior = idempotentResult(store, operation, normalized)
      if (prior) return prior
      assertVersion(store, request)
      const lane = locate(store, request)
      assertHolder(lane, normalized)
      const now = mutationNow(options, store)
      assertNotExpired(lane, now)
      return writeOperation(storePath, store, transform(lane, normalized, now), operation, normalized, status, now)
    })
  } catch (error) { return wallResult(error) }
}

export function checkpointLaneLease(storePath, storeId, request, options = {}) {
  return mutateHolder(storePath, storeId, request, options, "CHECKPOINT", "MULTI_AGENT_LANE_CHECKPOINT_REQUEST", ["expectedCheckpointSequence", "transition", "evidence"], (lane, normalized, now) => {
    if (!integer(normalized.expectedCheckpointSequence, 1) || normalized.expectedCheckpointSequence !== lane.checkpoint.sequence) wall("LANE_CHECKPOINT_SEQUENCE_CONFLICT")
    if (!exactFields(normalized.transition, ["from", "to", "reasonCode", "failureClass", "authorityGap"])) wall("MULTI_AGENT_LANE_CHECKPOINT_REQUEST_INVALID")
    if (normalized.transition.from !== lane.checkpoint.lifecycleState) wall("LANE_CHECKPOINT_STATE_CONFLICT")
    try { transitionLifecycle(normalized.transition) } catch (error) {
      if (error?.code === "LIFECYCLE_TERMINAL_IMMUTABILITY_WALL") wall("LANE_CHECKPOINT_TERMINAL_IMMUTABILITY_WALL")
      wall("LANE_CHECKPOINT_LIFECYCLE_WALL", error?.code ?? null)
    }
    if (TERMINAL_STATES.has(lane.checkpoint.lifecycleState)) wall("LANE_CHECKPOINT_TERMINAL_IMMUTABILITY_WALL")
    return {
      ...lane,
      checkpoint: { sequence: lane.checkpoint.sequence + 1, lifecycleState: normalized.transition.to, recordedAt: iso(now), evidence: validateEvidence(normalized.evidence, [normalized.holderToken]) },
    }
  }, "LANE_CHECKPOINT_WRITTEN")
}

export function releaseLaneLease(storePath, storeId, request, options = {}) {
  return mutateHolder(storePath, storeId, request, options, "RELEASE", "MULTI_AGENT_LANE_LEASE_RELEASE_REQUEST", [], (lane, _normalized, now) => ({
    ...lane, status: "RELEASED", releasedAt: iso(now), expiresAt: iso(now),
  }), "LANE_LEASE_RELEASED")
}

export function expireLaneLease(storePath, storeId, request, options = {}) {
  try {
    validateConfiguration(storePath, storeId)
    validateCommon(request, "MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST", ["expectedFencingToken"], ["expectedFencingToken"])
    if (!integer(request.expectedFencingToken, 1)) wall("MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST_INVALID")
    return locked(storePath, options, () => {
      const store = readStore(storePath, storeId, false)
      const prior = idempotentResult(store, "EXPIRE", request)
      if (prior) return prior
      assertVersion(store, request)
      const lane = locate(store, request)
      const now = mutationNow(options, store)
      if (lane.fencingToken !== request.expectedFencingToken) wall("LANE_LEASE_FENCE_CONFLICT")
      if (lane.status !== "ACTIVE") wall("LANE_LEASE_NOT_ACTIVE")
      if (instant(lane.expiresAt) > now) wall("LANE_LEASE_NOT_EXPIRED")
      const expired = { ...lane, status: "EXPIRED", expiredAt: iso(now) }
      return writeOperation(storePath, store, expired, "EXPIRE", request, "LANE_LEASE_EXPIRED_RECORDED", now)
    })
  } catch (error) { return wallResult(error) }
}

export function settleExpiredTerminalLaneLease(storePath, storeId, request, options = {}) {
  try {
    validateConfiguration(storePath, storeId)
    validateCommon(request, "MULTI_AGENT_LANE_LEASE_SETTLE_TERMINAL_REQUEST", [
      "holderToken", "expectedFencingToken", "expectedCheckpointSequence", "expectedLifecycleState", "expectedCheckpointEvidence",
    ])
    if (typeof request.holderToken !== "string" || request.holderToken.length < 16 || request.holderToken.length > 4096 || request.holderToken.includes("\0")
      || !integer(request.expectedFencingToken, 1) || !integer(request.expectedCheckpointSequence, 1)
      || !TERMINAL_STATES.has(request.expectedLifecycleState)) wall("MULTI_AGENT_LANE_LEASE_SETTLE_TERMINAL_REQUEST_INVALID")
    const expectedCheckpointEvidence = validateEvidence(request.expectedCheckpointEvidence, [request.holderToken])
    const normalized = { ...request, expectedCheckpointEvidence, holderTokenDigest: digest(request.holderToken) }
    return locked(storePath, options, () => {
      const store = readStore(storePath, storeId, false)
      const prior = idempotentResult(store, "SETTLE_TERMINAL", normalized)
      if (prior) return prior
      assertVersion(store, request)
      const lane = locate(store, request)
      const now = mutationNow(options, store)
      if (lane.workerId !== request.workerId || lane.fencingToken !== request.expectedFencingToken
        || !sameDigest(lane.holderTokenDigest, normalized.holderTokenDigest)) wall("LANE_LEASE_NOT_HOLDER")
      if (lane.status !== "EXPIRED" || !TERMINAL_STATES.has(lane.checkpoint.lifecycleState)) {
        wall("LANE_LEASE_EXPIRED_TERMINAL_SETTLEMENT_REQUIRED")
      }
      if (lane.checkpoint.sequence !== request.expectedCheckpointSequence
        || lane.checkpoint.lifecycleState !== request.expectedLifecycleState
        || canonical(lane.checkpoint.evidence) !== canonical(expectedCheckpointEvidence)) {
        wall("LANE_LEASE_EXPIRED_TERMINAL_SETTLEMENT_EVIDENCE_WALL")
      }
      const expiryOperation = store.operations.findLast((entry) => entry.workOrderId === lane.workOrderId
        && entry.laneId === lane.laneId && entry.operation === "EXPIRE")
      if (!expiryOperation || expiryOperation.fencingToken !== lane.fencingToken
        || expiryOperation.status !== OPERATION_STATUS.EXPIRE) wall("LANE_LEASE_RECLAIM_REQUIRES_DURABLE_EXPIRY")
      const settled = { ...lane, status: "RELEASED", releasedAt: iso(now), expiresAt: iso(now), expiredAt: null }
      return writeOperation(storePath, store, settled, "SETTLE_TERMINAL", normalized, OPERATION_STATUS.SETTLE_TERMINAL, now)
    })
  } catch (error) { return wallResult(error) }
}

export function inspectLaneLeaseStore(storePath, storeId) {
  try {
    validateConfiguration(storePath, storeId)
    const store = readStore(storePath, storeId, false)
    return result("LANE_LEASE_STORE_VALID", {
      ok: true, storeId, storeVersion: store.version, nextFencingToken: store.nextFencingToken,
      lanes: store.lanes.map((lane) => ({
        workOrderId: lane.workOrderId, laneId: lane.laneId, workerId: lane.workerId, generation: lane.generation,
        status: lane.status, holderTokenDigest: lane.holderTokenDigest, fencingToken: lane.fencingToken,
        expiresAt: lane.expiresAt, heartbeatAt: lane.heartbeatAt,
        checkpointSequence: lane.checkpoint.sequence, lifecycleState: lane.checkpoint.lifecycleState,
        checkpointEvidence: lane.checkpoint.evidence,
      })),
      recoveryEvents: store.operations.filter((operation) => operation.operation === "RECLAIM").map((operation) => ({
        workOrderId: operation.workOrderId,
        laneId: operation.laneId,
        workerId: operation.workerId,
        storeVersion: operation.storeVersion,
        fencingToken: operation.fencingToken,
        recoveryEvidence: operation.recoveryEvidence,
        recoveryEvidenceHash: operation.recoveryEvidenceHash,
      })),
      operationCount: store.operations.length,
    })
  } catch (error) { return wallResult(error) }
}
