import crypto from "node:crypto"

import { loadCanonicalProviderTrustRecord } from "./provider-assessment-trust-registry.mjs"

const HASH = /^[a-f0-9]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const ARTIFACT_FIELDS = new Set([
  "schemaVersion", "artifactType", "artifactId", "providerId", "assessmentWorkOrderId",
  "subjectWorkOrderId", "assessmentEnvelopeHash", "subjectEnvelopeHash", "result",
  "completionStatus", "lifecycleState", "reasonCode", "continuationPolicy",
  "assessmentSource", "contentHash", "proof",
])
const CLAIM_FIELDS = [...ARTIFACT_FIELDS].filter((field) => !new Set(["contentHash", "proof"]).has(field))
const SIGNATURE_FIELDS = new Set([
  "proofType", "writerId", "keyId", "algorithm", "signature",
])
const LEDGER_FIELDS = new Set([
  "proofType", "ledgerId", "eventId", "eventHash", "eventCount", "headEventHash",
  "externalAnchorId",
])
const TRUST_INPUT_FIELDS = new Set([
  "registryId", "registryVersion",
])
const TRUST_REGISTRY_ENTRY_FIELDS = new Set(["registryRecord", "pinnedRegistryRecordContentHash", "evaluationTime"])
const TRUST_REGISTRY_RECORD_FIELDS = new Set([
  "schemaVersion", "artifactType", "registryId", "registryVersion", "status", "immutable",
  "trustBundle", "pinnedRootFingerprint", "pinnedBundleContentHash", "pinnedStatusHeadHash",
])
const TRUST_BUNDLE_FIELDS = new Set([
  "schemaVersion", "artifactType", "bundleId", "issuer", "issuedAt", "expiresAt", "root",
  "writers", "ledgerAnchors", "statusEvents", "statusHead", "contentHash", "signature",
])
const TRUST_ISSUER_FIELDS = new Set(["role", "rootId"])
const TRUST_ROOT_FIELDS = new Set([
  "rootId", "keyId", "algorithm", "publicKeyPem", "fingerprint", "status", "notBefore", "expiresAt",
])
const TRUST_WRITER_FIELDS = new Set([
  "writerId", "keyId", "algorithm", "publicKeyPem", "fingerprint", "status",
  "notBefore", "expiresAt", "providerIds", "assessmentWorkOrderIds", "subjectWorkOrderIds",
])
const TRUST_LEDGER_ANCHOR_FIELDS = new Set([
  "anchorId", "ledgerId", "eventId", "eventHash", "eventCount", "headEventHash",
  "externalAnchorId", "assessmentContentHash", "artifactId", "providerId",
  "assessmentWorkOrderId", "subjectWorkOrderId", "assessmentEnvelopeHash", "subjectEnvelopeHash",
  "status", "issuedAt", "expiresAt",
])
const TRUST_STATUS_EVENT_FIELDS = new Set([
  "sequence", "version", "fence", "eventId", "subjectType", "subjectId", "status", "issuedAt",
  "previousEventHash", "eventHash",
])
const TRUST_STATUS_HEAD_FIELDS = new Set(["eventCount", "latestEventHash"])
const TRUST_SIGNATURE_FIELDS = new Set(["algorithm", "keyId", "value"])
const CONFIGURED_TRUST = new WeakMap()

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

