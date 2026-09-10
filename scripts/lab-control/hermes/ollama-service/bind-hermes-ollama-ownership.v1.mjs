#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const LAUNCH_SCHEMA = "hermes-ollama-ownership-launch/1"
export const LEGACY_RECEIPT_SCHEMA = "hermes-ollama-ownership-launch-receipt/1"
export const RECEIPT_SCHEMA = "hermes-ollama-ownership-launch-receipt/2"
export const SOURCE_SCHEMA = "hermes-ollama-ownership-source/1"
export const LEGACY_BOUND_SCHEMA = "hermes-ollama-ownership-bound/1"
export const BOUND_SCHEMA = "hermes-ollama-ownership-bound/2"
export const OBSERVATION = "HERMES_OLLAMA_OWNERSHIP_OBSERVATION"
export const PROBE_FAILURE = "HERMES_OLLAMA_OWNERSHIP_PROBE_FAILURE"
export const CANONICALIZATION = "recursive-key-sort-json/1"
export const BOOTSTRAP_CHECKPOINT_MAP_VERSION = "hermes-ollama-ownership-bootstrap-checkpoints/1"
export const BOOTSTRAP_CHECKPOINT_EXIT_CODES = Object.freeze({
  BOOTSTRAP_ELEVATION_IDENTITY: 161,
  BOOTSTRAP_ARGUMENT_PATH_NORMALIZATION: 162,
  BOOTSTRAP_MANIFEST_EXISTENCE: 163,
  BOOTSTRAP_MANIFEST_REPARSE_CHECK: 164,
  BOOTSTRAP_MANIFEST_PARSE: 165,
  BOOTSTRAP_MANIFEST_SCHEMA_AUTHORITY: 166,
  BOOTSTRAP_COLLECTOR_DIGEST: 167,
  BOOTSTRAP_OUTPUT_PATH_BINDING: 168,
  BOOTSTRAP_DOCKER_DIGEST: 169,
  BOOTSTRAP_MACHINE_IDENTITY: 170,
  BOOTSTRAP_LINEAGE_PARENT_EXISTENCE: 171,
  BOOTSTRAP_LINEAGE_REPARSE_CHECK: 172,
  BOOTSTRAP_SECURE_SOURCE_DIRECTORY_CREATE: 173,
  BOOTSTRAP_SECURE_SOURCE_DIRECTORY_ACL_VERIFY: 174,
  BOOTSTRAP_OUTPUT_NONEXISTENCE: 175,
  BOOTSTRAP_ENVELOPE_READY: 176,
})
const BOOTSTRAP_EXIT_CHECKPOINTS = new Map(Object.entries(BOOTSTRAP_CHECKPOINT_EXIT_CODES).map(([checkpoint, exitCode]) => [exitCode, checkpoint]))

const SHA256 = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const FAILURE_CLASSES = new Set(["ACCESS_DENIED", "API_FAILURE", "MALFORMED_RESULT", "TOOL_EXIT_NONZERO", "PARSE_FAILURE", "PRECONDITION_FAILED", "UNEXPECTED_EXCEPTION"])
const SENSITIVE_KEY = /(?:password|passwd|secret|token|credential|private.?key|connection.?string|authorization|cookie)/i
const SENSITIVE_VALUE = /(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*(?!\[REDACTED\])\S+|(?:bearer|basic)\s+[a-z0-9._~+\/-]+|(?:postgres(?:ql)?|mongodb(?:\+srv)?|redis|https?):\/\/[^/@\s:]+:[^/@\s]+@|-----BEGIN [^-]+PRIVATE KEY-----/i

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  throw error
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value, keys, label) {
  if (!object(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail("HERMES_OWNERSHIP_SCHEMA_INVALID", `${label} keys differ`)
  }
}

function instant(value, label) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("HERMES_OWNERSHIP_TIME_INVALID", `${label} is not a UTC instant`)
  }
  return Date.parse(value)
}

