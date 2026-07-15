import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { normalizeProviderCapability } from "./provider-contract.mjs"
import { validateProviderResponse } from "./provider-contract.mjs"
import { checkReservationCompatibility, normalizeReservationSet } from "./reservation-set.mjs"
import { isTerminalLifecycleState, transitionLifecycle } from "./lifecycle-state-machine.mjs"
import { resolveDagEligibleSet } from "./dag-eligible-resolver.mjs"
import { acquireReservations, inspectReservationLedger, releaseReservations } from "./reservation-ledger.mjs"
import {
  acquireLaneLease,
  checkpointLaneLease,
  expireLaneLease,
  inspectLaneLeaseStore,
  reclaimLaneLease,
  releaseLaneLease,
  settleExpiredTerminalLaneLease,
} from "./lane-lease-checkpoint.mjs"
import { appendEvidenceEvent, inspectVerifiedEvidenceEvent } from "./evidence-ledger.mjs"
import { loadCanonicalSchedulerTrustRecord } from "./scheduler-trust-registry.mjs"
import { acquireSchedulerLock, SchedulerLockLeaseError } from "./scheduler-lock-lease.mjs"

const HASH = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,191}$/
const RISKS = new Set(["R0", "R1", "R2", "R3"])
const TERMINAL_TRANSACTION_PHASES = new Set(["COMMITTED", "ROLLED_BACK", "SUPERSEDED_BY_REAP", "COMPENSATED"])
const TRUST_FIELDS = new Set([
  "schemaVersion", "artifactType", "artifactId", "issuer", "subject", "issuedAt", "expiresAt",
  "revoked", "priorHash", "evidenceHash", "signature",
])
const SUBJECT_FIELDS = new Set([
  "providerId", "adapterId", "workerId", "roles", "repositories", "actions",
])
const AUTHORITY_FIELDS = new Set([
  "schemaVersion", "artifactType", "grantId", "issuer", "programId", "goalId", "loopId",
  "workOrderId", "laneId", "providerId", "adapterId", "workerId", "role", "executionSurface",
  "schedulerRunId", "attempt", "configurationHash", "repositories", "riskClass", "actions",
  "reservationSetId", "reservationContentHash", "issuedAt", "expiresAt", "revoked",
  "trustArtifactHash", "signature",
])
const WORK_FIELDS = new Set([
  "schemaVersion", "artifactType", "programId", "goalId", "loopId", "workOrderId", "laneId",
  "providerId", "adapterId", "workerId", "requestedRole", "executionSurface", "schedulerRunId",
  "attempt", "configurationHash", "repositories", "riskClass", "allowedActions", "reservationSet",
  "reservationContentHash", "dispatchId", "trustArtifact", "authorityGrant",
])
const BUDGET_FIELDS = new Set(["global", "providers", "repositories", "risks", "combined"])
const BUNDLE_FIELDS = new Set([
  "schemaVersion", "artifactType", "bundleId", "issuedAt", "expiresAt", "status",
  "revocationChainHead", "trustRoots", "authorityRoots", "rootFingerprints",
  "workerProviderBindings", "signature",
])
const BUNDLE_REFERENCE_FIELDS = new Set(["registryId", "registryVersion"])
const TRUST_REGISTRY_ENTRY_FIELDS = new Set(["registryRecord", "pinnedRegistryRecordContentHash", "evaluationTime"])
const TRUST_REGISTRY_RECORD_FIELDS = new Set([
  "schemaVersion", "artifactType", "registryId", "registryVersion", "status", "immutable",
  "trustBundle", "signerPublicKeyPem", "signerFingerprint", "bundleContentHash",
  "statusEvents", "statusHeadHash", "maximumAgeMs",
])
const TRUST_STATUS_EVENT_FIELDS = new Set([
  "schemaVersion", "artifactType", "eventId", "sequence", "priorEventHash", "registryId",
  "registryVersion", "bundleId", "status", "issuedAt", "signature", "eventHash",
])
const BINDING_FIELDS = new Set(["workerId", "providerId", "adapterId", "executionSurfaces"])
const RECONCILIATION_PROOF_FIELDS = new Set([
  "schemaVersion", "artifactType", "proofId", "issuer", "ownerId", "schedulerRunId", "attempt",
  "fullIdentityHash", "schedulerFencingToken", "leaseFencingToken", "reservationFencingToken",
  "claimHash", "issuedAt", "expiresAt", "signature",
])
const SCHEDULER_CONFIGURATION_FIELDS = new Set([
  "statePath", "stateId", "trustBundleReference", "reservationLedgerPath", "reservationLedgerId",
  "leaseStorePath", "leaseStoreId", "evidenceLedgerDir", "evidenceLedgerId", "leaseTokenKey",
  "leaseDurationMs", "reconciliationBatchCeiling", "now", "lockTimeoutMs",
])
const SCHEDULER_CONFIGURATION_OPTIONAL_FIELDS = new Set(["failureInjector", "lockLeaseDurationMs", "lockHeartbeatIntervalMs"])
const OWNER_COUNTERS = Object.freeze({
  ownerOperationTouchCount: 0,
  ownerCredentialTouchCount: 0,
  ownerDiagnosticTouchCount: 0,
  ownerRoutineDecisionCount: 0,
  ownerRoutineContactCount: 0,
})
const SENSITIVE_KEY = /(authorization|credential|cookie|password|passwd|passphrase|secret|session|token|api.?key|private.?key|raw.?output)/i
const SENSITIVE_VALUE = /(bearer\s+[a-z0-9._~+/-]{8,}|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:gh[opsu]|github_pat)_[A-Za-z0-9_]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:password|token|secret|api.?key)\s*[:=]\s*\S+)/i