export class ProviderUnavailableSettlementError extends Error {
  constructor(code, field, detail = null) {
    super(`${code}:${field}${detail === null ? "" : `:${detail}`}`)
    this.name = "ProviderUnavailableSettlementError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail = null) {
  throw new ProviderUnavailableSettlementError(code, field, detail)
}

function exact(value, fields, field) {
  if (!plainObject(value)) wall("PROVIDER_SETTLEMENT_SCHEMA_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("PROVIDER_SETTLEMENT_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("PROVIDER_SETTLEMENT_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function identifier(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || !pattern.test(value)) {
    wall("PROVIDER_SETTLEMENT_VALUE_WALL", field, "VALID_IDENTIFIER_REQUIRED")
  }
  return value
}

function hash(value, field) {
  return identifier(value, field, HASH)
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function claimsFrom(input) {
  return Object.fromEntries(CLAIM_FIELDS.map((field) => [field, input[field]]))
}

export function providerUnavailableAssessmentContentHash(input) {
  const claims = claimsFrom(input)
  return sha256(canonicalJson(claims))
}

function normalizeClaims(input) {
  if (input.schemaVersion !== 1 || input.artifactType !== "PROVIDER_AVAILABILITY_ASSESSMENT") {
    wall("PROVIDER_SETTLEMENT_SCHEMA_WALL", "assessment", "V1_ASSESSMENT_REQUIRED")
  }
  const normalized = {
    schemaVersion: 1,
    artifactType: "PROVIDER_AVAILABILITY_ASSESSMENT",
    artifactId: identifier(input.artifactId, "assessment.artifactId"),
    providerId: identifier(input.providerId, "assessment.providerId"),
    assessmentWorkOrderId: identifier(input.assessmentWorkOrderId, "assessment.assessmentWorkOrderId", WORK_ORDER_ID),
    subjectWorkOrderId: identifier(input.subjectWorkOrderId, "assessment.subjectWorkOrderId", WORK_ORDER_ID),
    assessmentEnvelopeHash: hash(input.assessmentEnvelopeHash, "assessment.assessmentEnvelopeHash"),
    subjectEnvelopeHash: hash(input.subjectEnvelopeHash, "assessment.subjectEnvelopeHash"),
    result: input.result,
    completionStatus: input.completionStatus,
    lifecycleState: input.lifecycleState,
    reasonCode: input.reasonCode,
    continuationPolicy: input.continuationPolicy,
    assessmentSource: input.assessmentSource,
  }
  if (normalized.assessmentWorkOrderId === normalized.subjectWorkOrderId) {
    wall("PROVIDER_SETTLEMENT_BINDING_WALL", "assessment", "INDEPENDENT_WORK_ORDERS_REQUIRED")
  }
  const exactValues = {
    result: "UNAVAILABLE",
    completionStatus: "COMPLETE_PROVIDER_ASSESSMENT",
    lifecycleState: "DEFERRED",
    reasonCode: "PROVIDER_UNAVAILABLE",
    continuationPolicy: "DEFER_AFFECTED_LANE_CONTINUE_HEALTHY_PROVIDERS",
    assessmentSource: "STATIC_REPOSITORY_EVIDENCE",
  }
  for (const [field, expected] of Object.entries(exactValues)) {
    if (normalized[field] !== expected) {
      wall("PROVIDER_SETTLEMENT_SEMANTIC_WALL", `assessment.${field}`, `${expected}_REQUIRED`)
    }
  }
  return Object.freeze(normalized)
}

function instant(value, field) {
  if (typeof value !== "string") wall("PROVIDER_SETTLEMENT_TIME_WALL", field, "ISO_INSTANT_REQUIRED")
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    wall("PROVIDER_SETTLEMENT_TIME_WALL", field, "ISO_INSTANT_REQUIRED")
  }
  return parsed
}

function keyFingerprint(publicKeyPem, field) {
  if (typeof publicKeyPem !== "string" || publicKeyPem.length > 8192) {
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", field, "BOUNDED_PUBLIC_KEY_REQUIRED")
  }
  try {
    const key = crypto.createPublicKey(publicKeyPem)
    const der = key.export({ type: "spki", format: "der" })
    if (key.asymmetricKeyType !== "ed25519") {
      wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", field, "ED25519_KEY_REQUIRED")
    }
    return sha256(der)
  } catch (error) {
    if (error instanceof ProviderUnavailableSettlementError) throw error
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", field, "VALID_PUBLIC_KEY_REQUIRED")
  }
}

function exactStringSet(value, field, pattern = IDENTIFIER) {
  if (!Array.isArray(value) || value.length === 0) {
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  }
  const normalized = value.map((entry, index) => identifier(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) {
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", field, "DUPLICATE")
  }
  return Object.freeze(normalized)
}

function unsignedTrustBundle(bundle) {
  const { contentHash: _contentHash, signature: _signature, ...claims } = bundle
  return claims
}

export function providerTrustBundleContentHash(bundle) {
  return sha256(canonicalJson(unsignedTrustBundle(bundle)))
}

export function providerTrustStatusEventHash(event) {
  const { eventHash: _eventHash, ...claims } = event
  return sha256(canonicalJson(claims))
}

export function providerTrustRegistryRecordContentHash(record) {
  return sha256(canonicalJson(record))
}

function normalizeTrustStatusEvents(events, statusHead, pinnedStatusHeadHash, now) {
  if (!Array.isArray(events) || events.length === 0) {
    wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", "trustBundle.statusEvents", "NON_EMPTY_ARRAY_REQUIRED")
  }
  exact(statusHead, TRUST_STATUS_HEAD_FIELDS, "trustBundle.statusHead")
  if (!Number.isSafeInteger(statusHead.eventCount) || statusHead.eventCount !== events.length) {
    wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", "trustBundle.statusHead.eventCount", "EXACT_COUNT_REQUIRED")
  }
  let previousEventHash = null
  let previousVersion = 0
  let previousFence = 0
  let previousIssuedAt = -Infinity
  const latestBySubject = new Map()
  const seenEventIds = new Set()
  const normalized = events.map((event, index) => {
    const field = `trustBundle.statusEvents[${index}]`
    exact(event, TRUST_STATUS_EVENT_FIELDS, field)
    if (event.sequence !== index + 1 || event.version !== previousVersion + 1
      || !Number.isSafeInteger(event.fence) || event.fence <= previousFence
      || event.previousEventHash !== previousEventHash) {
      wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", field, "CHAIN_LINK_MISMATCH")
    }
    identifier(event.eventId, `${field}.eventId`)
    if (seenEventIds.has(event.eventId)) wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", `${field}.eventId`, "DUPLICATE")
    seenEventIds.add(event.eventId)
    if (!new Set(["ROOT", "WRITER", "LEDGER_ANCHOR"]).has(event.subjectType)) {
      wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", `${field}.subjectType`, "KNOWN_SUBJECT_REQUIRED")
    }
    identifier(event.subjectId, `${field}.subjectId`)
    if (!new Set(["ACTIVE", "REVOKED"]).has(event.status)) {
      wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", `${field}.status`, "KNOWN_STATUS_REQUIRED")
    }
    const issuedAt = instant(event.issuedAt, `${field}.issuedAt`)
    if (issuedAt > now) {
      wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", `${field}.issuedAt`, "FUTURE_EVENT")
    }
    if (issuedAt <= previousIssuedAt) {
      wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", `${field}.issuedAt`, "STRICTLY_MONOTONIC_TIME_REQUIRED")
    }
    const subjectKey = `${event.subjectType}:${event.subjectId}`
    if (latestBySubject.get(subjectKey) === "REVOKED") {
      wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", field, "TERMINAL_REVOCATION_VIOLATION")
    }
    hash(event.eventHash, `${field}.eventHash`)
    const computed = providerTrustStatusEventHash(event)
    if (event.eventHash !== computed) {
      wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", `${field}.eventHash`, "COMPUTED_HASH_MISMATCH")
    }
    previousEventHash = computed
    previousVersion = event.version
    previousFence = event.fence
    previousIssuedAt = issuedAt
    latestBySubject.set(subjectKey, event.status)
    return Object.freeze({ ...event })
  })
  if (statusHead.latestEventHash !== previousEventHash
    || pinnedStatusHeadHash !== previousEventHash) {
    wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", "trustBundle.statusHead", "PINNED_HEAD_MISMATCH")
  }
  return { events: Object.freeze(normalized), latestBySubject }
}

function normalizePinnedTrustBundle(registryReference) {
  if (plainObject(registryReference)
    && (Object.hasOwn(registryReference, "trustedAssessmentWriters")
      || Object.hasOwn(registryReference, "trustedLedgerAnchors")
      || Object.hasOwn(registryReference, "trustBundle")
      || Object.hasOwn(registryReference, "pinnedRootFingerprint"))) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "registryReference", "CALLER_TRUST_MATERIAL_REJECTED")
  }
  exact(registryReference, TRUST_INPUT_FIELDS, "registryReference")
  identifier(registryReference.registryId, "registryReference.registryId")
  if (!Number.isSafeInteger(registryReference.registryVersion) || registryReference.registryVersion < 1) {
    wall("PROVIDER_SETTLEMENT_TRUST_REGISTRY_WALL", "registryReference.registryVersion", "POSITIVE_INTEGER_REQUIRED")
  }
  const loaded = loadCanonicalProviderTrustRecord(registryReference.registryId, registryReference.registryVersion)
  if (loaded === null) {
    wall("PROVIDER_SETTLEMENT_TRUST_REGISTRY_WALL", "registryReference", "AUTHENTICATED_PINNED_RECORD_REQUIRED")
  }
  exact(loaded, TRUST_REGISTRY_ENTRY_FIELDS, "registryEntry")
  exact(loaded.registryRecord, TRUST_REGISTRY_RECORD_FIELDS, "registryRecord")
  hash(loaded.pinnedRegistryRecordContentHash, "registryEntry.pinnedRegistryRecordContentHash")
  const registryRecordHash = providerTrustRegistryRecordContentHash(loaded.registryRecord)
  if (registryRecordHash !== loaded.pinnedRegistryRecordContentHash) {
    wall("PROVIDER_SETTLEMENT_TRUST_REGISTRY_WALL", "registryRecord", "IMMUTABLE_RECORD_HASH_MISMATCH")
  }
  const record = loaded.registryRecord
  if (record.schemaVersion !== 1 || record.artifactType !== "PROVIDER_ASSESSMENT_PIN_RECORD"
    || record.registryId !== registryReference.registryId
    || record.registryVersion !== registryReference.registryVersion
    || record.status !== "ACTIVE" || record.immutable !== true) {
    wall("PROVIDER_SETTLEMENT_TRUST_REGISTRY_WALL", "registryRecord", "ACTIVE_IMMUTABLE_RECORD_REQUIRED")
  }
  const trustOptions = {
    trustBundle: record.trustBundle,
    pinnedRootFingerprint: record.pinnedRootFingerprint,
    pinnedBundleContentHash: record.pinnedBundleContentHash,
    pinnedStatusHeadHash: record.pinnedStatusHeadHash,
    now: loaded.evaluationTime,
  }
  const bundle = trustOptions.trustBundle
  exact(bundle, TRUST_BUNDLE_FIELDS, "trustBundle")
  if (bundle.schemaVersion !== 1 || bundle.artifactType !== "PROVIDER_ASSESSMENT_TRUST_BUNDLE") {
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", "trustBundle", "V1_TRUST_BUNDLE_REQUIRED")
  }
  identifier(bundle.bundleId, "trustBundle.bundleId")
  hash(trustOptions.pinnedRootFingerprint, "trustOptions.pinnedRootFingerprint")
  hash(trustOptions.pinnedBundleContentHash, "trustOptions.pinnedBundleContentHash")
  hash(trustOptions.pinnedStatusHeadHash, "trustOptions.pinnedStatusHeadHash")
  const now = instant(trustOptions.now, "trustOptions.now")
  const issuedAt = instant(bundle.issuedAt, "trustBundle.issuedAt")
  const expiresAt = instant(bundle.expiresAt, "trustBundle.expiresAt")
  if (expiresAt <= issuedAt || now < issuedAt || now >= expiresAt) {
    wall("PROVIDER_SETTLEMENT_TRUST_FRESHNESS_WALL", "trustBundle", "ACTIVE_WINDOW_REQUIRED")
  }

  exact(bundle.root, TRUST_ROOT_FIELDS, "trustBundle.root")
  const root = bundle.root
  identifier(root.rootId, "trustBundle.root.rootId")
  identifier(root.keyId, "trustBundle.root.keyId")
  if (root.algorithm !== "ED25519" || root.status !== "ACTIVE") {
    wall("PROVIDER_SETTLEMENT_TRUST_ROOT_WALL", "trustBundle.root", "ACTIVE_ED25519_ROOT_REQUIRED")
  }
  const computedRootFingerprint = keyFingerprint(root.publicKeyPem, "trustBundle.root.publicKeyPem")
  hash(root.fingerprint, "trustBundle.root.fingerprint")
  if (root.fingerprint !== computedRootFingerprint
    || trustOptions.pinnedRootFingerprint !== computedRootFingerprint) {
    wall("PROVIDER_SETTLEMENT_TRUST_ROOT_WALL", "trustBundle.root.fingerprint", "PINNED_ROOT_MISMATCH")
  }
  const rootNotBefore = instant(root.notBefore, "trustBundle.root.notBefore")
  const rootExpiresAt = instant(root.expiresAt, "trustBundle.root.expiresAt")
  if (rootExpiresAt <= rootNotBefore || now < rootNotBefore || now >= rootExpiresAt) {
    wall("PROVIDER_SETTLEMENT_TRUST_FRESHNESS_WALL", "trustBundle.root", "ACTIVE_ROOT_WINDOW_REQUIRED")
  }
  exact(bundle.issuer, TRUST_ISSUER_FIELDS, "trustBundle.issuer")
  if (bundle.issuer.role !== "TRUST_ROOT" || bundle.issuer.rootId !== root.rootId) {
    wall("PROVIDER_SETTLEMENT_TRUST_ROOT_WALL", "trustBundle.issuer", "ROOT_ISSUER_REQUIRED")
  }

  hash(bundle.contentHash, "trustBundle.contentHash")
  const computedBundleHash = providerTrustBundleContentHash(bundle)
  if (bundle.contentHash !== computedBundleHash
    || trustOptions.pinnedBundleContentHash !== computedBundleHash) {
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", "trustBundle.contentHash", "PINNED_HASH_MISMATCH")
  }
  exact(bundle.signature, TRUST_SIGNATURE_FIELDS, "trustBundle.signature")
  if (bundle.signature.algorithm !== "ED25519" || bundle.signature.keyId !== root.keyId
    || typeof bundle.signature.value !== "string" || !BASE64.test(bundle.signature.value)) {
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", "trustBundle.signature", "ROOT_SIGNATURE_REQUIRED")
  }
  try {
    const signature = Buffer.from(bundle.signature.value, "base64")
    if (signature.length !== 64
      || !crypto.verify(null, Buffer.from(canonicalJson(unsignedTrustBundle(bundle))), root.publicKeyPem, signature)) {
      wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", "trustBundle.signature", "SIGNATURE_VERIFICATION_FAILED")
    }
  } catch (error) {
    if (error instanceof ProviderUnavailableSettlementError) throw error
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", "trustBundle.signature", "SIGNATURE_VERIFICATION_FAILED")
  }

  const { latestBySubject } = normalizeTrustStatusEvents(
    bundle.statusEvents,
    bundle.statusHead,
    trustOptions.pinnedStatusHeadHash,
    now,
  )
  if (latestBySubject.get(`ROOT:${root.rootId}`) !== "ACTIVE") {
    wall("PROVIDER_SETTLEMENT_TRUST_ROOT_WALL", "trustBundle.root", "ROOT_REVOKED_OR_STATUS_MISSING")
  }

  if (!Array.isArray(bundle.writers) || !Array.isArray(bundle.ledgerAnchors)) {
    wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", "trustBundle", "TRUST_COLLECTIONS_REQUIRED")
  }
  const writerIds = new Set()
  const writers = bundle.writers.map((writer, index) => {
    const field = `trustBundle.writers[${index}]`
    exact(writer, TRUST_WRITER_FIELDS, field)
    identifier(writer.writerId, `${field}.writerId`)
    identifier(writer.keyId, `${field}.keyId`)
    if (writerIds.has(writer.writerId)) wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", `${field}.writerId`, "DUPLICATE")
    writerIds.add(writer.writerId)
    if (writer.algorithm !== "ED25519" || !new Set(["ACTIVE", "REVOKED"]).has(writer.status)) {
      wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", field, "KNOWN_WRITER_STATUS_REQUIRED")
    }
    const fingerprint = keyFingerprint(writer.publicKeyPem, `${field}.publicKeyPem`)
    if (writer.fingerprint !== fingerprint) {
      wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", `${field}.fingerprint`, "COMPUTED_FINGERPRINT_MISMATCH")
    }
    const notBefore = instant(writer.notBefore, `${field}.notBefore`)
    const writerExpiresAt = instant(writer.expiresAt, `${field}.expiresAt`)
    if (writerExpiresAt <= notBefore) wall("PROVIDER_SETTLEMENT_TRUST_FRESHNESS_WALL", field, "EXPIRY_ORDER")
    const chainStatus = latestBySubject.get(`WRITER:${writer.writerId}`)
    if (chainStatus !== writer.status) wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", field, "WRITER_STATUS_HEAD_MISMATCH")
    return Object.freeze({
      ...writer,
      providerIds: exactStringSet(writer.providerIds, `${field}.providerIds`),
      assessmentWorkOrderIds: exactStringSet(writer.assessmentWorkOrderIds, `${field}.assessmentWorkOrderIds`, WORK_ORDER_ID),
      subjectWorkOrderIds: exactStringSet(writer.subjectWorkOrderIds, `${field}.subjectWorkOrderIds`, WORK_ORDER_ID),
      notBeforeMs: notBefore,
      expiresAtMs: writerExpiresAt,
    })
  })

  const anchorIds = new Set()
  const ledgerAnchors = bundle.ledgerAnchors.map((anchor, index) => {
    const field = `trustBundle.ledgerAnchors[${index}]`
    exact(anchor, TRUST_LEDGER_ANCHOR_FIELDS, field)
    for (const key of ["anchorId", "ledgerId", "eventId", "externalAnchorId", "artifactId", "providerId"]) {
      identifier(anchor[key], `${field}.${key}`)
    }
    identifier(anchor.assessmentWorkOrderId, `${field}.assessmentWorkOrderId`, WORK_ORDER_ID)
    identifier(anchor.subjectWorkOrderId, `${field}.subjectWorkOrderId`, WORK_ORDER_ID)
    for (const key of ["eventHash", "headEventHash", "assessmentContentHash", "assessmentEnvelopeHash", "subjectEnvelopeHash"]) {
      hash(anchor[key], `${field}.${key}`)
    }
    if (!Number.isSafeInteger(anchor.eventCount) || anchor.eventCount < 1) {
      wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", `${field}.eventCount`, "POSITIVE_INTEGER_REQUIRED")
    }
    if (anchorIds.has(anchor.anchorId)) wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", `${field}.anchorId`, "DUPLICATE")
    anchorIds.add(anchor.anchorId)
    if (!new Set(["ACTIVE", "REVOKED"]).has(anchor.status)) {
      wall("PROVIDER_SETTLEMENT_TRUST_BUNDLE_WALL", `${field}.status`, "KNOWN_STATUS_REQUIRED")
    }
    const anchorIssuedAt = instant(anchor.issuedAt, `${field}.issuedAt`)
    const anchorExpiresAt = instant(anchor.expiresAt, `${field}.expiresAt`)
    if (anchorExpiresAt <= anchorIssuedAt) wall("PROVIDER_SETTLEMENT_TRUST_FRESHNESS_WALL", field, "EXPIRY_ORDER")
    if (latestBySubject.get(`LEDGER_ANCHOR:${anchor.anchorId}`) !== anchor.status) {
      wall("PROVIDER_SETTLEMENT_TRUST_STATUS_WALL", field, "LEDGER_STATUS_HEAD_MISMATCH")
    }
    return Object.freeze({ ...anchor, issuedAtMs: anchorIssuedAt, expiresAtMs: anchorExpiresAt })
  })
  return Object.freeze({
    root: Object.freeze({ ...root }),
    writers: Object.freeze(writers),
    ledgerAnchors: Object.freeze(ledgerAnchors),
    now,
    registryId: registryReference.registryId,
    registryVersion: registryReference.registryVersion,
    rootFingerprint: trustOptions.pinnedRootFingerprint,
    bundleContentHash: trustOptions.pinnedBundleContentHash,
    statusHeadHash: trustOptions.pinnedStatusHeadHash,
  })
}

export function verifyPinnedProviderAssessmentTrustBundle(trustOptions) {
  const trust = normalizePinnedTrustBundle(trustOptions)
  const configured = Object.freeze({
    ok: true,
    code: "PROVIDER_ASSESSMENT_TRUST_BUNDLE_VERIFIED",
    registryId: trust.registryId,
    registryVersion: trust.registryVersion,
    rootFingerprint: trust.rootFingerprint,
    bundleContentHash: trust.bundleContentHash,
    statusHeadHash: trust.statusHeadHash,
    writerCount: trust.writers.length,
    ledgerAnchorCount: trust.ledgerAnchors.length,
    authorityGranted: false,
  })
  CONFIGURED_TRUST.set(configured, trust)
  return configured
}

function configuredTrust(value) {
  if (plainObject(value)
    && (Object.hasOwn(value, "trustedAssessmentWriters") || Object.hasOwn(value, "trustedLedgerAnchors"))) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "configuredTrust", "RAW_CALLER_TRUST_REJECTED")
  }
  if (!plainObject(value) || !CONFIGURED_TRUST.has(value)) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "configuredTrust", "SEPARATELY_CONFIGURED_PINNED_TRUST_REQUIRED")
  }
  return CONFIGURED_TRUST.get(value)
}