function assertSha(value, label, nullable = false) {
  if (nullable && value === null) return
  if (typeof value !== "string" || !SHA256.test(value)) fail("HERMES_OWNERSHIP_DIGEST_INVALID", `${label} is not sha256`)
}

function assertNoSecrets(value, label = "artifact", seen = new Set()) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return
  if (typeof value === "string") {
    if (value.length > 4096 || SENSITIVE_VALUE.test(value)) fail("HERMES_OWNERSHIP_SECRET_REFUSED", `${label} contains secret-shaped or unbounded text`)
    return
  }
  if (typeof value !== "object" || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) value.forEach((entry, index) => assertNoSecrets(entry, `${label}[${index}]`, seen))
  else for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) fail("HERMES_OWNERSHIP_SECRET_REFUSED", `${label}.${key} is a forbidden field`)
    assertNoSecrets(entry, `${label}.${key}`, seen)
  }
}

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

export function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export function stableDigest(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"))
}

function validateHostIdentity(identity, label) {
  exactKeys(identity, ["computerName", "machineGuidSha256"], label)
  if (typeof identity.computerName !== "string" || identity.computerName.length < 1 || identity.computerName.length > 255) fail("HERMES_OWNERSHIP_HOST_INVALID", `${label}.computerName invalid`)
  assertSha(identity.machineGuidSha256, `${label}.machineGuidSha256`)
}

export function validateLaunch(manifest, receipt) {
  exactKeys(manifest, ["schema", "nonce", "stagedAt", "collectorSha256", "binderSha256", "stagerSha256", "nodeSha256", "powershellSha256", "dockerSha256", "expectedUacPrompts", "uacMethod", "persistentCredential", "sourcePathSha256", "boundPathSha256", "hostIdentity", "authority"], "launchManifest")
  if (manifest.schema !== LAUNCH_SCHEMA || !UUID.test(manifest.nonce) || manifest.expectedUacPrompts !== 1 || manifest.uacMethod !== "Start-Process/RunAs" || manifest.persistentCredential !== false) fail("HERMES_OWNERSHIP_LAUNCH_INVALID", "manifest authority differs")
  for (const key of ["collectorSha256", "binderSha256", "stagerSha256", "nodeSha256", "powershellSha256", "dockerSha256", "sourcePathSha256", "boundPathSha256"]) assertSha(manifest[key], `launchManifest.${key}`)
  exactKeys(manifest.authority, ["readOnly", "hostMutationAuthorized"], "launchManifest.authority")
  if (manifest.authority.readOnly !== true || manifest.authority.hostMutationAuthorized !== false) fail("HERMES_OWNERSHIP_LAUNCH_INVALID", "manifest authorizes mutation")
  validateHostIdentity(manifest.hostIdentity, "launchManifest.hostIdentity")
  const stagedAt = instant(manifest.stagedAt, "launchManifest.stagedAt")

  const receiptV2 = receipt?.schema === RECEIPT_SCHEMA
  const receiptV1 = receipt?.schema === LEGACY_RECEIPT_SCHEMA
  if (!receiptV1 && !receiptV2) fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "receipt schema differs")
  const receiptKeys = ["schema", "nonce", "manifestSha256", "collectorSha256", "binderSha256", "stagerSha256", "nodeSha256", "powershellSha256", "startedAt", "completedAt", "elevatedProcessId", "exitCode", "uacStartInvocations", "sourcePresent", "sourceSha256", "disposition", "hostIdentity"]
  exactKeys(receipt, receiptV2 ? [...receiptKeys, "bootstrapMapVersion", "bootstrapCheckpoint", "bootstrapExitCode"] : receiptKeys, "launchReceipt")
  if (receipt.nonce !== manifest.nonce || receipt.manifestSha256 !== stableDigest(manifest)
    || receipt.collectorSha256 !== manifest.collectorSha256 || receipt.binderSha256 !== manifest.binderSha256
    || receipt.stagerSha256 !== manifest.stagerSha256 || receipt.nodeSha256 !== manifest.nodeSha256
    || receipt.powershellSha256 !== manifest.powershellSha256 || receipt.uacStartInvocations !== 1) {
    fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "receipt does not bind staged authority")
  }
  validateHostIdentity(receipt.hostIdentity, "launchReceipt.hostIdentity")
  if (canonicalize(receipt.hostIdentity) !== canonicalize(manifest.hostIdentity)) fail("HERMES_OWNERSHIP_HOST_INVALID", "receipt host differs")
  const startedAt = instant(receipt.startedAt, "launchReceipt.startedAt")
  const completedAt = instant(receipt.completedAt, "launchReceipt.completedAt")
  if (stagedAt > startedAt || startedAt > completedAt) fail("HERMES_OWNERSHIP_TIME_INVALID", "launch chronology differs")
  if (!Number.isInteger(receipt.elevatedProcessId) || receipt.elevatedProcessId < 1 || !Number.isInteger(receipt.exitCode)) fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "process result missing")
  if (typeof receipt.sourcePresent !== "boolean") fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "sourcePresent missing")
  assertSha(receipt.sourceSha256, "launchReceipt.sourceSha256", true)
  if (receipt.sourcePresent !== (receipt.sourceSha256 !== null)) fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "source presence/digest disagree")
  if (receipt.sourcePresent && receipt.disposition !== "COLLECTOR_SOURCE_PRESENT") fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "source disposition differs")
  if (receiptV1 && !receipt.sourcePresent && receipt.disposition !== "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL") fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "legacy early-death disposition differs")
  if (receiptV2) {
    if (receipt.sourcePresent) {
      if (receipt.bootstrapMapVersion !== null || receipt.bootstrapCheckpoint !== null || receipt.bootstrapExitCode !== null) fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "source receipt claims bootstrap failure")
    } else {
      if (receipt.bootstrapMapVersion !== BOOTSTRAP_CHECKPOINT_MAP_VERSION || !Number.isInteger(receipt.bootstrapExitCode) || receipt.bootstrapExitCode !== receipt.exitCode) fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "bootstrap exit lineage differs")
      const mappedCheckpoint = BOOTSTRAP_EXIT_CHECKPOINTS.get(receipt.bootstrapExitCode)
      if (mappedCheckpoint === undefined) {
        if (receipt.bootstrapCheckpoint !== null || receipt.disposition !== "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL_UNKNOWN") fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "unknown bootstrap exit was classified")
      } else if (receipt.bootstrapCheckpoint !== mappedCheckpoint || receipt.disposition !== "COLLECTOR_BOOTSTRAP_FAILED") {
        fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "bootstrap checkpoint mapping differs")
      }
    }
  }
  return { stagedAt, startedAt, completedAt, receiptV2 }
}