export class EligibleSetSchedulerError extends Error {
  constructor(code, field, detail = null) {
    super(`${code}:${field}${detail === null ? "" : `:${detail}`}`)
    this.name = "EligibleSetSchedulerError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail = null) { throw new EligibleSetSchedulerError(code, field, detail) }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!plain(value)) wall("SCHEDULER_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("SCHEDULER_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("SCHEDULER_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function validateSchedulerConfiguration(value) {
  if (!plain(value)) wall("SCHEDULER_TYPE_WALL", "configuration", "OBJECT_REQUIRED")
  const allowed = new Set([...SCHEDULER_CONFIGURATION_FIELDS, ...SCHEDULER_CONFIGURATION_OPTIONAL_FIELDS])
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort()[0]
  if (unknown) wall("SCHEDULER_UNKNOWN_FIELD_WALL", `configuration.${unknown}`)
  const missing = [...SCHEDULER_CONFIGURATION_FIELDS].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("SCHEDULER_MISSING_FIELD_WALL", `configuration.${missing}`)
  if (Object.hasOwn(value, "failureInjector") && typeof value.failureInjector !== "function") wall("SCHEDULER_TYPE_WALL", "configuration.failureInjector", "FUNCTION_REQUIRED")
  if (Object.hasOwn(value, "lockLeaseDurationMs")) integer(value.lockLeaseDurationMs, "configuration.lockLeaseDurationMs", 30)
  if (Object.hasOwn(value, "lockHeartbeatIntervalMs")) integer(value.lockHeartbeatIntervalMs, "configuration.lockHeartbeatIntervalMs", 5)
}
function injectFailure(configuration, point) { if (configuration.failureInjector) configuration.failureInjector(point) }
function identifier(value, field) {
  if (typeof value !== "string" || !ID.test(value)) wall("SCHEDULER_VALUE_WALL", field, "IDENTIFIER_REQUIRED")
  return value
}
function budgetKey(value, field) {
  if (typeof value !== "string" || value === "" || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    wall("SCHEDULER_VALUE_WALL", field, "SAFE_BUDGET_KEY_REQUIRED")
  }
  return value
}
function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) wall("SCHEDULER_VALUE_WALL", field, `INTEGER_${minimum}_OR_GREATER_REQUIRED`)
  return value
}
function instant(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    wall("SCHEDULER_VALUE_WALL", field, "CANONICAL_INSTANT_REQUIRED")
  }
  return Date.parse(value)
}
function strings(value, field, nonempty = true) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) wall("SCHEDULER_VALUE_WALL", field, "NONEMPTY_ARRAY_REQUIRED")
  const result = value.map((entry, index) => identifier(entry, `${field}[${index}]`)).sort()
  if (new Set(result).size !== result.length) wall("SCHEDULER_VALUE_WALL", field, "UNIQUE_REQUIRED")
  return result
}
function repositories(value, field) {
  if (!Array.isArray(value) || value.length === 0) wall("SCHEDULER_VALUE_WALL", field, "NONEMPTY_ARRAY_REQUIRED")
  const result = value.map((entry, index) => {
    if (typeof entry !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry)) {
      wall("SCHEDULER_VALUE_WALL", `${field}[${index}]`, "OWNER_REPOSITORY_REQUIRED")
    }
    return entry
  }).sort()
  if (new Set(result).size !== result.length) wall("SCHEDULER_VALUE_WALL", field, "UNIQUE_REQUIRED")
  return result
}
function canonicalObject(value) {
  if (Array.isArray(value)) return value.map(canonicalObject)
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalObject(value[key])]))
  return value
}
function sanitizedEvidence(value, field = "evidence", depth = 0) {
  if (depth > 6) wall("SCHEDULER_EVIDENCE_WALL", field, "MAX_DEPTH")
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value
  if (typeof value === "string") {
    if (value.length > 2048 || /[\u0000\u2028\u2029]/u.test(value) || SENSITIVE_VALUE.test(value)) wall("SCHEDULER_EVIDENCE_WALL", field, "UNSAFE_VALUE")
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 64) wall("SCHEDULER_EVIDENCE_WALL", field, "MAX_ITEMS")
    return value.map((entry, index) => sanitizedEvidence(entry, `${field}[${index}]`, depth + 1))
  }
  if (!plain(value) || Object.keys(value).length > 64) wall("SCHEDULER_EVIDENCE_WALL", field, "BOUNDED_PLAIN_OBJECT_REQUIRED")
  return Object.fromEntries(Object.keys(value).sort().map((key) => {
    if (SENSITIVE_KEY.test(key)) wall("SCHEDULER_EVIDENCE_WALL", `${field}.${key}`, "SENSITIVE_KEY")
    return [key, sanitizedEvidence(value[key], `${field}.${key}`, depth + 1)]
  }))
}
export function canonicalSchedulerJson(value) { return JSON.stringify(canonicalObject(value)) }
export function schedulerHash(value) { return crypto.createHash("sha256").update(canonicalSchedulerJson(value)).digest("hex") }
function deterministicUuid(value) {
  const hash = schedulerHash(value)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
function unsigned(value) { const copy = { ...value }; delete copy.signature; return copy }
function verifySignature(value, publicKey, field) {
  let valid = false
  try {
    valid = crypto.verify("sha256", Buffer.from(canonicalSchedulerJson(unsigned(value))), publicKey, Buffer.from(value.signature, "base64"))
  } catch { valid = false }
  if (!valid) wall("SCHEDULER_SIGNATURE_WALL", field, "SIGNATURE_INVALID")
}
function signedHash(value) { return schedulerHash(value) }

export function signSchedulerArtifact(value, privateKey) {
  const normalized = { ...value }
  delete normalized.signature
  return Object.freeze({
    ...normalized,
    signature: crypto.sign("sha256", Buffer.from(canonicalSchedulerJson(normalized)), privateKey).toString("base64"),
  })
}

export function schedulerPublicKeyFingerprint(publicKey) {
  const der = crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" })
  return crypto.createHash("sha256").update(der).digest("hex")
}

export function schedulerTrustRegistryRecordHash(value) { return schedulerHash(value) }
export function schedulerTrustStatusEventHash(value) {
  const body = { ...value }; delete body.eventHash; delete body.signature
  return schedulerHash(body)
}

function loadPinnedTrustBundle(reference) {
  if (plain(reference) && ["bundlePath", "contentHash", "signerFingerprint", "signerPublicKeyPem", "statusChainHead", "maximumAgeMs", "trustBundle"].some((field) => Object.hasOwn(reference, field))) {
    wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustBundleReference", "CALLER_TRUST_MATERIAL_REJECTED")
  }
  exact(reference, BUNDLE_REFERENCE_FIELDS, "trustBundleReference")
  identifier(reference.registryId, "trustBundleReference.registryId")
  integer(reference.registryVersion, "trustBundleReference.registryVersion", 1)
  const loaded = loadCanonicalSchedulerTrustRecord(reference.registryId, reference.registryVersion)
  if (loaded === null) wall("SCHEDULER_TRUST_REGISTRY_WALL", "trustBundleReference", "AUTHENTICATED_PINNED_RECORD_REQUIRED")
  exact(loaded, TRUST_REGISTRY_ENTRY_FIELDS, "trustRegistryEntry")
  exact(loaded.registryRecord, TRUST_REGISTRY_RECORD_FIELDS, "trustRegistryRecord")
  if (!HASH.test(loaded.pinnedRegistryRecordContentHash)
    || schedulerTrustRegistryRecordHash(loaded.registryRecord) !== loaded.pinnedRegistryRecordContentHash) {
    wall("SCHEDULER_TRUST_REGISTRY_WALL", "trustRegistryRecord", "IMMUTABLE_RECORD_HASH_MISMATCH")
  }
  const record = loaded.registryRecord
  if (record.schemaVersion !== 1 || record.artifactType !== "SCHEDULER_TRUST_PIN_RECORD"
    || record.registryId !== reference.registryId || record.registryVersion !== reference.registryVersion
    || record.status !== "ACTIVE" || record.immutable !== true) {
    wall("SCHEDULER_TRUST_REGISTRY_WALL", "trustRegistryRecord", "ACTIVE_IMMUTABLE_RECORD_REQUIRED")
  }
  const now = instant(loaded.evaluationTime, "trustRegistryEntry.evaluationTime")
  integer(record.maximumAgeMs, "trustRegistryRecord.maximumAgeMs", 1)
  if (!HASH.test(record.signerFingerprint) || !HASH.test(record.bundleContentHash) || !HASH.test(record.statusHeadHash)
    || schedulerPublicKeyFingerprint(record.signerPublicKeyPem) !== record.signerFingerprint) {
    wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustRegistryRecord.signerFingerprint", "PIN_MISMATCH")
  }
  const bundle = record.trustBundle
  if (schedulerHash(bundle) !== record.bundleContentHash) wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustRegistryRecord.bundleContentHash", "BUNDLE_HASH_MISMATCH")
  exact(bundle, BUNDLE_FIELDS, "trustBundle")
  if (bundle.schemaVersion !== 1 || bundle.artifactType !== "SCHEDULER_TRUST_ROOT_BUNDLE" || bundle.status !== "ACTIVE"
    || bundle.revocationChainHead !== record.statusHeadHash) wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustBundle.status")
  identifier(bundle.bundleId, "trustBundle.bundleId")
  const issued = instant(bundle.issuedAt, "trustBundle.issuedAt")
  const expires = instant(bundle.expiresAt, "trustBundle.expiresAt")
  if (issued > now || expires <= now || now - issued > record.maximumAgeMs) wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustBundle.expiresAt", "FRESH_ACTIVE_BUNDLE_REQUIRED")
  verifySignature(bundle, record.signerPublicKeyPem, "trustBundle.signature")
  if (!Array.isArray(record.statusEvents) || record.statusEvents.length === 0) wall("SCHEDULER_TRUST_STATUS_WALL", "trustRegistryRecord.statusEvents", "NONEMPTY_CHAIN_REQUIRED")
  let prior = "0".repeat(64)
  let sequence = 0
  let status = null
  let priorIssuedAt = -Infinity
  for (const [index, event] of record.statusEvents.entries()) {
    exact(event, TRUST_STATUS_EVENT_FIELDS, `trustRegistryRecord.statusEvents[${index}]`)
    if (event.schemaVersion !== 1 || event.artifactType !== "SCHEDULER_TRUST_STATUS_EVENT"
      || event.sequence !== sequence + 1 || event.priorEventHash !== prior
      || event.registryId !== record.registryId || event.registryVersion !== record.registryVersion
      || event.bundleId !== bundle.bundleId || !["ACTIVE", "REVOKED"].includes(event.status)) {
      wall("SCHEDULER_TRUST_STATUS_WALL", `trustRegistryRecord.statusEvents[${index}]`, "CHAIN_SCOPE_INVALID")
    }
    const statusIssuedAt = instant(event.issuedAt, `trustRegistryRecord.statusEvents[${index}].issuedAt`)
    if (statusIssuedAt <= priorIssuedAt || statusIssuedAt > now) wall("SCHEDULER_TRUST_STATUS_WALL", `trustRegistryRecord.statusEvents[${index}].issuedAt`, "STRICT_PAST_MONOTONIC_TIME_REQUIRED")
    if (status === "REVOKED") wall("SCHEDULER_TRUST_STATUS_WALL", `trustRegistryRecord.statusEvents[${index}]`, "TERMINAL_REVOCATION_VIOLATION")
    verifySignature(event, record.signerPublicKeyPem, `trustRegistryRecord.statusEvents[${index}].signature`)
    if (event.eventHash !== schedulerTrustStatusEventHash(event)) wall("SCHEDULER_TRUST_STATUS_WALL", `trustRegistryRecord.statusEvents[${index}].eventHash`, "HASH_MISMATCH")
    prior = event.eventHash; sequence = event.sequence; status = event.status; priorIssuedAt = statusIssuedAt
  }
  if (prior !== record.statusHeadHash || status !== "ACTIVE" || now - priorIssuedAt > record.maximumAgeMs) wall("SCHEDULER_TRUST_STATUS_WALL", "trustRegistryRecord.statusHeadHash", "FRESH_ACTIVE_PINNED_HEAD_REQUIRED")
  if (!plain(bundle.trustRoots) || !plain(bundle.authorityRoots) || Object.keys(bundle.trustRoots).length === 0 || Object.keys(bundle.authorityRoots).length === 0) {
    wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustBundle.roots", "PINNED_ROOTS_REQUIRED")
  }
  if (!plain(bundle.rootFingerprints) || !plain(bundle.rootFingerprints.trust) || !plain(bundle.rootFingerprints.authority)) {
    wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustBundle.rootFingerprints", "ROOT_FINGERPRINTS_REQUIRED")
  }
  for (const [kind, roots] of [["trust", bundle.trustRoots], ["authority", bundle.authorityRoots]]) {
    if (canonicalSchedulerJson(Object.keys(roots).sort()) !== canonicalSchedulerJson(Object.keys(bundle.rootFingerprints[kind]).sort())) {
      wall("SCHEDULER_TRUST_BUNDLE_WALL", `trustBundle.rootFingerprints.${kind}`, "EXACT_ROOT_SET_REQUIRED")
    }
    for (const [issuer, publicKey] of Object.entries(roots)) {
      if (schedulerPublicKeyFingerprint(publicKey) !== bundle.rootFingerprints[kind][issuer]) {
        wall("SCHEDULER_TRUST_BUNDLE_WALL", `trustBundle.rootFingerprints.${kind}.${issuer}`, "ROOT_PIN_MISMATCH")
      }
    }
  }
  const trustKeyFingerprints = new Set(Object.values(bundle.trustRoots).map((publicKey) => schedulerPublicKeyFingerprint(publicKey)))
  if (Object.values(bundle.authorityRoots).some((publicKey) => trustKeyFingerprints.has(schedulerPublicKeyFingerprint(publicKey)))) {
    wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustBundle.roots", "CRYPTOGRAPHICALLY_DISTINCT_TRUST_AND_AUTHORITY_KEYS_REQUIRED")
  }
  if (!Array.isArray(bundle.workerProviderBindings) || bundle.workerProviderBindings.length === 0) wall("SCHEDULER_TRUST_BUNDLE_WALL", "trustBundle.workerProviderBindings")
  const bindings = bundle.workerProviderBindings.map((binding, index) => {
    exact(binding, BINDING_FIELDS, `trustBundle.workerProviderBindings[${index}]`)
    return {
      workerId: identifier(binding.workerId, `trustBundle.workerProviderBindings[${index}].workerId`),
      providerId: identifier(binding.providerId, `trustBundle.workerProviderBindings[${index}].providerId`),
      adapterId: identifier(binding.adapterId, `trustBundle.workerProviderBindings[${index}].adapterId`),
      executionSurfaces: strings(binding.executionSurfaces, `trustBundle.workerProviderBindings[${index}].executionSurfaces`),
    }
  })
  return Object.freeze({ ...bundle, bindings: Object.freeze(bindings), bundleHash: record.bundleContentHash, registryRecordHash: loaded.pinnedRegistryRecordContentHash })
}

export function schedulerConfigurationHash(configuration, budgets) {
  const lockLease = lockLeaseOptions(configuration)
  return schedulerHash({
    stateId: configuration.stateId,
    statePath: configuration.statePath,
    reservationLedgerId: configuration.reservationLedgerId,
    reservationLedgerPath: configuration.reservationLedgerPath,
    leaseStoreId: configuration.leaseStoreId,
    leaseStorePath: configuration.leaseStorePath,
    evidenceLedgerId: configuration.evidenceLedgerId,
    evidenceLedgerDir: configuration.evidenceLedgerDir,
    trustRegistryReference: configuration.trustBundleReference,
    reconciliationBatchCeiling: configuration.reconciliationBatchCeiling,
    leaseDurationMs: configuration.leaseDurationMs,
    lockTimeoutMs: configuration.lockTimeoutMs,
    lockLeaseDurationMs: lockLease.leaseDurationMs,
    lockHeartbeatIntervalMs: lockLease.heartbeatIntervalMs,
    budgets: validateBudgets(budgets),
  })
}

function validateTrust(value, roots, now) {
  exact(value, TRUST_FIELDS, "trustArtifact")
  exact(value.subject, SUBJECT_FIELDS, "trustArtifact.subject")
  if (value.schemaVersion !== 2 || value.artifactType !== "PREVENTIVE_TRUST_ARTIFACT_V2") wall("SCHEDULER_TRUST_WALL", "trustArtifact", "V2_REQUIRED")
  for (const field of ["artifactId", "issuer"]) identifier(value[field], `trustArtifact.${field}`)
  const subject = {
    providerId: identifier(value.subject.providerId, "trustArtifact.subject.providerId"),
    adapterId: identifier(value.subject.adapterId, "trustArtifact.subject.adapterId"),
    workerId: identifier(value.subject.workerId, "trustArtifact.subject.workerId"),
    roles: strings(value.subject.roles, "trustArtifact.subject.roles"),
    repositories: repositories(value.subject.repositories, "trustArtifact.subject.repositories"),
    actions: strings(value.subject.actions, "trustArtifact.subject.actions"),
  }
  const issued = instant(value.issuedAt, "trustArtifact.issuedAt")
  const expires = instant(value.expiresAt, "trustArtifact.expiresAt")
  if (issued > now || expires <= now || issued >= expires) wall("SCHEDULER_TRUST_WALL", "trustArtifact.expiresAt", "ACTIVE_WINDOW_REQUIRED")
  if (value.revoked !== false) wall("SCHEDULER_TRUST_WALL", "trustArtifact.revoked", "FALSE_REQUIRED")
  if (!HASH.test(value.priorHash) || !HASH.test(value.evidenceHash)) wall("SCHEDULER_TRUST_WALL", "trustArtifact", "HASH_ANCHORS_REQUIRED")
  const root = roots[value.issuer]
  if (!root) wall("SCHEDULER_TRUST_WALL", "trustArtifact.issuer", "INDEPENDENT_TRUST_ROOT_REQUIRED")
  verifySignature(value, root, "trustArtifact.signature")
  return Object.freeze({ ...value, subject: Object.freeze(subject), artifactHash: signedHash(value) })
}

function validateAuthority(value, roots, now) {
  exact(value, AUTHORITY_FIELDS, "authorityGrant")
  if (value.schemaVersion !== 1 || value.artifactType !== "SIGNED_WORK_ORDER_AUTHORITY") wall("SCHEDULER_AUTHORITY_WALL", "authorityGrant", "SIGNED_V1_REQUIRED")
  for (const field of ["grantId", "issuer", "programId", "goalId", "loopId", "workOrderId", "laneId", "providerId", "adapterId", "workerId", "role", "executionSurface", "schedulerRunId", "reservationSetId"]) {
    identifier(value[field], `authorityGrant.${field}`)
  }
  integer(value.attempt, "authorityGrant.attempt", 1)
  if (!HASH.test(value.configurationHash) || !HASH.test(value.reservationContentHash)) wall("SCHEDULER_AUTHORITY_WALL", "authorityGrant", "CONFIGURATION_AND_RESERVATION_HASH_REQUIRED")
  const repositoryList = repositories(value.repositories, "authorityGrant.repositories")
  const actions = strings(value.actions, "authorityGrant.actions")
  if (!RISKS.has(value.riskClass)) wall("SCHEDULER_AUTHORITY_WALL", "authorityGrant.riskClass")
  const issued = instant(value.issuedAt, "authorityGrant.issuedAt")
  const expires = instant(value.expiresAt, "authorityGrant.expiresAt")
  if (issued > now || expires <= now || issued >= expires) wall("SCHEDULER_AUTHORITY_WALL", "authorityGrant.expiresAt", "ACTIVE_WINDOW_REQUIRED")
  if (value.revoked !== false) wall("SCHEDULER_AUTHORITY_WALL", "authorityGrant.revoked", "FALSE_REQUIRED")
  if (!HASH.test(value.trustArtifactHash)) wall("SCHEDULER_AUTHORITY_WALL", "authorityGrant.trustArtifactHash", "HASH_REQUIRED")
  const root = roots[value.issuer]
  if (!root) wall("SCHEDULER_AUTHORITY_WALL", "authorityGrant.issuer", "INDEPENDENT_AUTHORITY_ROOT_REQUIRED")
  verifySignature(value, root, "authorityGrant.signature")
  return Object.freeze({ ...value, repositories: Object.freeze(repositoryList), actions: Object.freeze(actions), grantHash: signedHash(value) })
}

function exactMatch(actual, expected, field) {
  if (canonicalSchedulerJson(actual) !== canonicalSchedulerJson(expected)) {
    const mismatch = plain(actual) && plain(expected)
      ? [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()
        .find((key) => canonicalSchedulerJson(actual[key]) !== canonicalSchedulerJson(expected[key]))
      : null
    wall("SCHEDULER_SCOPE_WALL", mismatch ? `${field}.${mismatch}` : field, "EXACT_MATCH_REQUIRED")
  }
}

function normalizeWork(value, bundle, now, configurationHash) {
  exact(value, WORK_FIELDS, "work")
  if (value.schemaVersion !== 1 || value.artifactType !== "ELIGIBLE_SCHEDULER_WORK") wall("SCHEDULER_SCHEMA_WALL", "work")
  for (const field of ["programId", "goalId", "loopId", "workOrderId", "laneId", "providerId", "adapterId", "workerId", "requestedRole", "executionSurface", "schedulerRunId", "dispatchId"]) identifier(value[field], `work.${field}`)
  integer(value.attempt, "work.attempt", 1)
  if (!HASH.test(value.configurationHash) || value.configurationHash !== configurationHash) wall("SCHEDULER_SCOPE_WALL", "work.configurationHash", "COMPLETE_CONFIGURATION_HASH_REQUIRED")
  if (!RISKS.has(value.riskClass)) wall("SCHEDULER_VALUE_WALL", "work.riskClass")
  const repositoryList = repositories(value.repositories, "work.repositories")
  const actions = strings(value.allowedActions, "work.allowedActions")
  const reservation = normalizeReservationSet(value.reservationSet)
  if (!reservation.valid) wall("SCHEDULER_RESERVATION_WALL", "work.reservationSet", reservation.reasonCodes?.[0] ?? "INVALID")
  if (reservation.reservationSet.workOrderId !== value.workOrderId || reservation.reservationSet.workerId !== value.workerId) {
    wall("SCHEDULER_RESERVATION_WALL", "work.reservationSet", "WORKER_WORK_ORDER_BINDING_REQUIRED")
  }
  const reservationContentHash = schedulerHash(reservation.reservationSet)
  if (value.reservationContentHash !== reservationContentHash) wall("SCHEDULER_RESERVATION_WALL", "work.reservationContentHash", "CONTENT_HASH_MISMATCH")
  const trust = validateTrust(value.trustArtifact, bundle.trustRoots, now)
  const authority = validateAuthority(value.authorityGrant, bundle.authorityRoots, now)
  if (trust.issuer === authority.issuer
    || schedulerPublicKeyFingerprint(bundle.trustRoots[trust.issuer]) === schedulerPublicKeyFingerprint(bundle.authorityRoots[authority.issuer])) {
    wall("SCHEDULER_TRUST_WALL", "authorityGrant.issuer", "INDEPENDENT_SIGNING_ROOT_REQUIRED")
  }
  const binding = bundle.bindings.find((candidate) => candidate.workerId === value.workerId
    && candidate.providerId === value.providerId && candidate.adapterId === value.adapterId
    && candidate.executionSurfaces.includes(value.executionSurface))
  if (!binding) wall("SCHEDULER_TRUST_BUNDLE_WALL", "work.executionSurface", "PINNED_WORKER_PROVIDER_BINDING_REQUIRED")
  exactMatch({ providerId: value.providerId, adapterId: value.adapterId, workerId: value.workerId }, {
    providerId: trust.subject.providerId, adapterId: trust.subject.adapterId, workerId: trust.subject.workerId,
  }, "work.trustIdentity")
  if (!trust.subject.roles.includes(value.requestedRole)) wall("SCHEDULER_SCOPE_WALL", "work.requestedRole")
  exactMatch(repositoryList, trust.subject.repositories, "work.trustRepositories")
  exactMatch(actions, trust.subject.actions, "work.trustActions")
  if (authority.trustArtifactHash !== trust.artifactHash) wall("SCHEDULER_TRUST_WALL", "authorityGrant.trustArtifactHash", "SIGNED_ARTIFACT_HASH_REQUIRED")
  exactMatch({
    programId: value.programId, goalId: value.goalId, loopId: value.loopId, workOrderId: value.workOrderId, laneId: value.laneId,
    providerId: value.providerId, adapterId: value.adapterId, workerId: value.workerId,
    role: value.requestedRole, executionSurface: value.executionSurface, schedulerRunId: value.schedulerRunId,
    attempt: value.attempt, configurationHash: value.configurationHash,
    repositories: repositoryList, riskClass: value.riskClass, actions,
    reservationSetId: reservation.reservationSet.reservationSetId, reservationContentHash,
  }, {
    programId: authority.programId, goalId: authority.goalId, loopId: authority.loopId,
    workOrderId: authority.workOrderId, laneId: authority.laneId,
    providerId: authority.providerId, adapterId: authority.adapterId, workerId: authority.workerId,
    role: authority.role, executionSurface: authority.executionSurface,
    schedulerRunId: authority.schedulerRunId, attempt: authority.attempt,
    configurationHash: authority.configurationHash,
    repositories: authority.repositories, riskClass: authority.riskClass,
    actions: authority.actions, reservationSetId: authority.reservationSetId,
    reservationContentHash: authority.reservationContentHash,
  }, "work.authorityScope")
  return Object.freeze({
    ...value, repositories: Object.freeze(repositoryList), allowedActions: Object.freeze(actions),
    reservationSet: reservation.reservationSet, trustArtifact: trust, authorityGrant: authority,
    fullIdentityHash: schedulerHash({
      programId: value.programId, goalId: value.goalId, loopId: value.loopId,
      workOrderId: value.workOrderId, laneId: value.laneId,
      providerId: value.providerId, adapterId: value.adapterId, workerId: value.workerId,
      requestedRole: value.requestedRole, executionSurface: value.executionSurface,
      schedulerRunId: value.schedulerRunId, attempt: value.attempt, configurationHash: value.configurationHash,
      repositories: repositoryList, riskClass: value.riskClass, actions,
      reservationSetId: reservation.reservationSet.reservationSetId,
      reservationContentHash, dispatchId: value.dispatchId,
      trustArtifactHash: trust.artifactHash, authorityGrantHash: authority.grantHash,
    }),
  })
}

function validateBudgets(value) {
  exact(value, BUDGET_FIELDS, "budgets")
  const global = integer(value.global, "budgets.global", 1)
  const maps = {}
  for (const field of ["providers", "repositories", "risks", "combined"]) {
    if (!plain(value[field])) wall("SCHEDULER_BUDGET_WALL", `budgets.${field}`, "OBJECT_REQUIRED")
    maps[field] = Object.fromEntries(Object.keys(value[field]).sort().map((key) => [budgetKey(key, `budgets.${field}.key`), integer(value[field][key], `budgets.${field}.${key}`, 1)]))
  }
  return Object.freeze({ global, ...maps })
}

function emptyState(stateId) {
  const state = { schemaVersion: 1, artifactType: "ELIGIBLE_SET_SCHEDULER_STATE", stateId, version: 0, nextFence: 1, active: [], released: [], reconciliation: [], events: [], stateHash: null }
  state.stateHash = schedulerHash(state)
  return state
}

function lockLeaseOptions(configuration) {
  const leaseDurationMs = configuration.lockLeaseDurationMs ?? Math.max(30_000, configuration.lockTimeoutMs * 8)
  return {
    timeoutMs: configuration.lockTimeoutMs,
    leaseDurationMs,
    heartbeatIntervalMs: configuration.lockHeartbeatIntervalMs ?? Math.max(10, Math.floor(leaseDurationMs / 3)),
  }
}

function acquireLock(configuration) {
  try { return acquireSchedulerLock(configuration.statePath, lockLeaseOptions(configuration)) } catch (error) {
    if (error instanceof SchedulerLockLeaseError) wall(error.code, "state", error.detail)
    throw error
  }
}

function loadState(statePath, stateId) {
  try {
    const value = JSON.parse(fs.readFileSync(statePath, "utf8"))
    exact(value, new Set(["schemaVersion", "artifactType", "stateId", "version", "nextFence", "active", "released", "reconciliation", "events", "stateHash"]), "state")
    if (value.schemaVersion !== 1 || value.artifactType !== "ELIGIBLE_SET_SCHEDULER_STATE" || value.stateId !== stateId
      || !Number.isSafeInteger(value.version) || !Number.isSafeInteger(value.nextFence)
      || !Array.isArray(value.active) || !Array.isArray(value.released) || !Array.isArray(value.reconciliation) || !Array.isArray(value.events)
      || !HASH.test(value.stateHash)) {
      wall("SCHEDULER_STATE_CORRUPT", "state")
    }
    const stateHash = value.stateHash
    value.stateHash = null
    if (schedulerHash(value) !== stateHash) wall("SCHEDULER_STATE_CORRUPT", "state.stateHash", "HASH_MISMATCH")
    value.stateHash = stateHash
    if (value.events.length !== value.version) wall("SCHEDULER_STATE_CORRUPT", "state.events", "VERSION_MISMATCH")
    let priorEventHash = "0".repeat(64)
    for (let index = 0; index < value.events.length; index += 1) {
      const event = value.events[index]
      if (!plain(event) || event.sequence !== index + 1 || event.priorEventHash !== priorEventHash || !HASH.test(event.eventHash)) {
        wall("SCHEDULER_STATE_CORRUPT", "state.events", "CHAIN_INVALID")
      }
      const eventHash = event.eventHash
      const body = { ...event }; delete body.eventHash
      if (schedulerHash(body) !== eventHash) wall("SCHEDULER_STATE_CORRUPT", "state.events", "EVENT_HASH_MISMATCH")
      priorEventHash = eventHash
    }
    return value
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState(stateId)
    if (error instanceof EligibleSetSchedulerError) throw error
    wall("SCHEDULER_STATE_CORRUPT", "state")
  }
}

function durableWrite(statePath, state) {
  const temporary = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`
  let handle
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 })
    handle = fs.openSync(temporary, "wx", 0o600)
    state.stateHash = null
    state.stateHash = schedulerHash(state)
    fs.writeFileSync(handle, `${JSON.stringify(state, null, 2)}\n`)
    fs.fsyncSync(handle); fs.closeSync(handle); handle = null
    fs.renameSync(temporary, statePath)
    const directory = fs.openSync(path.dirname(statePath), "r"); fs.fsyncSync(directory); fs.closeSync(directory)
  } catch {
    if (handle) try { fs.closeSync(handle) } catch { /* typed wall below */ }
    try { fs.rmSync(temporary, { force: true }) } catch { /* typed wall below */ }
    wall("SCHEDULER_IO_WALL", "state")
  }
}

function journalPath(configuration) { return `${configuration.statePath}.transactions.json` }
function emptyJournal(configuration) {
  const journal = { schemaVersion: 1, artifactType: "ELIGIBLE_SCHEDULER_TRANSACTION_JOURNAL", journalId: `${configuration.stateId}:transactions`, version: 0, nextFence: 1, transactions: [], journalHash: null }
  journal.journalHash = schedulerHash(journal)
  return journal
}
function immutableOutcomeProjection(transaction) {
  return {
    transactionId: transaction.transactionId, operation: transaction.operation,
    journalFencingToken: transaction.journalFencingToken, fullIdentityHash: transaction.fullIdentityHash,
    schedulerFencingToken: transaction.schedulerFencingToken, expectedSchedulerVersion: transaction.expectedSchedulerVersion,
    startedAt: transaction.startedAt, detail: transaction.detail,
  }
}
function computedImmutableOutcomeDetailHash(transaction) { return schedulerHash(immutableOutcomeProjection(transaction)) }
function loadJournal(configuration) {
  const file = journalPath(configuration)
  try {
    const journal = JSON.parse(fs.readFileSync(file, "utf8"))
    exact(journal, new Set(["schemaVersion", "artifactType", "journalId", "version", "nextFence", "transactions", "journalHash"]), "transactionJournal")
    const hash = journal.journalHash; journal.journalHash = null
    if (journal.schemaVersion !== 1 || journal.artifactType !== "ELIGIBLE_SCHEDULER_TRANSACTION_JOURNAL"
      || journal.journalId !== `${configuration.stateId}:transactions` || !Number.isSafeInteger(journal.version)
      || !Number.isSafeInteger(journal.nextFence) || !Array.isArray(journal.transactions) || !HASH.test(hash)
      || schedulerHash(journal) !== hash) wall("SCHEDULER_TRANSACTION_JOURNAL_WALL", "transactionJournal", "CORRUPT")
    const transactionIds = new Set()
    const journalFences = new Set()
    for (const transaction of journal.transactions) {
      if (!plain(transaction) || !ID.test(transaction.transactionId) || !Number.isSafeInteger(transaction.journalFencingToken)
        || transaction.journalFencingToken < 1 || transaction.journalFencingToken >= journal.nextFence
        || transactionIds.has(transaction.transactionId) || journalFences.has(transaction.journalFencingToken)) wall("SCHEDULER_TRANSACTION_JOURNAL_WALL", "transactionJournal", "UNIQUE_TRANSACTION_ID_AND_FENCE_REQUIRED")
      transactionIds.add(transaction.transactionId); journalFences.add(transaction.journalFencingToken)
      if (transaction.operation === "OUTCOME" && (!HASH.test(transaction.immutableOutcomeDetailHash)
        || transaction.immutableOutcomeDetailHash !== computedImmutableOutcomeDetailHash(transaction))) {
        wall("SCHEDULER_TRANSACTION_JOURNAL_WALL", "transactionJournal.immutableOutcomeDetailHash", "EXACT_IMMUTABLE_OUTCOME_REQUIRED")
      }
    }
    journal.journalHash = hash
    return journal
  } catch (error) {
    if (error?.code === "ENOENT") return emptyJournal(configuration)
    if (error instanceof EligibleSetSchedulerError) throw error
    wall("SCHEDULER_TRANSACTION_JOURNAL_WALL", "transactionJournal", "CORRUPT")
  }
}
function writeJournal(configuration, journal) {
  const target = journalPath(configuration)
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`
  let handle
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    handle = fs.openSync(temporary, "wx", 0o600)
    journal.journalHash = null; journal.journalHash = schedulerHash(journal)
    fs.writeFileSync(handle, `${JSON.stringify(journal, null, 2)}\n`); fs.fsyncSync(handle); fs.closeSync(handle); handle = null
    fs.renameSync(temporary, target)
    const directory = fs.openSync(path.dirname(target), "r"); fs.fsyncSync(directory); fs.closeSync(directory)
  } catch {
    if (handle) try { fs.closeSync(handle) } catch { /* typed wall */ }
    try { fs.rmSync(temporary, { force: true }) } catch { /* typed wall */ }
    wall("SCHEDULER_TRANSACTION_JOURNAL_WALL", "transactionJournal", "DURABLE_WRITE_REQUIRED")
  }
}
function beginTransaction(configuration, operation, identity, detail, now) {
  injectFailure(configuration, `${operation}:INTENT`)
  const journal = loadJournal(configuration)
  const transaction = {
    transactionId: `${operation.toLowerCase()}-${identity.fullIdentityHash}-${journal.nextFence}`,
    operation, phase: "INTENT", journalFencingToken: journal.nextFence,
    fullIdentityHash: identity.fullIdentityHash, schedulerFencingToken: identity.schedulerFencingToken,
    expectedSchedulerVersion: detail.expectedSchedulerVersion, detail,
    startedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), errorCode: null, result: {},
  }
  transaction.immutableOutcomeDetailHash = operation === "OUTCOME" ? computedImmutableOutcomeDetailHash(transaction) : null
  journal.nextFence += 1; journal.version += 1; journal.transactions.push(transaction); writeJournal(configuration, journal)
  return transaction.transactionId
}
function advanceTransaction(configuration, transactionId, phase, patch = {}, errorCode = null) {
  const journal = loadJournal(configuration)
  const transaction = journal.transactions.find((candidate) => candidate.transactionId === transactionId)
  if (!transaction) wall("SCHEDULER_TRANSACTION_JOURNAL_WALL", "transactionId", "DURABLE_INTENT_REQUIRED")
  transaction.phase = phase
  if (transaction.operation === "OUTCOME") transaction.result = { ...transaction.result, ...patch }
  else transaction.detail = { ...transaction.detail, ...patch }
  transaction.errorCode = errorCode
  transaction.updatedAt = new Date(configuration.now()).toISOString(); journal.version += 1; writeJournal(configuration, journal)
}

