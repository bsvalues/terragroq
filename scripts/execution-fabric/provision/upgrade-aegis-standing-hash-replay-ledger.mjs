#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export const UPGRADE_MANIFEST_PATH = "config/execution-fabric/aegis-standing-hash-replay-ledger-upgrade.v1.json"
export const REPLAY_JOURNAL_PATH = "/var/lib/aegis-standing-hash-replay-journal.jsonl"
export const NODE_LEASE_PATH = "/var/lib/williamos/fabric/ledger/resident-aegis-active.json"
export const LEDGER_MUTATION_LOCK_PATH = "/var/lib/williamos/fabric/standing-hash-ledger/standing-hash-mutation.lock"
export const NODE_MUTATION_LOCK_PATH = "/var/lib/williamos/fabric/ledger/resident-aegis-mutation.lock"
export const AUTHORITY_ROOT = "/var/lib/williamos/fabric/standing-hash-upgrade-authorities"
export const ACTIVATION_MARKER_PATH = "/etc/williamos/fabric/aegis-standing-hash-replay-ledger-upgrade-v1.activation.json"
export const CHATTR = "/usr/bin/chattr"
export const LSATTR = "/usr/bin/lsattr"

const DIGEST = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLACEHOLDER = /__[A-Z0-9_]+__/
const MAX_FILE_BYTES = 16 * 1024 * 1024
const AUTHORITY_KEYS = Object.freeze([
  "schemaVersion", "authorityId", "upgradeId", "repository", "machineIdSha256",
  "priorCommit", "newCommit", "manifestSha256", "priorProvisioningAuthorityId",
  "priorProvisioningJournalSha256", "priorRepairAuthorityId", "priorRepairJournalSha256",
  "priorReleaseManifestSha256", "priorAuthorizedKeysSha256", "priorInstalledSha256",
  "newClosureSha256", "newInstallerSha256", "reviewedCheckoutPath", "packageCommit", "packageCheckoutPath",
  "evidenceCommit", "evidenceCheckoutPath",
  "issuedAt", "expiresAt", "singleUse", "consumed",
])

function validUnicode(value) {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("lone surrogate")
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError("lone surrogate")
  }
}

