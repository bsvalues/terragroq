import crypto from "node:crypto"

import {
  AuthorityAssertionError,
  canonicalJson,
  computeAuthorityContentHash,
  verifyTrustBundle,
} from "./authority-events.mjs"

const HASH_PATTERN = /^[a-f0-9]{64}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COUNTER_NAMES = Object.freeze([
  "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT",
  "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT",
  "OWNER_ROUTINE_CONTACT_COUNT",
])
const SCOPE_FIELDS = Object.freeze(["programId", "goalId", "loopId", "workOrderId", "decisionId", "action"])

function wall(code, detail) {
  throw new AuthorityAssertionError(code, detail ? `${code}:${detail}` : code)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") wall("OWNER_OPERATION_EVIDENCE_SCHEMA_WALL", field)
  return value
}

function requiredHash(value, field) {
  if (!HASH_PATTERN.test(value ?? "")) wall("OWNER_OPERATION_EVIDENCE_SCHEMA_WALL", field)
  return value
}

function instant(value, field) {
  requiredString(value, field)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    wall("OWNER_OPERATION_EVIDENCE_SCHEMA_WALL", field)
  }
  return parsed
}

function verifySignedRecord(record, publicKeyPem, wallCode) {
  requiredHash(record.contentHash, "contentHash")
  const computed = computeAuthorityContentHash(record)
  if (!crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(record.contentHash, "hex"))) {
    wall(wallCode, "HASH")
  }
  let signature
  try {
    signature = Buffer.from(requiredString(record.signature?.value, "signature.value"), "base64")
    if (record.signature?.algorithm !== "Ed25519" || signature.length === 0) wall(wallCode, "SIGNATURE")
    const { contentHash: _contentHash, signature: _signature, ...payload } = record
    if (!crypto.verify(null, Buffer.from(canonicalJson(payload), "utf8"), publicKeyPem, signature)) {
      wall(wallCode, "SIGNATURE")
    }
  } catch (error) {
    if (error instanceof AuthorityAssertionError) throw error
    wall(wallCode, "SIGNATURE")
  }
}

function validateKeyRecord(key, purpose, programId, at, wallCode) {
  if (!plainObject(key)
    || key.status !== "ACTIVE"
    || key.algorithm !== "Ed25519"
    || key.purpose !== purpose
    || !Array.isArray(key.programIds)
    || !key.programIds.includes(programId)
    || typeof key.publicKeyPem !== "string") {
    wall(wallCode, "KEY")
  }
  const validFrom = instant(key.validFrom, "key.validFrom")
  const validUntil = instant(key.validUntil, "key.validUntil")
  if (at < validFrom || at >= validUntil) wall(wallCode, "KEY_TIME")
  return key
}

function normalizeCounters(counters) {
  if (!plainObject(counters)) wall("OWNER_OPERATION_EVIDENCE_SCHEMA_WALL", "counters")
  const keys = Object.keys(counters).sort()
  const expectedKeys = [...COUNTER_NAMES].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    wall("OWNER_OPERATION_EVIDENCE_SCHEMA_WALL", "COUNTER_SET")
  }
  const normalized = {}
  for (const name of COUNTER_NAMES) {
    if (!Number.isSafeInteger(counters[name]) || counters[name] < 0) {
      wall("OWNER_OPERATION_EVIDENCE_SCHEMA_WALL", name)
    }
    normalized[name] = counters[name]
  }
  return Object.freeze(normalized)
}

function validateScope(scope, expected) {
  if (!plainObject(scope) || !plainObject(expected)) wall("OWNER_OPERATION_EVIDENCE_CONTEXT_WALL")
  for (const field of SCOPE_FIELDS) {
    const actual = scope[field]
    const wanted = expected[field]
    if (field === "decisionId") {
      if (!((actual === null || typeof actual === "string") && actual === wanted)) {
        wall("OWNER_OPERATION_EVIDENCE_CONTEXT_WALL", field)
      }
    } else if (requiredString(actual, `scope.${field}`) !== requiredString(wanted, `expected.${field}`)) {
      wall("OWNER_OPERATION_EVIDENCE_CONTEXT_WALL", field)
    }
  }
  return Object.freeze(Object.fromEntries(SCOPE_FIELDS.map((field) => [field, scope[field]])))
}