function budgetKeys(work) {
  return {
    providers: [work.providerId], repositories: work.repositories, risks: [work.riskClass],
    combined: work.repositories.map((repository) => `${work.providerId}:${repository}:${work.riskClass}`),
  }
}

function count(active, kind, key) { return active.filter((entry) => budgetKeys(entry)[kind].includes(key)).length }
function hasCapacity(state, work, budgets) {
  const capacityHolders = [...state.active, ...state.reconciliation]
  if (capacityHolders.length >= budgets.global) return "GLOBAL_CAPACITY_EXHAUSTED"
  for (const [kind, keys] of Object.entries(budgetKeys(work))) {
    for (const key of keys) {
      const ceiling = budgets[kind][key]
      if (ceiling === undefined) return `BUDGET_UNDECLARED:${kind}:${key}`
      if (count(capacityHolders, kind, key) >= ceiling) return `CAPACITY_EXHAUSTED:${kind}:${key}`
    }
  }
  return null
}

function record(state, type, work, now, detail = {}) {
  state.version += 1
  const event = {
    sequence: state.version,
    type,
    recordedAt: new Date(now).toISOString(),
    fullIdentityHash: work.fullIdentityHash,
    priorEventHash: state.events.at(-1)?.eventHash ?? "0".repeat(64),
    ...detail,
  }
  state.events.push({ ...event, eventHash: schedulerHash(event) })
}

function activeEntry(work, fence, leaseFence, reservationFence, now) {
  return {
    programId: work.programId, goalId: work.goalId, loopId: work.loopId,
    workOrderId: work.workOrderId, laneId: work.laneId,
    providerId: work.providerId, adapterId: work.adapterId, workerId: work.workerId,
    requestedRole: work.requestedRole, executionSurface: work.executionSurface,
    schedulerRunId: work.schedulerRunId, attempt: work.attempt, configurationHash: work.configurationHash,
    repositories: work.repositories, riskClass: work.riskClass,
    allowedActions: work.allowedActions, reservationSet: work.reservationSet,
    reservationContentHash: work.reservationContentHash,
    leaseFencingToken: leaseFence, reservationFencingToken: reservationFence,
    schedulerFencingToken: fence,
    dispatchId: work.dispatchId, trustArtifactHash: work.trustArtifact.artifactHash,
    authorityGrantHash: work.authorityGrant.grantHash, fullIdentityHash: work.fullIdentityHash,
    status: "ACTIVE", lifecycleState: "PROVIDER_DISPATCHED", acquiredAt: new Date(now).toISOString(),
  }
}

function compatible(active, work) {
  return active.every((entry) => checkReservationCompatibility(entry.reservationSet, work.reservationSet).compatible)
}

function result(code, detail = {}) { return Object.freeze({ ok: true, code, ...detail, authorityGranted: false, ...OWNER_COUNTERS }) }

function holderToken(configuration, work) {
  return crypto.createHmac("sha256", configuration.leaseTokenKey)
    .update(`${configuration.stateId}\0${work.fullIdentityHash}`)
    .digest("hex")
}
function scopedOperationKey(kind, work, suffix = "") {
  const workHash = schedulerHash(work.workOrderId).slice(0, 16)
  const laneHash = schedulerHash(work.laneId).slice(0, 16)
  const suffixHash = schedulerHash(suffix).slice(0, 16)
  return `${kind}-wo-${workHash}-lane-${laneHash}-identity-${work.fullIdentityHash}-${suffixHash}`
}