function verifySignature(proof, claims, claimsJson, trust) {
  exact(proof, SIGNATURE_FIELDS, "assessment.proof")
  if (proof.proofType !== "TRUSTED_WRITER_SIGNATURE" || proof.algorithm !== "ED25519") {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof", "ED25519_TRUSTED_WRITER_REQUIRED")
  }
  identifier(proof.writerId, "assessment.proof.writerId")
  identifier(proof.keyId, "assessment.proof.keyId")
  if (typeof proof.signature !== "string" || !BASE64.test(proof.signature)) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.signature", "BASE64_SIGNATURE_REQUIRED")
  }
  const signature = Buffer.from(proof.signature, "base64")
  if (signature.length !== 64) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.signature", "ED25519_SIGNATURE_REQUIRED")
  }
  const writer = trust.writers.find((entry) => entry.writerId === proof.writerId
    && entry.keyId === proof.keyId && entry.algorithm === "ED25519")
  if (!writer) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.writerId", "PINNED_TRUSTED_WRITER_REQUIRED")
  }
  if (writer.status !== "ACTIVE" || trust.now < writer.notBeforeMs || trust.now >= writer.expiresAtMs) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.writerId", "ACTIVE_FRESH_WRITER_REQUIRED")
  }
  if (!writer.providerIds.includes(claims.providerId)
    || !writer.assessmentWorkOrderIds.includes(claims.assessmentWorkOrderId)
    || !writer.subjectWorkOrderIds.includes(claims.subjectWorkOrderId)) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.writerId", "WRITER_SCOPE_MISMATCH")
  }
  let verified = false
  try {
    verified = crypto.verify(null, Buffer.from(claimsJson), writer.publicKeyPem, signature)
  } catch {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.signature", "SIGNATURE_VERIFICATION_FAILED")
  }
  if (!verified) wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.signature", "SIGNATURE_VERIFICATION_FAILED")
  return Object.freeze({ proofType: proof.proofType, writerId: proof.writerId, keyId: proof.keyId, algorithm: proof.algorithm, signature: proof.signature })
}