function validateEvidenceSchema(evidence, expected) {
  if (!plainObject(evidence)
    || evidence.schemaVersion !== 1
    || evidence.artifactType !== "OWNER_OPERATION_EVIDENCE"
    || evidence.canonicalization !== "WILLIAMOS-CANONICAL-JSON-V1"
    || evidence.hashAlgorithm !== "SHA-256"
    || evidence.runState !== "COMPLETED") {
    wall("OWNER_OPERATION_EVIDENCE_SCHEMA_WALL", "EVIDENCE")
  }
  requiredString(evidence.evidenceId, "evidenceId")
  if (!UUID_PATTERN.test(evidence.runId ?? "") || evidence.runId !== expected.runId) {
    wall("OWNER_OPERATION_EVIDENCE_CONTEXT_WALL", "runId")
  }
  requiredHash(evidence.runManifestHash, "runManifestHash")
  if (evidence.runManifestHash !== expected.runManifestHash) wall("OWNER_OPERATION_EVIDENCE_CONTEXT_WALL", "runManifestHash")
  const scope = validateScope(evidence.scope, expected.scope)
  if (!plainObject(evidence.observation)
    || evidence.observation.complete !== true
    || !Number.isSafeInteger(evidence.observation.startSequence)
    || evidence.observation.startSequence < 0
    || !Number.isSafeInteger(evidence.observation.endSequence)
    || evidence.observation.endSequence <= evidence.observation.startSequence
    || !Number.isSafeInteger(evidence.observation.observedEventCount)
    || evidence.observation.observedEventCount < 1
    || evidence.observation.observedEventCount !== evidence.observation.endSequence - evidence.observation.startSequence) {
    wall("OWNER_OPERATION_EVIDENCE_COMPLETENESS_WALL")
  }
  requiredString(evidence.observation.sourceLogId, "observation.sourceLogId")
  requiredHash(evidence.observation.startEventHash, "observation.startEventHash")
  requiredHash(evidence.observation.endEventHash, "observation.endEventHash")
  requiredHash(evidence.observation.classificationPolicyHash, "observation.classificationPolicyHash")
  if (evidence.observation.sourceLogId !== expected.sourceLogId
    || evidence.observation.classificationPolicyHash !== expected.classificationPolicyHash) {
    wall("OWNER_OPERATION_EVIDENCE_CONTEXT_WALL", "observation")
  }
  const startedAt = instant(evidence.startedAt, "startedAt")
  const completedAt = instant(evidence.completedAt, "completedAt")
  const recordedAt = instant(evidence.recordedAt, "recordedAt")
  if (completedAt < startedAt || recordedAt < completedAt) wall("OWNER_OPERATION_EVIDENCE_TIME_WALL")
  if (!plainObject(evidence.issuer) || evidence.issuer.role !== "ASSURANCE") {
    wall("OWNER_OPERATION_EVIDENCE_RECORDER_WALL", "ISSUER")
  }
  return { scope, counters: normalizeCounters(evidence.counters), recordedAt }
}

function evidenceRecorderFor(evidence, trustedOwners, programId, at) {
  const recorderId = requiredString(evidence.issuer?.recorderId, "issuer.recorderId")
  const keyId = requiredString(evidence.signature?.keyId, "signature.keyId")
  if (!Array.isArray(trustedOwners.assuranceRecorders)) {
    wall("OWNER_OPERATION_EVIDENCE_RECORDER_WALL", "TRUST_COLLECTION")
  }
  const matches = trustedOwners.assuranceRecorders.filter((candidate) =>
    candidate?.recorderId === recorderId && candidate?.publicKeyId === keyId)
  if (matches.length !== 1) wall("OWNER_OPERATION_EVIDENCE_RECORDER_WALL", "IDENTITY")
  return validateKeyRecord(matches[0], "OWNER_OPERATION_ASSURANCE", programId, at,
    "OWNER_OPERATION_EVIDENCE_RECORDER_WALL")
}

function checkpointKeyFor(checkpoint, trustedOwners, programId, at) {
  const logId = requiredString(checkpoint.logId, "checkpoint.logId")
  if (!plainObject(checkpoint.issuer)
    || checkpoint.issuer.role !== "ASSURANCE_LOG"
    || checkpoint.issuer.logId !== logId) {
    wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "ISSUER")
  }
  const keyId = requiredString(checkpoint.signature?.keyId, "signature.keyId")
  if (!Array.isArray(trustedOwners.assuranceCheckpointKeys)) {
    wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "TRUST_COLLECTION")
  }
  const matches = trustedOwners.assuranceCheckpointKeys.filter((candidate) =>
    candidate?.logId === logId && candidate?.publicKeyId === keyId)
  if (matches.length !== 1) wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "IDENTITY")
  return validateKeyRecord(matches[0], "OWNER_OPERATION_CHECKPOINT", programId, at,
    "OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL")
}