function phaseOptions(configuration) { return { now: configuration.now, lockTimeoutMs: configuration.lockTimeoutMs } }
function schedulerEvidenceRefs(entry) {
  return [
    { artifactType: "SCHEDULER_CLAIM", artifactId: entry.fullIdentityHash, contentHash: entry.fullIdentityHash },
    { artifactType: "SCHEDULER_CONFIGURATION", artifactId: entry.configurationHash, contentHash: entry.configurationHash },
    { artifactType: "RESERVATION_SET", artifactId: entry.reservationSet.reservationSetId, contentHash: entry.reservationContentHash },
    { artifactType: "SCHEDULER_FENCES", artifactId: `fences-${entry.schedulerFencingToken}-${entry.leaseFencingToken}-${entry.reservationFencingToken}`,
      contentHash: schedulerHash({ schedulerFencingToken: entry.schedulerFencingToken, leaseFencingToken: entry.leaseFencingToken, reservationFencingToken: entry.reservationFencingToken }) },
  ]
}
function inspectReservationLedgerExact(configuration) {
  return inspectReservationLedger(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
    schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST",
  })
}
function loadEvidenceEvent(configuration, eventId) {
  if (typeof eventId !== "string") return null
  const verified = inspectVerifiedEvidenceEvent(configuration.evidenceLedgerDir, configuration.evidenceLedgerId, {
    schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_EVENT_INSPECT_REQUEST", eventId, expectedAnchor: null,
  }, phaseOptions(configuration))
  return verified.ok && verified.valid ? verified.event : null
}
function latestDurableOutcomeEvidence(configuration, entry, lane) {
  let names
  try { names = fs.readdirSync(path.join(configuration.evidenceLedgerDir, "events")).sort().reverse() } catch { wall("SCHEDULER_EVIDENCE_WALL", "recovery.evidence", "VERIFIED_OUTCOME_EVIDENCE_REQUIRED") }
  for (const name of names) {
    const match = /^\d{12}-([0-9a-f-]{36})\.json$/.exec(name)
    if (!match) continue
    const event = loadEvidenceEvent(configuration, match[1])
    if (event?.eventType === "PROVIDER" && event.scope?.programId === entry.programId
      && event.scope?.goalId === entry.goalId && event.scope?.loopId === entry.loopId
      && event.scope?.workOrderId === entry.workOrderId && event.scope?.laneId === entry.laneId
      && event.scope?.runId === entry.schedulerRunId && event.writer?.writerId === entry.workerId
      && event.writer?.providerId === entry.providerId && event.writer?.adapterId === entry.adapterId
      && event.leaseAttribution?.storeId === configuration.leaseStoreId
      && event.leaseAttribution?.fencingToken === lane.fencingToken
      && event.leaseAttribution?.checkpointSequence === lane.checkpointSequence
      && event.leaseAttribution?.checkpointEvidenceHash === schedulerHash(lane.checkpointEvidence)) return event
  }
  wall("SCHEDULER_EVIDENCE_WALL", "recovery.evidence", "VERIFIED_OUTCOME_EVIDENCE_REQUIRED")
}
function applyDurableOutcomeProjection(configuration, entry, lane) {
  const evidence = latestDurableOutcomeEvidence(configuration, entry, lane)
  entry.leaseFencingToken = lane.fencingToken
  entry.lifecycleState = lane.lifecycleState
  entry.lastEvidenceEventId = evidence.eventId
  return evidence
}
function assessEntryStores(configuration, entry) {
  const leaseStore = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId)
  const reservationStore = inspectReservationLedgerExact(configuration)
  const lane = leaseStore.ok ? leaseStore.lanes.find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId) : null
  const reservation = reservationStore.valid ? reservationStore.reservations.find((candidate) => candidate.reservationSetId === entry.reservationSet.reservationSetId) : null
  const evidence = loadEvidenceEvent(configuration, entry.lastEvidenceEventId)
  const checkpoint = lane?.checkpointEvidence
  const reclaimProjection = leaseStore.ok ? leaseStore.recoveryEvents.findLast((candidate) => candidate.workOrderId === entry.workOrderId
    && candidate.laneId === entry.laneId && candidate.workerId === entry.workerId && candidate.fencingToken === entry.leaseFencingToken) : null
  const exactCheckpointContent = Boolean(plain(checkpoint) && checkpoint.fullIdentityHash === entry.fullIdentityHash
    && checkpoint.configurationHash === entry.configurationHash && checkpoint.reservationContentHash === entry.reservationContentHash
    && checkpoint.reservationFence === entry.reservationFencingToken && checkpoint.leaseFence === entry.leaseFencingToken)
  const exactReclaimProjection = Boolean(reclaimProjection && reclaimProjection.recoveryEvidence?.fullIdentityHash === entry.fullIdentityHash
    && reclaimProjection.recoveryEvidence?.configurationHash === entry.configurationHash
    && reclaimProjection.recoveryEvidence?.reservationContentHash === entry.reservationContentHash
    && reclaimProjection.recoveryEvidence?.reservationFence === entry.reservationFencingToken)
  const exactLane = Boolean(lane && lane.workerId === entry.workerId && lane.fencingToken === entry.leaseFencingToken
    && lane.lifecycleState === entry.lifecycleState && (exactCheckpointContent || exactReclaimProjection))
  const exactReservation = Boolean(reservation && reservation.workerId === entry.workerId && reservation.workOrderId === entry.workOrderId
    && reservation.laneId === entry.laneId && reservation.fencingToken === entry.reservationFencingToken
    && schedulerHash(reservation.reservationSet) === schedulerHash(entry.reservationSet))
  const expectedRefs = schedulerEvidenceRefs(entry)
  const exactEvidence = Boolean(evidence && lane && evidence.eventId === entry.lastEvidenceEventId
    && evidence.scope?.programId === entry.programId && evidence.scope?.goalId === entry.goalId && evidence.scope?.loopId === entry.loopId
    && evidence.scope?.workOrderId === entry.workOrderId && evidence.scope?.laneId === entry.laneId && evidence.scope?.runId === entry.schedulerRunId
    && evidence.writer?.writerId === entry.workerId && evidence.writer?.role === entry.requestedRole
    && evidence.writer?.providerId === entry.providerId && evidence.writer?.adapterId === entry.adapterId
    && evidence.writer?.trustGateEvidenceHash === entry.trustArtifactHash
    && evidence.leaseAttribution?.storeId === configuration.leaseStoreId
    && evidence.leaseAttribution?.workOrderId === entry.workOrderId && evidence.leaseAttribution?.laneId === entry.laneId
    && evidence.leaseAttribution?.workerId === entry.workerId && evidence.leaseAttribution?.fencingToken === entry.leaseFencingToken
    && evidence.leaseAttribution?.checkpointSequence === lane?.checkpointSequence
    && evidence.leaseAttribution?.checkpointEvidenceHash === schedulerHash(lane?.checkpointEvidence)
    && expectedRefs.every((expected) => evidence.sourceRefs?.some((actual) => canonicalSchedulerJson(actual) === canonicalSchedulerJson(expected))))
  const expired = exactLane && (lane.status === "EXPIRED" || (lane.status === "ACTIVE" && Date.parse(lane.expiresAt) <= configuration.now()))
  return { lane, reservation, evidence, exactLane, exactReservation, exactEvidence, expired,
    healthy: exactLane && exactReservation && exactEvidence && lane.status === "ACTIVE" && !expired }
}
function compensateDivergentEntry(configuration, state, entry, collection, reasonCode, now) {
  const assessment = assessEntryStores(configuration, entry)
  const durableLaneOwned = assessment.lane?.workerId === entry.workerId
  const durableReservationOwned = assessment.reservation?.workerId === entry.workerId
    && assessment.reservation?.workOrderId === entry.workOrderId && assessment.reservation?.laneId === entry.laneId
    && schedulerHash(assessment.reservation?.reservationSet) === schedulerHash(entry.reservationSet)
  if (durableLaneOwned) {
    let lane = assessment.lane
    if (lane.status === "ACTIVE" && Date.parse(lane.expiresAt) <= now) {
      injectFailure(configuration, "COMPENSATE:LEASE_EXPIRE")
      const expired = expireLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
        schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST", workOrderId: entry.workOrderId,
        laneId: entry.laneId, workerId: entry.workerId,
        idempotencyKey: scopedOperationKey("scheduler-divergence-expire", entry, lane.fencingToken),
        expectedFencingToken: lane.fencingToken,
      }, phaseOptions(configuration))
      if (!expired.ok || expired.leaseStatus !== "EXPIRED") wall("SCHEDULER_COMPENSATION_WALL", "leaseExpire", expired.status)
      lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
        .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
    }
    if (lane?.status === "EXPIRED") {
      if (isTerminalLifecycleState(lane.lifecycleState)) {
        const terminalEvidence = lane.checkpointEvidence
        if (!plain(terminalEvidence) || terminalEvidence.fullIdentityHash !== entry.fullIdentityHash
          || terminalEvidence.configurationHash !== entry.configurationHash
          || terminalEvidence.reservationContentHash !== entry.reservationContentHash
          || terminalEvidence.reservationFence !== entry.reservationFencingToken
          || terminalEvidence.leaseFence !== lane.fencingToken) {
          wall("SCHEDULER_COMPENSATION_WALL", "leaseSettleTerminal", "EXACT_TERMINAL_CHECKPOINT_IDENTITY_REQUIRED")
        }
        injectFailure(configuration, "COMPENSATE:LEASE_SETTLE_TERMINAL")
        const settled = settleExpiredTerminalLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
          schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_SETTLE_TERMINAL_REQUEST",
          workOrderId: entry.workOrderId, laneId: entry.laneId, workerId: entry.workerId,
          idempotencyKey: scopedOperationKey("scheduler-divergence-settle-terminal", entry, lane.fencingToken),
          holderToken: holderToken(configuration, entry), expectedFencingToken: lane.fencingToken,
          expectedCheckpointSequence: lane.checkpointSequence, expectedLifecycleState: lane.lifecycleState,
          expectedCheckpointEvidence: lane.checkpointEvidence,
        }, phaseOptions(configuration))
        if (!settled.ok || settled.leaseStatus !== "RELEASED" || !isTerminalLifecycleState(settled.lifecycleState)) {
          wall("SCHEDULER_COMPENSATION_WALL", "leaseSettleTerminal", settled.status)
        }
        lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
          .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
      } else {
        injectFailure(configuration, "COMPENSATE:LEASE_RECLAIM")
        const reclaimed = reclaimLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
          schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST",
          workOrderId: entry.workOrderId, laneId: entry.laneId, workerId: entry.workerId,
          idempotencyKey: scopedOperationKey("scheduler-divergence-reclaim", entry, lane.fencingToken),
          holderToken: holderToken(configuration, entry), leaseDurationMs: configuration.leaseDurationMs,
          expectedFencingToken: lane.fencingToken,
          checkpointEvidence: { schedulerRunId: entry.schedulerRunId, attempt: entry.attempt, fullIdentityHash: entry.fullIdentityHash,
            configurationHash: entry.configurationHash, reservationContentHash: entry.reservationContentHash,
            reservationFence: entry.reservationFencingToken, reclaimedFromLeaseFence: lane.fencingToken,
            recoveryReason: "STORE_DIVERGENCE_COMPENSATION" },
        }, phaseOptions(configuration))
        if (!reclaimed.ok || reclaimed.leaseStatus !== "ACTIVE" || reclaimed.fencingToken <= lane.fencingToken) {
          wall("SCHEDULER_COMPENSATION_WALL", "leaseReclaim", reclaimed.status)
        }
        entry.leaseFencingToken = reclaimed.fencingToken
        lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
          .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
      }
    }
    if (lane?.status === "ACTIVE" && !isTerminalLifecycleState(lane.lifecycleState)) {
      injectFailure(configuration, "COMPENSATE:LEASE_TERMINALIZE")
      const terminal = checkpointLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
        schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_CHECKPOINT_REQUEST",
        workOrderId: entry.workOrderId, laneId: entry.laneId, workerId: entry.workerId,
        idempotencyKey: scopedOperationKey("scheduler-divergence-terminal", entry, lane.fencingToken),
        holderToken: holderToken(configuration, entry), fencingToken: lane.fencingToken,
        expectedCheckpointSequence: lane.checkpointSequence,
        transition: { from: lane.lifecycleState, to: "FAILED_TERMINAL", reasonCode,
          failureClass: "PROVIDER_SERVER", authorityGap: { present: false, condition: null, conditionRef: null } },
        evidence: { schedulerRunId: entry.schedulerRunId, attempt: entry.attempt, fullIdentityHash: entry.fullIdentityHash,
          configurationHash: entry.configurationHash, reservationContentHash: entry.reservationContentHash,
          reservationFence: entry.reservationFencingToken, leaseFence: lane.fencingToken,
          recoveryReason: "STORE_DIVERGENCE_COMPENSATION" },
      }, phaseOptions(configuration))
      if (!terminal.ok || !isTerminalLifecycleState(terminal.lifecycleState)) wall("SCHEDULER_COMPENSATION_WALL", "leaseTerminalize", terminal.status)
      lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
        .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
    }
    if (lane?.status === "ACTIVE" && isTerminalLifecycleState(lane.lifecycleState)) {
      injectFailure(configuration, "COMPENSATE:LEASE_RELEASE")
      const released = releaseLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
        schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RELEASE_REQUEST", workOrderId: entry.workOrderId,
        laneId: entry.laneId, workerId: entry.workerId,
        idempotencyKey: scopedOperationKey("scheduler-divergence-release", entry, lane.fencingToken),
        holderToken: holderToken(configuration, entry), fencingToken: lane.fencingToken,
      }, phaseOptions(configuration))
      if (!released.ok || released.leaseStatus !== "RELEASED" || !isTerminalLifecycleState(released.lifecycleState)) {
        wall("SCHEDULER_COMPENSATION_WALL", "leaseRelease", released.status)
      }
      lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
        .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
    }
    if (lane?.status !== "RELEASED" || !isTerminalLifecycleState(lane.lifecycleState)) {
      wall("SCHEDULER_COMPENSATION_WALL", "leaseRelease", "DURABLE_TERMINAL_RELEASE_REQUIRED")
    }
    entry.leaseFencingToken = lane.fencingToken
    entry.lifecycleState = lane.lifecycleState
  }
  if (durableReservationOwned) {
    injectFailure(configuration, "COMPENSATE:RESERVATION_RELEASE")
    const released = releaseReservations(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_RELEASE_REQUEST", reservationSetId: entry.reservationSet.reservationSetId,
      holderToken: holderToken(configuration, entry), fencingToken: assessment.reservation.fencingToken,
    }, phaseOptions(configuration))
    if (!released.released) wall("SCHEDULER_COMPENSATION_WALL", "reservationRelease", released.status)
  }
  const index = collection.findIndex((candidate) => candidate.fullIdentityHash === entry.fullIdentityHash)
  if (index >= 0) collection.splice(index, 1)
  state.released.push({ ...entry, status: "RELEASED", outcome: "STORE_DIVERGENCE_COMPENSATED", releasedAt: new Date(now).toISOString(), reasonCode })
  record(state, "STORE_DIVERGENCE_COMPENSATED", entry, now, { reasonCode })
}

function rollbackPhaseTwoClaim(configuration, work, reservationFence = null, leaseFence = null) {
  const token = holderToken(configuration, work)
  let rollbackError = null
  if (leaseFence !== null) {
    const released = releaseLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RELEASE_REQUEST",
      workOrderId: work.workOrderId, laneId: work.laneId, workerId: work.workerId,
      idempotencyKey: scopedOperationKey("scheduler-rollback", work, `${work.schedulerRunId}:${work.attempt}`),
      holderToken: token, fencingToken: leaseFence,
    }, phaseOptions(configuration))
    if (!released.ok && released.status !== "LANE_LEASE_ALREADY_RELEASED") rollbackError = released.status
  }
  if (reservationFence !== null) {
    const released = releaseReservations(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_RELEASE_REQUEST",
      reservationSetId: work.reservationSet.reservationSetId, holderToken: token, fencingToken: reservationFence,
    }, phaseOptions(configuration))
    if (!released.released && released.status !== "RESERVATION_RELEASE_IDEMPOTENT") rollbackError ??= released.status
  }
  return rollbackError
}

function acquirePhaseTwoClaim(configuration, work, transactionId, schedulerFence) {
  const token = holderToken(configuration, work)
  let reservation = null
  let lease = null
  try {
    injectFailure(configuration, "SCHEDULE:RESERVATION")
    reservation = acquireReservations(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_ACQUIRE_REQUEST",
    laneId: work.laneId,
    holderToken: token,
    reservationSet: work.reservationSet,
  }, phaseOptions(configuration))
    if (!reservation.acquired) wall("SCHEDULER_RESERVATION_WALL", "reservationLedger", reservation.status)
    advanceTransaction(configuration, transactionId, "RESERVATION_ACQUIRED", { reservationFencingToken: reservation.fencingToken })
  const leaseEvidence = {
    schedulerRunId: work.schedulerRunId,
    attempt: work.attempt,
    fullIdentityHash: work.fullIdentityHash,
    configurationHash: work.configurationHash,
    reservationContentHash: work.reservationContentHash,
  }
    injectFailure(configuration, "SCHEDULE:LEASE")
    lease = acquireLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST",
    workOrderId: work.workOrderId,
    laneId: work.laneId,
    workerId: work.workerId,
    idempotencyKey: scopedOperationKey("scheduler-acquire", work, `${work.schedulerRunId}:${work.attempt}`),
    holderToken: token,
    leaseDurationMs: configuration.leaseDurationMs,
    checkpointEvidence: leaseEvidence,
  }, phaseOptions(configuration))
    if (!lease.ok) wall("SCHEDULER_LEASE_WALL", "leaseStore", lease.status)
    advanceTransaction(configuration, transactionId, "LEASE_ACQUIRED", { leaseFencingToken: lease.fencingToken })
  const transition = {
    from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: null, failureClass: null,
    authorityGap: { present: false, condition: null, conditionRef: null },
  }
    injectFailure(configuration, "SCHEDULE:CHECKPOINT")
    const checkpoint = checkpointLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_LANE_CHECKPOINT_REQUEST",
    workOrderId: work.workOrderId,
    laneId: work.laneId,
    workerId: work.workerId,
    idempotencyKey: scopedOperationKey("scheduler-dispatch", work, `${work.schedulerRunId}:${work.attempt}`),
    holderToken: token,
    fencingToken: lease.fencingToken,
    expectedCheckpointSequence: lease.checkpointSequence,
    transition,
    evidence: { ...leaseEvidence, phase: "provider-dispatch-handoff", reservationFence: reservation.fencingToken, leaseFence: lease.fencingToken },
  }, phaseOptions(configuration))
    if (!checkpoint.ok) wall("SCHEDULER_CHECKPOINT_WALL", "leaseStore", checkpoint.status)
    advanceTransaction(configuration, transactionId, "CHECKPOINT_WRITTEN")
    const lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
    .find((candidate) => candidate.workOrderId === work.workOrderId && candidate.laneId === work.laneId)
    if (!lane || lane.status !== "ACTIVE" || lane.workerId !== work.workerId || lane.fencingToken !== lease.fencingToken) wall("SCHEDULER_FENCE_WALL", "leaseStore", "DURABLE_ACTIVE_LEASE_REQUIRED")
  const evidenceRequest = {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_EVIDENCE_APPEND_REQUEST",
    eventId: deterministicUuid({ type: "scheduler-dispatch", fullIdentityHash: work.fullIdentityHash }),
    occurredAt: new Date(configuration.now()).toISOString(),
    eventType: "TRANSITION",
    scope: { programId: work.programId, goalId: work.goalId, loopId: work.loopId, workOrderId: work.workOrderId, laneId: work.laneId, runId: work.schedulerRunId },
    writer: { writerId: work.workerId, writerKind: "PROVIDER_ADAPTER", role: work.requestedRole, providerId: work.providerId, adapterId: work.adapterId, trustGateEvidenceHash: work.trustArtifact.artifactHash },
    leaseAttribution: {
      storeId: configuration.leaseStoreId, workOrderId: work.workOrderId, laneId: work.laneId,
      workerId: work.workerId, fencingToken: lane.fencingToken,
      checkpointSequence: lane.checkpointSequence,
      checkpointEvidenceHash: schedulerHash(lane.checkpointEvidence),
    },
    payload: { ...transition, transitionContentHash: schedulerHash(transitionLifecycle(transition)) },
    sourceRefs: [
      { artifactType: "TRUST", artifactId: work.trustArtifact.artifactId, contentHash: work.trustArtifact.artifactHash },
      { artifactType: "AUTHORITY", artifactId: work.authorityGrant.grantId, contentHash: work.authorityGrant.grantHash },
      ...schedulerEvidenceRefs({ ...work, schedulerFencingToken: schedulerFence, leaseFencingToken: lane.fencingToken, reservationFencingToken: reservation.fencingToken }),
    ],
    sanitized: true, rawAuthMaterialIncluded: false, rawProviderOutputIncluded: false, expectedHead: null,
  }
    injectFailure(configuration, "SCHEDULE:EVIDENCE")
    const evidence = appendEvidenceEvent(configuration.evidenceLedgerDir, configuration.evidenceLedgerId, evidenceRequest, {
    leaseStorePath: configuration.leaseStorePath,
    leaseStoreId: configuration.leaseStoreId,
    ...phaseOptions(configuration),
  })
    if (!evidence.ok) wall("SCHEDULER_EVIDENCE_WALL", "evidenceLedger", evidence.status)
    advanceTransaction(configuration, transactionId, "EVIDENCE_WRITTEN")
    return { token, reservation, lease: lane, evidence }
  } catch (error) {
    const rollbackError = rollbackPhaseTwoClaim(configuration, work, reservation?.fencingToken ?? null, lease?.fencingToken ?? null)
    advanceTransaction(configuration, transactionId, rollbackError ? "RECOVERY_REQUIRED" : "ROLLED_BACK", {}, rollbackError ?? error?.code ?? "SCHEDULE_PHASE_FAILURE")
    throw error
  }
}

