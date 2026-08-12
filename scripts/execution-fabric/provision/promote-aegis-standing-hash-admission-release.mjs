#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export const PROMOTION_MANIFEST_PATH = "config/execution-fabric/aegis-standing-hash-admission-release-promotion.v1.json"
export const PROMOTION_INSTALLER_PATH = "scripts/execution-fabric/provision/promote-aegis-standing-hash-admission-release.mjs"
export const STANDING_AUTHORITY_PATH = "config/execution-fabric/aegis-standing-compute-authority.v1.json"
export const STANDING_EVALUATOR_PATH = "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs"
export const PROMOTION_VALIDATOR_PATH = "scripts/execution-fabric/admission/validate-aegis-standing-promotion-artifacts.mjs"
export const TRUSTED_RELEASE_MANIFEST_PATH = "/etc/williamos/fabric/trusted-main-release.json"
export const ACTIVATION_MARKER_PATH = "/etc/williamos/fabric/aegis-standing-hash-replay-ledger-upgrade-v1.activation.json"
export const REPLAY_JOURNAL_PATH = "/var/lib/aegis-standing-hash-replay-journal.jsonl"
export const NODE_LEASE_PATH = "/var/lib/williamos/fabric/ledger/resident-aegis-active.json"
export const NODE_MUTATION_LOCK_PATH = "/var/lib/williamos/fabric/ledger/resident-aegis-mutation.lock"
export const LEDGER_MUTATION_LOCK_PATH = "/var/lib/williamos/fabric/standing-hash-ledger/standing-hash-mutation.lock"
export const REQUEST_ROOT = "/var/lib/williamos/fabric/standing-hash-requests"
export const AUTHORITY_ROOT = "/var/lib/williamos/fabric/standing-hash-promotion-authorities"

const CURRENT_COMMIT = "2593e782fdbaefbc05f617cdac3acde4a4255be0"
const REPOSITORY = "bsvalues/terragroq"
const DIGEST = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/
const SAFE_REPOSITORY_PATH = /^(?!\/)(?!.*\\)(?!.*\0)[A-Za-z0-9._/-]+$/
const PLACEHOLDER = /__[A-Z0-9_]+__/
const MAX_BYTES = 16 * 1024 * 1024
const ALLOWED_SERVICE_HOMES = new Set(["/home/williamos-fabric", "/var/empty/williamos-fabric"])
const REQUIRED_CLOSURE = Object.freeze([
  "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs",
  "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs",
  "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs",
  "scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs",
  "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs",
  "scripts/execution-fabric/provision/aegis-standing-hash-replay-ledger.mjs",
  "scripts/execution-fabric/canonical-json.mjs",
])
const ACTIVATION_ORDER = Object.freeze([
  "PUBLISH_CONTENT_ADDRESSED_RELEASE",
  "INSTALL_PRIVATE_REQUEST",
  "REPLACE_ACTIVATION_MARKER",
  "REPLACE_TRUSTED_RELEASE_MANIFEST",
])
const REPLAY_UPGRADE_ORDER = Object.freeze([
  "PUBLISH_CONTENT_ADDRESSED_RELEASE", "CREATE_EMPTY_REPLAY_JOURNAL", "SET_AND_VERIFY_APPEND_ONLY",
  "INSTALL_REPLAY_HELPER", "REPLACE_REPLAY_INITIALIZER", "REPLACE_BOOTSTRAP",
  "CREATE_ACTIVATION_MARKER", "REPLACE_TRUSTED_RELEASE_MANIFEST",
])
const AUTHORITY_KEYS = Object.freeze([
  "schemaVersion", "authorityId", "promotionId", "repository", "machineIdSha256",
  "priorCommit", "newCommit", "evidenceCommit", "packageCommit", "manifestSha256",
  "priorReleaseManifestSha256", "priorActivationMarkerSha256", "replayUpgradeJournalSha256",
  "replayJournalSha256", "priorAuthorizedKeysSha256", "newClosureSha256", "trustArtifactSha256",
  "reviewedCheckoutPath", "evidenceCheckoutPath", "packageCheckoutPath",
  "issuedAt", "expiresAt", "singleUse", "consumed",
])

function validUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("lone surrogate")
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError("lone surrogate")
  }
}