function validateAuthority(authority, manifest) {
  exactKeys(authority, ["elevated", "persistentCredential", "readOnly", "hostMutationAuthorized", "hostMutationObserved"], "source.authority")
  if (authority.elevated !== true || authority.persistentCredential !== false || authority.readOnly !== true || authority.hostMutationAuthorized !== false || authority.hostMutationObserved !== false) fail("HERMES_OWNERSHIP_AUTHORITY_INVALID", "source authority differs")
  if (manifest.authority.readOnly !== authority.readOnly || manifest.authority.hostMutationAuthorized !== authority.hostMutationAuthorized) fail("HERMES_OWNERSHIP_AUTHORITY_INVALID", "source exceeds manifest")
}

function validateFailureShape(failure) {
  exactKeys(failure, ["subprobeId", "probeStage", "domain", "typedClass", "exceptionType", "hresult", "nativeErrorCode", "fullyQualifiedErrorId", "category", "toolIdentity", "externalToolExitCode", "message", "messageSha256"], "source.failure")
  if (typeof failure.subprobeId !== "string" || !/^[a-z][a-z0-9.-]{2,80}$/.test(failure.subprobeId) || typeof failure.probeStage !== "string" || typeof failure.domain !== "string" || !FAILURE_CLASSES.has(failure.typedClass)) fail("HERMES_OWNERSHIP_FAILURE_INVALID", "typed probe identity differs")
  for (const key of ["exceptionType", "hresult", "fullyQualifiedErrorId", "category", "toolIdentity", "message"]) if (failure[key] !== null && typeof failure[key] !== "string") fail("HERMES_OWNERSHIP_FAILURE_INVALID", `${key} invalid`)
  for (const key of ["nativeErrorCode", "externalToolExitCode"]) if (failure[key] !== null && !Number.isInteger(failure[key])) fail("HERMES_OWNERSHIP_FAILURE_INVALID", `${key} invalid`)
  assertSha(failure.messageSha256, "source.failure.messageSha256")
  if (failure.message !== null && failure.message.length > 256) fail("HERMES_OWNERSHIP_FAILURE_INVALID", "message is unbounded")
  assertNoSecrets(failure, "source.failure")
}