function liveLaneForMutation(configuration, entry) {
  const token = holderToken(configuration, entry)
  let lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
    .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
  if (!lane || lane.workerId !== entry.workerId || lane.fencingToken !== entry.leaseFencingToken) {
    wall("SCHEDULER_FENCE_WALL", "leaseStore", "EXACT_DURABLE_LEASE_REQUIRED")
  }
  const now = configuration.now()
  if (lane.status === "ACTIVE" && Date.parse(lane.expiresAt) <= now) {
    const expired = expireLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST",
      workOrderId: entry.workOrderId, laneId: entry.laneId, workerId: entry.workerId,
      idempotencyKey: scopedOperationKey("scheduler-expire", entry, entry.leaseFencingToken),
      expectedFencingToken: entry.leaseFencingToken,
    }, phaseOptions(configuration))
    if (!expired.ok) wall("SCHEDULER_LEASE_WALL", "leaseStore", expired.status)
    lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
      .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
  }
  if (lane.status === "EXPIRED") {
    if (isTerminalLifecycleState(lane.lifecycleState)) return lane
    const reclaimed = reclaimLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST",
      workOrderId: entry.workOrderId, laneId: entry.laneId, workerId: entry.workerId,
      idempotencyKey: scopedOperationKey("scheduler-reclaim", entry, entry.leaseFencingToken),
      holderToken: token, leaseDurationMs: configuration.leaseDurationMs,
      expectedFencingToken: entry.leaseFencingToken,
      checkpointEvidence: { schedulerRunId: entry.schedulerRunId, attempt: entry.attempt, fullIdentityHash: entry.fullIdentityHash,
        configurationHash: entry.configurationHash, reservationContentHash: entry.reservationContentHash,
        reservationFence: entry.reservationFencingToken, reclaimedFromLeaseFence: entry.leaseFencingToken },
    }, phaseOptions(configuration))
    if (!reclaimed.ok) wall("SCHEDULER_LEASE_WALL", "leaseStore", reclaimed.status)
    entry.leaseFencingToken = reclaimed.fencingToken
    lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
      .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
    const reclaimEvidence = appendEvidenceEvent(configuration.evidenceLedgerDir, configuration.evidenceLedgerId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_APPEND_REQUEST",
      eventId: deterministicUuid({ type: "scheduler-reclaim", fullIdentityHash: entry.fullIdentityHash, leaseFencingToken: entry.leaseFencingToken }),
      occurredAt: new Date(now).toISOString(), eventType: "WORKER",
      scope: { programId: entry.programId, goalId: entry.goalId, loopId: entry.loopId, workOrderId: entry.workOrderId, laneId: entry.laneId, runId: entry.schedulerRunId },
      writer: { writerId: entry.workerId, writerKind: "PROVIDER_ADAPTER", role: entry.requestedRole, providerId: entry.providerId, adapterId: entry.adapterId, trustGateEvidenceHash: entry.trustArtifactHash },
      leaseAttribution: { storeId: configuration.leaseStoreId, workOrderId: entry.workOrderId, laneId: entry.laneId,
        workerId: entry.workerId, fencingToken: lane.fencingToken, checkpointSequence: lane.checkpointSequence,
        checkpointEvidenceHash: schedulerHash(lane.checkpointEvidence) },
      payload: { workerId: entry.workerId, role: entry.requestedRole, action: "HEARTBEAT", reasonCode: null },
      sourceRefs: schedulerEvidenceRefs(entry), sanitized: true, rawAuthMaterialIncluded: false, rawProviderOutputIncluded: false, expectedHead: null,
    }, { leaseStorePath: configuration.leaseStorePath, leaseStoreId: configuration.leaseStoreId, ...phaseOptions(configuration) })
    if (!reclaimEvidence.ok) wall("SCHEDULER_EVIDENCE_WALL", "reclaimEvidence", reclaimEvidence.status)
    entry.lastEvidenceEventId = reclaimEvidence.event.eventId
  }
  if (lane.status !== "ACTIVE") wall("SCHEDULER_FENCE_WALL", "leaseStore", "DURABLE_ACTIVE_LEASE_REQUIRED")
  return lane
}

function phaseOutcome(configuration, entry, providerState, reasonCode, responseHash, terminal, ambiguous, requiredLeaseFencingToken = null, immutableOutcomeDetailHash = null) {
  const token = holderToken(configuration, entry)
  const outcomeNow = configuration.now()
  const lane = liveLaneForMutation(configuration, entry)
  if (requiredLeaseFencingToken !== null && (entry.leaseFencingToken !== requiredLeaseFencingToken || lane.fencingToken !== requiredLeaseFencingToken)) {
    wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationOwnerProof.leaseFencingToken", "CURRENT_ACTIVE_LEASE_PROOF_REQUIRED")
  }
  let targets
  if (ambiguous) targets = ["REROUTE_PENDING"]
  else if (["ACCEPTED", "RUNNING"].includes(providerState)) targets = lane.lifecycleState === "PROVIDER_DISPATCHED" ? ["EXECUTING"] : []
  else if (providerState === "SUCCEEDED") {
    const completionPath = ["PROVIDER_DISPATCHED", "EXECUTING", "VALIDATING", "PR_OPEN", "INDEPENDENT_REVIEW", "MERGE_ELIGIBLE", "MERGED", "VERIFIED", "COMPLETE", "DEPENDENTS_RELEASED"]
    const start = completionPath.indexOf(lane.lifecycleState)
    if (start < 0) wall("SCHEDULER_CHECKPOINT_WALL", "leaseStore", "SUCCESS_PATH_STATE_REQUIRED")
    targets = completionPath.slice(start + 1)
  } else if (["FAILED", "CANCELLED"].includes(providerState)) targets = lane.lifecycleState === "FAILED_TERMINAL" ? [] : ["FAILED_TERMINAL"]
  else targets = lane.lifecycleState === "PROVIDER_DISPATCHED" ? ["EXECUTING"] : []
  let current = lane
  let checkpoint = { ok: true, status: "LANE_CHECKPOINT_IDEMPOTENT", lifecycleState: current.lifecycleState, checkpointSequence: current.checkpointSequence }
  for (const target of targets) {
    const failureClass = ambiguous ? "TRANSIENT_TRANSPORT"
      : providerState === "FAILED" ? "PROVIDER_SERVER"
        : providerState === "CANCELLED" ? "PROVIDER_UNAVAILABLE" : null
    const transition = {
      from: current.lifecycleState, to: target,
      reasonCode: failureClass === null ? null : reasonCode ?? (ambiguous ? "PROVIDER_DELIVERY_AMBIGUOUS" : `PROVIDER_${providerState}`),
      failureClass,
      authorityGap: { present: false, condition: null, conditionRef: null },
    }
    injectFailure(configuration, `OUTCOME:CHECKPOINT:${target}`)
    checkpoint = checkpointLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_CHECKPOINT_REQUEST",
      workOrderId: entry.workOrderId, laneId: entry.laneId, workerId: entry.workerId,
      idempotencyKey: scopedOperationKey("scheduler-outcome", entry, `${entry.schedulerRunId}:${entry.attempt}:${providerState}:${entry.schedulerFencingToken}:${target}`),
      holderToken: token, fencingToken: entry.leaseFencingToken,
      expectedCheckpointSequence: current.checkpointSequence, transition,
      evidence: { schedulerRunId: entry.schedulerRunId, attempt: entry.attempt, fullIdentityHash: entry.fullIdentityHash,
        configurationHash: entry.configurationHash, reservationContentHash: entry.reservationContentHash,
        reservationFence: entry.reservationFencingToken, leaseFence: entry.leaseFencingToken,
        responseHash, providerState, ambiguous, target },
    }, phaseOptions(configuration))
    if (!checkpoint.ok) wall("SCHEDULER_CHECKPOINT_WALL", "leaseStore", checkpoint.status)
    current = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
      .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
  }
  const updated = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
    .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
  if (!updated) wall("SCHEDULER_FENCE_WALL", "leaseStore", "DURABLE_LANE_REQUIRED")
  injectFailure(configuration, "OUTCOME:EVIDENCE")
  const evidence = appendEvidenceEvent(configuration.evidenceLedgerDir, configuration.evidenceLedgerId, {
    schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_APPEND_REQUEST", eventId: deterministicUuid({ type: "scheduler-outcome", fullIdentityHash: entry.fullIdentityHash, providerState, schedulerFencingToken: entry.schedulerFencingToken, outcomeNow }),
    occurredAt: new Date(outcomeNow).toISOString(), eventType: "PROVIDER",
    scope: { programId: entry.programId, goalId: entry.goalId, loopId: entry.loopId, workOrderId: entry.workOrderId, laneId: entry.laneId, runId: entry.schedulerRunId },
    writer: { writerId: entry.workerId, writerKind: "PROVIDER_ADAPTER", role: entry.requestedRole, providerId: entry.providerId, adapterId: entry.adapterId, trustGateEvidenceHash: entry.trustArtifactHash },
    leaseAttribution: {
      storeId: configuration.leaseStoreId, workOrderId: entry.workOrderId, laneId: entry.laneId,
      workerId: entry.workerId, fencingToken: updated.fencingToken,
      checkpointSequence: updated.checkpointSequence,
      checkpointEvidenceHash: schedulerHash(updated.checkpointEvidence),
    },
    payload: { providerId: entry.providerId, adapterId: entry.adapterId, dispatchId: entry.dispatchId, state: providerState, reasonCode, responseContentHash: responseHash,
      ...(immutableOutcomeDetailHash === null ? {} : { immutableOutcomeDetailHash }) },
    sourceRefs: schedulerEvidenceRefs(entry), sanitized: true, rawAuthMaterialIncluded: false, rawProviderOutputIncluded: false, expectedHead: null,
  }, { leaseStorePath: configuration.leaseStorePath, leaseStoreId: configuration.leaseStoreId, ...phaseOptions(configuration) })
  if (!evidence.ok) wall("SCHEDULER_EVIDENCE_WALL", "evidenceLedger", evidence.status)
  if (terminal) {
    if (!isTerminalLifecycleState(updated.lifecycleState)) wall("SCHEDULER_CHECKPOINT_WALL", "leaseStore", "TERMINAL_CHECKPOINT_REQUIRED_BEFORE_RELEASE")
    injectFailure(configuration, "OUTCOME:LEASE_RELEASE")
    const leaseRelease = releaseLaneLease(configuration.leaseStorePath, configuration.leaseStoreId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RELEASE_REQUEST",
      workOrderId: entry.workOrderId, laneId: entry.laneId, workerId: entry.workerId,
      idempotencyKey: scopedOperationKey("scheduler-release", entry, `${entry.schedulerRunId}:${entry.attempt}`),
      holderToken: token, fencingToken: entry.leaseFencingToken,
    }, phaseOptions(configuration))
    if (!leaseRelease.ok) wall("SCHEDULER_LEASE_WALL", "leaseStore", leaseRelease.status)
    injectFailure(configuration, "OUTCOME:RESERVATION_RELEASE")
    const reservationRelease = releaseReservations(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_RELEASE_REQUEST",
      reservationSetId: entry.reservationSet.reservationSetId,
      holderToken: token, fencingToken: entry.reservationFencingToken,
    }, phaseOptions(configuration))
    if (!reservationRelease.released) wall("SCHEDULER_RESERVATION_WALL", "reservationLedger", reservationRelease.status)
  }
  return { checkpoint: { ...checkpoint, lifecycleState: updated.lifecycleState, checkpointSequence: updated.checkpointSequence }, evidence }
}

function reconciliationClaim(entry) {
  return {
    schedulerRunId: entry.schedulerRunId,
    attempt: entry.attempt,
    fullIdentityHash: entry.fullIdentityHash,
    schedulerFencingToken: entry.schedulerFencingToken,
    leaseFencingToken: entry.leaseFencingToken,
    reservationFencingToken: entry.reservationFencingToken,
  }
}

function validateReconciliationOwnerProof(value, bundle, entry, validAt, minimumExpiry = validAt) {
  exact(value, RECONCILIATION_PROOF_FIELDS, "reconciliationOwnerProof")
  if (value.schemaVersion !== 1 || value.artifactType !== "SIGNED_RECONCILIATION_OWNER_PROOF") wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationOwnerProof")
  for (const field of ["proofId", "issuer", "ownerId", "schedulerRunId"]) identifier(value[field], `reconciliationOwnerProof.${field}`)
  integer(value.attempt, "reconciliationOwnerProof.attempt", 1)
  integer(value.schedulerFencingToken, "reconciliationOwnerProof.schedulerFencingToken", 1)
  integer(value.leaseFencingToken, "reconciliationOwnerProof.leaseFencingToken", 1)
  integer(value.reservationFencingToken, "reconciliationOwnerProof.reservationFencingToken", 1)
  if (!HASH.test(value.fullIdentityHash) || !HASH.test(value.claimHash)) wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationOwnerProof.claimHash")
  const issued = instant(value.issuedAt, "reconciliationOwnerProof.issuedAt")
  const expires = instant(value.expiresAt, "reconciliationOwnerProof.expiresAt")
  if (issued > validAt || expires < minimumExpiry) wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationOwnerProof.expiresAt", "PROOF_MUST_COVER_RECONCILIATION_GRANT")
  const root = bundle.authorityRoots[value.issuer]
  if (!root) wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationOwnerProof.issuer")
  verifySignature(value, root, "reconciliationOwnerProof.signature")
  const claim = reconciliationClaim(entry)
  exactMatch({
    schedulerRunId: value.schedulerRunId, attempt: value.attempt,
    fullIdentityHash: value.fullIdentityHash, schedulerFencingToken: value.schedulerFencingToken,
    leaseFencingToken: value.leaseFencingToken,
    reservationFencingToken: value.reservationFencingToken,
  }, claim, "reconciliationOwnerProof.claim")
  if (value.claimHash !== schedulerHash(claim)) wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationOwnerProof.claimHash", "EXACT_CLAIM_HASH_REQUIRED")
  return Object.freeze({ ...value, proofHash: schedulerHash(value) })
}

function assertCurrentActiveReconciliationLease(configuration, entry, proof) {
  const lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
    .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
  if (!lane || lane.workerId !== entry.workerId || lane.status !== "ACTIVE"
    || lane.fencingToken !== entry.leaseFencingToken || proof.leaseFencingToken !== lane.fencingToken
    || Date.parse(lane.expiresAt) <= configuration.now()) {
    wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationOwnerProof.leaseFencingToken", "CURRENT_ACTIVE_LEASE_PROOF_REQUIRED")
  }
}

function reconciliationAuthorityEntry(entry) {
  if (entry.reconciliationAuthorityClaim === undefined) return entry
  exact(entry.reconciliationAuthorityClaim, new Set(["schedulerRunId", "attempt", "fullIdentityHash", "schedulerFencingToken", "leaseFencingToken", "reservationFencingToken"]), "reconciliationAuthorityClaim")
  return { ...entry, ...entry.reconciliationAuthorityClaim }
}