export function canonicalizeUpgradeJcs(value) {
  if (typeof value === "string") { validUnicode(value); return JSON.stringify(value) }
  if (value === null || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeUpgradeJcs).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      validUnicode(key)
      return `${JSON.stringify(key)}:${canonicalizeUpgradeJcs(value[key])}`
    }).join(",")}}`
  }
  throw new TypeError("unsupported JSON value")
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalSha256 = (value) => sha256(Buffer.from(canonicalizeUpgradeJcs(value), "utf8"))
const same = (left, right) => canonicalizeUpgradeJcs(left) === canonicalizeUpgradeJcs(right)
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

function modeNumber(value) {
  return typeof value === "string" && /^0[0-7]{3}$/.test(value) ? Number.parseInt(value, 8) : NaN
}

function validateManifest(manifest) {
  const prior = manifest?.priorState
  const next = manifest?.newRelease
  const install = manifest?.install
  const packageRelease = manifest?.packageRelease
  if (manifest?.schemaVersion !== 1 || manifest.upgradeId !== "aegis-standing-hash-replay-ledger-upgrade-v1"
    || manifest.issue !== 595 || manifest.workOrderId !== "WO-EF-AEGIS-STANDING-001"
    || manifest.repository !== "bsvalues/terragroq" || manifest.authority?.maximumAgeSeconds !== 900
    || manifest.authority?.singleUse !== true || manifest.authority?.consumeBeforeMutation !== true
    || !COMMIT.test(prior?.commit ?? "") || prior.releaseRoot !== `/opt/williamos/releases/${prior.commit}`
    || !DIGEST.test(prior?.provisioningManifestSha256 ?? "")
    || prior.trustedReleaseManifestPath !== "/etc/williamos/fabric/trusted-main-release.json"
    || prior.authorizedKeysPath !== "/home/williamos-fabric/.ssh/authorized_keys"
    || !Array.isArray(prior.installedFiles) || prior.installedFiles.length !== 4
    || !Array.isArray(prior.privateRoots) || prior.privateRoots.length !== 5
    || !same(prior.inactivePaths, [NODE_LEASE_PATH, NODE_MUTATION_LOCK_PATH, LEDGER_MUTATION_LOCK_PATH])
    || install?.replayJournalPath !== REPLAY_JOURNAL_PATH || install.chattr !== CHATTR || install.lsattr !== LSATTR
    || install.appendOnlyRequired !== true || install.replayJournalOwner !== "root"
    || install.replayJournalGroup !== "williamos-fabric" || install.replayJournalMode !== "0660"
    || install.replayHelperPath !== "/usr/local/libexec/williamos/aegis-standing-hash-replay-ledger.mjs"
    || install.replayInitializerPath !== "/usr/local/libexec/williamos/aegis-standing-hash-replay-epoch.mjs"
    || install.bootstrapPath !== "/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs"
    || install.executableMode !== "0555"
    || install.authorityRoot !== AUTHORITY_ROOT || install.activationMarkerPath !== ACTIVATION_MARKER_PATH
    || !same(install.activationOrder, [
      "PUBLISH_CONTENT_ADDRESSED_RELEASE", "CREATE_EMPTY_REPLAY_JOURNAL", "SET_AND_VERIFY_APPEND_ONLY",
      "INSTALL_REPLAY_HELPER", "REPLACE_REPLAY_INITIALIZER", "REPLACE_BOOTSTRAP",
      "CREATE_ACTIVATION_MARKER", "REPLACE_TRUSTED_RELEASE_MANIFEST",
    ])
    || !same(manifest.forbiddenMutations, [
      "authorized_keys", "account", "network", "workload", "scheduler", "privilege-escalation", "storage-root",
      "prior-release", "prior-evidence",
    ])) {
    fail("AEGIS_REPLAY_UPGRADE_MANIFEST_INVALID", "upgrade manifest semantics differ")
  }
  if (JSON.stringify(manifest).match(PLACEHOLDER)) {
    fail("AEGIS_REPLAY_UPGRADE_NOT_FINALIZED", "final head, checkout, and closure digests are placeholders")
  }
  if (!COMMIT.test(next?.commit ?? "") || next.commit === prior.commit
    || next.releaseRoot !== `/opt/williamos/releases/${next.commit}`
    || typeof next.reviewedCheckoutPath !== "string" || !path.posix.isAbsolute(next.reviewedCheckoutPath)
    || next.trustedRef !== "refs/heads/main" || next.manifestSchemaVersion !== "1.0-williamos-trusted-main-release"
    || !next.closure || Object.keys(next.closure).length !== 7
    || !next.installerBindings || Object.keys(next.installerBindings).length !== 2
    || next.installerBindings["scripts/execution-fabric/provision/upgrade-aegis-standing-hash-replay-ledger.mjs"] === undefined
    || next.installerBindings[install.replayInitializerSource] === undefined
    || !COMMIT.test(packageRelease?.commit ?? "")
    || typeof packageRelease.checkoutPath !== "string" || !path.posix.isAbsolute(packageRelease.checkoutPath)
    || Object.values({ ...next.closure, ...next.installerBindings }).some((digest) => !DIGEST.test(digest))) {
    fail("AEGIS_REPLAY_UPGRADE_MANIFEST_INVALID", "new reviewed release binding differs")
  }
  for (const source of [install.replayHelperSource, install.replayInitializerSource, install.bootstrapSource]) {
    if (next.closure[source] === undefined && next.installerBindings[source] === undefined) {
      fail("AEGIS_REPLAY_UPGRADE_MANIFEST_INVALID", `${source} is outside the source bindings`)
    }
  }
  return manifest
}

export function validateAegisStandingHashReplayLedgerUpgradeManifest(manifest) {
  return validateManifest(structuredClone(manifest))
}

function validateAuthority(manifest, authority, now, manifestSha256) {
  if (!exactKeys(authority, AUTHORITY_KEYS) || authority.schemaVersion !== 1
    || !UUID.test(authority.authorityId ?? "") || !UUID.test(authority.priorProvisioningAuthorityId ?? "")
    || !UUID.test(authority.priorRepairAuthorityId ?? "") || authority.singleUse !== true) {
    fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_INVALID", "authority shape differs")
  }
  if (authority.consumed !== false) fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_REPLAY", "authority is already consumed")
  const expected = {
    upgradeId: manifest.upgradeId,
    repository: manifest.repository,
    machineIdSha256: manifest.machine.machineIdSha256,
    priorCommit: manifest.priorState.commit,
    newCommit: manifest.newRelease.commit,
    manifestSha256,
    priorInstalledSha256: Object.fromEntries(manifest.priorState.installedFiles.map((item) => [item.id, item.sha256])),
    newClosureSha256: manifest.newRelease.closure,
    newInstallerSha256: manifest.newRelease.installerBindings,
    reviewedCheckoutPath: manifest.newRelease.reviewedCheckoutPath,
    packageCommit: manifest.packageRelease.commit,
    packageCheckoutPath: manifest.packageRelease.checkoutPath,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!same(authority[key], value)) fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_SCOPE_MISMATCH", `${key} differs`)
  }
  for (const key of ["priorProvisioningJournalSha256", "priorRepairJournalSha256", "priorReleaseManifestSha256", "priorAuthorizedKeysSha256"]) {
    if (!DIGEST.test(authority[key] ?? "")) fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_SCOPE_MISMATCH", `${key} is invalid`)
  }
  if (!COMMIT.test(authority.evidenceCommit ?? "") || typeof authority.evidenceCheckoutPath !== "string"
    || !path.posix.isAbsolute(authority.evidenceCheckoutPath)) {
    fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_SCOPE_MISMATCH", "evidence release binding is invalid")
  }
  const issued = Date.parse(authority.issuedAt)
  const expires = Date.parse(authority.expiresAt)
  const current = Date.parse(now)
  if (!canonicalTimestamp(authority.issuedAt) || !canonicalTimestamp(authority.expiresAt) || !canonicalTimestamp(now)
    || expires <= issued || expires - issued > manifest.authority.maximumAgeSeconds * 1000
    || current < issued || current >= expires) {
    fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_EXPIRED", "authority is outside its short-lived window")
  }
}

function assertExactFile(io, targetPath, { uid, gid, mode, sha256: digest, absent = false }) {
  const observed = io.inspect(targetPath)
  if (absent) {
    if (observed !== null) fail("AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", `${targetPath} must be absent`)
    return
  }
  if (!observed || observed.type !== "file" || observed.direct !== true || observed.nlink !== 1
    || (uid !== undefined && observed.uid !== uid) || (gid !== undefined && observed.gid !== gid)
    || (mode !== undefined && observed.mode !== mode)) {
    fail("AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", `${targetPath} metadata differs`)
  }
  const bytes = io.read(targetPath)
  if (digest && sha256(bytes) !== digest) fail("AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", `${targetPath} digest differs`)
  return bytes
}

function assertExactDirectory(io, targetPath, { uid, gid, mode }) {
  const observed = io.inspect(targetPath)
  if (!observed || observed.type !== "directory" || observed.direct !== true
    || observed.uid !== uid || observed.gid !== gid || observed.mode !== mode) {
    fail("AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", `${targetPath} directory metadata differs`)
  }
}

function verifyPriorJournals(io, manifest, authority) {
  const provisioningPath = `${manifest.priorState.provisioningJournalPrefix}${authority.priorProvisioningAuthorityId}.mutation-journal.jsonl`
  const repairPath = `${manifest.priorState.repairJournalPrefix}${authority.priorRepairAuthorityId}.journal.jsonl`
  const provisioning = assertExactFile(io, provisioningPath, { uid: 0, gid: 0, mode: 0o600,
    sha256: authority.priorProvisioningJournalSha256 })
  const repair = assertExactFile(io, repairPath, { uid: 0, gid: 0, mode: 0o600,
    sha256: authority.priorRepairJournalSha256 })
  let provisioningRecords
  let repairRecords
  try {
    provisioningRecords = provisioning.toString("utf8").trimEnd().split("\n").map(JSON.parse)
    repairRecords = repair.toString("utf8").trimEnd().split("\n").map(JSON.parse)
  } catch { fail("AEGIS_REPLAY_UPGRADE_PRIOR_JOURNAL_INVALID", "prior journal JSON is malformed") }
  if (provisioningRecords[0]?.record_type !== "AUTHORITY_CONSUMED"
    || provisioningRecords.at(-1)?.record_type !== "APPLY_COMPLETE"
    || provisioningRecords.some((record, index) => record.sequence !== index)
    || provisioningRecords.some(({ record_type }) => record_type === "APPLY_FAILED_PARTIAL_STATE")
    || repairRecords.length !== 2 || repairRecords[0]?.record_type !== "AUTHORITY_CONSUMED"
    || repairRecords[1]?.record_type !== "REPAIR_COMPLETE" || repairRecords.some((record, index) => record.sequence !== index)) {
    fail("AEGIS_REPLAY_UPGRADE_PRIOR_JOURNAL_INVALID", "prior provisioning and repair are not exact successful terminals")
  }
  return { provisioningPath, repairPath }
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

function inspectPriorState(io, manifest, authority, repoRoot, heldLocks = false) {
  const account = io.account(manifest.serviceAccount.name)
  if (!same(account, { uid: account.uid, gid: account.gid, home: manifest.serviceAccount.home, shell: manifest.serviceAccount.shell })
    || !Number.isSafeInteger(account.uid) || account.uid <= 0 || !Number.isSafeInteger(account.gid) || account.gid <= 0) {
    fail("AEGIS_REPLAY_UPGRADE_ACCOUNT_INVALID", "williamos-fabric account identity differs")
  }
  const packagePath = path.resolve(repoRoot, ...manifest.priorState.provisioningManifestPath.split("/"))
  const priorPackageBytes = assertExactFile(io, packagePath, { sha256: manifest.priorState.provisioningManifestSha256 })
  const priorPackage = parseJson(priorPackageBytes, "AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", "prior provisioning manifest")
  const priorClosure = Object.fromEntries((priorPackage.reviewedRelease?.runtimeClosurePaths ?? []).map((relativePath) => [
    relativePath,
    priorPackage.bindings?.find(({ path: bindingPath }) => bindingPath === relativePath)?.sha256,
  ]))
  if (priorPackage.packageId !== "aegis-standing-hash-provisioning-issue-595-v1"
    || priorPackage.trustedMain?.commit !== manifest.priorState.commit
    || priorPackage.reviewedRelease?.releaseRoot !== manifest.priorState.releaseRoot
    || Object.keys(priorClosure).length === 0 || Object.values(priorClosure).some((digest) => !DIGEST.test(digest))) {
    fail("AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", "prior provisioning manifest release binding differs")
  }
  for (const root of manifest.priorState.privateRoots) {
    assertExactDirectory(io, root.path, { uid: account.uid, gid: account.gid, mode: modeNumber(root.mode) })
  }
  assertExactDirectory(io, manifest.priorState.releaseRoot, { uid: 0, gid: 0, mode: 0o755 })
  io.verifyCheckout(manifest.priorState.releaseRoot, manifest.priorState.commit, manifest.repository, priorClosure)
  const installedBytes = Object.fromEntries(manifest.priorState.installedFiles.map((item) => [item.id,
    assertExactFile(io, item.path, { uid: 0, gid: 0, mode: modeNumber(item.mode), sha256: item.sha256 })]))
  const authorizedKeys = assertExactFile(io, manifest.priorState.authorizedKeysPath,
    { uid: account.uid, gid: account.gid, mode: 0o600, sha256: authority.priorAuthorizedKeysSha256 })
  const keyText = authorizedKeys.toString("utf8")
  if (!keyText.startsWith(manifest.priorState.authorizedKeyPrefix)
    || !/^[^\r\n ]+\n$/.test(keyText.slice(manifest.priorState.authorizedKeyPrefix.length))) {
    fail("AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", "restricted authorized_keys record differs")
  }
  const releaseBytes = assertExactFile(io, manifest.priorState.trustedReleaseManifestPath,
    { uid: 0, gid: 0, mode: 0o444, sha256: authority.priorReleaseManifestSha256 })
  const release = parseJson(releaseBytes, "AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", "prior release manifest")
  if (release.head_commit !== manifest.priorState.commit || release.release_root !== manifest.priorState.releaseRoot
    || release.repository !== manifest.repository || release.reviewed !== true) {
    fail("AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT", "prior trusted release manifest semantics differ")
  }
  verifyPriorJournals(io, manifest, authority)
  assertExactFile(io, NODE_LEASE_PATH, { absent: true })
  for (const lockPath of [NODE_MUTATION_LOCK_PATH, LEDGER_MUTATION_LOCK_PATH]) {
    if (heldLocks) assertExactFile(io, lockPath, { uid: account.uid, gid: account.gid, mode: 0o600 })
    else if (io.inspect(lockPath) !== null) fail("AEGIS_REPLAY_UPGRADE_LOCK_OCCUPIED", `${lockPath} is occupied`)
  }
  assertExactFile(io, manifest.newRelease.releaseRoot, { absent: true })
  assertExactFile(io, manifest.install.replayJournalPath, { absent: true })
  assertExactFile(io, manifest.install.replayHelperPath, { absent: true })
  assertExactFile(io, manifest.install.activationMarkerPath, { absent: true })
  return { account, installedBytes, priorReleaseBytes: releaseBytes }
}

function verifyMachine(io, manifest, injectedMachineIdSha256) {
  if (io.platform() !== "linux") fail("AEGIS_REPLAY_UPGRADE_LINUX_REQUIRED", "upgrade is Linux-only")
  if (io.euid() !== 0) fail("AEGIS_REPLAY_UPGRADE_ROOT_REQUIRED", "upgrade requires effective root")
  if (io.hostname() !== manifest.machine.hostname) fail("AEGIS_REPLAY_UPGRADE_HOST_REJECTED", "exact aegis hostname is required")
  const observed = injectedMachineIdSha256 ?? sha256(Buffer.from(io.read("/etc/machine-id").toString("utf8").trim(), "utf8"))
  if (observed !== manifest.machine.machineIdSha256) fail("AEGIS_REPLAY_UPGRADE_MACHINE_REJECTED", "machine identity differs")
}

function verifyNewCheckouts(io, manifest, authority, manifestBytes) {
  try {
    io.verifyCheckout(manifest.newRelease.reviewedCheckoutPath, manifest.newRelease.commit, manifest.repository,
      manifest.newRelease.closure)
    io.verifyCheckout(manifest.packageRelease.checkoutPath, manifest.packageRelease.commit, manifest.repository,
      manifest.newRelease.installerBindings)
    io.verifyCheckout(authority.evidenceCheckoutPath, authority.evidenceCommit, manifest.repository,
      { [UPGRADE_MANIFEST_PATH]: sha256(manifestBytes) })
    io.verifyAncestry(manifest.packageRelease.checkoutPath, manifest.newRelease.commit, manifest.packageRelease.commit)
    io.verifyAncestry(authority.evidenceCheckoutPath, manifest.packageRelease.commit, authority.evidenceCommit)
  } catch (error) {
    if (error?.code === "AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT") throw error
    fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT", String(error?.message ?? error).slice(0, 256))
  }
  for (const [relativePath, digest] of Object.entries(manifest.newRelease.closure)) {
    const sourcePath = path.posix.join(manifest.newRelease.reviewedCheckoutPath, relativePath)
    if (sha256(io.read(sourcePath)) !== digest) fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT", `${relativePath} digest differs`)
  }
  if (sha256(io.read(path.posix.join(authority.evidenceCheckoutPath, UPGRADE_MANIFEST_PATH))) !== sha256(manifestBytes)) {
    fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT", "package manifest bytes differ")
  }
  for (const [relativePath, digest] of Object.entries(manifest.newRelease.installerBindings)) {
    if (sha256(io.read(path.posix.join(manifest.packageRelease.checkoutPath, relativePath))) !== digest) {
      fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT", `${relativePath} package digest differs`)
    }
  }
}

/**
 * Executes the fail-closed one-shot upgrade. The injected io surface is intentionally small so the
 * complete mutation ordering can be tested without root access or host mutation.
 */
export function upgradeAegisStandingHashReplayLedger({
  authority,
  mode = "dry-run",
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  manifest,
  manifestBytes,
  io = createNodeUpgradeIo(),
  clock = () => new Date().toISOString(),
  machineIdentitySha256,
} = {}) {
  if (!["dry-run", "apply"].includes(mode)) fail("AEGIS_REPLAY_UPGRADE_MODE_INVALID", "mode must be dry-run or apply")
  const loadedBytes = manifestBytes ?? (manifest
    ? Buffer.from(`${canonicalizeUpgradeJcs(manifest)}\n`, "utf8")
    : io.read(path.resolve(repoRoot, ...UPGRADE_MANIFEST_PATH.split("/"))))
  const loadedManifest = validateManifest(manifest ?? parseJson(loadedBytes,
    "AEGIS_REPLAY_UPGRADE_MANIFEST_INVALID", "upgrade manifest"))
  const loadedManifestSha256 = sha256(loadedBytes)
  verifyMachine(io, loadedManifest, machineIdentitySha256)
  const now = clock()
  validateAuthority(loadedManifest, authority, now, loadedManifestSha256)
  const mutationJournal = `${loadedManifest.install.journalPrefix}${authority.authorityId}.journal.jsonl`
  if (io.inspect(mutationJournal) !== null) fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_REPLAY", "authority journal already exists")
  const prior = inspectPriorState(io, loadedManifest, authority, repoRoot)
  verifyNewCheckouts(io, loadedManifest, authority, loadedBytes)

  const plan = [...loadedManifest.install.activationOrder]
  const evidence = {
    schema_version: "1.0-aegis-standing-hash-replay-ledger-upgrade-evidence",
    status: mode === "dry-run" ? "DRY_RUN" : "APPLY_PENDING",
    mode: mode.toUpperCase(),
    authority_id: authority.authorityId,
    authority_consumed: false,
    prior_commit: loadedManifest.priorState.commit,
    new_commit: loadedManifest.newRelease.commit,
    new_release_root: loadedManifest.newRelease.releaseRoot,
    replay_journal: loadedManifest.install.replayJournalPath,
    mutation_journal: mode === "apply" ? mutationJournal : null,
    planned_mutations: plan,
    completed_mutations: [],
    activated: false,
    replay_epoch_initialized: false,
    operational: false,
    next_non_root_step: "INITIALIZE_REPLAY_EPOCH_AS_WILLIAMOS_FABRIC",
    authorized_keys_mutated: false,
    account_mutated: false,
    network_accessed: false,
    workload_executed: false,
    scheduler_activated: false,
    privilege_helper_used: false,
    prior_release_preserved: true,
    prior_evidence_preserved: true,
  }
  if (mode === "dry-run") return evidence

  const applyAt = clock()
  validateAuthority(loadedManifest, authority, applyAt, loadedManifestSha256)
  const lockRecord = Buffer.from(`${canonicalizeUpgradeJcs({
    schema_version: "1.0-aegis-standing-hash-upgrade-lock", authority_id: authority.authorityId,
    upgrade_id: loadedManifest.upgradeId, acquired_at: applyAt,
  })}\n`, "utf8")
  const heldLocks = []
  let journalCreated = false
  let completed = []
  let releaseManifestReplaced = false
  try {
    for (const lockPath of [NODE_MUTATION_LOCK_PATH, LEDGER_MUTATION_LOCK_PATH]) {
      io.acquireLock(lockPath, lockRecord, prior.account.uid, prior.account.gid, 0o600)
      heldLocks.push(lockPath)
    }
    assertExactFile(io, NODE_LEASE_PATH, { absent: true })
    inspectPriorState(io, loadedManifest, authority, repoRoot, true)
    verifyNewCheckouts(io, loadedManifest, authority, loadedBytes)
    io.createJournal(mutationJournal, {
    schema_version: "1.0-aegis-standing-hash-replay-ledger-upgrade-journal",
    record_type: "PREPARED",
    phase: 1,
    authority_id: authority.authorityId,
    authority_sha256: canonicalSha256(authority),
    manifest_sha256: loadedManifestSha256,
    prepared_at: applyAt,
    prior_commit: loadedManifest.priorState.commit,
    new_commit: loadedManifest.newRelease.commit,
    planned_mutations: plan,
    })
    journalCreated = true
    evidence.authority_consumed = true
    const step = (name, action) => {
      action()
      completed.push(name)
    }
    const deployedAt = clock()
    const activationMarker = {
      schema_version: "1.0-aegis-standing-hash-activation-marker",
      upgrade_id: loadedManifest.upgradeId,
      authority_id: authority.authorityId,
      new_commit: loadedManifest.newRelease.commit,
      runtime_closure_sha256: loadedManifest.newRelease.closure,
      manifest_sha256: loadedManifestSha256,
      prepared_at: applyAt,
    }
    const activationMarkerBytes = Buffer.from(`${canonicalizeUpgradeJcs(activationMarker)}\n`, "utf8")
    const release = trustedRelease(loadedManifest, deployedAt, canonicalSha256(activationMarker))
    const releaseBytes = Buffer.from(`${canonicalizeUpgradeJcs(release)}\n`, "utf8")
    const executableMode = modeNumber(loadedManifest.install.executableMode)
    step("PUBLISH_CONTENT_ADDRESSED_RELEASE", () => {
      io.publishRelease(loadedManifest.newRelease.reviewedCheckoutPath, loadedManifest.newRelease.releaseRoot)
      io.verifyCheckout(loadedManifest.newRelease.releaseRoot, loadedManifest.newRelease.commit, loadedManifest.repository,
        loadedManifest.newRelease.closure)
    })
    step("CREATE_EMPTY_REPLAY_JOURNAL", () => io.createFileExclusive(
      loadedManifest.install.replayJournalPath, Buffer.alloc(0), 0, prior.account.gid,
      modeNumber(loadedManifest.install.replayJournalMode),
    ))
    step("SET_AND_VERIFY_APPEND_ONLY", () => {
      const set = io.run(CHATTR, ["+a", "--", loadedManifest.install.replayJournalPath])
      if (set.status !== 0) fail("AEGIS_REPLAY_UPGRADE_APPEND_ONLY_FAILED", "chattr +a failed")
      const check = io.run(LSATTR, ["-d", "--", loadedManifest.install.replayJournalPath])
      if (check.status !== 0 || !/^[A-Za-z-]*a[A-Za-z-]*\s+/.test(check.stdout)) {
        fail("AEGIS_REPLAY_UPGRADE_APPEND_ONLY_FAILED", "lsattr did not retain the append-only fence")
      }
      assertExactFile(io, loadedManifest.install.replayJournalPath,
        { uid: 0, gid: prior.account.gid, mode: modeNumber(loadedManifest.install.replayJournalMode), sha256: sha256(Buffer.alloc(0)) })
    })
    step("INSTALL_REPLAY_HELPER", () => io.createFileExclusive(
      loadedManifest.install.replayHelperPath,
      io.read(path.posix.join(loadedManifest.newRelease.releaseRoot, loadedManifest.install.replayHelperSource)),
      0, 0, executableMode,
    ))
    step("REPLACE_REPLAY_INITIALIZER", () => io.atomicReplace(
      loadedManifest.install.replayInitializerPath,
       io.read(path.posix.join(loadedManifest.packageRelease.checkoutPath, loadedManifest.install.replayInitializerSource)),
      0, 0, executableMode,
    ))
    step("REPLACE_BOOTSTRAP", () => io.atomicReplace(
      loadedManifest.install.bootstrapPath,
      io.read(path.posix.join(loadedManifest.newRelease.releaseRoot, loadedManifest.install.bootstrapSource)),
      0, 0, executableMode,
    ))
    step("CREATE_ACTIVATION_MARKER", () => io.createFileExclusive(
      loadedManifest.install.activationMarkerPath, activationMarkerBytes, 0, 0, 0o444,
    ))
    step("REPLACE_TRUSTED_RELEASE_MANIFEST", () => {
      releaseManifestReplaced = true
      io.atomicReplace(loadedManifest.priorState.trustedReleaseManifestPath, releaseBytes, 0, 0, 0o444)
    })
    io.appendJournal(mutationJournal, {
      record_type: "COMMITTED",
      phase: 2,
      committed_at: clock(),
      completed_mutations: completed,
      release_manifest_sha256: sha256(releaseBytes),
      replay_journal_sha256: sha256(Buffer.alloc(0)),
      append_only_verified: true,
      authorized_keys_mutated: false,
      account_mutated: false,
      network_accessed: false,
      workload_executed: false,
      scheduler_activated: false,
      privilege_helper_used: false,
      replay_epoch_initialized: false,
      operational: false,
      next_non_root_step: "INITIALIZE_REPLAY_EPOCH_AS_WILLIAMOS_FABRIC",
    })
  } catch (error) {
    const recoveryErrors = []
    const restore = (required, action) => {
      if (!required) return false
      try { action(); return true } catch (restoreError) { recoveryErrors.push(restoreError); return false }
    }
    const releaseManifestRestored = restore(releaseManifestReplaced || completed.includes("REPLACE_TRUSTED_RELEASE_MANIFEST"),
      () => io.atomicReplace(loadedManifest.priorState.trustedReleaseManifestPath,
        prior.priorReleaseBytes, 0, 0, 0o444))
    const bootstrapRestored = restore(completed.includes("REPLACE_BOOTSTRAP"), () => io.atomicReplace(
      loadedManifest.install.bootstrapPath, prior.installedBytes.bootstrap, 0, 0,
      modeNumber(loadedManifest.install.executableMode)))
    const initializerRestored = restore(completed.includes("REPLACE_REPLAY_INITIALIZER"), () => io.atomicReplace(
      loadedManifest.install.replayInitializerPath, prior.installedBytes["replay-epoch-initializer"], 0, 0,
      modeNumber(loadedManifest.install.executableMode)))
    try {
      if (journalCreated) io.appendJournal(mutationJournal, {
        record_type: "FAILED_PARTIAL",
        phase: 2,
        failed_at: clock(),
        failure_code: error?.code ?? "AEGIS_REPLAY_UPGRADE_APPLY_FAILED",
        completed_mutations: completed,
        activation_manifest_replaced: releaseManifestReplaced,
        prior_bootstrap_restored: bootstrapRestored,
        prior_initializer_restored: initializerRestored,
        prior_release_manifest_restored: releaseManifestRestored,
      })
    } catch (journalError) {
      fail("AEGIS_REPLAY_UPGRADE_EVIDENCE_UNCERTAIN", "partial failure journal was not durable", {
        causeCode: journalError?.code ?? null, originalFailureCode: error?.code ?? null,
        authorityConsumed: true, mutationJournal, completedMutations: completed,
      })
    }
    if (recoveryErrors.length > 0) fail("AEGIS_REPLAY_UPGRADE_RECOVERY_UNCERTAIN", "prior activation restoration failed", {
      causeCode: recoveryErrors[0]?.code ?? null, originalFailureCode: error?.code ?? null,
      authorityConsumed: journalCreated, mutationJournal: journalCreated ? mutationJournal : null, completedMutations: completed,
    })
    Object.assign(error, { authorityConsumed: journalCreated,
      mutationJournal: journalCreated ? mutationJournal : null, completedMutations: completed })
    throw error
  } finally {
    let releaseFailure = null
    for (const lockPath of heldLocks.reverse()) {
      try { io.releaseLock(lockPath, lockRecord, prior.account.uid, prior.account.gid, 0o600) }
      catch (releaseError) {
        releaseFailure ??= releaseError
      }
    }
    if (releaseFailure) fail("AEGIS_REPLAY_UPGRADE_LOCK_RELEASE_UNCERTAIN", "upgrade lock release could not be proven", {
      causeCode: releaseFailure?.code ?? null, authorityConsumed: journalCreated,
      mutationJournal: journalCreated ? mutationJournal : null, completedMutations: completed,
    })
  }
  return { ...evidence, status: "COMMITTED", authority_consumed: true,
    completed_mutations: completed, activated: true, replay_epoch_initialized: false, operational: false,
    next_non_root_step: "INITIALIZE_REPLAY_EPOCH_AS_WILLIAMOS_FABRIC" }
}

function safeParents(targetPath) {
  let current = path.posix.dirname(targetPath)
  while (true) {
    const stats = fs.lstatSync(current)
    if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync(current) !== current || (stats.mode & 0o022) !== 0) {
      fail("AEGIS_REPLAY_UPGRADE_PARENT_UNTRUSTED", `${current} is indirect or writable`) }
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
  const temporary = exclusive ? targetPath : `${targetPath}.upgrade-${crypto.randomUUID()}.tmp`
  let descriptor
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0), mode)
    fs.fchmodSync(descriptor, mode)
    fs.fchownSync(descriptor, uid, gid)
    let offset = 0
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null)
      if (!Number.isSafeInteger(written) || written <= 0) fail("AEGIS_REPLAY_UPGRADE_WRITE_FAILED", "write made no progress")
      offset += written
    }
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    if (!exclusive) fs.renameSync(temporary, targetPath)
    fsyncParent(targetPath)
  } catch (error) {
    if (!exclusive) try { fs.unlinkSync(temporary) } catch {}
    throw error
  } finally { if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch {} }
}

function fixedGit(checkout, args, accepted = [0]) {
  const result = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=",
    "--no-replace-objects", "-C", checkout, ...args], {
    shell: false, encoding: "utf8", timeout: 30_000, maxBuffer: MAX_FILE_BYTES,
    env: { PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", GIT_OPTIONAL_LOCKS: "0" },
  })
  if (result.error || result.signal || !accepted.includes(result.status)) {
    fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_GIT_FAILED", `fixed Git operation failed: ${args[0]}`)
  }
  return { status: result.status, stdout: result.stdout ?? "" }
}

export function createNodeUpgradeIo() {
  const inspect = (targetPath) => {
    try {
      const stats = fs.lstatSync(targetPath)
      let direct = false
      try { direct = fs.realpathSync(targetPath) === targetPath } catch {}
      return { type: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other",
        direct, nlink: stats.nlink, uid: stats.uid, gid: stats.gid,
        mode: stats.mode & 0o7777 }
    } catch (error) { if (error?.code === "ENOENT") return null; throw error }
  }
  const read = (targetPath) => {
    const descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      const stats = fs.fstatSync(descriptor)
      if (!stats.isFile() || stats.nlink !== 1 || stats.size > MAX_FILE_BYTES) fail("AEGIS_REPLAY_UPGRADE_FILE_UNTRUSTED", `${targetPath} is not bounded`)
      return fs.readFileSync(descriptor)
    } finally { fs.closeSync(descriptor) }
  }
  const readStable = (targetPath, { uid, gid, mode }) => {
    safeParents(targetPath)
    const descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      const before = fs.fstatSync(descriptor)
      if (!before.isFile() || before.nlink !== 1 || before.uid !== uid || before.gid !== gid
        || (before.mode & 0o7777) !== mode || before.size > MAX_FILE_BYTES) {
        fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_FILE_UNTRUSTED", "authority metadata differs")
      }
      const bytes = fs.readFileSync(descriptor)
      const after = fs.fstatSync(descriptor)
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_FILE_UNSTABLE", "authority changed during stable read")
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
      fail("AEGIS_REPLAY_UPGRADE_ACCOUNT_INVALID", "account or primary group differs")
    }
    return { uid: Number(p[2]), gid: Number(p[3]), home: p[5], shell: p[6] }
  }
  const verifyCheckout = (checkout, commit, repository, closure) => {
    const stats = inspect(checkout)
    if (!stats || stats.type !== "directory" || !stats.direct || stats.uid !== 0 || stats.gid !== 0
      || stats.mode !== 0o755) fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT", "checkout root metadata differs")
    const head = fixedGit(checkout, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout.trim()
    const symbolic = fixedGit(checkout, ["symbolic-ref", "-q", "HEAD"], [0, 1])
    const origin = fixedGit(checkout, ["remote", "get-url", "--all", "origin"]).stdout.trim()
    const normalizedOrigin = origin.replace(/^git@github\.com:/, "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")
    if (head !== commit || symbolic.status !== 1 || symbolic.stdout !== "" || normalizedOrigin !== repository
      || fixedGit(checkout, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout !== "") {
      fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT", "checkout is not exact, detached, clean, and reviewed")
    }
    const tracked = new Set(fixedGit(checkout, ["ls-files", "-z"]).stdout.split("\0").filter(Boolean))
    if (Object.keys(closure).some((relative) => !tracked.has(relative))) {
      fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT", "checkout omits a required closure path")
    }
    for (const relative of tracked) {
      const item = inspect(path.posix.join(checkout, relative))
      if (!item || item.type !== "file" || !item.direct || item.nlink !== 1 || item.uid !== 0 || item.gid !== 0
        || (item.mode & 0o7022) !== 0 || (item.mode & 0o400) === 0) {
        fail("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT", `${relative} metadata differs`)
      }
    }
  }
  const verifyAncestry = (checkout, ancestor, descendant) => {
    fixedGit(checkout, ["merge-base", "--is-ancestor", ancestor, descendant])
  }
  const createJournal = (journalPath, record) => writeFile(journalPath,
    Buffer.from(`${canonicalizeUpgradeJcs(record)}\n`, "utf8"), 0, 0, 0o600, true)
  const appendJournal = (journalPath, record) => {
    const observed = inspect(journalPath)
    if (!observed || observed.type !== "file" || !observed.direct || observed.nlink !== 1
      || observed.uid !== 0 || observed.gid !== 0 || observed.mode !== 0o600) {
      fail("AEGIS_REPLAY_UPGRADE_JOURNAL_UNTRUSTED", "mutation journal metadata differs")
    }
    const descriptor = fs.openSync(journalPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      fs.writeFileSync(descriptor, `${canonicalizeUpgradeJcs(record)}\n`, "utf8")
      fs.fsyncSync(descriptor)
    } finally { fs.closeSync(descriptor) }
    fsyncParent(journalPath)
  }
  return {
    platform: () => process.platform, euid: () => process.geteuid?.() ?? process.getuid?.(), hostname: () => os.hostname(), inspect, read, readStable, account,
    verifyCheckout, verifyAncestry,
    publishRelease(source, destination) {
      safeParents(destination)
      const temporary = `${destination}.upgrade-${crypto.randomUUID()}.tmp`
      fs.cpSync(source, temporary, { recursive: true, dereference: false, errorOnExist: true, force: false, verbatimSymlinks: true })
      fs.renameSync(temporary, destination)
      fsyncParent(destination)
    },
    createFileExclusive(targetPath, bytes, uid, gid, mode) { writeFile(targetPath, bytes, uid, gid, mode, true) },
    atomicReplace(targetPath, bytes, uid, gid, mode) { writeFile(targetPath, bytes, uid, gid, mode, false) },
    acquireLock(targetPath, bytes, uid, gid, mode) {
      try { writeFile(targetPath, bytes, uid, gid, mode, true) }
      catch (error) {
        if (error?.code === "EEXIST") fail("AEGIS_REPLAY_UPGRADE_LOCK_OCCUPIED", `${targetPath} is occupied`)
        throw error
      }
    },
    releaseLock(targetPath, bytes, uid, gid, mode) {
      const observed = inspect(targetPath)
      if (!observed || observed.type !== "file" || !observed.direct || observed.nlink !== 1
        || observed.uid !== uid || observed.gid !== gid || observed.mode !== mode
        || sha256(read(targetPath)) !== sha256(bytes)) {
        fail("AEGIS_REPLAY_UPGRADE_LOCK_RELEASE_UNSAFE", `${targetPath} ownership changed`)
      }
      fs.unlinkSync(targetPath)
      fsyncParent(targetPath)
    },
    run(binary, args) {
      const result = spawnSync(binary, args, { shell: false, encoding: "utf8", timeout: 5_000,
        env: { PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C", LC_ALL: "C" } })
      return { status: result.error || result.signal ? null : result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
    },
    createJournal, appendJournal,
  }
}

export function replayLedgerUpgradeErrorEvidence(error) {
  return {
    schema_version: "1.0-aegis-standing-hash-replay-ledger-upgrade-error",
    status: "FAILED_CLOSED",
    code: error?.code ?? "AEGIS_REPLAY_UPGRADE_REJECTED",
    detail: String(error?.message ?? error).slice(0, 512),
    authority_consumed: error?.authorityConsumed === true,
    mutation_journal: error?.mutationJournal ?? null,
    completed_mutations: error?.completedMutations ?? [],
    original_failure_code: error?.originalFailureCode ?? null,
    cause_code: error?.causeCode ?? null,
    authorized_keys_mutated: false,
    account_mutated: false,
    network_accessed: false,
    workload_executed: false,
    scheduler_activated: false,
    privilege_helper_used: false,
  }
}

function parseCli(argv) {
  const result = { mode: null, authorityPath: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (["--dry-run", "--apply"].includes(argument) && result.mode === null) result.mode = argument.slice(2)
    else if (argument === "--authority" && result.authorityPath === null && argv[index + 1]) result.authorityPath = argv[++index]
    else fail("AEGIS_REPLAY_UPGRADE_USAGE_INVALID", `invalid argument ${argument}`)
  }
  if (!result.mode || !result.authorityPath) fail("AEGIS_REPLAY_UPGRADE_USAGE_INVALID", "use --authority <json> and one mode")
  if (!new RegExp(`^${AUTHORITY_ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[0-9a-f-]{36}\\.json$`, "i").test(result.authorityPath)) {
    fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_PATH_INVALID", "authority must use the fixed standing-hash authority root")
  }
  return result
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const io = dependencies.io ?? createNodeUpgradeIo()
  try {
    const cli = parseCli(argv)
    const authorityBytes = io.readStable(cli.authorityPath, { uid: 0, gid: 0, mode: 0o600 })
    const authority = parseJson(authorityBytes, "AEGIS_REPLAY_UPGRADE_AUTHORITY_INVALID", "authority")
    if (!UUID.test(authority.authorityId ?? "") || cli.authorityPath !== `${AUTHORITY_ROOT}/${authority.authorityId}.json`) {
      fail("AEGIS_REPLAY_UPGRADE_AUTHORITY_PATH_INVALID", "authority filename does not match authority_id")
    }
    const packageManifestPath = path.posix.join(authority.evidenceCheckoutPath ?? "", UPGRADE_MANIFEST_PATH)
    const packageManifestBytes = io.read(packageManifestPath)
    const result = upgradeAegisStandingHashReplayLedger({ ...dependencies, io, authority, mode: cli.mode,
      manifestBytes: packageManifestBytes })
    ;(dependencies.stdout ?? process.stdout).write(`${canonicalizeUpgradeJcs(result)}\n`)
    return 0
  } catch (error) {
    ;(dependencies.stderr ?? process.stderr).write(`${canonicalizeUpgradeJcs(replayLedgerUpgradeErrorEvidence(error))}\n`)
    return error?.code === "AEGIS_REPLAY_UPGRADE_USAGE_INVALID" ? 64 : 2
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) process.exitCode = main()