function validatePartial(partial) {
  if (!Array.isArray(partial)) fail("HERMES_OWNERSHIP_PARTIAL_INVALID", "partial observations missing")
  for (const [index, entry] of partial.entries()) {
    exactKeys(entry, ["subprobeId", "observedAt", "authoritative", "value"], `partialObservations[${index}]`)
    if (typeof entry.subprobeId !== "string" || entry.authoritative !== false) fail("HERMES_OWNERSHIP_PARTIAL_INVALID", "partial observation claimed authority")
    instant(entry.observedAt, `partialObservations[${index}].observedAt`)
    assertNoSecrets(entry.value, `partialObservations[${index}].value`)
  }
}

function validateSource(source, manifest, receipt) {
  const common = ["schema", "artifact", "collectionId", "startedAt", "completedAt", "collector", "launch", "hostIdentity", "authority", "currentTruthClaim"]
  if (!object(source) || source.schema !== SOURCE_SCHEMA || ![OBSERVATION, PROBE_FAILURE].includes(source.artifact)) fail("HERMES_OWNERSHIP_SOURCE_INVALID", "source schema/artifact differs")
  exactKeys(source, source.artifact === OBSERVATION ? [...common, "observations"] : [...common, "failure", "partialObservations"], "source")
  if (source.collectionId !== manifest.nonce) fail("HERMES_OWNERSHIP_SOURCE_INVALID", "collection id differs")
  exactKeys(source.collector, ["name", "version", "sha256", "readOnly"], "source.collector")
  if (source.collector.name !== "diagnose-hermes-ollama-ownership.ps1" || !["2.0.0", "2.1.0"].includes(source.collector.version) || source.collector.sha256 !== manifest.collectorSha256 || source.collector.readOnly !== true) fail("HERMES_OWNERSHIP_SOURCE_INVALID", "collector identity differs")
  exactKeys(source.launch, ["nonce", "manifestSha256"], "source.launch")
  if (source.launch.nonce !== manifest.nonce || source.launch.manifestSha256 !== stableDigest(manifest)) fail("HERMES_OWNERSHIP_SOURCE_INVALID", "launch binding differs")
  validateHostIdentity(source.hostIdentity, "source.hostIdentity")
  if (canonicalize(source.hostIdentity) !== canonicalize(manifest.hostIdentity)) fail("HERMES_OWNERSHIP_HOST_INVALID", "source host differs")
  validateAuthority(source.authority, manifest)
  const sourceStarted = instant(source.startedAt, "source.startedAt")
  const sourceCompleted = instant(source.completedAt, "source.completedAt")
  if (sourceStarted < Date.parse(receipt.startedAt) || sourceStarted > sourceCompleted || sourceCompleted > Date.parse(receipt.completedAt)) fail("HERMES_OWNERSHIP_TIME_INVALID", "source chronology differs")
  if (source.artifact === OBSERVATION) {
    if (source.currentTruthClaim !== true || receipt.exitCode !== 0 || !object(source.observations)) fail("HERMES_OWNERSHIP_SOURCE_INVALID", "success semantics differ")
    assertNoSecrets(source.observations, "source.observations")
  } else {
    if (source.currentTruthClaim !== false || receipt.exitCode === 0) fail("HERMES_OWNERSHIP_SOURCE_INVALID", "failure semantics differ")
    validateFailureShape(source.failure)
    validatePartial(source.partialObservations)
  }
  return source
}