function validateReconciliationLeaseRebind(configuration, state, entry, proof) {
  if (proof.leaseFencingToken === entry.leaseFencingToken) {
    if (entry.reconciliationLeaseRebind !== null && entry.reconciliationLeaseRebind !== undefined) wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationLeaseRebind", "UNEXPECTED")
    return
  }
  exact(entry.reconciliationLeaseRebind, new Set(["fromLeaseFencingToken", "toLeaseFencingToken", "transactionId", "proofHash", "immutableOutcomeDetailHash", "evidenceEventId", "evidenceEventHash"]), "reconciliationLeaseRebind")
  const rebind = entry.reconciliationLeaseRebind
  if (rebind.fromLeaseFencingToken !== proof.leaseFencingToken || rebind.toLeaseFencingToken !== entry.leaseFencingToken
    || rebind.toLeaseFencingToken <= rebind.fromLeaseFencingToken || rebind.proofHash !== proof.proofHash
    || !rebind.transactionId.startsWith(`outcome-${entry.fullIdentityHash}-`)) {
    wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationLeaseRebind", "EXACT_JOURNAL_REBIND_REQUIRED")
  }
  const durableState = loadState(configuration.statePath, configuration.stateId)
  if (canonicalSchedulerJson(durableState) !== canonicalSchedulerJson(state)
    || state.active.some((candidate) => candidate.fullIdentityHash === entry.fullIdentityHash)
    || state.released.some((candidate) => candidate.fullIdentityHash === entry.fullIdentityHash)
    || state.reconciliation.filter((candidate) => candidate.fullIdentityHash === entry.fullIdentityHash).length !== 1) {
    wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationLeaseRebind.state", "EXACT_DURABLE_RECONCILIATION_STATE_REQUIRED")
  }
  const journal = loadJournal(configuration)
  const transaction = journal.transactions.find((candidate) => candidate.transactionId === rebind.transactionId)
  if (!transaction || transaction.operation !== "OUTCOME" || transaction.phase !== "RECONCILIATION_HELD"
    || transaction.transactionId !== `outcome-${entry.fullIdentityHash}-${transaction.journalFencingToken}`
    || transaction.fullIdentityHash !== entry.fullIdentityHash || transaction.schedulerFencingToken !== entry.schedulerFencingToken
    || transaction.expectedSchedulerVersion !== transaction.detail?.expectedSchedulerVersion
    || transaction.detail?.ambiguous !== true || transaction.detail?.terminal !== false) {
    wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationLeaseRebind.transaction", "EXACT_HELD_OUTCOME_REQUIRED")
  }
  if (transaction.immutableOutcomeDetailHash !== computedImmutableOutcomeDetailHash(transaction)
    || rebind.immutableOutcomeDetailHash !== transaction.immutableOutcomeDetailHash) {
    wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationLeaseRebind.immutableOutcomeDetailHash", "EXACT_IMMUTABLE_OUTCOME_REQUIRED")
  }
  const original = transaction.detail.entry
  const originalClaim = reconciliationClaim(original)
  const { proofHash: _proofHash, ...signedProof } = proof
  if (original.workOrderId !== entry.workOrderId || original.laneId !== entry.laneId
    || original.schedulerRunId !== entry.schedulerRunId || original.attempt !== entry.attempt
    || original.schedulerFencingToken !== entry.schedulerFencingToken
    || canonicalSchedulerJson(originalClaim) !== canonicalSchedulerJson(entry.reconciliationAuthorityClaim)
    || canonicalSchedulerJson(transaction.detail.claim) !== canonicalSchedulerJson(originalClaim)
    || transaction.detail.effectiveOutcome !== entry.outcome
    || canonicalSchedulerJson(transaction.detail.reconciliation?.ownerProof) !== canonicalSchedulerJson(signedProof)
    || schedulerHash(transaction.detail.reconciliation?.ownerProof) !== proof.proofHash
    || transaction.detail.reconciliationOwnerProofHash !== proof.proofHash
    || transaction.detail.reconciliation?.ownerId !== entry.reconciliationOwner
    || transaction.detail.reconciliation?.deadline !== entry.reconciliationDeadline) {
    wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationLeaseRebind.transactionDetail", "EXACT_ORIGINAL_GRANT_REQUIRED")
  }
  const superseding = journal.transactions.find((candidate) => candidate.journalFencingToken > transaction.journalFencingToken
    && (candidate.fullIdentityHash === entry.fullIdentityHash
      || candidate.detail?.entries?.some((item) => item.entry?.fullIdentityHash === entry.fullIdentityHash)))
  if (superseding) wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationLeaseRebind.transaction", "SUPERSEDED_OR_STALE")
  const lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
    .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
  const event = loadEvidenceEvent(configuration, rebind.evidenceEventId)
  if (!lane || lane.workerId !== entry.workerId || lane.fencingToken !== entry.leaseFencingToken
    || !event || event.eventHash !== rebind.evidenceEventHash || event.eventType !== "PROVIDER"
    || event.scope?.programId !== entry.programId || event.scope?.goalId !== entry.goalId || event.scope?.loopId !== entry.loopId
    || event.scope?.workOrderId !== entry.workOrderId || event.scope?.laneId !== entry.laneId || event.scope?.runId !== entry.schedulerRunId
    || event.writer?.writerId !== entry.workerId || event.writer?.providerId !== entry.providerId || event.writer?.adapterId !== entry.adapterId
    || event.leaseAttribution?.storeId !== configuration.leaseStoreId || event.leaseAttribution?.fencingToken !== entry.leaseFencingToken
    || event.leaseAttribution?.checkpointSequence !== lane.checkpointSequence
    || event.leaseAttribution?.checkpointEvidenceHash !== schedulerHash(lane.checkpointEvidence)
    || event.payload?.immutableOutcomeDetailHash !== transaction.immutableOutcomeDetailHash
    || event.payload?.responseContentHash !== transaction.detail.responseHash) {
    wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationLeaseRebind.evidence", "VERIFIED_NEW_FENCE_EVIDENCE_REQUIRED")
  }
}

export function scheduleEligibleSet(configuration, input) {
  validateSchedulerConfiguration(configuration)
  exact(input, new Set(["expectedVersion", "dagInput", "dispatchClaims", "providerCapabilities", "budgets"]), "input")
  if (typeof configuration.statePath !== "string" || configuration.statePath.trim() === "") wall("SCHEDULER_CONFIGURATION_WALL", "statePath")
  identifier(configuration.stateId, "stateId")
  for (const field of ["reservationLedgerPath", "leaseStorePath", "evidenceLedgerDir", "leaseTokenKey"]) {
    if (typeof configuration[field] !== "string" || configuration[field].length < (field === "leaseTokenKey" ? 32 : 1)) wall("SCHEDULER_CONFIGURATION_WALL", field)
  }
  for (const field of ["reservationLedgerId", "leaseStoreId", "evidenceLedgerId"]) identifier(configuration[field], field)
  integer(configuration.leaseDurationMs, "leaseDurationMs", 100)
  integer(configuration.reconciliationBatchCeiling, "reconciliationBatchCeiling", 1)
  const now = configuration.now()
  integer(now, "now")
  integer(input.expectedVersion, "expectedVersion")
  if (!Array.isArray(input.dispatchClaims)) wall("SCHEDULER_TYPE_WALL", "dispatchClaims")
  if (!Array.isArray(input.providerCapabilities)) wall("SCHEDULER_TYPE_WALL", "providerCapabilities")
  const budgets = validateBudgets(input.budgets)
  const bundle = loadPinnedTrustBundle(configuration.trustBundleReference)
  const configurationHash = schedulerConfigurationHash(configuration, budgets)
  const dag = resolveDagEligibleSet(input.dagInput)
  const eligibleIds = dag.eligible.map((entry) => entry.workOrderId)
  const claimIds = input.dispatchClaims.map((entry) => entry.workOrderId)
  if (new Set(claimIds).size !== claimIds.length || claimIds.some((id) => !eligibleIds.includes(id))
    || eligibleIds.some((id) => !claimIds.includes(id))) {
    wall("SCHEDULER_DAG_WALL", "dispatchClaims", "EXACT_DERIVED_ELIGIBLE_SET_REQUIRED")
  }
  const capabilities = new Map(input.providerCapabilities.map((value) => {
    const capability = normalizeProviderCapability(value)
    return [capability.providerId, capability]
  }))
  const envelopes = new Map(input.dagInput.workOrders.map((envelope) => [envelope.workOrderId, envelope]))
  const works = eligibleIds.map((workOrderId) => {
    const work = normalizeWork(input.dispatchClaims.find((entry) => entry.workOrderId === workOrderId), bundle, now, configurationHash)
    const envelope = envelopes.get(workOrderId)
    exactMatch({
      programId: work.programId, goalId: work.goalId, loopId: work.loopId,
      workOrderId: work.workOrderId, laneId: work.laneId, repositories: work.repositories,
      riskClass: work.riskClass, allowedActions: work.allowedActions,
    }, {
      programId: envelope.programId, goalId: envelope.goalId, loopId: envelope.loopId,
      workOrderId: envelope.workOrderId, laneId: envelope.laneId, repositories: envelope.repositories,
      riskClass: envelope.riskClass, allowedActions: envelope.allowedActions,
    }, "work.envelopeScope")
    if (envelope.teamRoles[work.requestedRole] !== work.workerId
      || ![...envelope.preferredProviders, ...envelope.fallbackProviders].includes(work.providerId)) {
      wall("SCHEDULER_SCOPE_WALL", "work.envelopeIdentity")
    }
    exactMatch({
      paths: work.reservationSet.reservations.paths,
      contracts: work.reservationSet.reservations.contracts,
      environments: work.reservationSet.reservations.environments,
      repositories: work.reservationSet.reservations.repositories,
      protectedResources: work.reservationSet.reservations.protectedResources,
    }, {
      paths: envelope.reservations.paths,
      contracts: envelope.reservations.contracts,
      environments: envelope.reservations.environments,
      repositories: [],
      protectedResources: [],
    }, "work.reservationContent")
    return work
  })
  const ids = works.map((work) => work.fullIdentityHash)
  if (new Set(ids).size !== ids.length) wall("SCHEDULER_REPLAY_WALL", "dispatchClaims", "DUPLICATE_FULL_IDENTITY")
  const unlock = acquireLock(configuration)
  try {
    const state = loadState(configuration.statePath, configuration.stateId)
    if (state.version !== input.expectedVersion) wall("SCHEDULER_CAS_WALL", "expectedVersion", `${state.version}`)
    const scheduled = []
    const blocked = []
    const transactions = []
    try {
      for (const work of works) {
      if ([...state.released, ...state.active, ...state.reconciliation]
        .some((entry) => entry.fullIdentityHash === work.fullIdentityHash)) {
        blocked.push({ workOrderId: work.workOrderId, code: "RELEASED_OR_ACTIVE_REPLAY" }); continue
      }
      const scopeReplay = [...state.active, ...state.released, ...state.reconciliation]
        .find((entry) => entry.dispatchId === work.dispatchId || (entry.workOrderId === work.workOrderId && entry.laneId === work.laneId))
      if (scopeReplay) { blocked.push({ workOrderId: work.workOrderId, code: "SCOPE_MUTATION_REPLAY" }); continue }
      const capability = capabilities.get(work.providerId)
      if (!capability || capability.adapterId !== work.adapterId || capability.availability !== "AVAILABLE"
        || !capability.riskClasses.includes(work.riskClass) || !capability.roles.includes(work.requestedRole)
        || work.repositories.some((repository) => !capability.repositories.includes(repository))
        || work.allowedActions.some((action) => !capability.actions.includes(action))
        || !capability.supportsCancellation || !capability.supportsArtifacts
        || !capability.supportsSanitizedEvidence || !capability.serviceCompatible) {
        blocked.push({ workOrderId: work.workOrderId, code: "PROVIDER_CAPABILITY_UNSUPPORTED" }); continue
      }
      if ([...state.active, ...state.reconciliation]
        .filter((entry) => entry.providerId === work.providerId).length >= capability.maxConcurrency) {
        blocked.push({ workOrderId: work.workOrderId, code: `CAPACITY_EXHAUSTED:capability:${work.providerId}` }); continue
      }
      const ceiling = hasCapacity(state, work, budgets)
      if (ceiling) { blocked.push({ workOrderId: work.workOrderId, code: ceiling }); continue }
      if (!compatible([...state.active, ...state.reconciliation], work)) { blocked.push({ workOrderId: work.workOrderId, code: "RESERVATION_COLLISION" }); continue }
      for (const [from, to] of [["PLANNED", "AUTHORITY_MATCHED"], ["AUTHORITY_MATCHED", "DEPENDENCY_CLEARED"], ["DEPENDENCY_CLEARED", "RESERVED"], ["RESERVED", "LEASED"], ["LEASED", "PROVIDER_DISPATCHED"]]) {
        transitionLifecycle({ from, to, reasonCode: null, failureClass: null, authorityGap: { present: false, condition: null, conditionRef: null } })
      }
      const transactionId = beginTransaction(configuration, "SCHEDULE", { ...work, schedulerFencingToken: state.nextFence }, {
        expectedSchedulerVersion: state.version, work,
      }, now)
      transactions.push({ transactionId, work })
      const phase = acquirePhaseTwoClaim(configuration, work, transactionId, state.nextFence)
      record(state, "TRUST_VERIFIED", work, now, { trustArtifactHash: work.trustArtifact.artifactHash, trustBundleHash: bundle.bundleHash })
      record(state, "AUTHORITY_VERIFIED", work, now, { authorityGrantHash: work.authorityGrant.grantHash })
      record(state, "CAPACITY_RESERVED", work, now)
      record(state, "RESERVATION_ACQUIRED", work, now, { reservationSetId: work.reservationSet.reservationSetId })
      record(state, "LIFECYCLE_PROVIDER_DISPATCHED", work, now)
      const entry = activeEntry(work, state.nextFence, phase.lease.fencingToken, phase.reservation.fencingToken, now)
      entry.lastEvidenceEventId = phase.evidence.event.eventId
      state.nextFence += 1
      state.active.push(entry)
      scheduled.push(entry)
        advanceTransaction(configuration, transactionId, "STORES_APPLIED", {
          schedulerFencingToken: entry.schedulerFencingToken,
          leaseFencingToken: entry.leaseFencingToken,
          reservationFencingToken: entry.reservationFencingToken,
        })
      }
    } catch (error) {
      for (const entry of [...scheduled].reverse()) {
        const transaction = transactions.find((candidate) => candidate.work.fullIdentityHash === entry.fullIdentityHash)
        const rollbackError = rollbackPhaseTwoClaim(configuration, transaction.work, entry.reservationFencingToken, entry.leaseFencingToken)
        advanceTransaction(configuration, transaction.transactionId, rollbackError ? "RECOVERY_REQUIRED" : "ROLLED_BACK", {}, rollbackError ?? error?.code ?? "SCHEDULE_BATCH_FAILURE")
      }
      throw error
    }
    try {
      injectFailure(configuration, "SCHEDULE:SCHEDULER_STATE")
      durableWrite(configuration.statePath, state)
    } catch (error) {
      for (const transaction of [...transactions].reverse()) {
        const entry = scheduled.find((candidate) => candidate.fullIdentityHash === transaction.work.fullIdentityHash)
        const rollbackError = rollbackPhaseTwoClaim(configuration, transaction.work, entry?.reservationFencingToken ?? null, entry?.leaseFencingToken ?? null)
        advanceTransaction(configuration, transaction.transactionId, rollbackError ? "RECOVERY_REQUIRED" : "ROLLED_BACK", {}, rollbackError ?? error?.code ?? "SCHEDULER_STATE_WRITE_FAILURE")
      }
      throw error
    }
    for (const transaction of transactions) advanceTransaction(configuration, transaction.transactionId, "COMMITTED")
    return result("ELIGIBLE_SET_SCHEDULED", { scheduled: Object.freeze(scheduled), blocked: Object.freeze(blocked), stateVersion: state.version, dagResultHash: schedulerHash(dag), derivedEligibleWorkOrderIds: Object.freeze(eligibleIds), sideEffectOrder: Object.freeze(["TRUST", "AUTHORITY", "CAPACITY", "RESERVATION", "LIFECYCLE", "EVIDENCE"]) })
  } finally { unlock() }
}