function verifyCheckpointChain(checkpoints, trustedOwners, expected, anchor, assertionTime) {
  if (!Array.isArray(checkpoints)
    || checkpoints.length === 0
    || !plainObject(anchor)
    || typeof anchor.logId !== "string"
    || anchor.logId.trim() === ""
    || !Number.isSafeInteger(anchor.sequence)
    || anchor.sequence < 1
    || !HASH_PATTERN.test(anchor.checkpointContentHash ?? "")) {
    wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "MISSING")
  }
  const seenRuns = new Set()
  const checkpointIds = new Set()
  let previous = null
  let evidenceHash = null
  let evidenceCheckpointIssuedAt = null
  let previousTime = 0
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index]
    if (!plainObject(checkpoint)
      || checkpoint.schemaVersion !== 1
      || checkpoint.artifactType !== "OWNER_OPERATION_EVIDENCE_CHECKPOINT"
      || checkpoint.sequence !== index + 1
      || checkpoint.previousCheckpointHash !== previous
      || !plainObject(checkpoint.commitment)) {
      wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "CHAIN")
    }
    if (checkpoint.logId !== anchor.logId) wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "LOG")
    requiredString(checkpoint.checkpointId, "checkpointId")
    if (checkpointIds.has(checkpoint.checkpointId)) wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "DUPLICATE_CHECKPOINT")
    checkpointIds.add(checkpoint.checkpointId)
    if (!UUID_PATTERN.test(checkpoint.commitment.runId ?? "") || seenRuns.has(checkpoint.commitment.runId)) {
      wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "DUPLICATE_RUN")
    }
    seenRuns.add(checkpoint.commitment.runId)
    requiredHash(checkpoint.commitment.evidenceContentHash, "commitment.evidenceContentHash")
    const issuedAt = instant(checkpoint.issuedAt, "checkpoint.issuedAt")
    if (issuedAt < previousTime || issuedAt > assertionTime) wall("OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL", "TIME")
    const key = checkpointKeyFor(checkpoint, trustedOwners, expected.scope.programId, issuedAt)
    verifySignedRecord(checkpoint, key.publicKeyPem, "OWNER_OPERATION_EVIDENCE_CHECKPOINT_WALL")
    if (checkpoint.commitment.runId === expected.runId) {
      evidenceHash = checkpoint.commitment.evidenceContentHash
      evidenceCheckpointIssuedAt = issuedAt
    }
    previous = checkpoint.contentHash
    previousTime = issuedAt
  }
  if (anchor.logId !== checkpoints.at(-1).logId
    || anchor.sequence !== checkpoints.length
    || anchor.checkpointContentHash !== previous
    || evidenceHash === null) {
    wall("OWNER_OPERATION_EVIDENCE_ANCHOR_WALL")
  }
  return { evidenceHash, evidenceCheckpointIssuedAt, checkpointContentHash: previous, checkpointSequence: checkpoints.length }
}

export function validateOwnerOperationEvidenceArtifacts(input) {
  if (!plainObject(input)) wall("OWNER_OPERATION_EVIDENCE_SCHEMA_WALL", "INPUT")
  const {
    evidence, checkpoints, checkpointAnchor, expected,
    trustedOwners, trustedOwnerKeyFingerprint, trustedOwnerBundleContentHash,
    now = new Date(),
  } = input
  if (!plainObject(expected)
    || !UUID_PATTERN.test(expected.runId ?? "")
    || !HASH_PATTERN.test(expected.runManifestHash ?? "")
    || !HASH_PATTERN.test(expected.classificationPolicyHash ?? "")
    || typeof expected.sourceLogId !== "string"
    || expected.sourceLogId.trim() === "") {
    wall("OWNER_OPERATION_EVIDENCE_CONTEXT_WALL", "EXPECTED")
  }
  const assertionTime = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(assertionTime)) wall("OWNER_OPERATION_EVIDENCE_TIME_WALL", "ASSERTION")
  verifyTrustBundle(trustedOwners, trustedOwnerKeyFingerprint, trustedOwnerBundleContentHash)
  const validated = validateEvidenceSchema(evidence, expected)
  if (validated.recordedAt > assertionTime) wall("OWNER_OPERATION_EVIDENCE_TIME_WALL", "FUTURE")
  const recorder = evidenceRecorderFor(evidence, trustedOwners, expected.scope.programId, validated.recordedAt)
  verifySignedRecord(evidence, recorder.publicKeyPem, "OWNER_OPERATION_EVIDENCE_SIGNATURE_WALL")
  const anchored = verifyCheckpointChain(checkpoints, trustedOwners, expected, checkpointAnchor, assertionTime)
  if (anchored.evidenceHash !== evidence.contentHash) wall("OWNER_OPERATION_EVIDENCE_ANCHOR_WALL", "EVIDENCE_HASH")
  if (anchored.evidenceCheckpointIssuedAt < validated.recordedAt) wall("OWNER_OPERATION_EVIDENCE_TIME_WALL", "CHECKPOINT")
  const touched = COUNTER_NAMES.some((name) => validated.counters[name] !== 0)
  return Object.freeze({
    status: "EVIDENCE_ARTIFACTS_VALIDATED_NOT_CERTIFIED",
    reasonCode: touched ? "FAIL_OWNER_BABYSITTING" : "INDEPENDENT_EVIDENCE_SOURCE_REQUIRED",
    counterAssessment: touched ? "NONZERO_COUNTERS_OBSERVED" : "ZERO_COUNTERS_UNVERIFIED",
    certified: false,
    authorityGranted: false,
    runId: evidence.runId,
    evidenceId: evidence.evidenceId,
    evidenceContentHash: evidence.contentHash,
    checkpointContentHash: anchored.checkpointContentHash,
    checkpointSequence: anchored.checkpointSequence,
    scope: validated.scope,
    counters: validated.counters,
  })
}

export const OWNER_OPERATION_EVIDENCE_COUNTERS = COUNTER_NAMES