function bindingFor(manifest, receipt, sourceBytes, boundWithoutDigest) {
  const binding = {
    canonicalization: CANONICALIZATION,
    collectorSha256: manifest.collectorSha256,
    binderSha256: manifest.binderSha256,
    stagerSha256: manifest.stagerSha256,
    launchManifestSha256: stableDigest(manifest),
    launchReceiptSha256: stableDigest(receipt),
    sourceBytesSha256: sourceBytes ? sha256Bytes(sourceBytes) : null,
  }
  return { ...binding, digestSha256: stableDigest({ ...boundWithoutDigest, binding }) }
}

export function bindOwnershipOutcome({ source = null, sourceBytes = null, launchManifest, launchReceipt, now = new Date() }) {
  const launchTimes = validateLaunch(launchManifest, launchReceipt)
  const boundAtMs = instant(now.toISOString(), "boundAt")
  if (boundAtMs < launchTimes.completedAt || boundAtMs - launchTimes.completedAt > 300_000) fail("HERMES_OWNERSHIP_TIME_INVALID", "binding is outside the completion window")
  if (launchReceipt.sourcePresent) {
    if (!(Buffer.isBuffer(sourceBytes) || sourceBytes instanceof Uint8Array)) fail("HERMES_OWNERSHIP_SOURCE_REQUIRED", "receipt binds source bytes")
    if (sha256Bytes(sourceBytes) !== launchReceipt.sourceSha256) fail("HERMES_OWNERSHIP_SOURCE_TAMPERED", "source bytes differ from receipt")
  } else if (source !== null || sourceBytes !== null) fail("HERMES_OWNERSHIP_RECEIPT_INVALID", "unreceipted source supplied")

  let validated = null
  let invalidSourceDigest = null
  if (launchReceipt.sourcePresent && source !== null) {
    try { validated = validateSource(source, launchManifest, launchReceipt) }
    catch (error) {
      invalidSourceDigest = sha256Bytes(Buffer.from(`${error.code ?? "HERMES_OWNERSHIP_SOURCE_INVALID"}`, "utf8"))
    }
  }

  const boundAt = now.toISOString()
  const authority = { readOnly: true, hostMutationAuthorized: false, hostMutationObserved: false, uacStartInvocations: 1 }
  const boundSchema = launchTimes.receiptV2 ? BOUND_SCHEMA : LEGACY_BOUND_SCHEMA
  let terminal
  if (validated?.artifact === OBSERVATION) {
    terminal = {
      schema: boundSchema, artifact: OBSERVATION, boundAt, collectionId: launchManifest.nonce,
      hostIdentity: launchManifest.hostIdentity, currentTruthClaim: true, authority,
      observation: validated.observations,
    }
  } else {
    let failure
    if (validated?.artifact === PROBE_FAILURE) {
      failure = { disposition: "SEALED_INTERNAL_PROBE_FAILURE", diagnostic: validated.failure, partialObservations: validated.partialObservations }
    } else if (launchReceipt.sourcePresent) {
      failure = { disposition: "COLLECTOR_SOURCE_UNBINDABLE", diagnostic: null, partialObservations: [], sourceContractErrorSha256: invalidSourceDigest ?? sha256Bytes(Buffer.from("SOURCE_PARSE_FAILURE")) }
    } else if (launchTimes.receiptV2) {
      failure = {
        disposition: launchReceipt.disposition,
        diagnostic: null,
        partialObservations: [],
        bootstrap: {
          mapVersion: launchReceipt.bootstrapMapVersion,
          checkpoint: launchReceipt.bootstrapCheckpoint,
          exitCode: launchReceipt.bootstrapExitCode,
        },
      }
    } else {
      failure = { disposition: "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL", diagnostic: null, partialObservations: [] }
    }
    if (launchTimes.receiptV2 && launchReceipt.sourcePresent) failure = { ...failure, bootstrap: null }
    terminal = {
      schema: boundSchema, artifact: PROBE_FAILURE, boundAt, collectionId: launchManifest.nonce,
      hostIdentity: launchManifest.hostIdentity, currentTruthClaim: false, authority,
      failure: { ...failure, exitCode: launchReceipt.exitCode, elevatedProcessId: launchReceipt.elevatedProcessId },
    }
  }
  const binding = bindingFor(launchManifest, launchReceipt, sourceBytes, terminal)
  return { ...terminal, binding }
}