export function recordProviderOutcome(configuration, input) {
  validateSchedulerConfiguration(configuration)
  exact(input, new Set(["expectedVersion", "claim", "delivery", "reconciliation"]), "outcome")
  exact(input.claim, new Set(["schedulerRunId", "attempt", "fullIdentityHash", "schedulerFencingToken", "leaseFencingToken", "reservationFencingToken"]), "outcome.claim")
  exact(input.delivery, new Set(["kind", "providerResponse", "reasonCode", "evidence"]), "outcome.delivery")
  integer(input.expectedVersion, "expectedVersion")
  for (const field of ["attempt", "schedulerFencingToken", "leaseFencingToken", "reservationFencingToken"]) integer(input.claim[field], `outcome.claim.${field}`, 1)
  identifier(input.claim.schedulerRunId, "outcome.claim.schedulerRunId")
  if (!HASH.test(input.claim.fullIdentityHash)) wall("SCHEDULER_OUTCOME_WALL", "outcome.claim.fullIdentityHash")
  const now = configuration.now(); integer(now, "now")
  const bundle = loadPinnedTrustBundle(configuration.trustBundleReference)
  const unlock = acquireLock(configuration)
  try {
    const state = loadState(configuration.statePath, configuration.stateId)
    if (state.version !== input.expectedVersion) wall("SCHEDULER_CAS_WALL", "expectedVersion", `${state.version}`)
    const index = state.active.findIndex((entry) => entry.fullIdentityHash === input.claim.fullIdentityHash)
    const releasedReplay = index < 0 ? state.released.find((entry) => entry.fullIdentityHash === input.claim.fullIdentityHash) : null
    if (index < 0 && !releasedReplay) wall("SCHEDULER_FENCE_WALL", "fullIdentity", "ACTIVE_OR_RELEASED_EXACT_IDENTITY_REQUIRED")
    const entry = index >= 0 ? state.active[index] : releasedReplay
    exactMatch(input.claim, releasedReplay?.terminalClaim ?? reconciliationClaim(entry), "outcome.claim")
    let providerState
    let reasonCode
    let responseHash
    let normalizedResponse = null
    let attributionMatch = false
    if (input.delivery.kind === "PROVIDER_RESPONSE") {
      if (input.delivery.reasonCode !== null) wall("SCHEDULER_OUTCOME_WALL", "outcome.delivery.reasonCode", "NULL_FOR_RESPONSE_REQUIRED")
      const response = validateProviderResponse(input.delivery.providerResponse)
      normalizedResponse = response
      providerState = response.providerState
      reasonCode = response.reasonCode
      responseHash = schedulerHash(response)
      attributionMatch = response.providerId === entry.providerId && response.adapterId === entry.adapterId
        && response.dispatchId === entry.dispatchId && response.workOrderId === entry.workOrderId
        && response.laneId === entry.laneId
    } else if (["TRANSPORT_ERROR", "AUTHENTICATION_ERROR", "RATE_LIMIT", "SERVER_ERROR", "TIMEOUT", "MALFORMED_RESPONSE"].includes(input.delivery.kind)) {
      if (input.delivery.providerResponse !== null) wall("SCHEDULER_OUTCOME_WALL", "outcome.delivery.providerResponse", "NULL_REQUIRED")
      reasonCode = identifier(input.delivery.reasonCode, "outcome.delivery.reasonCode")
      providerState = "UNKNOWN"
      responseHash = schedulerHash({ kind: input.delivery.kind, reasonCode })
    } else wall("SCHEDULER_OUTCOME_WALL", "outcome.delivery.kind")
    const effectiveOutcome = attributionMatch || input.delivery.kind !== "PROVIDER_RESPONSE" ? providerState : "ATTRIBUTION_MISMATCH"
    const ambiguous = input.delivery.kind !== "PROVIDER_RESPONSE" || !attributionMatch || providerState === "UNKNOWN"
    const terminal = !ambiguous && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(providerState)
    const normalizedEvidence = sanitizedEvidence(input.delivery.evidence)
    const evidenceHash = schedulerHash(normalizedEvidence)
    const terminalDeliveryHash = terminal ? schedulerHash({ claim: input.claim, response: normalizedResponse, evidence: normalizedEvidence }) : null
    if (releasedReplay) {
      if (!terminal || releasedReplay.terminalDeliveryHash !== terminalDeliveryHash) wall("SCHEDULER_TERMINAL_REPLAY_WALL", "outcome", "IDENTICAL_TERMINAL_DELIVERY_REQUIRED")
      return result("OUTCOME_TERMINAL_RELEASED", { ...releasedReplay.terminalResult, stateVersion: state.version, idempotent: true })
    }
    let proof = null
    if (ambiguous) {
      exact(input.reconciliation, new Set(["ownerId", "deadline", "ownerProof"]), "outcome.reconciliation")
      const deadline = instant(input.reconciliation.deadline, "outcome.reconciliation.deadline")
      if (deadline <= now) wall("SCHEDULER_RECONCILIATION_WALL", "reconciliationDeadline", "FUTURE_DEADLINE_REQUIRED")
      proof = validateReconciliationOwnerProof(input.reconciliation.ownerProof, bundle, entry, now, deadline)
      if (input.reconciliation.ownerId !== proof.ownerId) wall("SCHEDULER_RECONCILIATION_WALL", "outcome.reconciliation.ownerId")
      assertCurrentActiveReconciliationLease(configuration, entry, proof)
    } else if (input.reconciliation !== null) wall("SCHEDULER_RECONCILIATION_WALL", "outcome.reconciliation", "NULL_FOR_ATTRIBUTED_RESPONSE_REQUIRED")
    const transactionId = beginTransaction(configuration, "OUTCOME", entry, {
      expectedSchedulerVersion: state.version, entry, claim: input.claim, effectiveOutcome, providerState,
      reasonCode, responseHash, terminal, ambiguous, reconciliation: input.reconciliation,
      reconciliationOwnerProofHash: proof?.proofHash ?? null,
    }, now)
    const immutableOutcomeDetailHash = loadJournal(configuration).transactions.find((candidate) => candidate.transactionId === transactionId).immutableOutcomeDetailHash
    let phase
    try {
      phase = phaseOutcome(configuration, entry, ambiguous ? "UNKNOWN" : providerState, ambiguous ? reasonCode ?? "ATTRIBUTION_MISMATCH" : reasonCode, responseHash, terminal, ambiguous, proof?.leaseFencingToken ?? null, immutableOutcomeDetailHash)
    } catch (error) {
      const recoveryConfiguration = { ...configuration }; delete recoveryConfiguration.failureInjector
      const lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
        .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
      try {
        if (terminal && lane?.status === "RELEASED") {
          const reservationRelease = releaseReservations(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
            schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_RELEASE_REQUEST",
            reservationSetId: entry.reservationSet.reservationSetId, holderToken: holderToken(configuration, entry), fencingToken: entry.reservationFencingToken,
          }, phaseOptions(recoveryConfiguration))
          if (!reservationRelease.released) wall("SCHEDULER_RESERVATION_WALL", "reservationLedger", reservationRelease.status)
          phase = { checkpoint: { lifecycleState: lane.lifecycleState, checkpointSequence: lane.checkpointSequence }, evidence: { recoveredFromDurableLedger: true } }
        } else {
          phase = phaseOutcome(recoveryConfiguration, entry, ambiguous ? "UNKNOWN" : providerState, ambiguous ? reasonCode ?? "ATTRIBUTION_MISMATCH" : reasonCode, responseHash, terminal, ambiguous, proof?.leaseFencingToken ?? null, immutableOutcomeDetailHash)
        }
      } catch (recoveryError) {
        advanceTransaction(configuration, transactionId, "RECOVERY_REQUIRED", {}, recoveryError?.code ?? error?.code ?? "OUTCOME_PHASE_FAILURE")
        throw recoveryError
      }
    }
    advanceTransaction(configuration, transactionId, "STORES_APPLIED", { lifecycleState: phase.checkpoint.lifecycleState })
    entry.lifecycleState = phase.checkpoint.lifecycleState
    entry.lastEvidenceEventId = phase.evidence.event?.eventId ?? entry.lastEvidenceEventId
    record(state, "EVIDENCE_PROVIDER_OUTCOME", entry, now, { outcome: effectiveOutcome, evidenceHash, phaseEvidenceHash: schedulerHash(phase.evidence) })
    record(state, "LIFECYCLE_PROVIDER_OUTCOME", entry, now, { outcome: effectiveOutcome, lifecycleState: entry.lifecycleState })
    record(state, "CHECKPOINT_PROVIDER_OUTCOME", entry, now, { outcome: effectiveOutcome, evidenceHash, leaseFencingToken: entry.leaseFencingToken })
    if (ambiguous) {
      state.active.splice(index, 1)
      state.reconciliation.push({ ...entry, status: "RECONCILIATION_REQUIRED", outcome: effectiveOutcome, reconciliationOwner: input.reconciliation.ownerId, reconciliationOwnerProofHash: proof.proofHash, reconciliationGrantExpiresAt: proof.expiresAt, reconciliationDeadline: input.reconciliation.deadline,
        reconciliationAuthorityClaim: reconciliationClaim(entry), reconciliationLeaseRebind: null, fenced: true })
      record(state, "AMBIGUOUS_OUTCOME_FENCED", entry, now, { reconciliationOwner: input.reconciliation.ownerId, reconciliationOwnerProofHash: proof.proofHash, reconciliationDeadline: input.reconciliation.deadline })
    } else if (terminal) {
      state.active.splice(index, 1)
      const terminalResult = { outcome: effectiveOutcome, capacityReleased: true, fencedForReconciliation: false, lifecycleState: entry.lifecycleState }
      state.released.push({ ...entry, status: "RELEASED", outcome: effectiveOutcome, releasedAt: new Date(now).toISOString(),
        terminalClaim: input.claim, terminalDeliveryHash, terminalResult })
      record(state, "TERMINAL_RELEASED", entry, now, { outcome: effectiveOutcome })
    } else {
      record(state, "CHECKPOINT_RECORDED", entry, now, { lifecycleState: entry.lifecycleState })
    }
    try {
      injectFailure(configuration, "OUTCOME:SCHEDULER_STATE")
      durableWrite(configuration.statePath, state)
    } catch (error) {
      try { durableWrite(configuration.statePath, state) } catch (recoveryError) {
        advanceTransaction(configuration, transactionId, "RECOVERY_REQUIRED", {}, recoveryError?.code ?? error?.code ?? "OUTCOME_STATE_FAILURE")
        throw recoveryError
      }
    }
    advanceTransaction(configuration, transactionId, "COMMITTED")
    return result(ambiguous ? "OUTCOME_RECONCILIATION_REQUIRED" : terminal ? "OUTCOME_TERMINAL_RELEASED" : "OUTCOME_CHECKPOINTED", { outcome: effectiveOutcome, stateVersion: state.version, capacityReleased: terminal, fencedForReconciliation: ambiguous, lifecycleState: entry.lifecycleState })
  } finally { unlock() }
}

export function reapAmbiguousOutcomes(configuration, input) {
  validateSchedulerConfiguration(configuration)
  exact(input, new Set(["expectedVersion", "claims", "maxBatch"]), "reaper")
  integer(input.expectedVersion, "expectedVersion")
  integer(input.maxBatch, "reaper.maxBatch", 1)
  if (input.maxBatch > configuration.reconciliationBatchCeiling) wall("SCHEDULER_RECONCILIATION_WALL", "reaper.maxBatch", "BATCH_CEILING_EXCEEDED")
  if (!Array.isArray(input.claims) || input.claims.length === 0 || input.claims.length > input.maxBatch) wall("SCHEDULER_RECONCILIATION_WALL", "reaper.claims", "BOUNDED_NONEMPTY_BATCH_REQUIRED")
  const now = configuration.now(); integer(now, "now")
  const bundle = loadPinnedTrustBundle(configuration.trustBundleReference)
  const unlock = acquireLock(configuration)
  try {
    const state = loadState(configuration.statePath, configuration.stateId)
    if (state.version !== input.expectedVersion) wall("SCHEDULER_CAS_WALL", "expectedVersion", `${state.version}`)
    const leaseSnapshot = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId)
    const reservationSnapshot = inspectReservationLedgerExact(configuration)
    if (!leaseSnapshot.ok || !reservationSnapshot.valid) wall("SCHEDULER_RECONCILIATION_WALL", "reaper.stores", "VERIFIED_STORES_REQUIRED")
    const validated = []
    const identities = new Set()
    for (const claim of input.claims) {
      exact(claim, new Set(["schedulerRunId", "attempt", "fullIdentityHash", "schedulerFencingToken", "leaseFencingToken", "reservationFencingToken", "ownerProof"]), "reaper.claim")
      if (identities.has(claim.fullIdentityHash)) wall("SCHEDULER_RECONCILIATION_WALL", "reaper.claims", "UNIQUE_IDENTITIES_REQUIRED")
      identities.add(claim.fullIdentityHash)
      const entry = state.reconciliation.find((candidate) => candidate.fullIdentityHash === claim.fullIdentityHash)
      if (!entry) wall("SCHEDULER_RECONCILIATION_WALL", "reaper.claim", "EXACT_RECONCILIATION_IDENTITY_REQUIRED")
      exactMatch({ schedulerRunId: claim.schedulerRunId, attempt: claim.attempt, fullIdentityHash: claim.fullIdentityHash, schedulerFencingToken: claim.schedulerFencingToken, leaseFencingToken: claim.leaseFencingToken, reservationFencingToken: claim.reservationFencingToken }, reconciliationClaim(entry), "reaper.claim")
      const proof = validateReconciliationOwnerProof(claim.ownerProof, bundle, reconciliationAuthorityEntry(entry), Date.parse(entry.reconciliationDeadline), Date.parse(entry.reconciliationDeadline))
      if (proof.ownerId !== entry.reconciliationOwner || proof.proofHash !== entry.reconciliationOwnerProofHash || proof.expiresAt !== entry.reconciliationGrantExpiresAt) wall("SCHEDULER_RECONCILIATION_WALL", "reaper.ownerProof", "ORIGINAL_DURABLE_OWNER_GRANT_REQUIRED")
      validateReconciliationLeaseRebind(configuration, state, entry, proof)
      if (Date.parse(entry.reconciliationDeadline) > now) wall("SCHEDULER_RECONCILIATION_WALL", "reaper.claim", "DEADLINE_NOT_REACHED")
      const lane = leaseSnapshot.lanes.find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
      if (!lane || lane.workerId !== entry.workerId || lane.fencingToken !== entry.leaseFencingToken || !["ACTIVE", "EXPIRED"].includes(lane.status)
        || lane.lifecycleState !== entry.lifecycleState) wall("SCHEDULER_FENCE_WALL", "reaper.leaseStore", "EXACT_ACTIVE_CHECKPOINT_REQUIRED")
      const reservation = reservationSnapshot.reservations.find((candidate) => candidate.reservationSetId === entry.reservationSet.reservationSetId)
      if (!reservation || reservation.workerId !== entry.workerId || reservation.workOrderId !== entry.workOrderId
        || reservation.laneId !== entry.laneId || reservation.fencingToken !== entry.reservationFencingToken
        || schedulerHash(reservation.reservationSet) !== schedulerHash(entry.reservationSet)) {
        wall("SCHEDULER_FENCE_WALL", "reaper.reservationLedger", "EXACT_ACTIVE_RESERVATION_REQUIRED")
      }
      const assessment = assessEntryStores(configuration, entry)
      if (!assessment.healthy && !(assessment.expired && assessment.exactReservation && assessment.exactEvidence)) wall("SCHEDULER_FENCE_WALL", "reaper.stores", "EXACT_CHECKPOINT_EVIDENCE_REQUIRED")
      validated.push({ entry, proof, responseHash: schedulerHash({ claim: reconciliationClaim(entry), proofHash: proof.proofHash }) })
    }
    const batchIdentity = schedulerHash(validated.map(({ entry }) => reconciliationClaim(entry)))
    const transactionId = beginTransaction(configuration, "REAP_BATCH", {
      fullIdentityHash: batchIdentity, schedulerFencingToken: Math.max(...validated.map(({ entry }) => entry.schedulerFencingToken)),
    }, { expectedSchedulerVersion: state.version, entries: validated.map(({ entry, responseHash }) => ({ entry, responseHash })) }, now)
    const released = []
    for (const { entry, proof, responseHash } of validated) {
      let phase
      try {
        phase = phaseOutcome(configuration, entry, "FAILED", "RECONCILIATION_DEADLINE_EXPIRED", responseHash, true, false)
      } catch (error) {
        const recoveryConfiguration = { ...configuration }; delete recoveryConfiguration.failureInjector
        const lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
          .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
        try {
          if (lane?.status === "RELEASED") {
            const reservationRelease = releaseReservations(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
              schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_RELEASE_REQUEST", reservationSetId: entry.reservationSet.reservationSetId,
              holderToken: holderToken(configuration, entry), fencingToken: entry.reservationFencingToken,
            }, phaseOptions(recoveryConfiguration))
            if (!reservationRelease.released) wall("SCHEDULER_RESERVATION_WALL", "reservationLedger", reservationRelease.status)
            phase = { checkpoint: { lifecycleState: lane.lifecycleState, checkpointSequence: lane.checkpointSequence }, evidence: { recoveredFromDurableLedger: true } }
          } else phase = phaseOutcome(recoveryConfiguration, entry, "FAILED", "RECONCILIATION_DEADLINE_EXPIRED", responseHash, true, false)
        } catch (recoveryError) {
          advanceTransaction(configuration, transactionId, "RECOVERY_REQUIRED", {}, recoveryError?.code ?? error?.code ?? "REAPER_PHASE_FAILURE")
          throw recoveryError
        }
      }
      entry.lifecycleState = phase.checkpoint.lifecycleState
      entry.lastEvidenceEventId = phase.evidence.event?.eventId ?? entry.lastEvidenceEventId
      const index = state.reconciliation.findIndex((candidate) => candidate.fullIdentityHash === entry.fullIdentityHash)
      state.reconciliation.splice(index, 1)
      state.released.push({ ...entry, status: "RELEASED", outcome: "AMBIGUOUS_REAPED", releasedAt: new Date(now).toISOString(), reconciliationOwner: proof.ownerId })
      record(state, "AMBIGUOUS_REAPED_RELEASED", entry, now, { reconciliationOwner: proof.ownerId, ownerProofHash: proof.proofHash })
      released.push(entry.fullIdentityHash)
    }
    advanceTransaction(configuration, transactionId, "STORES_APPLIED", { released })
    try {
      injectFailure(configuration, "REAP:SCHEDULER_STATE")
      durableWrite(configuration.statePath, state)
    } catch { durableWrite(configuration.statePath, state) }
    for (const { entry } of validated) {
      if (entry.reconciliationLeaseRebind) advanceTransaction(configuration, entry.reconciliationLeaseRebind.transactionId, "SUPERSEDED_BY_REAP")
    }
    advanceTransaction(configuration, transactionId, "COMMITTED")
    return result("AMBIGUOUS_REAPER_COMPLETE", { released: Object.freeze(released), stateVersion: state.version, capacityRecovered: released.length })
  } finally { unlock() }
}