export function canonicalizePromotionJcs(value) {
  if (typeof value === "string") { validUnicode(value); return JSON.stringify(value) }
  if (value === null || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizePromotionJcs).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      validUnicode(key)
      return `${JSON.stringify(key)}:${canonicalizePromotionJcs(value[key])}`
    }).join(",")}}`
  }
  throw new TypeError("unsupported JSON value")
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalSha256 = (value) => sha256(Buffer.from(canonicalizePromotionJcs(value), "utf8"))
const same = (left, right) => canonicalizePromotionJcs(left) === canonicalizePromotionJcs(right)
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort())

function fail(code, detail, state = {}) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  Object.assign(error, state)
  throw error
}

function parseJson(bytes, code, label) {
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")) } catch { fail(code, `${label} is not valid JSON`) }
}

function canonicalTimestamp(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function safeRelative(value, prefix = null) {
  if (typeof value !== "string" || !SAFE_REPOSITORY_PATH.test(value)
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || (prefix && !value.startsWith(`${prefix}/`))) {
    fail("AEGIS_ADMISSION_PROMOTION_MANIFEST_INVALID", `unsafe repository path: ${String(value)}`)
  }
  return value
}

function modeNumber(value) {
  return typeof value === "string" && /^0[0-7]{3}$/.test(value) ? Number.parseInt(value, 8) : NaN
}

function validateManifest(manifest) {
  const prior = manifest?.priorState
  const evidence = manifest?.evidenceRelease
  const next = manifest?.newRelease
  const packageRelease = manifest?.packageRelease
  const install = manifest?.install
  if (!exactKeys(manifest, ["schemaVersion", "promotionId", "issue", "workOrderId", "repository", "authority",
    "machine", "serviceAccount", "priorState", "evidenceRelease", "newRelease", "packageRelease", "install",
    "forbiddenMutations"])
    || !exactKeys(manifest?.authority, ["maximumAgeSeconds", "singleUse", "consumeBeforeMutation"])
    || !exactKeys(manifest?.machine, ["platform", "effectiveUid", "hostname", "machineIdSha256"])
    || !exactKeys(manifest?.serviceAccount, ["name", "home", "shell"])
    || !exactKeys(prior, ["commit", "releaseRoot", "trustedReleaseManifestPath", "activationMarkerPath",
      "replayUpgradeJournalPath", "replayUpgradeJournalSha256", "replayJournalPath", "replayJournalSha256",
      "authorizedKeysPath", "requestRoot", "closure", "inactivePaths"])
    || !exactKeys(evidence, ["sourceCommit", "admissionPath", "admissionSha256", "inputPath", "inputSha256"])
    || !exactKeys(next, ["commit", "checkoutPath", "releaseRoot", "trustedRef", "manifestSchemaVersion", "closure", "trustArtifacts"])
    || !exactKeys(next?.trustArtifacts, ["requestSourcePath", "requestSha256", "admissionPath", "admissionSha256", "inputPath", "inputSha256"])
    || !exactKeys(packageRelease, ["commit", "checkoutPath", "installerSha256", "validatorSha256",
      "evaluatorSha256", "standingAuthoritySha256"])
    || !exactKeys(install, ["requestId", "requestPath", "requestMode", "journalPrefix", "authorityRoot",
      "activationMarkerPath", "activationOrder"])
    || manifest?.schemaVersion !== 1 || manifest.promotionId !== "aegis-standing-hash-admission-release-promotion-v1"
    || manifest.issue !== 595 || manifest.workOrderId !== "WO-EF-AEGIS-STANDING-001"
    || manifest.repository !== REPOSITORY || manifest.authority?.maximumAgeSeconds !== 900
    || manifest.authority?.singleUse !== true || manifest.authority?.consumeBeforeMutation !== true
    || manifest.machine?.platform !== "linux" || manifest.machine?.effectiveUid !== 0
    || manifest.machine?.hostname !== "aegis" || !DIGEST.test(manifest.machine?.machineIdSha256 ?? "")
    || manifest.serviceAccount?.name !== "williamos-fabric"
    || !ALLOWED_SERVICE_HOMES.has(manifest.serviceAccount?.home) || manifest.serviceAccount?.shell !== "/bin/bash"
    || prior?.commit !== CURRENT_COMMIT || prior.releaseRoot !== `/opt/williamos/releases/${CURRENT_COMMIT}`
    || prior.trustedReleaseManifestPath !== TRUSTED_RELEASE_MANIFEST_PATH
    || prior.activationMarkerPath !== ACTIVATION_MARKER_PATH || prior.replayJournalPath !== REPLAY_JOURNAL_PATH
    || prior.requestRoot !== REQUEST_ROOT || prior.authorizedKeysPath !== "/home/williamos-fabric/.ssh/authorized_keys"
    || !same(Object.keys(prior.closure ?? {}).sort(), [...REQUIRED_CLOSURE].sort())
    || Object.values(prior.closure ?? {}).some((digest) => !DIGEST.test(digest))
    || !same(prior.inactivePaths, [NODE_LEASE_PATH, NODE_MUTATION_LOCK_PATH, LEDGER_MUTATION_LOCK_PATH])
    || install?.authorityRoot !== AUTHORITY_ROOT || install.activationMarkerPath !== ACTIVATION_MARKER_PATH
    || install.requestMode !== "0600" || !same(install.activationOrder, ACTIVATION_ORDER)
    || !same(manifest.forbiddenMutations, [
      "authorized_keys", "account", "network", "replay-journal", "standing-ledger", "scheduler",
      "storage-root", "prior-release", "prior-evidence",
    ])) {
    fail("AEGIS_ADMISSION_PROMOTION_MANIFEST_INVALID", "promotion manifest semantics differ")
  }
  if (JSON.stringify(manifest).match(PLACEHOLDER)) {
    fail("AEGIS_ADMISSION_PROMOTION_NOT_FINALIZED", "promotion commits, paths, and digests are placeholders")
  }
  if (!DIGEST.test(prior.replayUpgradeJournalSha256 ?? "") || !DIGEST.test(prior.replayJournalSha256 ?? "")
    || typeof prior.replayUpgradeJournalPath !== "string"
    || !/^\/var\/lib\/williamos-aegis-standing-hash-replay-ledger-upgrade-[0-9a-f-]{36}\.journal\.jsonl$/i.test(prior.replayUpgradeJournalPath)
    || !COMMIT.test(evidence?.sourceCommit ?? "")
    || !DIGEST.test(evidence?.admissionSha256 ?? "") || !DIGEST.test(evidence?.inputSha256 ?? "")
    || !COMMIT.test(next?.commit ?? "") || !path.posix.isAbsolute(next?.checkoutPath ?? "")
    || next.releaseRoot !== `/opt/williamos/releases/${next.commit}` || next.trustedRef !== "refs/heads/main"
    || next.manifestSchemaVersion !== "1.0-williamos-trusted-main-release"
    || !same(Object.keys(next.closure ?? {}).sort(), [...REQUIRED_CLOSURE].sort())
    || Object.values(next.closure ?? {}).some((digest) => !DIGEST.test(digest))
    || !next.trustArtifacts || Object.keys(next.trustArtifacts).length !== 6
    || Object.entries(next.trustArtifacts).filter(([key]) => key.endsWith("Sha256")).some(([, digest]) => !DIGEST.test(digest))
    || next.trustArtifacts.admissionPath !== evidence.admissionPath
    || next.trustArtifacts.admissionSha256 !== evidence.admissionSha256
    || next.trustArtifacts.inputPath !== evidence.inputPath || next.trustArtifacts.inputSha256 !== evidence.inputSha256
    || !COMMIT.test(packageRelease?.commit ?? "") || !path.posix.isAbsolute(packageRelease?.checkoutPath ?? "")
    || !DIGEST.test(packageRelease?.installerSha256 ?? "") || !DIGEST.test(packageRelease?.validatorSha256 ?? "")
    || !DIGEST.test(packageRelease?.evaluatorSha256 ?? "")
    || !DIGEST.test(packageRelease?.standingAuthoritySha256 ?? "") || !SAFE_ID.test(install.requestId ?? "")
    || install.requestPath !== `${REQUEST_ROOT}/${install.requestId}.json`
    || !/^\/var\/lib\/williamos-aegis-standing-hash-admission-release-promotion-$/.test(install.journalPrefix)
    || evidence.sourceCommit === prior.commit
    || next.closure[REQUIRED_CLOSURE[0]] !== prior.closure[REQUIRED_CLOSURE[0]]
    || new Set([prior.commit, next.commit, packageRelease.commit]).size !== 3) {
    fail("AEGIS_ADMISSION_PROMOTION_MANIFEST_INVALID", "final promotion binding differs")
  }
  safeRelative(evidence.admissionPath, "docs/reports/standing-dispatch")
  safeRelative(evidence.inputPath, "docs/reports/standing-dispatch/inputs")
  safeRelative(next.trustArtifacts.requestSourcePath, "docs/reports/standing-dispatch")
  return manifest
}

export function validateAegisStandingHashAdmissionReleasePromotionManifest(manifest) {
  return validateManifest(structuredClone(manifest))
}

function validateAuthority(manifest, authority, now, manifestSha256) {
  if (!exactKeys(authority, AUTHORITY_KEYS) || authority.schemaVersion !== 1
    || !UUID.test(authority.authorityId ?? "") || authority.singleUse !== true) {
    fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_INVALID", "authority shape differs")
  }
  if (authority.consumed !== false) fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_REPLAY", "authority is already consumed")
  const expected = {
    promotionId: manifest.promotionId,
    repository: manifest.repository,
    machineIdSha256: manifest.machine.machineIdSha256,
    priorCommit: manifest.priorState.commit,
    newCommit: manifest.newRelease.commit,
    packageCommit: manifest.packageRelease.commit,
    manifestSha256,
    replayUpgradeJournalSha256: manifest.priorState.replayUpgradeJournalSha256,
    replayJournalSha256: manifest.priorState.replayJournalSha256,
    newClosureSha256: manifest.newRelease.closure,
    trustArtifactSha256: {
      request: manifest.newRelease.trustArtifacts.requestSha256,
      admission: manifest.newRelease.trustArtifacts.admissionSha256,
      input: manifest.newRelease.trustArtifacts.inputSha256,
    },
    reviewedCheckoutPath: manifest.newRelease.checkoutPath,
    packageCheckoutPath: manifest.packageRelease.checkoutPath,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!same(authority[key], value)) fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_SCOPE_MISMATCH", `${key} differs`)
  }
  if (!COMMIT.test(authority.evidenceCommit ?? "") || typeof authority.evidenceCheckoutPath !== "string"
    || !path.posix.isAbsolute(authority.evidenceCheckoutPath)
    || new Set([manifest.priorState.commit, manifest.packageRelease.commit,
      manifest.newRelease.commit, authority.evidenceCommit]).size !== 4) {
    fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_SCOPE_MISMATCH", "evidence release binding is invalid")
  }
  for (const key of ["priorReleaseManifestSha256", "priorActivationMarkerSha256", "priorAuthorizedKeysSha256"]) {
    if (!DIGEST.test(authority[key] ?? "")) fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_SCOPE_MISMATCH", `${key} is invalid`)
  }
  const issued = Date.parse(authority.issuedAt)
  const expires = Date.parse(authority.expiresAt)
  const current = Date.parse(now)
  if (!canonicalTimestamp(authority.issuedAt) || !canonicalTimestamp(authority.expiresAt) || !canonicalTimestamp(now)
    || expires <= issued || expires - issued > manifest.authority.maximumAgeSeconds * 1000
    || current < issued || current >= expires) {
    fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_EXPIRED", "authority is outside its short-lived window")
  }
}

function assertExactFile(io, targetPath, { uid, gid, mode, digest, absent = false }) {
  const observed = io.inspect(targetPath)
  if (absent) {
    if (observed !== null) fail("AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", `${targetPath} must be absent`)
    return null
  }
  if (!observed || observed.type !== "file" || observed.direct !== true || observed.nlink !== 1
    || (uid !== undefined && observed.uid !== uid) || (gid !== undefined && observed.gid !== gid)
    || (mode !== undefined && observed.mode !== mode)) {
    fail("AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", `${targetPath} metadata differs`)
  }
  const bytes = io.read(targetPath)
  if (digest && sha256(bytes) !== digest) fail("AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", `${targetPath} digest differs`)
  return bytes
}

function assertExactDirectory(io, targetPath, { uid, gid, mode }) {
  const observed = io.inspect(targetPath)
  if (!observed || observed.type !== "directory" || observed.direct !== true
    || observed.uid !== uid || observed.gid !== gid || observed.mode !== mode) {
    fail("AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", `${targetPath} directory metadata differs`)
  }
}

export function validateCheckoutAncestorChain(inspect, checkout, closure) {
  for (const relative of Object.keys(closure)) {
    let current = path.posix.dirname(relative)
    while (current !== ".") {
      const target = path.posix.join(checkout, current)
      const observed = inspect(target)
      if (!observed || observed.type !== "directory" || !observed.direct
        || observed.uid !== 0 || observed.gid !== 0 || (observed.mode & 0o022) !== 0) {
        fail("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT", `${target} directory metadata is untrusted`)
      }
      current = path.posix.dirname(current)
    }
  }
}

function validateCurrentActivation(manifest, releaseBytes, markerBytes, authority, upgrade) {
  const release = parseJson(releaseBytes, "AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", "trusted release manifest")
  const body = { ...release }
  delete body.release_manifest_sha256
  if (!exactKeys(release, ["schema_version", "repository", "trusted_ref", "head_commit", "release_root",
    "reviewed", "deployed_at", "file_sha256", "activation_marker_path", "activation_marker_sha256",
    "release_manifest_sha256"])
    || sha256(releaseBytes) !== authority.priorReleaseManifestSha256
    || release.schema_version !== "1.0-williamos-trusted-main-release" || release.repository !== REPOSITORY
    || release.trusted_ref !== "refs/heads/main" || release.head_commit !== CURRENT_COMMIT
    || release.release_root !== manifest.priorState.releaseRoot || release.reviewed !== true
    || !canonicalTimestamp(release.deployed_at) || !same(release.file_sha256, manifest.priorState.closure)
    || release.activation_marker_path !== ACTIVATION_MARKER_PATH
    || release.release_manifest_sha256 !== canonicalSha256(body)) {
    fail("AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", "current trusted release is not the exact reviewed activation")
  }
  const marker = parseJson(markerBytes, "AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", "activation marker")
  if (!exactKeys(marker, ["schema_version", "upgrade_id", "authority_id", "new_commit",
    "runtime_closure_sha256", "manifest_sha256", "prepared_at"])
    || sha256(markerBytes) !== authority.priorActivationMarkerSha256
    || marker.schema_version !== "1.0-aegis-standing-hash-activation-marker"
    || marker.upgrade_id !== "aegis-standing-hash-replay-ledger-upgrade-v1"
    || !UUID.test(marker.authority_id ?? "") || marker.authority_id !== upgrade.prepared.authority_id
    || marker.manifest_sha256 !== upgrade.prepared.manifest_sha256 || marker.new_commit !== CURRENT_COMMIT
    || !same(marker.runtime_closure_sha256, manifest.priorState.closure)
    || !DIGEST.test(marker.manifest_sha256 ?? "") || !canonicalTimestamp(marker.prepared_at)
    || release.activation_marker_sha256 !== canonicalSha256(marker)) {
    fail("AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", "current activation marker binding differs")
  }
}

function validateReplayUpgradeJournal(bytes, manifest) {
  let records
  try { records = bytes.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line)) } catch {
    fail("AEGIS_ADMISSION_PROMOTION_REPLAY_UPGRADE_INVALID", "replay upgrade journal is malformed")
  }
  const prepared = records[0]
  const committed = records.at(-1)
  if (records.length !== 2 || prepared?.record_type !== "PREPARED"
    || prepared.schema_version !== "1.0-aegis-standing-hash-replay-ledger-upgrade-journal"
    || !UUID.test(prepared.authority_id ?? "") || !DIGEST.test(prepared.authority_sha256 ?? "")
    || !DIGEST.test(prepared.manifest_sha256 ?? "")
    || prepared.new_commit !== manifest.evidenceRelease.sourceCommit || committed?.record_type !== "COMMITTED"
    || committed.phase !== 2 || !same(committed.completed_mutations, REPLAY_UPGRADE_ORDER)
    || committed.replay_epoch_initialized !== false || committed.operational !== false
    || records.some((record) => String(record?.record_type ?? "").startsWith("FAILED"))) {
    fail("AEGIS_ADMISSION_PROMOTION_REPLAY_UPGRADE_INVALID", "replay upgrade lacks one exact committed terminal")
  }
  return { prepared, committed }
}

function validateEpochOnlyReplayJournal(bytes) {
  if (bytes.length === 0 || !bytes.toString("utf8").endsWith("\n")) {
    fail("AEGIS_ADMISSION_PROMOTION_REPLAY_STATE_INVALID", "replay journal is empty or truncated")
  }
  let entries
  try { entries = bytes.toString("utf8").slice(0, -1).split("\n").map((line) => JSON.parse(line)) } catch {
    fail("AEGIS_ADMISSION_PROMOTION_REPLAY_STATE_INVALID", "replay journal JSON is malformed")
  }
  let previous = null
  for (const [index, entry] of entries.entries()) {
    const body = { ...entry }
    delete body.entry_sha256
    if (!exactKeys(entry, ["sequence", "previous_entry_sha256", "recorded_at", "record", "entry_sha256"])
      || entry.sequence !== index + 1 || entry.previous_entry_sha256 !== previous
      || !canonicalTimestamp(entry.recorded_at) || entry.entry_sha256 !== canonicalSha256(body)) {
      fail("AEGIS_ADMISSION_PROMOTION_REPLAY_STATE_INVALID", "replay journal hash chain differs")
    }
    previous = entry.entry_sha256
  }
  const record = entries[0]?.record
  const recordBody = record && { ...record }
  if (recordBody) delete recordBody.journal_record_sha256
  if (entries.length !== 1 || !exactKeys(record, ["record_type", "epoch_id", "initialized_at", "journal_record_sha256"])
    || record?.record_type !== "EPOCH"
    || record.epoch_id !== "aegis-standing-hash-replay-epoch-v1"
    || !canonicalTimestamp(record.initialized_at) || record.journal_record_sha256 !== canonicalSha256(recordBody)
    || entries.some((entry) => entry.record?.record_type === "CLAIM")) {
    fail("AEGIS_ADMISSION_PROMOTION_REPLAY_STATE_INVALID", "exactly one epoch and no claim are required")
  }
  return { record, recordedAt: entries[0].recorded_at }
}

function promotionJobScope(request) {
  return {
    schema_version: request.schema_version,
    job_id: request.job_id,
    outcome: request.outcome,
    work_order_id: request.work_order_id,
    source: request.source,
    workload: request.workload,
    execution_identity: request.execution_identity,
    reviewed_binding: request.reviewed_binding,
    input: request.input,
    limits: request.limits,
    boundary: request.boundary,
  }
}

function validateTrustArtifacts(io, manifest, requestBytes, admissionBytes, inputBytes,
  standingAuthorityBytes, epoch, now) {
  const request = parseJson(requestBytes, "AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID", "private request")
  const admission = parseJson(admissionBytes, "AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID", "admission")
  const standingAuthority = parseJson(standingAuthorityBytes,
    "AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID", "standing authority")
  const eligibility = io.evaluateStandingArtifacts(
    path.posix.join(manifest.packageRelease.checkoutPath, PROMOTION_VALIDATOR_PATH),
    { authority: standingAuthority, request, candidateAdmission: admission, now })
  if (eligibility.status !== "ADMITTED" || eligibility.execution_authorized !== true
    || eligibility.dispatch_allowed !== true || eligibility.scheduler_activated !== false
    || eligibility.autonomous_selection !== false) {
    fail("AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID",
      `standing runtime eligibility rejected the artifacts: ${eligibility.code ?? "NOT_ADMITTED"}`)
  }
  const issued = Date.parse(admission?.issued_at)
  const expires = Date.parse(admission?.expires_at)
  const current = Date.parse(now)
  const jobScope = promotionJobScope(request)
  if (request?.schema_version !== "1.0-aegis-standing-admission-request"
    || request.source?.repository !== REPOSITORY || request.source?.commit_sha !== manifest.evidenceRelease.sourceCommit
    || request.input?.relative_path !== manifest.evidenceRelease.inputPath.replace("docs/reports/standing-dispatch/", "")
    || request.input?.expected_sha256 !== sha256(inputBytes) || request.input?.expected_byte_length !== inputBytes.length
    || request.claim?.admission_sha256 !== canonicalSha256(admission)
    || admission?.schema_version !== "1.0-aegis-standing-job-admission" || admission.status !== "ACTIVE"
    || admission.single_use !== true || admission.consumption_count !== 0 || admission.consumed_at !== null
    || !same(admission.job_scope, jobScope) || admission.job_scope_sha256 !== canonicalSha256(jobScope)
    || admission.revoked_at !== null || !canonicalTimestamp(admission.issued_at) || !canonicalTimestamp(admission.expires_at)
    || issued <= Date.parse(epoch.recordedAt) || issued > current || expires <= current || expires - issued > 86_400_000) {
    fail("AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID", "request, admission, input, freshness, or epoch binding differs")
  }
}

function verifyCheckouts(io, manifest, authority, manifestBytes) {
  const evidenceClosure = {
    [PROMOTION_MANIFEST_PATH]: sha256(manifestBytes),
    [manifest.evidenceRelease.admissionPath]: manifest.evidenceRelease.admissionSha256,
    [manifest.evidenceRelease.inputPath]: manifest.evidenceRelease.inputSha256,
  }
  const releaseArtifacts = manifest.newRelease.trustArtifacts
  const releaseClosure = {
    ...manifest.newRelease.closure,
    [releaseArtifacts.requestSourcePath]: releaseArtifacts.requestSha256,
    [releaseArtifacts.admissionPath]: releaseArtifacts.admissionSha256,
    [releaseArtifacts.inputPath]: releaseArtifacts.inputSha256,
  }
  const packageClosure = {
    [PROMOTION_INSTALLER_PATH]: manifest.packageRelease.installerSha256,
    [PROMOTION_VALIDATOR_PATH]: manifest.packageRelease.validatorSha256,
    [STANDING_EVALUATOR_PATH]: manifest.packageRelease.evaluatorSha256,
    [STANDING_AUTHORITY_PATH]: manifest.packageRelease.standingAuthoritySha256,
  }
  try {
    io.verifyCheckout(authority.evidenceCheckoutPath, authority.evidenceCommit, REPOSITORY, evidenceClosure)
    io.verifyCheckout(manifest.newRelease.checkoutPath, manifest.newRelease.commit, REPOSITORY, releaseClosure)
    io.verifyCheckout(manifest.packageRelease.checkoutPath, manifest.packageRelease.commit, REPOSITORY, packageClosure)
    io.verifyAncestry(authority.evidenceCheckoutPath, manifest.evidenceRelease.sourceCommit, manifest.priorState.commit)
    io.verifyAncestry(authority.evidenceCheckoutPath, manifest.priorState.commit, manifest.packageRelease.commit)
    io.verifyAncestry(authority.evidenceCheckoutPath, manifest.packageRelease.commit, manifest.newRelease.commit)
    io.verifyAncestry(authority.evidenceCheckoutPath, manifest.newRelease.commit, authority.evidenceCommit)
  } catch (error) {
    if (error?.code === "AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT") throw error
    fail("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT", String(error?.message ?? error).slice(0, 256))
  }
  for (const [checkout, closure] of [
    [authority.evidenceCheckoutPath, evidenceClosure],
    [manifest.newRelease.checkoutPath, releaseClosure],
    [manifest.packageRelease.checkoutPath, packageClosure],
  ]) {
    for (const [relative, digest] of Object.entries(closure)) {
      if (sha256(io.read(path.posix.join(checkout, relative))) !== digest) {
        fail("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT", `${relative} bytes differ from the reviewed checkout`)
      }
    }
  }
}

function inspectPriorState(io, manifest, authority, heldLocks = false) {
  const account = io.account(manifest.serviceAccount.name)
  if (!same(account, { uid: account.uid, gid: account.gid, home: manifest.serviceAccount.home, shell: manifest.serviceAccount.shell })
    || !Number.isSafeInteger(account.uid) || account.uid <= 0 || !Number.isSafeInteger(account.gid) || account.gid <= 0) {
    fail("AEGIS_ADMISSION_PROMOTION_ACCOUNT_INVALID", "williamos-fabric account identity differs")
  }
  assertExactDirectory(io, REQUEST_ROOT, { uid: account.uid, gid: account.gid, mode: 0o700 })
  const releaseBytes = assertExactFile(io, TRUSTED_RELEASE_MANIFEST_PATH,
    { uid: 0, gid: 0, mode: 0o444, digest: authority.priorReleaseManifestSha256 })
  const markerBytes = assertExactFile(io, ACTIVATION_MARKER_PATH,
    { uid: 0, gid: 0, mode: 0o444, digest: authority.priorActivationMarkerSha256 })
  io.verifyCheckout(manifest.priorState.releaseRoot, manifest.priorState.commit, REPOSITORY, manifest.priorState.closure)
  for (const [relative, digest] of Object.entries(manifest.priorState.closure)) {
    if (sha256(io.read(path.posix.join(manifest.priorState.releaseRoot, relative))) !== digest) {
      fail("AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT", `${relative} differs from the current release closure`)
    }
  }
  const upgradeBytes = assertExactFile(io, manifest.priorState.replayUpgradeJournalPath,
    { uid: 0, gid: 0, mode: 0o600, digest: authority.replayUpgradeJournalSha256 })
  const upgrade = validateReplayUpgradeJournal(upgradeBytes, manifest)
  if (!manifest.priorState.replayUpgradeJournalPath.endsWith(`-${upgrade.prepared.authority_id}.journal.jsonl`)) {
    fail("AEGIS_ADMISSION_PROMOTION_REPLAY_UPGRADE_INVALID", "replay upgrade journal path and authority differ")
  }
  validateCurrentActivation(manifest, releaseBytes, markerBytes, authority, upgrade)
  const replayBytes = assertExactFile(io, REPLAY_JOURNAL_PATH,
    { uid: 0, gid: account.gid, mode: 0o660, digest: authority.replayJournalSha256 })
  if (!io.hasAppendOnly(REPLAY_JOURNAL_PATH)) {
    fail("AEGIS_ADMISSION_PROMOTION_REPLAY_STATE_INVALID", "replay journal append-only fence is absent")
  }
  const epoch = validateEpochOnlyReplayJournal(replayBytes)
  const authorizedKeysBytes = assertExactFile(io, manifest.priorState.authorizedKeysPath,
    { uid: account.uid, gid: account.gid, mode: 0o600, digest: authority.priorAuthorizedKeysSha256 })
  assertExactFile(io, NODE_LEASE_PATH, { absent: true })
  for (const lockPath of [NODE_MUTATION_LOCK_PATH, LEDGER_MUTATION_LOCK_PATH]) {
    if (heldLocks) assertExactFile(io, lockPath, { uid: account.uid, gid: account.gid, mode: 0o600 })
    else assertExactFile(io, lockPath, { absent: true })
  }
  assertExactFile(io, manifest.newRelease.releaseRoot, { absent: true })
  assertExactFile(io, manifest.install.requestPath, { absent: true })
  return { account, releaseBytes, markerBytes, replayBytes, upgradeBytes, authorizedKeysBytes, epoch }
}

function verifyMachine(io, manifest, injectedMachineIdSha256) {
  if (io.platform() !== "linux") fail("AEGIS_ADMISSION_PROMOTION_LINUX_REQUIRED", "promotion is Linux-only")
  if (io.euid() !== 0) fail("AEGIS_ADMISSION_PROMOTION_ROOT_REQUIRED", "promotion requires effective root")
  if (io.hostname() !== manifest.machine.hostname) fail("AEGIS_ADMISSION_PROMOTION_HOST_REJECTED", "exact aegis hostname is required")
  const observed = injectedMachineIdSha256 ?? sha256(Buffer.from(io.read("/etc/machine-id").toString("utf8").trim(), "utf8"))
  if (observed !== manifest.machine.machineIdSha256) fail("AEGIS_ADMISSION_PROMOTION_MACHINE_REJECTED", "machine identity differs")
}

function trustedRelease(manifest, deployedAt, activationMarkerSha256) {
  const body = {
    schema_version: manifest.newRelease.manifestSchemaVersion,
    repository: manifest.repository,
    trusted_ref: manifest.newRelease.trustedRef,
    head_commit: manifest.newRelease.commit,
    release_root: manifest.newRelease.releaseRoot,
    reviewed: true,
    deployed_at: deployedAt,
    file_sha256: manifest.newRelease.closure,
    activation_marker_path: manifest.install.activationMarkerPath,
    activation_marker_sha256: activationMarkerSha256,
  }
  return { ...body, release_manifest_sha256: canonicalSha256(body) }
}

function recoverCommittedPromotion(io, manifest, manifestBytes, authority, mutationJournal) {
  validateAuthority(manifest, authority, authority.issuedAt, sha256(manifestBytes))
  const account = io.account(manifest.serviceAccount.name)
  if (!same(account, { uid: account.uid, gid: account.gid,
    home: manifest.serviceAccount.home, shell: manifest.serviceAccount.shell })
    || !Number.isSafeInteger(account.uid) || account.uid <= 0
    || !Number.isSafeInteger(account.gid) || account.gid <= 0) {
    fail("AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN", "service account identity drifted")
  }
  assertExactDirectory(io, REQUEST_ROOT, { uid: account.uid, gid: account.gid, mode: 0o700 })
  const journalBytes = assertExactFile(io, mutationJournal, { uid: 0, gid: 0, mode: 0o600 })
  let records
  try { records = journalBytes.toString("utf8").trim().split("\n").map(JSON.parse) }
  catch { fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_REPLAY", "authority journal already exists") }
  const [prepared, committed] = records
  if (records.length !== 2 || prepared?.record_type !== "AUTHORITY_CONSUMED"
    || prepared.authority_id !== authority.authorityId || prepared.authority_sha256 !== canonicalSha256(authority)
    || prepared.manifest_sha256 !== sha256(manifestBytes) || prepared.new_commit !== manifest.newRelease.commit
    || !canonicalTimestamp(prepared.prepared_at) || committed?.record_type !== "COMMITTED"
    || !same(committed.completed_mutations, ACTIVATION_ORDER)) {
    fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_REPLAY", "authority journal is not one exact recoverable committed run")
  }
  verifyCheckouts(io, manifest, authority, manifestBytes)
  const requestBytes = io.read(path.posix.join(manifest.newRelease.checkoutPath,
    manifest.newRelease.trustArtifacts.requestSourcePath))
  assertExactFile(io, manifest.install.requestPath,
    { uid: account.uid, gid: account.gid, mode: 0o600, digest: committed.request_sha256 })
  const markerBytes = assertExactFile(io, ACTIVATION_MARKER_PATH,
    { uid: 0, gid: 0, mode: 0o444, digest: committed.activation_marker_sha256 })
  const marker = parseJson(markerBytes, "AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN", "activation marker")
  assertExactFile(io, TRUSTED_RELEASE_MANIFEST_PATH,
    { uid: 0, gid: 0, mode: 0o444, digest: committed.release_manifest_sha256 })
  if (marker.authority_id !== authority.authorityId || marker.new_commit !== manifest.newRelease.commit
    || marker.manifest_sha256 !== sha256(manifestBytes) || sha256(requestBytes) !== committed.request_sha256) {
    fail("AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN", "committed activation no longer matches its journal")
  }
  io.verifyCheckout(manifest.newRelease.releaseRoot, manifest.newRelease.commit, REPOSITORY,
    { ...manifest.newRelease.closure,
      [manifest.newRelease.trustArtifacts.requestSourcePath]: manifest.newRelease.trustArtifacts.requestSha256,
      [manifest.newRelease.trustArtifacts.admissionPath]: manifest.newRelease.trustArtifacts.admissionSha256,
      [manifest.newRelease.trustArtifacts.inputPath]: manifest.newRelease.trustArtifacts.inputSha256 })
  const replayBytes = assertExactFile(io, REPLAY_JOURNAL_PATH,
    { uid: 0, gid: account.gid, mode: 0o660, digest: authority.replayJournalSha256 })
  validateEpochOnlyReplayJournal(replayBytes)
  if (!io.hasAppendOnly(REPLAY_JOURNAL_PATH)) {
    fail("AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN", "replay journal append-only state drifted")
  }
  const upgradeBytes = assertExactFile(io, manifest.priorState.replayUpgradeJournalPath,
    { uid: 0, gid: 0, mode: 0o600, digest: authority.replayUpgradeJournalSha256 })
  validateReplayUpgradeJournal(upgradeBytes, manifest)
  assertExactFile(io, manifest.priorState.authorizedKeysPath,
    { uid: account.uid, gid: account.gid, mode: 0o600, digest: authority.priorAuthorizedKeysSha256 })
  assertExactFile(io, NODE_LEASE_PATH, { absent: true })
  const lockRecord = Buffer.from(`${canonicalizePromotionJcs({
    schema_version: "1.0-aegis-standing-hash-promotion-lock",
    authority_id: authority.authorityId,
    promotion_id: manifest.promotionId,
    acquired_at: prepared.prepared_at,
  })}\n`, "utf8")
  const retainedLocks = [LEDGER_MUTATION_LOCK_PATH, NODE_MUTATION_LOCK_PATH]
    .filter((lockPath) => io.inspect(lockPath) !== null)
  if (retainedLocks.length === 0) {
    fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_REPLAY",
      "committed authority has no stale owned lock requiring recovery")
  }
  for (const lockPath of retainedLocks) {
    try {
      assertExactFile(io, lockPath,
        { uid: account.uid, gid: account.gid, mode: 0o600, digest: sha256(lockRecord) })
    } catch (error) {
      fail("AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN",
        "retained lock ownership could not be proven before recovery", { causeCode: error?.code ?? null })
    }
  }
  for (const lockPath of retainedLocks) io.releaseLock(lockPath, lockRecord, account.uid, account.gid, 0o600)
  return {
    schema_version: "1.0-aegis-standing-hash-admission-release-promotion-evidence",
    status: "COMMITTED_RECOVERED",
    mode: "APPLY",
    authority_id: authority.authorityId,
    authority_consumed: true,
    mutation_journal: mutationJournal,
    completed_mutations: [...ACTIVATION_ORDER],
    activated: true,
    stale_owned_locks_released: true,
    workload_executed: false,
    scheduler_activated: false,
    network_accessed: false,
  }
}

export function promoteAegisStandingHashAdmissionRelease({
  authority,
  mode = "dry-run",
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  manifest,
  manifestBytes,
  io = createNodePromotionIo(),
  clock = () => new Date().toISOString(),
  machineIdentitySha256,
} = {}) {
  if (!["dry-run", "apply"].includes(mode)) fail("AEGIS_ADMISSION_PROMOTION_MODE_INVALID", "mode must be dry-run or apply")
  const loadedBytes = manifestBytes ?? (manifest
    ? Buffer.from(`${canonicalizePromotionJcs(manifest)}\n`, "utf8")
    : io.read(path.resolve(repoRoot, ...PROMOTION_MANIFEST_PATH.split("/"))))
  const loadedManifest = validateManifest(manifest ?? parseJson(loadedBytes,
    "AEGIS_ADMISSION_PROMOTION_MANIFEST_INVALID", "promotion manifest"))
  const manifestSha256 = sha256(loadedBytes)
  verifyMachine(io, loadedManifest, machineIdentitySha256)
  const now = clock()
  if (!UUID.test(authority?.authorityId ?? "")) {
    fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_INVALID", "authority identity is invalid")
  }
  const mutationJournal = `${loadedManifest.install.journalPrefix}${authority.authorityId}.journal.jsonl`
  if (io.inspect(mutationJournal) !== null) {
    if (mode === "apply") return recoverCommittedPromotion(io, loadedManifest, loadedBytes, authority, mutationJournal)
    fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_REPLAY", "authority journal already exists")
  }
  validateAuthority(loadedManifest, authority, now, manifestSha256)
  const prior = inspectPriorState(io, loadedManifest, authority)
  verifyCheckouts(io, loadedManifest, authority, loadedBytes)
  const requestBytes = io.read(path.posix.join(loadedManifest.newRelease.checkoutPath,
    loadedManifest.newRelease.trustArtifacts.requestSourcePath))
  const admissionBytes = io.read(path.posix.join(loadedManifest.newRelease.checkoutPath,
    loadedManifest.newRelease.trustArtifacts.admissionPath))
  const inputBytes = io.read(path.posix.join(loadedManifest.newRelease.checkoutPath,
    loadedManifest.newRelease.trustArtifacts.inputPath))
  const standingAuthorityBytes = io.read(path.posix.join(loadedManifest.packageRelease.checkoutPath,
    STANDING_AUTHORITY_PATH))
  validateTrustArtifacts(io, loadedManifest, requestBytes, admissionBytes, inputBytes,
    standingAuthorityBytes, prior.epoch, now)

  const evidence = {
    schema_version: "1.0-aegis-standing-hash-admission-release-promotion-evidence",
    status: mode === "dry-run" ? "DRY_RUN" : "APPLY_PENDING",
    mode: mode.toUpperCase(),
    authority_id: authority.authorityId,
    authority_consumed: false,
    prior_commit: loadedManifest.priorState.commit,
    new_commit: loadedManifest.newRelease.commit,
    request_id: loadedManifest.install.requestId,
    request_path: loadedManifest.install.requestPath,
    admission_path: loadedManifest.evidenceRelease.admissionPath,
    input_path: loadedManifest.evidenceRelease.inputPath,
    mutation_journal: mode === "apply" ? mutationJournal : null,
    planned_mutations: [...ACTIVATION_ORDER],
    completed_mutations: [],
    activated: false,
    workload_executed: false,
    scheduler_activated: false,
    network_accessed: false,
    replay_journal_mutated: false,
    standing_ledger_mutated: false,
    authorized_keys_mutated: false,
    account_mutated: false,
    storage_root_mutated: false,
  }
  if (mode === "dry-run") return evidence

  const applyAt = clock()
  validateAuthority(loadedManifest, authority, applyAt, manifestSha256)
  const lockRecord = Buffer.from(`${canonicalizePromotionJcs({
    schema_version: "1.0-aegis-standing-hash-promotion-lock",
    authority_id: authority.authorityId,
    promotion_id: loadedManifest.promotionId,
    acquired_at: applyAt,
  })}\n`, "utf8")
  const heldLocks = []
  const completed = []
  let journalCreated = false
  let journalCommitted = false
  let releasePublished = false
  let releaseRemoved = false
  let requestInstalled = false
  let markerReplaced = false
  let releaseManifestReplaced = false
  try {
    for (const lockPath of [NODE_MUTATION_LOCK_PATH, LEDGER_MUTATION_LOCK_PATH]) {
      io.acquireLock(lockPath, lockRecord, prior.account.uid, prior.account.gid, 0o600)
      heldLocks.push(lockPath)
    }
    inspectPriorState(io, loadedManifest, authority, true)
    verifyCheckouts(io, loadedManifest, authority, loadedBytes)
    io.createJournal(mutationJournal, {
      schema_version: "1.0-aegis-standing-hash-admission-release-promotion-journal",
      record_type: "AUTHORITY_CONSUMED",
      phase: 0,
      authority_id: authority.authorityId,
      authority_sha256: canonicalSha256(authority),
      manifest_sha256: manifestSha256,
      prepared_at: applyAt,
      prior_commit: loadedManifest.priorState.commit,
      new_commit: loadedManifest.newRelease.commit,
      request_sha256: sha256(requestBytes),
      admission_sha256: sha256(admissionBytes),
      input_sha256: sha256(inputBytes),
      planned_mutations: [...ACTIVATION_ORDER],
    })
    journalCreated = true
    const deployedAt = clock()
    const activationMarker = {
      schema_version: "1.0-aegis-standing-hash-activation-marker",
      upgrade_id: "aegis-standing-hash-replay-ledger-upgrade-v1",
      authority_id: authority.authorityId,
      new_commit: loadedManifest.newRelease.commit,
      runtime_closure_sha256: loadedManifest.newRelease.closure,
      manifest_sha256: manifestSha256,
      prepared_at: applyAt,
    }
    const markerBytes = Buffer.from(`${canonicalizePromotionJcs(activationMarker)}\n`, "utf8")
    const release = trustedRelease(loadedManifest, deployedAt, canonicalSha256(activationMarker))
    const releaseBytes = Buffer.from(`${canonicalizePromotionJcs(release)}\n`, "utf8")
    const step = (name, before, action) => {
      before()
      action()
      completed.push(name)
    }
    step("PUBLISH_CONTENT_ADDRESSED_RELEASE", () => { releasePublished = true }, () => {
      io.publishRelease(loadedManifest.newRelease.checkoutPath, loadedManifest.newRelease.releaseRoot)
      io.verifyCheckout(loadedManifest.newRelease.releaseRoot, loadedManifest.newRelease.commit, REPOSITORY,
        { ...loadedManifest.newRelease.closure,
          [loadedManifest.newRelease.trustArtifacts.requestSourcePath]: loadedManifest.newRelease.trustArtifacts.requestSha256,
          [loadedManifest.newRelease.trustArtifacts.admissionPath]: loadedManifest.newRelease.trustArtifacts.admissionSha256,
          [loadedManifest.newRelease.trustArtifacts.inputPath]: loadedManifest.newRelease.trustArtifacts.inputSha256 })
    })
    io.createFileExclusive(loadedManifest.install.requestPath, requestBytes, prior.account.uid, prior.account.gid,
      modeNumber(loadedManifest.install.requestMode))
    requestInstalled = true
    completed.push("INSTALL_PRIVATE_REQUEST")
    step("REPLACE_ACTIVATION_MARKER", () => { markerReplaced = true }, () => io.atomicReplace(
      ACTIVATION_MARKER_PATH, markerBytes, 0, 0, 0o444,
    ))
    step("REPLACE_TRUSTED_RELEASE_MANIFEST", () => { releaseManifestReplaced = true }, () => io.atomicReplace(
      TRUSTED_RELEASE_MANIFEST_PATH, releaseBytes, 0, 0, 0o444,
    ))

    assertExactFile(io, loadedManifest.install.requestPath,
      { uid: prior.account.uid, gid: prior.account.gid, mode: 0o600, digest: sha256(requestBytes) })
    assertExactFile(io, ACTIVATION_MARKER_PATH, { uid: 0, gid: 0, mode: 0o444, digest: sha256(markerBytes) })
    assertExactFile(io, TRUSTED_RELEASE_MANIFEST_PATH, { uid: 0, gid: 0, mode: 0o444, digest: sha256(releaseBytes) })
    assertExactFile(io, REPLAY_JOURNAL_PATH, { uid: 0, gid: prior.account.gid, mode: 0o660, digest: authority.replayJournalSha256 })
    assertExactFile(io, loadedManifest.priorState.replayUpgradeJournalPath,
      { uid: 0, gid: 0, mode: 0o600, digest: authority.replayUpgradeJournalSha256 })
    assertExactFile(io, loadedManifest.priorState.authorizedKeysPath,
      { uid: prior.account.uid, gid: prior.account.gid, mode: 0o600, digest: authority.priorAuthorizedKeysSha256 })

    io.appendJournal(mutationJournal, {
      record_type: "COMMITTED",
      phase: 2,
      committed_at: clock(),
      completed_mutations: [...completed],
      release_manifest_sha256: sha256(releaseBytes),
      activation_marker_sha256: sha256(markerBytes),
      request_sha256: sha256(requestBytes),
      replay_journal_sha256: authority.replayJournalSha256,
      authorized_keys_sha256: authority.priorAuthorizedKeysSha256,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
      replay_journal_mutated: false,
      standing_ledger_mutated: false,
      authorized_keys_mutated: false,
      account_mutated: false,
      storage_root_mutated: false,
    })
    journalCommitted = true
    while (heldLocks.length > 0) {
      const lockPath = heldLocks.at(-1)
      io.releaseLock(lockPath, lockRecord, prior.account.uid, prior.account.gid, 0o600)
      heldLocks.pop()
    }
  } catch (error) {
    if (journalCommitted) {
      const lockErrors = []
      while (heldLocks.length > 0) {
        const lockPath = heldLocks.at(-1)
        try { io.releaseLock(lockPath, lockRecord, prior.account.uid, prior.account.gid, 0o600) }
        catch (lockError) { lockErrors.push(lockError) }
        heldLocks.pop()
      }
      if (lockErrors.length > 0) {
        fail("AEGIS_ADMISSION_PROMOTION_POST_COMMIT_LOCK_UNCERTAIN",
          "promotion committed but lock release could not be proven", {
            causeCode: lockErrors[0]?.code ?? null,
            originalFailureCode: error?.code ?? null,
            authorityConsumed: true,
            mutationJournal,
            completedMutations: completed,
            activated: true,
          })
      }
      return { ...evidence, status: "COMMITTED", authority_consumed: true,
        completed_mutations: completed, activated: true, lock_release_retried: true }
    }
    const recoveryErrors = []
    let lockReleaseRecoveryFailed = false
    let releaseManifestRestored = false
    let markerRestored = false
    let requestRemoved = false
    const recover = (action, mark) => {
      try { action(); mark() } catch (recoveryError) { recoveryErrors.push(recoveryError) }
    }
    if (releaseManifestReplaced) recover(
      () => io.atomicReplace(TRUSTED_RELEASE_MANIFEST_PATH, prior.releaseBytes, 0, 0, 0o444),
      () => { releaseManifestRestored = true },
    )
    if (markerReplaced) recover(
      () => io.atomicReplace(ACTIVATION_MARKER_PATH, prior.markerBytes, 0, 0, 0o444),
      () => { markerRestored = true },
    )
    if (requestInstalled) recover(
      () => io.removeExact(loadedManifest.install.requestPath, requestBytes,
        prior.account.uid, prior.account.gid, modeNumber(loadedManifest.install.requestMode)),
      () => { requestRemoved = true },
    )
    if (releasePublished) recover(
      () => io.removePublishedRelease(loadedManifest.newRelease.releaseRoot, loadedManifest.newRelease.commit,
        REPOSITORY, { ...loadedManifest.newRelease.closure,
          [loadedManifest.newRelease.trustArtifacts.requestSourcePath]: loadedManifest.newRelease.trustArtifacts.requestSha256,
          [loadedManifest.newRelease.trustArtifacts.admissionPath]: loadedManifest.newRelease.trustArtifacts.admissionSha256,
          [loadedManifest.newRelease.trustArtifacts.inputPath]: loadedManifest.newRelease.trustArtifacts.inputSha256 }),
      () => { releaseRemoved = true },
    )
    while (heldLocks.length > 0) {
      const lockPath = heldLocks.at(-1)
      try { io.releaseLock(lockPath, lockRecord, prior.account.uid, prior.account.gid, 0o600) }
      catch (recoveryError) { recoveryErrors.push(recoveryError); lockReleaseRecoveryFailed = true }
      heldLocks.pop()
    }
    try {
      if (journalCreated) io.appendJournal(mutationJournal, {
        record_type: "FAILED_PARTIAL",
        phase: 2,
        failed_at: clock(),
        failure_code: error?.code ?? "AEGIS_ADMISSION_PROMOTION_APPLY_FAILED",
        completed_mutations: [...completed],
        activation_manifest_replaced: releaseManifestReplaced,
        activation_marker_replaced: markerReplaced,
        private_request_installed: requestInstalled,
        prior_release_manifest_restored: releaseManifestReplaced && releaseManifestRestored,
        prior_activation_marker_restored: markerReplaced && markerRestored,
        private_request_removed: requestInstalled && requestRemoved,
        published_release_removed: releasePublished && releaseRemoved,
        lock_release_proven: !lockReleaseRecoveryFailed,
      })
    } catch (journalError) {
      fail("AEGIS_ADMISSION_PROMOTION_EVIDENCE_UNCERTAIN", "partial failure journal was not durable", {
        causeCode: journalError?.code ?? null,
        originalFailureCode: error?.code ?? null,
        authorityConsumed: true,
        mutationJournal,
        completedMutations: completed,
      })
    }
    if (recoveryErrors.length > 0) fail("AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN", "prior activation restoration failed", {
      causeCode: recoveryErrors[0]?.code ?? null,
      originalFailureCode: error?.code ?? null,
      authorityConsumed: journalCreated,
      mutationJournal: journalCreated ? mutationJournal : null,
      completedMutations: completed,
    })
    Object.assign(error, {
      authorityConsumed: journalCreated,
      mutationJournal: journalCreated ? mutationJournal : null,
      completedMutations: completed,
    })
    throw error
  }
  return {
    ...evidence,
    status: "COMMITTED",
    authority_consumed: true,
    completed_mutations: completed,
    activated: true,
  }
}

function safeParents(targetPath) {
  let current = path.posix.dirname(targetPath)
  while (true) {
    const stats = fs.lstatSync(current)
    if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync(current) !== current || (stats.mode & 0o022) !== 0) {
      fail("AEGIS_ADMISSION_PROMOTION_PARENT_UNTRUSTED", `${current} is indirect or writable`)
    }
    if (current === "/") break
    current = path.posix.dirname(current)
  }
}

function fsyncParent(targetPath) {
  const descriptor = fs.openSync(path.posix.dirname(targetPath), fs.constants.O_RDONLY)
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function writeFile(targetPath, bytes, uid, gid, mode, exclusive) {
  safeParents(targetPath)
  const temporary = exclusive ? targetPath : `${targetPath}.promotion-${crypto.randomUUID()}.tmp`
  let descriptor
  let created = false
  let renamed = false
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0), mode)
    created = true
    fs.fchmodSync(descriptor, mode)
    fs.fchownSync(descriptor, uid, gid)
    let offset = 0
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null)
      if (!Number.isSafeInteger(written) || written <= 0) fail("AEGIS_ADMISSION_PROMOTION_WRITE_FAILED", "write made no progress")
      offset += written
    }
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    if (!exclusive) { fs.renameSync(temporary, targetPath); renamed = true }
    fsyncParent(targetPath)
  } catch (error) {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor) } catch {}; descriptor = undefined }
    if (created && !renamed) {
      try {
        fs.unlinkSync(temporary)
        fsyncParent(temporary)
      } catch (cleanupError) {
        fail("AEGIS_ADMISSION_PROMOTION_WRITE_CLEANUP_UNCERTAIN",
          "failed exclusive or temporary write could not be durably removed", {
            causeCode: cleanupError?.code ?? null,
            originalFailureCode: error?.code ?? null,
          })
      }
    }
    throw error
  } finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch {}
  }
}

function fixedGit(checkout, args, accepted = [0]) {
  const result = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=",
    "--no-replace-objects", "-C", checkout, ...args], {
    shell: false,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: MAX_BYTES,
    env: {
      PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", GIT_OPTIONAL_LOCKS: "0",
    },
  })
  if (result.error || result.signal || !accepted.includes(result.status)) {
    fail("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT", `fixed Git operation failed: ${args[0]}`)
  }
  return { status: result.status, stdout: result.stdout ?? "" }
}

export function createNodePromotionIo() {
  const inspect = (targetPath) => {
    try {
      const stats = fs.lstatSync(targetPath)
      return {
        type: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other",
        direct: fs.realpathSync(targetPath) === targetPath,
        nlink: stats.nlink,
        uid: stats.uid,
        gid: stats.gid,
        mode: stats.mode & 0o7777,
      }
    } catch (error) {
      if (error?.code === "ENOENT") return null
      throw error
    }
  }
  const read = (targetPath) => {
    const descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      const stats = fs.fstatSync(descriptor)
      if (!stats.isFile() || stats.nlink !== 1 || stats.size > MAX_BYTES) {
        fail("AEGIS_ADMISSION_PROMOTION_FILE_UNTRUSTED", `${targetPath} is not bounded`)
      }
      return fs.readFileSync(descriptor)
    } finally { fs.closeSync(descriptor) }
  }
  const readStable = (targetPath, { uid, gid, mode }) => {
    safeParents(targetPath)
    const descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      const before = fs.fstatSync(descriptor)
      if (!before.isFile() || before.nlink !== 1 || before.uid !== uid || before.gid !== gid
        || (before.mode & 0o7777) !== mode || before.size > MAX_BYTES) {
        fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_FILE_UNTRUSTED", "authority metadata differs")
      }
      const bytes = fs.readFileSync(descriptor)
      const after = fs.fstatSync(descriptor)
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_FILE_UNSTABLE", "authority changed during stable read")
      }
      return bytes
    } finally { fs.closeSync(descriptor) }
  }
  const account = (name) => {
    const passwd = read("/etc/passwd").toString("utf8").split("\n").filter((line) => line.startsWith(`${name}:`))
    const groups = read("/etc/group").toString("utf8").split("\n").filter((line) => line.startsWith(`${name}:`))
    const p = passwd[0]?.split(":")
    const g = groups[0]?.split(":")
    if (passwd.length !== 1 || groups.length !== 1 || p?.length !== 7 || g?.length !== 4 || Number(p[3]) !== Number(g[2])) {
      fail("AEGIS_ADMISSION_PROMOTION_ACCOUNT_INVALID", "account or primary group differs")
    }
    return { uid: Number(p[2]), gid: Number(p[3]), home: p[5], shell: p[6] }
  }
  const verifyCheckout = (checkout, commit, repository, closure) => {
    const stats = inspect(checkout)
    if (!stats || stats.type !== "directory" || !stats.direct || stats.uid !== 0 || stats.gid !== 0 || stats.mode !== 0o755) {
      fail("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT", "checkout root metadata differs")
    }
    const head = fixedGit(checkout, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout.trim()
    const symbolic = fixedGit(checkout, ["symbolic-ref", "-q", "HEAD"], [0, 1])
    const origin = fixedGit(checkout, ["remote", "get-url", "--all", "origin"]).stdout.trim()
    const normalizedOrigin = origin.replace(/^git@github\.com:/, "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")
    if (head !== commit || symbolic.status !== 1 || symbolic.stdout !== "" || normalizedOrigin !== repository
      || fixedGit(checkout, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout !== "") {
      fail("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT", "checkout is not exact, detached, clean, and reviewed")
    }
    validateCheckoutAncestorChain(inspect, checkout, closure)
    const tracked = new Set(fixedGit(checkout, ["ls-files", "-z"]).stdout.split("\0").filter(Boolean))
    for (const relative of Object.keys(closure)) {
      if (!tracked.has(relative)) fail("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT", `${relative} is not tracked`)
      const candidate = path.posix.join(checkout, relative)
      const item = inspect(candidate)
      if (!item || item.type !== "file" || !item.direct || item.nlink !== 1 || item.uid !== 0 || item.gid !== 0
        || (item.mode & 0o7022) !== 0 || (item.mode & 0o400) === 0) {
        fail("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT", `${relative} metadata differs`)
      }
    }
  }
  const appendJournal = (journalPath, record) => {
    const observed = inspect(journalPath)
    if (!observed || observed.type !== "file" || !observed.direct || observed.nlink !== 1
      || observed.uid !== 0 || observed.gid !== 0 || observed.mode !== 0o600) {
      fail("AEGIS_ADMISSION_PROMOTION_JOURNAL_UNTRUSTED", "promotion journal metadata differs")
    }
    const descriptor = fs.openSync(journalPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      fs.writeFileSync(descriptor, `${canonicalizePromotionJcs(record)}\n`, "utf8")
      fs.fsyncSync(descriptor)
    } finally { fs.closeSync(descriptor) }
    fsyncParent(journalPath)
  }
  return {
    platform: () => process.platform,
    euid: () => process.geteuid?.() ?? process.getuid?.(),
    hostname: () => os.hostname(),
    inspect,
    read,
    readStable,
    account,
    hasAppendOnly(targetPath) {
      const result = spawnSync("/usr/bin/lsattr", ["-d", "--", targetPath], {
        shell: false, encoding: "utf8", timeout: 5_000,
        env: { PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C", LC_ALL: "C" },
      })
      const [attributes, retainedPath, ...extra] = String(result.stdout ?? "").trim().split(/\s+/)
      return !result.error && !result.signal && result.status === 0 && extra.length === 0
        && retainedPath === targetPath && /^[A-Za-z-]+$/.test(attributes ?? "") && attributes.includes("a")
    },
    verifyCheckout,
    verifyAncestry(checkout, ancestor, descendant) {
      fixedGit(checkout, ["merge-base", "--is-ancestor", ancestor, descendant])
    },
    evaluateStandingArtifacts(validatorPath, payload) {
      const result = spawnSync("/usr/bin/node", [validatorPath], {
        shell: false,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: MAX_BYTES,
        input: canonicalizePromotionJcs(payload),
        env: { PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C", LC_ALL: "C", NODE_OPTIONS: "" },
      })
      const stdout = String(result.stdout ?? "").trim()
      if (result.error || result.signal || ![0, 2].includes(result.status) || !stdout || stdout.includes("\n")) {
        fail("AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID", "standing validator process failed closed")
      }
      return parseJson(Buffer.from(stdout, "utf8"),
        "AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID", "standing validator result")
    },
    publishRelease(source, destination) {
      safeParents(destination)
      const temporary = `${destination}.promotion-${crypto.randomUUID()}.tmp`
      let renamed = false
      try {
        fs.cpSync(source, temporary, { recursive: true, dereference: false, errorOnExist: true, force: false, verbatimSymlinks: true })
        fs.renameSync(temporary, destination)
        renamed = true
        fsyncParent(destination)
      } catch (error) {
        if (!renamed) {
          try {
            fs.rmSync(temporary, { recursive: true, force: true })
            fsyncParent(temporary)
          } catch (cleanupError) {
            fail("AEGIS_ADMISSION_PROMOTION_PUBLISH_CLEANUP_UNCERTAIN",
              "failed temporary release could not be durably removed", {
                causeCode: cleanupError?.code ?? null,
                originalFailureCode: error?.code ?? null,
              })
          }
        }
        throw error
      }
    },
    removePublishedRelease(destination, commit, repository, closure) {
      if (inspect(destination) === null) return
      const expectedPrefix = "/opt/williamos/releases/"
      if (destination !== `${expectedPrefix}${commit}` || path.posix.dirname(destination) !== expectedPrefix.slice(0, -1)) {
        fail("AEGIS_ADMISSION_PROMOTION_ROLLBACK_UNSAFE", "published release path is outside the owned release root")
      }
      verifyCheckout(destination, commit, repository, closure)
      fs.rmSync(destination, { recursive: true, force: false })
      fsyncParent(destination)
    },
    createFileExclusive(targetPath, bytes, uid, gid, mode) { writeFile(targetPath, bytes, uid, gid, mode, true) },
    atomicReplace(targetPath, bytes, uid, gid, mode) { writeFile(targetPath, bytes, uid, gid, mode, false) },
    removeExact(targetPath, bytes, uid, gid, mode) {
      const observed = inspect(targetPath)
      if (!observed || observed.type !== "file" || !observed.direct || observed.nlink !== 1
        || observed.uid !== uid || observed.gid !== gid || observed.mode !== mode || sha256(read(targetPath)) !== sha256(bytes)) {
        fail("AEGIS_ADMISSION_PROMOTION_ROLLBACK_UNSAFE", `${targetPath} changed before rollback`)
      }
      fs.unlinkSync(targetPath)
      fsyncParent(targetPath)
    },
    acquireLock(targetPath, bytes, uid, gid, mode) {
      try { writeFile(targetPath, bytes, uid, gid, mode, true) } catch (error) {
        if (error?.code === "EEXIST") fail("AEGIS_ADMISSION_PROMOTION_LOCK_OCCUPIED", `${targetPath} is occupied`)
        throw error
      }
    },
    releaseLock(targetPath, bytes, uid, gid, mode) {
      const observed = inspect(targetPath)
      if (!observed || observed.type !== "file" || !observed.direct || observed.nlink !== 1
        || observed.uid !== uid || observed.gid !== gid || observed.mode !== mode || sha256(read(targetPath)) !== sha256(bytes)) {
        fail("AEGIS_ADMISSION_PROMOTION_LOCK_RELEASE_UNSAFE", `${targetPath} changed before release`)
      }
      fs.unlinkSync(targetPath)
      fsyncParent(targetPath)
    },
    createJournal(journalPath, record) {
      writeFile(journalPath, Buffer.from(`${canonicalizePromotionJcs(record)}\n`, "utf8"), 0, 0, 0o600, true)
    },
    appendJournal,
  }
}

export function admissionReleasePromotionErrorEvidence(error) {
  return {
    schema_version: "1.0-aegis-standing-hash-admission-release-promotion-error",
    status: "FAILED_CLOSED",
    code: error?.code ?? "AEGIS_ADMISSION_PROMOTION_REJECTED",
    detail: String(error?.message ?? error).slice(0, 512),
    authority_consumed: error?.authorityConsumed === true,
    mutation_journal: error?.mutationJournal ?? null,
    completed_mutations: error?.completedMutations ?? [],
    original_failure_code: error?.originalFailureCode ?? null,
    cause_code: error?.causeCode ?? null,
    workload_executed: false,
    scheduler_activated: false,
    network_accessed: false,
    replay_journal_mutated: false,
    standing_ledger_mutated: false,
    authorized_keys_mutated: false,
    account_mutated: false,
    storage_root_mutated: false,
  }
}

function parseCli(argv) {
  const result = { mode: null, authorityPath: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (["--dry-run", "--apply"].includes(argument) && result.mode === null) result.mode = argument.slice(2)
    else if (argument === "--authority" && result.authorityPath === null && argv[index + 1]) result.authorityPath = argv[++index]
    else fail("AEGIS_ADMISSION_PROMOTION_USAGE_INVALID", `invalid argument ${argument}`)
  }
  if (!result.mode || !result.authorityPath) {
    fail("AEGIS_ADMISSION_PROMOTION_USAGE_INVALID", "use --authority <json> and one mode")
  }
  const escaped = AUTHORITY_ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (!new RegExp(`^${escaped}/[0-9a-f-]{36}\\.json$`, "i").test(result.authorityPath)) {
    fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_PATH_INVALID", "authority path is outside the fixed root")
  }
  return result
}

export function main(argv = process.argv.slice(2), {
  io = createNodePromotionIo(),
  stdout = process.stdout,
  stderr = process.stderr,
  repoRoot,
  clock,
  machineIdentitySha256,
} = {}) {
  try {
    const parsed = parseCli(argv)
    const authorityBytes = io.readStable
      ? io.readStable(parsed.authorityPath, { uid: 0, gid: 0, mode: 0o600 })
      : assertExactFile(io, parsed.authorityPath, { uid: 0, gid: 0, mode: 0o600 })
    const authority = parseJson(authorityBytes, "AEGIS_ADMISSION_PROMOTION_AUTHORITY_INVALID", "authority")
    if (path.posix.basename(parsed.authorityPath) !== `${authority.authorityId}.json`) {
      fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_PATH_INVALID", "authority filename does not match its embedded identity")
    }
    if (typeof authority.evidenceCheckoutPath !== "string" || !path.posix.isAbsolute(authority.evidenceCheckoutPath)) {
      fail("AEGIS_ADMISSION_PROMOTION_AUTHORITY_INVALID", "evidenceCheckoutPath must be an absolute path")
    }
    const result = promoteAegisStandingHashAdmissionRelease({
      authority,
      mode: parsed.mode,
      io,
      manifestBytes: io.read(path.posix.join(authority.evidenceCheckoutPath, PROMOTION_MANIFEST_PATH)),
      repoRoot,
      clock,
      machineIdentitySha256,
    })
    stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  } catch (error) {
    stderr.write(`${JSON.stringify(admissionReleasePromotionErrorEvidence(error), null, 2)}\n`)
    return 2
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) process.exitCode = main()