function verifyLedgerAnchor(proof, claims, contentHash, trust) {
  exact(proof, LEDGER_FIELDS, "assessment.proof")
  if (proof.proofType !== "IMMUTABLE_EVIDENCE_LEDGER_ANCHOR") {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.proofType", "KNOWN_PROOF_REQUIRED")
  }
  const normalized = {
    proofType: proof.proofType,
    ledgerId: identifier(proof.ledgerId, "assessment.proof.ledgerId"),
    eventId: identifier(proof.eventId, "assessment.proof.eventId"),
    eventHash: hash(proof.eventHash, "assessment.proof.eventHash"),
    eventCount: proof.eventCount,
    headEventHash: hash(proof.headEventHash, "assessment.proof.headEventHash"),
    externalAnchorId: identifier(proof.externalAnchorId, "assessment.proof.externalAnchorId"),
  }
  if (!Number.isSafeInteger(normalized.eventCount) || normalized.eventCount < 1) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof.eventCount", "POSITIVE_INTEGER_REQUIRED")
  }
  const trusted = trust.ledgerAnchors.find((entry) => entry.ledgerId === normalized.ledgerId
    && entry.eventId === normalized.eventId
    && entry.eventHash === normalized.eventHash
    && entry.eventCount === normalized.eventCount
    && entry.headEventHash === normalized.headEventHash
    && entry.externalAnchorId === normalized.externalAnchorId
    && entry.assessmentContentHash === contentHash
    && entry.artifactId === claims.artifactId
    && entry.providerId === claims.providerId
    && entry.assessmentWorkOrderId === claims.assessmentWorkOrderId
    && entry.subjectWorkOrderId === claims.subjectWorkOrderId
    && entry.assessmentEnvelopeHash === claims.assessmentEnvelopeHash
    && entry.subjectEnvelopeHash === claims.subjectEnvelopeHash)
  if (!trusted || trusted.status !== "ACTIVE" || trust.now < trusted.issuedAtMs || trust.now >= trusted.expiresAtMs) {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof", "ACTIVE_PINNED_LEDGER_ANCHOR_REQUIRED")
  }
  return Object.freeze(normalized)
}