export function recoverSchedulerTransactions(configuration) {
  validateSchedulerConfiguration(configuration)
  const recoveryConfiguration = { ...configuration }; delete recoveryConfiguration.failureInjector
  const now = configuration.now(); integer(now, "now")
  const unlock = acquireLock(configuration)
  try {
    const journal = loadJournal(configuration)
    const state = loadState(configuration.statePath, configuration.stateId)
    const recovered = []
    let stateChanged = false
    const pendingTransactions = journal.transactions
      .filter((candidate) => !TERMINAL_TRANSACTION_PHASES.has(candidate.phase))
      .sort((left, right) => left.journalFencingToken - right.journalFencingToken)
    const transactionFirstIdentities = new Set()
    for (const transaction of pendingTransactions) {
      if (["OUTCOME", "REAP"].includes(transaction.operation)) transactionFirstIdentities.add(transaction.fullIdentityHash)
      if (transaction.operation === "REAP_BATCH") {
        for (const item of transaction.detail.entries) transactionFirstIdentities.add(item.entry.fullIdentityHash)
      }
    }
    for (const transaction of pendingTransactions) {
      const detail = transaction.detail
      if (transaction.operation === "STORE_RECONCILIATION") {
        const candidate = state.active.find((entry) => entry.fullIdentityHash === transaction.fullIdentityHash)
          ?? state.reconciliation.find((entry) => entry.fullIdentityHash === transaction.fullIdentityHash)
        if (!candidate || assessEntryStores(recoveryConfiguration, candidate).healthy) {
          transaction.phase = "COMMITTED"; transaction.errorCode = null; recovered.push(transaction.transactionId)
        }
        continue
      }
      if (transaction.operation === "REAP_BATCH") {
        let complete = true
        for (const item of detail.entries) {
          const alreadyReleased = state.released.find((entry) => entry.fullIdentityHash === item.entry.fullIdentityHash)
          if (alreadyReleased) continue
          const entry = state.reconciliation.find((candidate) => candidate.fullIdentityHash === item.entry.fullIdentityHash) ?? item.entry
          try {
            const lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
              .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
            if (["ACTIVE", "EXPIRED"].includes(lane?.status)) {
              phaseOutcome(recoveryConfiguration, entry, "FAILED", "RECONCILIATION_DEADLINE_EXPIRED", item.responseHash, true, false)
            } else if (lane?.status !== "RELEASED") wall("SCHEDULER_FENCE_WALL", "recovery.reapBatch", "DURABLE_TERMINAL_LANE_REQUIRED")
            const reservation = inspectReservationLedgerExact(configuration).reservations
              .find((candidate) => candidate.reservationSetId === entry.reservationSet.reservationSetId)
            if (reservation) {
              const release = releaseReservations(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
                schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_RELEASE_REQUEST", reservationSetId: entry.reservationSet.reservationSetId,
                holderToken: holderToken(configuration, entry), fencingToken: entry.reservationFencingToken,
              }, phaseOptions(recoveryConfiguration))
              if (!release.released) wall("SCHEDULER_RESERVATION_WALL", "recovery.reapBatch", release.status)
            }
            const index = state.reconciliation.findIndex((candidate) => candidate.fullIdentityHash === entry.fullIdentityHash)
            if (index >= 0) state.reconciliation.splice(index, 1)
            const releasedLane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
              .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
            applyDurableOutcomeProjection(recoveryConfiguration, entry, releasedLane)
            state.released.push({ ...entry, status: "RELEASED", outcome: "AMBIGUOUS_REAPED", releasedAt: new Date(now).toISOString() })
            record(state, "TRANSACTION_RECOVERY_REAP_BATCH_RELEASED", entry, now, { transactionId: transaction.transactionId })
            stateChanged = true
          } catch (error) {
            transaction.errorCode = error?.code ?? "REAP_BATCH_RECOVERY_FAILURE"; complete = false; break
          }
        }
        if (complete) { transaction.phase = "COMMITTED"; transaction.errorCode = null; recovered.push(transaction.transactionId) }
        continue
      }
      const active = state.active.find((entry) => entry.fullIdentityHash === transaction.fullIdentityHash)
      const reconciling = state.reconciliation.find((entry) => entry.fullIdentityHash === transaction.fullIdentityHash)
      const released = state.released.find((entry) => entry.fullIdentityHash === transaction.fullIdentityHash)
      if (released) {
        transaction.phase = "COMMITTED"; transaction.errorCode = null; recovered.push(transaction.transactionId); continue
      }
      if (transaction.operation === "SCHEDULE") {
        if (active || reconciling) transaction.phase = "COMMITTED"
        else {
          const rollbackError = rollbackPhaseTwoClaim(recoveryConfiguration, detail.work, detail.reservationFencingToken ?? null, detail.leaseFencingToken ?? null)
          transaction.phase = rollbackError ? "RECOVERY_REQUIRED" : "ROLLED_BACK"; transaction.errorCode = rollbackError
        }
        recovered.push(transaction.transactionId); continue
      }
      if (transaction.operation === "OUTCOME" && transaction.phase === "RECONCILIATION_HELD") {
        try {
          if (!reconciling?.reconciliationLeaseRebind || reconciling.reconciliationLeaseRebind.transactionId !== transaction.transactionId) {
            wall("SCHEDULER_RECONCILIATION_WALL", "recovery.reconciliationLeaseRebind", "EXACT_HELD_RECONCILIATION_REQUIRED")
          }
          const bundle = loadPinnedTrustBundle(configuration.trustBundleReference)
          const proof = validateReconciliationOwnerProof(detail.reconciliation.ownerProof, bundle, reconciliationAuthorityEntry(reconciling), Date.parse(detail.reconciliation.deadline), Date.parse(detail.reconciliation.deadline))
          validateReconciliationLeaseRebind(configuration, state, reconciling, proof)
          transaction.errorCode = null
        } catch (error) {
          transaction.phase = "RECOVERY_REQUIRED"; transaction.errorCode = error?.code ?? "HELD_RECONCILIATION_INVALID"
        }
        continue
      }
      const entry = active ?? reconciling ?? detail.entry
      const lane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
        .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
      if (!lane) { transaction.phase = "RECOVERY_REQUIRED"; transaction.errorCode = "DURABLE_LANE_REQUIRED"; continue }
      if (detail.terminal || transaction.operation === "REAP") {
        if (["ACTIVE", "EXPIRED"].includes(lane.status)) {
          phaseOutcome(recoveryConfiguration, entry, detail.providerState ?? "FAILED", detail.reasonCode ?? "RECONCILIATION_DEADLINE_EXPIRED", detail.responseHash, true, false, null, transaction.immutableOutcomeDetailHash)
        } else if (lane.status !== "RELEASED") {
          transaction.phase = "RECOVERY_REQUIRED"; transaction.errorCode = "TERMINAL_RELEASE_STATE_REQUIRED"; continue
        }
        const reservationRelease = releaseReservations(configuration.reservationLedgerPath, configuration.reservationLedgerId, {
          schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_RELEASE_REQUEST", reservationSetId: entry.reservationSet.reservationSetId,
          holderToken: holderToken(configuration, entry), fencingToken: entry.reservationFencingToken,
        }, phaseOptions(recoveryConfiguration))
        if (!reservationRelease.released) { transaction.phase = "RECOVERY_REQUIRED"; transaction.errorCode = reservationRelease.status; continue }
        const collection = active ? state.active : state.reconciliation
        const index = collection.findIndex((candidate) => candidate.fullIdentityHash === entry.fullIdentityHash)
        if (index >= 0) collection.splice(index, 1)
        const updatedLane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
          .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
        applyDurableOutcomeProjection(recoveryConfiguration, entry, updatedLane)
        state.released.push({ ...entry, status: "RELEASED", outcome: detail.effectiveOutcome ?? "AMBIGUOUS_REAPED", releasedAt: new Date(now).toISOString() })
        record(state, "TRANSACTION_RECOVERY_TERMINAL_RELEASED", entry, now, { transactionId: transaction.transactionId })
        stateChanged = true
      } else if (detail.ambiguous) {
        if (!active || !detail.reconciliation) { transaction.phase = "RECOVERY_REQUIRED"; transaction.errorCode = "AMBIGUOUS_RECOVERY_SCOPE_REQUIRED"; continue }
        let proof
        let reconciliationLeaseRebind = null
        try {
          const bundle = loadPinnedTrustBundle(configuration.trustBundleReference)
          const deadline = Date.parse(detail.reconciliation.deadline)
          const authorityEntry = detail.entry
          proof = validateReconciliationOwnerProof(detail.reconciliation.ownerProof, bundle, authorityEntry, Date.parse(transaction.startedAt), deadline)
          if (proof.ownerId !== detail.reconciliation.ownerId || lane.fencingToken !== proof.leaseFencingToken
            || lane.fencingToken !== authorityEntry.leaseFencingToken || !["ACTIVE", "EXPIRED"].includes(lane.status)) {
            wall("SCHEDULER_RECONCILIATION_WALL", "recovery.reconciliationOwnerProof", "JOURNALED_LEASE_PROOF_REQUIRED")
          }
          if (lane.lifecycleState !== "REROUTE_PENDING") {
            phaseOutcome(recoveryConfiguration, entry, "UNKNOWN", detail.reasonCode ?? "ATTRIBUTION_MISMATCH", detail.responseHash, false, true, null, transaction.immutableOutcomeDetailHash)
          } else entry.lifecycleState = lane.lifecycleState
          const updatedLane = inspectLaneLeaseStore(configuration.leaseStorePath, configuration.leaseStoreId).lanes
            .find((candidate) => candidate.workOrderId === entry.workOrderId && candidate.laneId === entry.laneId)
          const evidence = applyDurableOutcomeProjection(recoveryConfiguration, entry, updatedLane)
          if (entry.leaseFencingToken !== proof.leaseFencingToken) {
            reconciliationLeaseRebind = {
              fromLeaseFencingToken: proof.leaseFencingToken, toLeaseFencingToken: entry.leaseFencingToken,
              transactionId: transaction.transactionId, proofHash: proof.proofHash,
              immutableOutcomeDetailHash: transaction.immutableOutcomeDetailHash,
              evidenceEventId: evidence.eventId, evidenceEventHash: evidence.eventHash,
            }
          }
        } catch (error) {
          transaction.phase = "RECOVERY_REQUIRED"; transaction.errorCode = error?.code ?? "AMBIGUOUS_PROOF_RECOVERY_FAILURE"; continue
        }
        const index = state.active.findIndex((candidate) => candidate.fullIdentityHash === entry.fullIdentityHash)
        state.active.splice(index, 1)
        state.reconciliation.push({ ...entry, lifecycleState: entry.lifecycleState, status: "RECONCILIATION_REQUIRED", outcome: detail.effectiveOutcome,
          reconciliationOwner: detail.reconciliation.ownerId, reconciliationOwnerProofHash: proof.proofHash, reconciliationGrantExpiresAt: proof.expiresAt,
          reconciliationDeadline: detail.reconciliation.deadline, reconciliationAuthorityClaim: reconciliationClaim(detail.entry),
          reconciliationLeaseRebind, fenced: true })
        record(state, "TRANSACTION_RECOVERY_AMBIGUOUS_FENCED", entry, now, { transactionId: transaction.transactionId })
        stateChanged = true
        transaction.phase = reconciliationLeaseRebind ? "RECONCILIATION_HELD" : "COMMITTED"
        transaction.errorCode = null; recovered.push(transaction.transactionId)
        continue
      } else if (active) {
        active.lifecycleState = lane.lifecycleState
        record(state, "TRANSACTION_RECOVERY_CHECKPOINTED", active, now, { transactionId: transaction.transactionId, lifecycleState: lane.lifecycleState })
        stateChanged = true
      }
      transaction.phase = "COMMITTED"; transaction.errorCode = null; recovered.push(transaction.transactionId)
    }
    // Journal intent is replayed first in fencing-token order. Only after that may an
    // unrelated identity be classified as generic cross-store divergence.
    for (const [name, collection] of [["ACTIVE", state.active], ["RECONCILIATION", state.reconciliation]]) {
      for (const entry of [...collection]) {
        if (transactionFirstIdentities.has(entry.fullIdentityHash)) continue
        const assessment = assessEntryStores(recoveryConfiguration, entry)
        if (assessment.healthy) continue
        // An expired reconciliation lease remains fenced by its original signed owner proof.
        // The deadline reaper validates that proof before it reclaims under a new lease fence.
        if (name === "RECONCILIATION" && assessment.expired && assessment.exactReservation && assessment.exactEvidence) continue
        const recoveryTransaction = {
          transactionId: `store-reconciliation-${entry.fullIdentityHash}-${journal.nextFence}`,
          operation: "STORE_RECONCILIATION", phase: "INTENT", journalFencingToken: journal.nextFence,
          fullIdentityHash: entry.fullIdentityHash, schedulerFencingToken: entry.schedulerFencingToken,
          expectedSchedulerVersion: state.version, detail: { expectedSchedulerVersion: state.version, entry, collection: name },
          startedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), errorCode: null,
        }
        journal.nextFence += 1; journal.version += 1; journal.transactions.push(recoveryTransaction); writeJournal(configuration, journal)
        try {
          if (assessment.expired && !isTerminalLifecycleState(entry.lifecycleState) && assessment.exactReservation && assessment.exactEvidence) {
            const oldFence = entry.leaseFencingToken
            liveLaneForMutation(recoveryConfiguration, entry)
            record(state, "EXPIRED_LEASE_RECLAIMED", entry, now, { priorLeaseFencingToken: oldFence, leaseFencingToken: entry.leaseFencingToken })
          } else compensateDivergentEntry(configuration, state, entry, collection, `${name}_STORE_DIVERGENCE`, now)
          recoveryTransaction.phase = "COMMITTED"; recoveryTransaction.updatedAt = new Date(now).toISOString(); journal.version += 1; writeJournal(configuration, journal)
          stateChanged = true
        } catch (error) {
          recoveryTransaction.phase = "RECOVERY_REQUIRED"; recoveryTransaction.errorCode = error?.code ?? "STORE_RECONCILIATION_FAILURE"
          recoveryTransaction.updatedAt = new Date(now).toISOString(); journal.version += 1; writeJournal(configuration, journal)
        }
      }
    }
    if (stateChanged) durableWrite(configuration.statePath, state)
    journal.version += 1
    for (const transaction of journal.transactions) transaction.updatedAt = new Date(now).toISOString()
    writeJournal(configuration, journal)
    return result("SCHEDULER_TRANSACTION_RECOVERY_COMPLETE", { recovered: Object.freeze(recovered), stateVersion: state.version })
  } finally { unlock() }
}

export function inspectSchedulerState(statePath, stateId) {
  return result("SCHEDULER_STATE_VALID", { state: loadState(statePath, stateId) })
}