export function verifyBoundOwnership(bound, { source = null, sourceBytes = null, launchManifest, launchReceipt }) {
  if (!object(bound) || ![BOUND_SCHEMA, LEGACY_BOUND_SCHEMA].includes(bound.schema) || ![OBSERVATION, PROBE_FAILURE].includes(bound.artifact)) fail("HERMES_OWNERSHIP_BOUND_INVALID", "bound schema differs")
  if (bound.artifact === PROBE_FAILURE && bound.currentTruthClaim !== false) fail("HERMES_OWNERSHIP_BOUND_INVALID", "failure claims truth")
  if (bound.artifact === OBSERVATION && bound.currentTruthClaim !== true) fail("HERMES_OWNERSHIP_BOUND_INVALID", "observation lacks truth claim")
  exactKeys(bound.binding, ["canonicalization", "collectorSha256", "binderSha256", "stagerSha256", "launchManifestSha256", "launchReceiptSha256", "sourceBytesSha256", "digestSha256"], "bound.binding")
  const { binding, ...terminal } = bound
  const { digestSha256, ...withoutDigest } = binding
  if (binding.canonicalization !== CANONICALIZATION || stableDigest({ ...terminal, binding: withoutDigest }) !== digestSha256) fail("HERMES_OWNERSHIP_BOUND_TAMPERED", "bound digest differs")
  const rebound = bindOwnershipOutcome({ source, sourceBytes, launchManifest, launchReceipt, now: new Date(bound.boundAt) })
  if (canonicalize(rebound) !== canonicalize(bound)) fail("HERMES_OWNERSHIP_BOUND_TAMPERED", "external lineage differs")
  return { valid: true, artifact: bound.artifact, currentTruthClaim: bound.currentTruthClaim }
}

function parseJsonBytes(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, ""))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourcePath, manifestPath, receiptPath, boundPath] = process.argv.slice(2)
  if (![sourcePath, manifestPath, receiptPath, boundPath].every(Boolean)) fail("HERMES_OWNERSHIP_USAGE", "source manifest receipt bound paths required")
  const launchManifest = parseJsonBytes(fs.readFileSync(manifestPath))
  const launchReceipt = parseJsonBytes(fs.readFileSync(receiptPath))
  if (sha256Bytes(Buffer.from(path.resolve(sourcePath), "utf8")) !== launchManifest.sourcePathSha256
    || sha256Bytes(Buffer.from(path.resolve(boundPath), "utf8")) !== launchManifest.boundPathSha256) {
    fail("HERMES_OWNERSHIP_PATH_BINDING_INVALID", "CLI paths differ from launch manifest")
  }
  let sourceBytes = null
  let source = null
  if (launchReceipt.sourcePresent) {
    if (!fs.existsSync(sourcePath)) fail("HERMES_OWNERSHIP_SOURCE_REQUIRED", "receipted source path is absent")
    sourceBytes = fs.readFileSync(sourcePath)
    try { source = parseJsonBytes(sourceBytes) } catch { source = null }
  }
  const bound = bindOwnershipOutcome({ source, sourceBytes, launchManifest, launchReceipt })
  verifyBoundOwnership(bound, { source, sourceBytes, launchManifest, launchReceipt })
  process.stdout.write(`${canonicalize(bound)}\n`)
  process.exitCode = bound.artifact === PROBE_FAILURE ? 70 : 0
}