export function verifyProviderUnavailableAssessment(input, configuredTrustBundle = null) {
  exact(input, ARTIFACT_FIELDS, "assessment")
  const claims = normalizeClaims(input)
  const claimsJson = canonicalJson(claims)
  const computedContentHash = sha256(claimsJson)
  hash(input.contentHash, "assessment.contentHash")
  if (input.contentHash !== computedContentHash) {
    wall("PROVIDER_SETTLEMENT_HASH_WALL", "assessment.contentHash", "COMPUTED_HASH_MISMATCH")
  }
  const trust = configuredTrust(configuredTrustBundle)
  let proof
  if (input.proof?.proofType === "TRUSTED_WRITER_SIGNATURE") {
    proof = verifySignature(input.proof, claims, claimsJson, trust)
  } else if (input.proof?.proofType === "IMMUTABLE_EVIDENCE_LEDGER_ANCHOR") {
    proof = verifyLedgerAnchor(input.proof, claims, computedContentHash, trust)
  } else {
    wall("PROVIDER_SETTLEMENT_TRUST_WALL", "assessment.proof", "TRUSTED_SIGNATURE_OR_LEDGER_ANCHOR_REQUIRED")
  }
  return Object.freeze({
    ok: true,
    code: "PROVIDER_UNAVAILABLE_ASSESSMENT_VERIFIED",
    assessment: Object.freeze({ ...claims, contentHash: computedContentHash, proof }),
    independentlyAuthoritative: true,
    authorityGranted: false,
    dispatchPerformed: false,
  })
}

export function signProviderUnavailableAssessmentClaims(claims, privateKey) {
  const normalized = normalizeClaims(claims)
  return crypto.sign(null, Buffer.from(canonicalJson(normalized)), privateKey).toString("base64")
}
