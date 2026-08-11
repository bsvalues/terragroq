#!/usr/bin/node
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  validateStandingProvisioningAuthority,
  validateStandingProvisioningManifest,
} from "./aegis-standing-hash-prerequisites.mjs"
import { canonicalizeJcs } from "../canonical-json.mjs"

export const MANIFEST_PATH = "config/execution-fabric/aegis-standing-hash-provisioning-package.v1.json"
export const JOURNAL_PREFIX = "/var/lib/williamos-aegis-standing-hash-"
export const AUTHORIZED_KEYS_RECORD_OPTIONS = Object.freeze([
  "restrict",
  'from="192.168.1.154"',
  'command="/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs"',
  "no-agent-forwarding",
  "no-port-forwarding",
  "no-X11-forwarding",
  "no-pty",
  "no-user-rc",
])

const AUTHORITY_KEYS = Object.freeze([
  "schemaVersion",
  "authorityId",
  "packageId",
  "manifestSha256",
  "repository",
  "trustedMainCommit",
  "machineIdSha256",
  "account",
  "workOrderId",
  "issueNumber",
  "rootMutationIds",
  "dedicatedTransportKeyFingerprint",
  "dedicatedTransportPublicKeySha256",
  "dedicatedTransportKeyGenerationEvidenceSha256",
  "reviewedCheckoutSourcePath",
  "issuedAt",
  "expiresAt",
  "singleUse",
  "consumed",
])
const EXPECTED_MUTATIONS = Object.freeze([
  "INSTALL_REVIEWED_RELEASE_CLOSURE",
  "INSTALL_ROOT_OWNED_BOOTSTRAP",
  "INSTALL_ROOT_OWNED_RELEASE_MANIFEST",
  "INSTALL_ROOT_OWNED_SSH_ENTRYPOINT",
  "INSTALL_ROOT_OWNED_REPLAY_EPOCH_INITIALIZER",
  "CREATE_PRIVATE_REQUEST_ROOT",
  "CREATE_PRIVATE_LEDGER_ROOT",
  "CREATE_PRIVATE_NODE_LEASE_ROOT",
  "ESTABLISH_REPLAY_JOURNAL_EPOCH",
  "INSTALL_FORCED_COMMAND_AUTHORIZED_KEY",
])
const PREREQUISITE_CODE_MAP = Object.freeze({
  PACKAGE_INVALID: "AEGIS_PROVISION_PACKAGE_INVALID",
  PROVISIONING_AUTHORITY_INVALID: "AEGIS_PROVISION_AUTHORITY_INVALID",
  PROVISIONING_AUTHORITY_CONSUMED: "AEGIS_PROVISION_AUTHORITY_REPLAY",
  PROVISIONING_AUTHORITY_SCOPE_MISMATCH: "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH",
  PROVISIONING_AUTHORITY_EXPIRED: "AEGIS_PROVISION_AUTHORITY_EXPIRED",
})
const KEY_EVIDENCE_KEYS = Object.freeze([
  "schemaVersion", "status", "packageId", "manifestSha256", "generationAuthorityId",
  "generationAuthoritySha256", "generatedAt", "generationHost", "generationAccount",
  "sourceAddress", "algorithm", "privateKeyPath", "publicKeyPath", "generatedFresh",
  "existedBefore", "privateKeyInspected", "privateKeyLocalOnly", "publicKeySha256",
  "publicKeyFingerprint",
])
const EXPECTED_CLOSURE = Object.freeze([
  "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs",
  "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs",
  "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs",
  "scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs",
  "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs",
])
const CANONICAL_JSON_SOURCE = "scripts/execution-fabric/canonical-json.mjs"
const EXPECTED_ROOT_ASSETS = Object.freeze({
  bootstrap: "/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs",
  "ssh-entrypoint": "/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs",
  "replay-epoch-initializer": "/usr/local/libexec/williamos/aegis-standing-hash-replay-epoch.mjs",
  "release-manifest": "/etc/williamos/fabric/trusted-main-release.json",
})
const EXPECTED_EXISTING_RUNTIME_ROOTS = Object.freeze([
  Object.freeze({
    path: "/var/lib/williamos",
    owner: "williamos-fabric",
    group: "williamos-fabric",
    mode: "0750",
    preserveExisting: true,
    mutationAllowed: false,
  }),
  Object.freeze({
    path: "/var/lib/williamos/fabric",
    owner: "williamos-fabric",
    group: "williamos-fabric",
    mode: "0700",
    preserveExisting: true,
    mutationAllowed: false,
  }),
])
const SSH_ENTRYPOINT_SOURCE = "scripts/execution-fabric/provision/aegis-standing-hash-ssh-entrypoint.mjs"
const REPLAY_INITIALIZER_SOURCE = "scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs"
const APPLY_SOURCE = "scripts/execution-fabric/provision/apply-aegis-standing-hash-prerequisites.mjs"
const KEY_GENERATOR_SOURCE = "scripts/execution-fabric/provision/create-hermes-aegis-standing-hash-key.mjs"
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[a-f0-9]{64}$/
const SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/
const MAX_FILE_BYTES = 1024 * 1024
const GIT_EXECUTABLE = "/usr/bin/git"
const GIT_MAX_OUTPUT_BYTES = 1024 * 1024

const canonicalize = canonicalizeJcs
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalSha256 = (value) => sha256(Buffer.from(canonicalize(value), "utf8"))
const same = (left, right) => canonicalize(left) === canonicalize(right)
const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort())

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  throw error
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function normalizeLf(bytes) {
  return Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"), "utf8")
}

function readStableFile(fsApi, filePath, { maximumBytes = MAX_FILE_BYTES, rootOwned = false, pathApi = path } = {}) {
  const lexical = pathApi.resolve(filePath)
  let descriptor
  try {
    const before = fsApi.lstatSync(lexical)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes
      || (rootOwned && (before.uid !== 0 || (before.mode & 0o022) !== 0))
      || fsApi.realpathSync(lexical) !== lexical) {
      fail("AEGIS_PROVISION_SOURCE_UNTRUSTED", `${filePath} is not a trusted direct single-link file`)
    }
    const constants = fsApi.constants ?? fs.constants
    descriptor = fsApi.openSync(lexical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
      fail("AEGIS_PROVISION_SOURCE_CHANGED", `${filePath} changed during acquisition`)
    }
    return Buffer.from(fsApi.readFileSync(descriptor))
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function confinedSource(repoRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.includes("\\") || path.posix.isAbsolute(relativePath)) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "package source path is not a relative POSIX path")
  }
  const root = path.resolve(repoRoot)
  const candidate = path.resolve(root, ...relativePath.split("/"))
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", `${relativePath} escapes the reviewed package`)
  }
  return candidate
}

function validateManifest(manifest) {
  try { validateStandingProvisioningManifest(manifest) } catch (error) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", String(error?.message ?? error))
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.schemaVersion !== 1
    || manifest.packageId !== "aegis-standing-hash-provisioning-issue-595-v1"
    || manifest.status !== "PACKAGE_ONLY_NOT_APPLIED"
    || manifest.applyAuthorized !== false
    || manifest.executionAuthorized !== false
    || manifest.ownerAuthorityRequired !== true) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "package identity or non-applied posture differs")
  }
  if (manifest.issue?.repository !== "bsvalues/terragroq" || manifest.issue?.number !== 595
    || manifest.issue?.workOrderId !== "WO-EF-AEGIS-STANDING-001"
    || manifest.trustedMain?.repository !== "bsvalues/terragroq"
    || manifest.trustedMain?.ref !== "refs/heads/main"
    || !/^[a-f0-9]{40}$/.test(manifest.trustedMain?.commit ?? "")
    || manifest.trustedMain?.reviewed !== true) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "reviewed repository scope differs")
  }
  if (manifest.identity?.nodeId !== "aegis" || manifest.identity?.hostname !== "aegis"
    || !SHA256.test(manifest.identity?.machineIdSha256 ?? "")
    || manifest.identity?.account !== "williamos-fabric") {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "AEGIS identity scope differs")
  }
  if (!same(manifest.reviewedRelease?.runtimeClosurePaths, EXPECTED_CLOSURE)
    || manifest.reviewedRelease?.releaseRoot !== `/opt/williamos/releases/${manifest.trustedMain.commit}`
    || manifest.reviewedRelease?.releaseManifestPath !== EXPECTED_ROOT_ASSETS["release-manifest"]
    || manifest.reviewedRelease?.bootstrapInstallPath !== EXPECTED_ROOT_ASSETS.bootstrap
    || manifest.reviewedRelease?.manifestSchemaVersion !== "1.0-williamos-trusted-main-release"
    || manifest.reviewedRelease?.exactClosureRequired !== true) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "reviewed release closure differs")
  }
  const assets = Object.fromEntries((manifest.rootOwnedAssets ?? []).map((asset) => [asset.id, asset]))
  for (const [id, expectedPath] of Object.entries(EXPECTED_ROOT_ASSETS)) {
    const asset = assets[id]
    if (asset?.path !== expectedPath || asset.type !== "file" || asset.owner !== "root"
      || asset.group !== "root" || asset.singleLink !== true
      || asset.mode !== (id === "release-manifest" ? "0444" : "0555")) {
      fail("AEGIS_PROVISION_PACKAGE_INVALID", `root-owned asset ${id} differs`)
    }
  }
  const releaseRoot = manifest.rootOwnedAssets?.find(({ id }) => id === "release-root")
  if (releaseRoot?.path !== manifest.reviewedRelease.releaseRoot || releaseRoot.type !== "directory"
    || releaseRoot.owner !== "root" || releaseRoot.group !== "root" || releaseRoot.mode !== "0755") {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "release root asset differs")
  }
  const privateExpected = {
    request: "/var/lib/williamos/fabric/standing-hash-requests",
    ledger: "/var/lib/williamos/fabric/standing-hash-ledger",
    nodeLease: "/var/lib/williamos/fabric/ledger",
  }
  if (!same(manifest.existingRuntimeRoots, EXPECTED_EXISTING_RUNTIME_ROOTS)) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "preserved existing runtime roots differ")
  }
  for (const [name, expectedPath] of Object.entries(privateExpected)) {
    const root = manifest.privateRoots?.[name]
    if (root?.path !== expectedPath || root.owner !== "williamos-fabric"
      || root.group !== "williamos-fabric" || root.mode !== "0700") {
      fail("AEGIS_PROVISION_PACKAGE_INVALID", `private root ${name} differs`)
    }
  }
  if (manifest.invocationBoundary?.authorizedKeysPath !== "/home/williamos-fabric/.ssh/authorized_keys"
    || manifest.invocationBoundary?.sourceAddress !== "192.168.1.154"
    || manifest.invocationBoundary?.forcedCommandPath !== EXPECTED_ROOT_ASSETS["ssh-entrypoint"]
    || manifest.invocationBoundary?.dedicatedTransportKeyAlgorithm !== "ssh-ed25519"
    || manifest.invocationBoundary?.dedicatedTransportPrivateKeyInspectionAllowed !== false
    || manifest.invocationBoundary?.existingKeyReuseAllowed !== false
    || manifest.standingExecutionBoundary?.schedulerState !== "disabled"
    || manifest.standingExecutionBoundary?.schedulerAuthority !== "not-granted"
    || manifest.standingExecutionBoundary?.autonomousSelection !== false) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "transport or scheduler boundary differs")
  }
  if (!same((manifest.rootMutations ?? []).map(({ id }) => id), EXPECTED_MUTATIONS)
    || manifest.apply?.defaultMode !== "DRY_RUN"
    || manifest.apply?.liveRootApplyAuthorized !== false
    || manifest.apply?.singleUseAuthorityRequired !== true
    || manifest.apply?.consumeBeforeFirstMutationRequired !== true
    || manifest.apply?.refuseExistingDrift !== true
    || manifest.apply?.mutationJournalRequired !== true) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "apply contract differs")
  }
  const bindingPaths = (manifest.bindings ?? []).map(({ path: bindingPath }) => bindingPath)
  if (!same(bindingPaths, [...EXPECTED_CLOSURE, CANONICAL_JSON_SOURCE, SSH_ENTRYPOINT_SOURCE, REPLAY_INITIALIZER_SOURCE, APPLY_SOURCE, KEY_GENERATOR_SOURCE])
    || manifest.bindings.some((binding) => !SHA256.test(binding.sha256 ?? "") || binding.textNormalization !== "LF")) {
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "reviewed package bindings differ")
  }
  return manifest
}

function parsePublicKey(bytes) {
  const text = Buffer.from(bytes).toString("utf8")
  if (text.includes("PRIVATE KEY") || text.includes("\0") || Buffer.byteLength(text, "utf8") > 16 * 1024) {
    fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "only one bounded public key record is accepted")
  }
  const line = text.replace(/\r\n/g, "\n").replace(/\n$/, "")
  if (line.includes("\n") || line.trim() !== line) {
    fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "public key file must contain exactly one canonical line")
  }
  const fields = line.split(/[ \t]+/)
  if (fields.length < 2 || fields[0] !== "ssh-ed25519" || !/^[A-Za-z0-9+/]+={0,2}$/.test(fields[1])) {
    fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "dedicated Hermes key must be ssh-ed25519")
  }
  let blob
  try { blob = Buffer.from(fields[1], "base64") } catch { fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "public key blob is invalid") }
  if (blob.toString("base64").replace(/=+$/, "") !== fields[1].replace(/=+$/, "")) {
    fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "public key blob is not canonical base64")
  }
  const readField = (offset) => {
    if (offset + 4 > blob.length) fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "public key wire record is truncated")
    const length = blob.readUInt32BE(offset)
    const start = offset + 4
    const end = start + length
    if (end > blob.length) fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "public key wire record is truncated")
    return { value: blob.subarray(start, end), next: end }
  }
  const algorithm = readField(0)
  const key = readField(algorithm.next)
  if (algorithm.value.toString("ascii") !== "ssh-ed25519" || key.value.length !== 32 || key.next !== blob.length) {
    fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "public key wire record is not one Ed25519 key")
  }
  const fingerprint = `SHA256:${crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`
  return {
    algorithm: "ssh-ed25519",
    blob: fields[1],
    fingerprint,
    fileSha256: sha256(bytes),
    authorizedRecord: `${AUTHORIZED_KEYS_RECORD_OPTIONS.join(",")} ssh-ed25519 ${fields[1]}\n`,
  }
}

export function validateHermesKeyGenerationEvidence(manifest, evidence, publicKey) {
  if (!exactKeys(evidence, KEY_EVIDENCE_KEYS)
    || evidence.schemaVersion !== "1.0-hermes-aegis-standing-hash-key-evidence"
    || evidence.status !== "GENERATED"
    || evidence.packageId !== manifest.packageId
    || evidence.manifestSha256 !== canonicalSha256(manifest)
    || !GUID.test(evidence.generationAuthorityId ?? "")
    || !SHA256.test(evidence.generationAuthoritySha256 ?? "")
    || !canonicalTimestamp(evidence.generatedAt)
    || evidence.generationHost !== "hermes" || evidence.generationAccount !== "bs"
    || evidence.sourceAddress !== "192.168.1.154" || evidence.algorithm !== "ssh-ed25519"
    || evidence.privateKeyPath !== manifest.invocationBoundary.dedicatedTransportPrivateKeyPath
    || evidence.publicKeyPath !== manifest.invocationBoundary.dedicatedTransportPublicKeyPath
    || evidence.generatedFresh !== true || evidence.existedBefore !== false
    || evidence.privateKeyInspected !== false || evidence.privateKeyLocalOnly !== true
    || evidence.publicKeySha256 !== publicKey.fileSha256
    || evidence.publicKeyFingerprint !== publicKey.fingerprint) {
    fail("AEGIS_PROVISION_KEY_GENERATION_EVIDENCE_INVALID", "dedicated key generation evidence differs")
  }
  return { evidence, sha256: canonicalSha256(evidence) }
}

function validateAuthority(manifest, authority, publicKey, keyGeneration, checkout, now) {
  if (!exactKeys(authority, AUTHORITY_KEYS) || authority.schemaVersion !== 1
    || !GUID.test(authority.authorityId ?? "") || authority.singleUse !== true) {
    fail("AEGIS_PROVISION_AUTHORITY_INVALID", "authority JSON shape differs from the exact single-use contract")
  }
  if (authority.consumed !== false) fail("AEGIS_PROVISION_AUTHORITY_REPLAY", "authority is already marked consumed")
  const expected = {
    packageId: manifest.packageId,
    manifestSha256: canonicalSha256(manifest),
    repository: manifest.trustedMain.repository,
    trustedMainCommit: manifest.trustedMain.commit,
    machineIdSha256: manifest.identity.machineIdSha256,
    account: manifest.identity.account,
    workOrderId: manifest.issue.workOrderId,
    issueNumber: manifest.issue.number,
    rootMutationIds: manifest.rootMutations.map(({ id }) => id),
    dedicatedTransportKeyFingerprint: publicKey.fingerprint,
    dedicatedTransportPublicKeySha256: publicKey.fileSha256,
    dedicatedTransportKeyGenerationEvidenceSha256: keyGeneration.sha256,
    reviewedCheckoutSourcePath: checkout.sourcePath,
  }
  if (authority.dedicatedTransportKeyFingerprint !== publicKey.fingerprint
    || authority.dedicatedTransportPublicKeySha256 !== publicKey.fileSha256) {
    fail("AEGIS_PROVISION_PUBLIC_KEY_BINDING_MISMATCH", "authority does not bind the exact dedicated public key")
  }
  if (Date.parse(keyGeneration.evidence.generatedAt) > Date.parse(authority.issuedAt)) {
    fail("AEGIS_PROVISION_KEY_GENERATION_EVIDENCE_INVALID", "key generation must predate root authority issuance")
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!same(authority[key], value)) fail("AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH", `authority ${key} differs`)
  }
  const issued = Date.parse(authority.issuedAt)
  const expires = Date.parse(authority.expiresAt)
  const current = Date.parse(now)
  const maximumAge = manifest.apply.authorityMaximumAgeSeconds * 1000
  if (!canonicalTimestamp(authority.issuedAt) || !canonicalTimestamp(authority.expiresAt)
    || !canonicalTimestamp(now) || ![issued, expires, current].every(Number.isFinite)
    || expires <= issued || expires - issued > maximumAge || current < issued || current >= expires) {
    fail("AEGIS_PROVISION_AUTHORITY_EXPIRED", "authority is outside its exact bounded validity window")
  }
  const prerequisite = validateStandingProvisioningAuthority(manifest, authority, now)
  if (prerequisite.status !== "BLOCKED" || prerequisite.reasonCode !== "LIVE_ROOT_APPLY_AUTHORITY_REQUIRED") {
    fail(PREREQUISITE_CODE_MAP[prerequisite.reasonCode] ?? "AEGIS_PROVISION_AUTHORITY_INVALID",
      `prerequisite validation returned ${prerequisite.reasonCode ?? "UNKNOWN"}: ${prerequisite.detail ?? "no detail"}`)
  }
  return authority
}

function verifyMachine(fsApi, processApi, hostname, manifest, injectedMachineIdentitySha256) {
  if (processApi.platform !== "linux") fail("AEGIS_PROVISION_LINUX_REQUIRED", "root provisioning is Linux-only")
  const uid = typeof processApi.getuid === "function" ? processApi.getuid() : undefined
  if (uid !== 0) fail("AEGIS_PROVISION_ROOT_REQUIRED", "effective UID 0 is required")
  if (hostname() !== "aegis") fail("AEGIS_PROVISION_HOST_REJECTED", "exact aegis hostname is required")
  const observedSha256 = injectedMachineIdentitySha256 ?? (() => {
    const machineId = readStableFile(fsApi, "/etc/machine-id", {
      maximumBytes: 256,
      rootOwned: true,
      pathApi: path.posix,
    }).toString("utf8").trim()
    if (!/^[a-fA-F0-9]{32}$/.test(machineId)) return null
    return sha256(Buffer.from(machineId, "utf8"))
  })()
  if (observedSha256 !== manifest.identity.machineIdSha256) {
    fail("AEGIS_PROVISION_MACHINE_ID_REJECTED", "AEGIS machine identity does not match the package")
  }
}

function resolveAccount(fsApi, account) {
  const passwd = readStableFile(fsApi, "/etc/passwd", {
    maximumBytes: 1024 * 1024,
    rootOwned: true,
    pathApi: path.posix,
  }).toString("utf8")
  const entries = passwd.split("\n").filter((line) => line && !line.startsWith("#") && line.split(":")[0] === account)
  if (entries.length !== 1) fail("AEGIS_PROVISION_ACCOUNT_INVALID", "exact williamos-fabric account is required")
  const fields = entries[0].split(":")
  const uid = Number(fields[2])
  const gid = Number(fields[3])
  if (fields.length !== 7 || !Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0
    || fields[5] !== "/home/williamos-fabric") {
    fail("AEGIS_PROVISION_ACCOUNT_INVALID", "williamos-fabric account identity differs")
  }
  const groups = readStableFile(fsApi, "/etc/group", {
    maximumBytes: 1024 * 1024,
    rootOwned: true,
    pathApi: path.posix,
  }).toString("utf8")
    .split("\n").filter((line) => line && !line.startsWith("#") && line.split(":")[0] === account)
  if (groups.length !== 1 || Number(groups[0].split(":")[2]) !== gid) {
    fail("AEGIS_PROVISION_ACCOUNT_INVALID", "williamos-fabric primary group differs")
  }
  return { uid, gid }
}

function assertExistingDirectory(fsApi, directoryPath, { uid, gid, mode, immutableRoot = false }) {
  const stats = fsApi.lstatSync(directoryPath)
  if (!stats.isDirectory() || stats.isSymbolicLink() || fsApi.realpathSync(directoryPath) !== path.posix.resolve(directoryPath)
    || stats.uid !== uid || (gid !== undefined && stats.gid !== gid)
    || (mode !== undefined && (stats.mode & 0o7777) !== mode)
    || (immutableRoot && (stats.mode & 0o022) !== 0)) {
    fail("AEGIS_PROVISION_DIRECTORY_DRIFT", `${directoryPath} is indirect or has unexpected ownership/mode`)
  }
}

function existsNoFollow(fsApi, target) {
  try { return { exists: true, stats: fsApi.lstatSync(target) } } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, stats: null }
    throw error
  }
}

function sourceClosure(repoRoot, fsApi, manifest) {
  const files = new Map()
  for (const binding of manifest.bindings) {
    const source = confinedSource(repoRoot, binding.path)
    const bytes = normalizeLf(readStableFile(fsApi, source))
    if (sha256(bytes) !== binding.sha256) {
      fail("AEGIS_PROVISION_PACKAGE_BINDING_DRIFT", `${binding.path} differs from its reviewed digest`)
    }
    files.set(binding.path, bytes)
  }
  return files
}

function runFixedGit(args, cwd) {
  const result = spawnSync(GIT_EXECUTABLE, [
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "credential.helper=",
    ...args,
  ], {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: "buffer",
    timeout: 30_000,
    maxBuffer: GIT_MAX_OUTPUT_BYTES,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: "/root",
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/false",
    },
  })
  if (result.error || result.status !== 0 || result.signal) {
    fail("AEGIS_PROVISION_CHECKOUT_GIT_FAILED", `fixed local Git operation failed: ${args[0] ?? "unknown"}`)
  }
  return Buffer.from(result.stdout ?? Buffer.alloc(0)).toString("utf8").trim()
}

function assertRootOwnedDirect(candidate, fsApi, kind) {
  const stats = fsApi.lstatSync(candidate)
  const typeMatches = kind === "directory" ? stats.isDirectory() : stats.isFile()
  if (!typeMatches || stats.isSymbolicLink() || fsApi.realpathSync(candidate) !== candidate
    || stats.uid !== 0 || stats.gid !== 0 || (stats.mode & 0o022) !== 0) {
    fail("AEGIS_PROVISION_CHECKOUT_TRUST_ROOT_INVALID", `${candidate} is not a direct root-owned, non-writable ${kind}`)
  }
  return stats
}

export function assertNoGitAlternates(checkoutRoot, fsApi = fs) {
  const alternatesPath = path.posix.join(checkoutRoot, ".git", "objects", "info", "alternates")
  if (existsNoFollow(fsApi, alternatesPath).exists) {
    fail(
      "AEGIS_PROVISION_CHECKOUT_ALTERNATES_REJECTED",
      `${alternatesPath} would allow object resolution outside the reviewed checkout`,
    )
  }
}

function validateLocalGitConfig(checkoutRoot, fsApi) {
  const gitRoot = path.posix.join(checkoutRoot, ".git")
  assertRootOwnedDirect(checkoutRoot, fsApi, "directory")
  assertRootOwnedDirect(gitRoot, fsApi, "directory")
  assertNoGitAlternates(checkoutRoot, fsApi)
  const configPath = path.posix.join(gitRoot, "config")
  const stats = assertRootOwnedDirect(configPath, fsApi, "file")
  if (stats.size > 64 * 1024) fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "local Git configuration exceeds the fixed bound")
  const text = readStableFile(fsApi, configPath).toString("utf8").replace(/\r\n/g, "\n")
  if (text.includes("\0") || /\\\n/.test(text)) {
    fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "local Git configuration contains an ambiguous continuation")
  }
  let section = null
  const seen = new Map()
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || line.startsWith(";")) continue
    const header = /^\[([A-Za-z][A-Za-z0-9.-]*)(?:\s+"([A-Za-z0-9._/-]+)")?\]$/.exec(line)
    if (header) {
      section = { name: header[1].toLowerCase(), subsection: header[2] ?? null }
      if (!["core", "remote", "branch"].includes(section.name)) {
        fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", `local Git configuration section ${section.name} is not allowed`)
      }
      continue
    }
    if (!section) fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "local Git configuration key precedes its section")
    const assignment = /^([A-Za-z][A-Za-z0-9.-]*)\s*=\s*(.*)$/.exec(line)
    if (!assignment) fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "local Git configuration contains an unsupported line")
    const key = assignment[1].toLowerCase()
    const value = assignment[2].trim()
    const qualified = `${section.name}.${section.subsection ?? ""}.${key}`
    const allowed = section.name === "core"
      ? section.subsection === null && ["repositoryformatversion", "filemode", "bare", "logallrefupdates", "ignorecase", "precomposeunicode"].includes(key)
      : section.name === "remote"
        ? section.subsection === "origin" && ["url", "fetch"].includes(key)
        : section.subsection !== null && ["remote", "merge"].includes(key)
    if (!allowed || seen.has(qualified)) {
      fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", `local Git configuration key ${qualified} is not allowed or is duplicated`)
    }
    if (section.name === "core" && key === "bare" && value !== "false") {
      fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "source checkout must not be bare")
    }
    if (section.name === "core" && key === "repositoryformatversion" && value !== "0") {
      fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "unsupported repository format")
    }
    if (section.name === "remote" && key === "url") canonicalRepository(value)
    if (section.name === "remote" && key === "fetch" && value !== "+refs/heads/*:refs/remotes/origin/*") {
      fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "origin fetch refspec differs from the fixed contract")
    }
    if (section.name === "branch" && key === "remote" && value !== "origin") {
      fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "branch remote differs from origin")
    }
    if (section.name === "branch" && key === "merge" && !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(value)) {
      fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "branch merge ref is invalid")
    }
    seen.set(qualified, value)
  }
  if (seen.get("core..repositoryformatversion") !== "0"
    || seen.get("core..bare") !== "false"
    || !seen.has("remote.origin.url")) {
    fail("AEGIS_PROVISION_CHECKOUT_CONFIG_INVALID", "local Git configuration lacks the required fixed identity")
  }
}

function canonicalRepository(value) {
  const normalized = String(value).trim().replace(/\\/g, "/")
  if ([
    "https://github.com/bsvalues/terragroq.git",
    "https://github.com/bsvalues/terragroq",
    "git@github.com:bsvalues/terragroq.git",
    "ssh://git@github.com/bsvalues/terragroq.git",
  ].includes(normalized)) return "bsvalues/terragroq"
  fail("AEGIS_PROVISION_CHECKOUT_REPOSITORY_REJECTED", "reviewed checkout origin is not bsvalues/terragroq")
}

function inspectLocalCheckout(sourcePath, expected, fsApi = fs) {
  if (typeof sourcePath !== "string" || !path.posix.isAbsolute(sourcePath) || sourcePath.includes("\0")) {
    fail("AEGIS_PROVISION_CHECKOUT_SOURCE_INVALID", "reviewed checkout source must be one absolute local path")
  }
  const lexical = path.posix.resolve(sourcePath)
  const stats = fsApi.lstatSync(lexical)
  if (!stats.isDirectory() || stats.isSymbolicLink() || fsApi.realpathSync(lexical) !== lexical) {
    fail("AEGIS_PROVISION_CHECKOUT_SOURCE_INVALID", "reviewed checkout source must be a direct local directory")
  }
  validateLocalGitConfig(lexical, fsApi)
  const topLevel = runFixedGit(["-C", lexical, "rev-parse", "--show-toplevel"], "/")
  if (path.posix.resolve(topLevel) !== lexical) {
    fail("AEGIS_PROVISION_CHECKOUT_SOURCE_INVALID", "reviewed checkout source is not the Git top level")
  }
  const headCommit = runFixedGit(["-C", lexical, "rev-parse", "--verify", "HEAD^{commit}"], "/")
  if (headCommit !== expected.commit) {
    fail("AEGIS_PROVISION_CHECKOUT_HEAD_MISMATCH", "reviewed checkout HEAD differs from the authority-bound commit")
  }
  if (runFixedGit(["-C", lexical, "status", "--porcelain=v1", "--untracked-files=all"], "/") !== "") {
    fail("AEGIS_PROVISION_CHECKOUT_DIRTY", "reviewed checkout contains tracked or untracked changes")
  }
  const repository = canonicalRepository(runFixedGit(["-C", lexical, "remote", "get-url", "origin"], "/"))
  if (repository !== expected.repository) {
    fail("AEGIS_PROVISION_CHECKOUT_REPOSITORY_REJECTED", "reviewed checkout repository differs")
  }
  return Object.freeze({ sourcePath: lexical, repository, headCommit, clean: true, gitMetadata: true })
}

function hardenCheckoutTree(root, fsApi = fs) {
  const visit = (candidate) => {
    const stats = fsApi.lstatSync(candidate)
    if (stats.isSymbolicLink()) fail("AEGIS_PROVISION_CHECKOUT_SYMLINK_REJECTED", `${candidate} is a symbolic link`)
    fsApi.chownSync(candidate, 0, 0)
    fsApi.chmodSync(candidate, (stats.mode & 0o777) & ~0o022)
    if (stats.isDirectory()) {
      for (const name of fsApi.readdirSync(candidate)) visit(path.posix.join(candidate, name))
    }
  }
  visit(root)
}

function publishLocalCheckout({ sourcePath, destination, expected, fsApi = fs }) {
  const before = inspectLocalCheckout(sourcePath, expected, fsApi)
  if (existsNoFollow(fsApi, destination).exists) {
    fail("AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS", `${destination} already exists; checkout adoption is refused`)
  }
  const temporary = `${destination}.provisioning-${crypto.randomUUID()}.tmp`
  if (existsNoFollow(fsApi, temporary).exists) fail("AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS", "checkout staging path already exists")
  let stagingCreated = false
  let destinationClaimed = false
  try {
    runFixedGit(["clone", "--local", "--no-hardlinks", "--no-checkout", "--", before.sourcePath, temporary], "/")
    stagingCreated = true
    assertNoGitAlternates(temporary, fsApi)
    runFixedGit(["-C", temporary, "remote", "set-url", "origin", "https://github.com/bsvalues/terragroq.git"], "/")
    runFixedGit(["-C", temporary, "checkout", "--detach", "--no-recurse-submodules", expected.commit], "/")
    const verified = inspectLocalCheckout(temporary, expected, fsApi)
    const gitMetadata = fsApi.lstatSync(path.posix.join(temporary, ".git"))
    if (!gitMetadata.isDirectory() || gitMetadata.isSymbolicLink()) {
      fail("AEGIS_PROVISION_CHECKOUT_GIT_METADATA_MISSING", "published release must retain a direct .git directory")
    }
    hardenCheckoutTree(temporary, fsApi)
    inspectLocalCheckout(temporary, expected, fsApi)
    fsApi.mkdirSync(destination, { recursive: false, mode: 0o700 })
    destinationClaimed = true
    fsApi.chownSync(destination, 0, 0)
    fsApi.chmodSync(destination, 0o700)
    for (const name of fsApi.readdirSync(temporary).sort()) {
      const source = path.posix.join(temporary, name)
      const target = path.posix.join(destination, name)
      if (existsNoFollow(fsApi, target).exists) fail("AEGIS_PROVISION_OVERWRITE_REFUSED", `${target} already exists`)
      fsApi.renameSync(source, target)
    }
    fsApi.rmdirSync(temporary)
    stagingCreated = false
    inspectLocalCheckout(destination, expected, fsApi)
    const destinationDescriptor = fsApi.openSync(destination, flags(fsApi).O_RDONLY)
    try { fsApi.fsyncSync(destinationDescriptor) } finally { fsApi.closeSync(destinationDescriptor) }
    fsApi.chmodSync(destination, 0o755)
    fsyncParent(fsApi, destination)
    return { ...verified, destination, published: true }
  } finally {
    if (stagingCreated) {
      try { fsApi.rmSync(temporary, { recursive: true, force: false }) } catch {}
    }
    if (destinationClaimed && existsNoFollow(fsApi, destination).exists) {
      // A failed claimed destination remains mode 0700 as explicit ambiguous state.
    }
  }
}

const DEFAULT_CHECKOUT_API = Object.freeze({
  inspect: ({ sourcePath, expected, fsApi }) => inspectLocalCheckout(sourcePath, expected, fsApi),
  publish: ({ sourcePath, destination, expected, fsApi }) => publishLocalCheckout({ sourcePath, destination, expected, fsApi }),
})

function validateCheckoutInspection(candidate, sourcePath, expected) {
  const normalizedSource = path.posix.isAbsolute(sourcePath) ? path.posix.resolve(sourcePath) : path.resolve(sourcePath)
  if (!exactKeys(candidate, ["sourcePath", "repository", "headCommit", "clean", "gitMetadata"])
    || candidate.sourcePath !== normalizedSource
    || candidate.repository !== expected.repository
    || candidate.headCommit !== expected.commit
    || candidate.clean !== true
    || candidate.gitMetadata !== true) {
    fail("AEGIS_PROVISION_CHECKOUT_INSPECTION_INVALID", "reviewed checkout inspection does not prove the exact clean repository state")
  }
  return candidate
}

function buildLayout(manifest, closure, publicKey, account) {
  const releaseRoot = manifest.reviewedRelease.releaseRoot
  const preservedDirectories = manifest.existingRuntimeRoots.map(({ path: target, mode }) => ({
    path: target,
    ...account,
    mode: Number.parseInt(mode, 8),
  }))
  const directories = new Map([
    ["/opt/williamos", { uid: 0, gid: 0, mode: 0o755 }],
    ["/opt/williamos/releases", { uid: 0, gid: 0, mode: 0o755 }],
    ["/usr/local/libexec/williamos", { uid: 0, gid: 0, mode: 0o755 }],
    ["/etc/williamos", { uid: 0, gid: 0, mode: 0o755 }],
    ["/etc/williamos/fabric", { uid: 0, gid: 0, mode: 0o755 }],
    [manifest.privateRoots.request.path, { ...account, mode: 0o700 }],
    [manifest.privateRoots.ledger.path, { ...account, mode: 0o700 }],
    [manifest.privateRoots.nodeLease.path, { ...account, mode: 0o700 }],
    ["/home/williamos-fabric/.ssh", { ...account, mode: 0o700 }],
  ])
  const files = []
  files.push(
    { id: "bootstrap", path: EXPECTED_ROOT_ASSETS.bootstrap, bytes: closure.get(EXPECTED_CLOSURE[0]), uid: 0, gid: 0, mode: 0o555 },
    { id: "ssh-entrypoint", path: EXPECTED_ROOT_ASSETS["ssh-entrypoint"], bytes: closure.get(SSH_ENTRYPOINT_SOURCE), uid: 0, gid: 0, mode: 0o555 },
    { id: "replay-epoch-initializer", path: EXPECTED_ROOT_ASSETS["replay-epoch-initializer"], bytes: closure.get(REPLAY_INITIALIZER_SOURCE), uid: 0, gid: 0, mode: 0o555 },
    { id: "authorized-keys", path: manifest.invocationBoundary.authorizedKeysPath, bytes: Buffer.from(publicKey.authorizedRecord, "utf8"), ...account, mode: 0o600 },
  )
  return {
    releaseRoot,
    preservedDirectories,
    directories: [...directories.entries()].map(([directoryPath, metadata]) => ({ path: directoryPath, ...metadata })),
    files,
  }
}

function preflightLayout(fsApi, layout, journalPath, account) {
  const immutableBases = ["/", "/opt", "/usr", "/usr/local", "/usr/local/libexec", "/etc", "/var", "/var/lib", "/home"]
  for (const base of immutableBases) assertExistingDirectory(fsApi, base, { uid: 0, immutableRoot: true })
  assertExistingDirectory(fsApi, "/home/williamos-fabric", { uid: account.uid, gid: account.gid, immutableRoot: true })
  for (const item of layout.preservedDirectories) {
    assertExistingDirectory(fsApi, item.path, { uid: item.uid, gid: item.gid, mode: item.mode })
  }
  if (existsNoFollow(fsApi, journalPath).exists) fail("AEGIS_PROVISION_AUTHORITY_REPLAY", "authority mutation journal already exists")
  const release = existsNoFollow(fsApi, layout.releaseRoot)
  if (release.exists) {
    if (release.stats.isSymbolicLink()) fail("AEGIS_PROVISION_SYMLINK_REJECTED", `${layout.releaseRoot} is a symbolic link`)
    fail("AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS", `${layout.releaseRoot} is a package-owned checkout that already exists`)
  }

  const exclusiveDirectories = new Set([
    layout.releaseRoot,
    "/var/lib/williamos/fabric/standing-hash-requests",
    "/var/lib/williamos/fabric/standing-hash-ledger",
  ])
  const absentDirectories = []
  for (const item of layout.directories) {
    const observed = existsNoFollow(fsApi, item.path)
    if (!observed.exists) {
      absentDirectories.push(item)
      continue
    }
    if (observed.stats.isSymbolicLink()) fail("AEGIS_PROVISION_SYMLINK_REJECTED", `${item.path} is a symbolic link`)
    if (exclusiveDirectories.has(item.path)) {
      fail("AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS", `${item.path} is a package-owned directory that already exists`)
    }
    assertExistingDirectory(fsApi, item.path, { uid: item.uid, gid: item.gid, mode: item.mode })
  }
  for (const item of layout.files) {
    const observed = existsNoFollow(fsApi, item.path)
    if (!observed.exists) continue
    if (observed.stats.isSymbolicLink()) fail("AEGIS_PROVISION_SYMLINK_REJECTED", `${item.path} is a symbolic link`)
    fail("AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS", `${item.path} already exists; overwrite and adoption are refused`)
  }
  layout.directories = absentDirectories
}

function flags(fsApi) {
  return fsApi.constants ?? fs.constants
}

function writeAll(fsApi, descriptor, bytes) {
  let offset = 0
  while (offset < bytes.length) {
    const written = fsApi.writeSync(descriptor, bytes, offset, bytes.length - offset, null)
    if (!Number.isSafeInteger(written) || written <= 0) fail("AEGIS_PROVISION_WRITE_FAILED", "fixed file write made no progress")
    offset += written
  }
}

function assertSafeParentChain(fsApi, targetPath, allowedUid) {
  if (!path.posix.isAbsolute(targetPath)) {
    fail("AEGIS_PROVISION_SYMLINK_REJECTED", `${targetPath} is not an absolute POSIX path`)
  }
  let current = path.posix.dirname(targetPath)
  const candidates = []
  while (true) {
    candidates.push(current)
    if (current === "/") break
    const parent = path.posix.dirname(current)
    if (parent === current) fail("AEGIS_PROVISION_SYMLINK_REJECTED", `${targetPath} parent chain does not reach the filesystem root`)
    current = parent
  }
  for (const candidate of candidates.reverse()) {
    const stats = fsApi.lstatSync(candidate)
    if (!stats.isDirectory() || stats.isSymbolicLink() || fsApi.realpathSync(candidate) !== candidate
      || (stats.uid !== 0 && stats.uid !== allowedUid) || (stats.mode & 0o022) !== 0) {
      fail("AEGIS_PROVISION_SYMLINK_REJECTED", `${candidate} is not a direct, non-writable trusted parent directory`)
    }
  }
}

function fsyncParent(fsApi, targetPath) {
  const descriptor = fsApi.openSync(path.posix.dirname(targetPath), flags(fsApi).O_RDONLY)
  try { fsApi.fsyncSync(descriptor) } finally { fsApi.closeSync(descriptor) }
}

function createExclusiveFile(fsApi, item, { ownershipAlreadySet = false } = {}) {
  const temporaryPath = `${item.path}.provisioning-${crypto.randomUUID()}.tmp`
  let descriptor
  let temporaryCreated = false
  try {
    assertSafeParentChain(fsApi, item.path, item.uid)
    if (existsNoFollow(fsApi, item.path).exists) fail("AEGIS_PROVISION_OVERWRITE_REFUSED", `${item.path} already exists`)
    descriptor = fsApi.openSync(temporaryPath,
      flags(fsApi).O_WRONLY | flags(fsApi).O_CREAT | flags(fsApi).O_EXCL | (flags(fsApi).O_NOFOLLOW ?? 0), item.mode)
    temporaryCreated = true
    fsApi.fchmodSync(descriptor, item.mode)
    if (!ownershipAlreadySet) fsApi.fchownSync(descriptor, item.uid, item.gid)
    writeAll(fsApi, descriptor, item.bytes)
    fsApi.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
  try {
    fsApi.linkSync(temporaryPath, item.path)
    fsyncParent(fsApi, item.path)
    fsApi.unlinkSync(temporaryPath)
    temporaryCreated = false
    fsyncParent(fsApi, item.path)
  } finally {
    if (temporaryCreated) {
      try { fsApi.unlinkSync(temporaryPath) } catch {}
    }
  }
}

function createExclusiveDirectory(fsApi, item, { ownershipAlreadySet = false } = {}) {
  assertSafeParentChain(fsApi, item.path, item.uid)
  fsApi.mkdirSync(item.path, { recursive: false, mode: item.mode })
  if (!ownershipAlreadySet) fsApi.chownSync(item.path, item.uid, item.gid)
  fsApi.chmodSync(item.path, item.mode)
  fsyncParent(fsApi, item.path)
}

function assertPrivilegeTransitionAvailable(processApi) {
  const methods = ["geteuid", "getegid", "seteuid", "setegid", "getgroups", "setgroups"]
  if (methods.some((name) => typeof processApi[name] !== "function")
    || processApi.geteuid() !== 0 || processApi.getegid() !== 0) {
    fail("AEGIS_PROVISION_PRIVILEGE_DROP_UNAVAILABLE", "root applier cannot establish the bounded service identity")
  }
}

function runAsAccount(processApi, account, action) {
  assertPrivilegeTransitionAvailable(processApi)
  const originalGroups = processApi.getgroups()
  if (!Array.isArray(originalGroups) || originalGroups.some((group) => !Number.isSafeInteger(group) || group < 0)) {
    fail("AEGIS_PROVISION_PRIVILEGE_DROP_UNAVAILABLE", "root supplementary groups cannot be retained safely")
  }
  let groupChanged = false
  let transitionEstablished = false
  try {
    processApi.setgroups([account.gid])
    processApi.setegid(account.gid)
    groupChanged = true
    processApi.seteuid(account.uid)
    const boundedGroups = [...processApi.getgroups()].sort((left, right) => left - right)
    if (processApi.geteuid() !== account.uid || processApi.getegid() !== account.gid
      || !same(boundedGroups, [account.gid])) {
      fail("AEGIS_PROVISION_PRIVILEGE_DROP_FAILED", "effective service identity differs")
    }
    transitionEstablished = true
    return action()
  } catch (error) {
    if (!transitionEstablished && !String(error?.code ?? "").startsWith("AEGIS_PROVISION_")) {
      fail("AEGIS_PROVISION_PRIVILEGE_DROP_FAILED", "effective service identity transition failed")
    }
    throw error
  } finally {
    try {
      if (processApi.geteuid() !== 0) processApi.seteuid(0)
      if (groupChanged || processApi.getegid() !== 0) processApi.setegid(0)
      processApi.setgroups(originalGroups)
    } catch {
      fail("AEGIS_PROVISION_PRIVILEGE_RESTORE_FAILED", "root applier identity restoration failed")
    }
    const restoredGroups = [...processApi.getgroups()].sort((left, right) => left - right)
    const expectedGroups = [...originalGroups].sort((left, right) => left - right)
    if (processApi.geteuid() !== 0 || processApi.getegid() !== 0 || !same(restoredGroups, expectedGroups)) {
      fail("AEGIS_PROVISION_PRIVILEGE_RESTORE_FAILED", "root applier identity was not restored")
    }
  }
}

function createJournal(fsApi, journalPath, record) {
  let descriptor
  try {
    assertSafeParentChain(fsApi, journalPath, 0)
    descriptor = fsApi.openSync(journalPath,
      flags(fsApi).O_WRONLY | flags(fsApi).O_CREAT | flags(fsApi).O_EXCL | (flags(fsApi).O_NOFOLLOW ?? 0), 0o600)
    fsApi.fchmodSync(descriptor, 0o600)
    fsApi.fchownSync(descriptor, 0, 0)
    writeAll(fsApi, descriptor, Buffer.from(`${canonicalize(record)}\n`, "utf8"))
    fsApi.fsyncSync(descriptor)
  } catch (error) {
    if (error?.code === "EEXIST") fail("AEGIS_PROVISION_AUTHORITY_REPLAY", "authority mutation journal already exists")
    throw error
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
  fsyncParent(fsApi, journalPath)
}

function appendJournal(fsApi, journalPath, record) {
  let descriptor
  try {
    const before = fsApi.lstatSync(journalPath)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0
      || before.gid !== 0 || (before.mode & 0o7777) !== 0o600 || fsApi.realpathSync(journalPath) !== journalPath) {
      fail("AEGIS_PROVISION_JOURNAL_UNTRUSTED", "mutation journal ownership or mode changed")
    }
    descriptor = fsApi.openSync(journalPath, flags(fsApi).O_WRONLY | flags(fsApi).O_APPEND | (flags(fsApi).O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) {
      fail("AEGIS_PROVISION_JOURNAL_UNTRUSTED", "mutation journal changed during acquisition")
    }
    writeAll(fsApi, descriptor, Buffer.from(`${canonicalize(record)}\n`, "utf8"))
    fsApi.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function releaseManifest(manifest, deployedAt) {
  const fileSha256 = Object.fromEntries(manifest.reviewedRelease.runtimeClosurePaths.map((relative) => {
    const binding = manifest.bindings.find(({ path: bindingPath }) => bindingPath === relative)
    return [relative, binding.sha256]
  }))
  const body = {
    schema_version: manifest.reviewedRelease.manifestSchemaVersion,
    repository: manifest.trustedMain.repository,
    trusted_ref: manifest.trustedMain.ref,
    head_commit: manifest.trustedMain.commit,
    release_root: manifest.reviewedRelease.releaseRoot,
    reviewed: true,
    deployed_at: deployedAt,
    file_sha256: fileSha256,
  }
  return { ...body, release_manifest_sha256: canonicalSha256(body) }
}

function evidenceBase(manifest, authority, publicKey, mode, journalPath, planned) {
  return {
    schema_version: "1.0-aegis-standing-hash-root-provisioning-evidence",
    status: mode === "apply" ? "APPLY_PENDING" : "DRY_RUN",
    mode: mode.toUpperCase(),
    package_id: manifest.packageId,
    manifest_sha256: canonicalSha256(manifest),
    trusted_main_commit: manifest.trustedMain.commit,
    authority_id: authority.authorityId,
    authority_consumed: false,
    mutation_journal: mode === "apply" ? journalPath : null,
    dedicated_transport_key_fingerprint: publicKey.fingerprint,
    dedicated_transport_public_key_sha256: publicKey.fileSha256,
    preserved_runtime_roots: manifest.existingRuntimeRoots.map(({ path: target, owner, group, mode }) => ({
      path: target,
      owner,
      group,
      mode,
      preserved: true,
      mutated: false,
    })),
    planned_mutations: planned,
    completed_mutations: [],
    deferred_mutations: [
      { id: "CREATE_DEDICATED_HERMES_TRANSPORT_KEY", status: "VERIFIED_HERMES_GENERATION_EVIDENCE" },
      { id: "ESTABLISH_REPLAY_JOURNAL_EPOCH", status: "REQUIRED_NON_ROOT_STEP_NOT_RUN" },
    ],
    private_key_generated: false,
    private_key_inspected: false,
    replay_epoch_initialized: false,
    workload_executed: false,
    scheduler_activated: false,
    network_accessed: false,
    next_non_root_step: {
      status: "REQUIRED_NOT_RUN",
      reason_code: "AEGIS_REPLAY_EPOCH_INITIALIZATION_REQUIRED",
      account: "williamos-fabric",
      action: "INITIALIZE_REPLAY_EPOCH",
      executable: "/usr/bin/node",
      arguments: [EXPECTED_ROOT_ASSETS["replay-epoch-initializer"]],
    },
  }
}

export function provisionAegisStandingHashPrerequisites({
  authority,
  publicKeyBytes,
  keyGenerationEvidence,
  mode = "dry-run",
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  fsApi = fs,
  processApi = process,
  hostname = os.hostname,
  clock = () => new Date().toISOString(),
  machineIdentitySha256,
  accountIdentity,
  reviewedCheckoutSourcePath = repoRoot,
  checkoutApi = DEFAULT_CHECKOUT_API,
  packageClosure,
} = {}) {
  if (mode !== "dry-run" && mode !== "apply") fail("AEGIS_PROVISION_MODE_INVALID", "mode must be dry-run or apply")
  const manifestBytes = readStableFile(fsApi, confinedSource(repoRoot, MANIFEST_PATH))
  let manifest
  try { manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8"))) } catch (error) {
    if (error?.code) throw error
    fail("AEGIS_PROVISION_PACKAGE_INVALID", "manifest is not valid JSON")
  }
  verifyMachine(fsApi, processApi, hostname, manifest, machineIdentitySha256)
  const account = accountIdentity ?? resolveAccount(fsApi, manifest.identity.account)
  if (!Number.isSafeInteger(account?.uid) || account.uid <= 0
    || !Number.isSafeInteger(account?.gid) || account.gid <= 0
    || (account.home !== undefined && account.home !== "/home/williamos-fabric")) {
    fail("AEGIS_PROVISION_ACCOUNT_INVALID", "injected williamos-fabric account identity differs")
  }
  const closure = packageClosure ?? sourceClosure(repoRoot, fsApi, manifest)
  const keyBytes = Buffer.isBuffer(publicKeyBytes) ? publicKeyBytes : Buffer.from(publicKeyBytes ?? "", "utf8")
  const publicKey = parsePublicKey(keyBytes)
  const keyGeneration = validateHermesKeyGenerationEvidence(manifest, keyGenerationEvidence, publicKey)
  const checkoutExpected = { repository: manifest.trustedMain.repository, commit: manifest.trustedMain.commit }
  const checkout = validateCheckoutInspection(
    checkoutApi.inspect({ sourcePath: reviewedCheckoutSourcePath, expected: checkoutExpected, fsApi }),
    reviewedCheckoutSourcePath,
    checkoutExpected,
  )
  const now = clock()
  validateAuthority(manifest, authority, publicKey, keyGeneration, checkout, now)
  const layout = buildLayout(manifest, closure, publicKey, account)
  const journalPath = `${JOURNAL_PREFIX}${authority.authorityId}.mutation-journal.jsonl`
  const release = releaseManifest(manifest, now)
  layout.files.push({
    id: "release-manifest",
    path: manifest.reviewedRelease.releaseManifestPath,
    bytes: Buffer.from(`${canonicalize(release)}\n`, "utf8"),
    uid: 0,
    gid: 0,
    mode: 0o444,
  })
  preflightLayout(fsApi, layout, journalPath, account)
  const applyAt = mode === "apply" ? clock() : now
  validateAuthority(manifest, authority, publicKey, keyGeneration, checkout, applyAt)
  const releaseFile = layout.files.find(({ id }) => id === "release-manifest")
  releaseFile.bytes = Buffer.from(`${canonicalize(releaseManifest(manifest, applyAt))}\n`, "utf8")
  const planned = [
    ...layout.directories.map(({ path: target }) => ({ type: "CREATE_DIRECTORY", path: target })),
    { type: "INSTALL_REVIEWED_CHECKOUT", path: layout.releaseRoot, source_path: checkout.sourcePath, commit: checkout.headCommit },
    ...layout.files.map(({ id, path: target }) => ({ type: "INSTALL_FILE", id, path: target })),
  ]
  const evidence = evidenceBase(manifest, authority, publicKey, mode, journalPath, planned)
  if (mode === "dry-run") return evidence
  assertPrivilegeTransitionAvailable(processApi)
  runAsAccount(processApi, account, () => undefined)

  const consumed = {
    schema_version: "1.0-aegis-standing-hash-mutation-journal",
    record_type: "AUTHORITY_CONSUMED",
    sequence: 0,
    authority_id: authority.authorityId,
    authority_sha256: canonicalSha256(authority),
    package_id: manifest.packageId,
    manifest_sha256: canonicalSha256(manifest),
    consumed_at: applyAt,
    planned_mutations: planned,
  }
  createJournal(fsApi, journalPath, consumed)
  evidence.authority_consumed = true

  const completed = []
  let sequence = 1
  const mutate = (description, action) => {
    appendJournal(fsApi, journalPath, { record_type: "MUTATION_STARTED", sequence: sequence++, ...description })
    action()
    completed.push(description)
    appendJournal(fsApi, journalPath, { record_type: "MUTATION_COMPLETED", sequence: sequence++, ...description })
  }
  const mutateOwned = (item, action) => {
    const accountOwned = item.uid === account.uid && item.gid === account.gid
    return accountOwned
      ? runAsAccount(processApi, account, () => action({ ownershipAlreadySet: true }))
      : action({ ownershipAlreadySet: false })
  }
  try {
    for (const directory of layout.directories) {
      mutate({ type: "CREATE_DIRECTORY", path: directory.path }, () => mutateOwned(
        directory,
        (options) => createExclusiveDirectory(fsApi, directory, options),
      ))
    }
    mutate({ type: "INSTALL_REVIEWED_CHECKOUT", path: layout.releaseRoot, source_path: checkout.sourcePath, commit: checkout.headCommit }, () => {
      checkoutApi.publish({ sourcePath: checkout.sourcePath, destination: layout.releaseRoot, expected: checkoutExpected, fsApi })
    })
    for (const file of layout.files) {
      mutate({ type: "INSTALL_FILE", id: file.id, path: file.path, sha256: sha256(file.bytes) }, () => mutateOwned(
        file,
        (options) => createExclusiveFile(fsApi, file, options),
      ))
    }
    appendJournal(fsApi, journalPath, {
      record_type: "APPLY_COMPLETE",
      sequence: sequence++,
      completed_at: clock(),
      completed_mutation_count: completed.length,
      replay_epoch_initialized: false,
      workload_executed: false,
      scheduler_activated: false,
    })
  } catch (error) {
    try {
      appendJournal(fsApi, journalPath, {
        record_type: "APPLY_FAILED_PARTIAL_STATE",
        sequence,
        failed_at: clock(),
        completed_mutation_count: completed.length,
        failure_code: error?.code ?? "AEGIS_PROVISION_MUTATION_FAILED",
      })
    } catch (journalError) {
      const evidenceFailure = new Error(
        `AEGIS_PROVISION_EVIDENCE_WRITE_FAILED: partial-state evidence could not be retained after ${error?.code ?? "AEGIS_PROVISION_MUTATION_FAILED"}`,
      )
      evidenceFailure.code = "AEGIS_PROVISION_EVIDENCE_WRITE_FAILED"
      evidenceFailure.causeCode = journalError?.code ?? "AEGIS_PROVISION_JOURNAL_WRITE_FAILED"
      evidenceFailure.originalFailureCode = error?.code ?? "AEGIS_PROVISION_MUTATION_FAILED"
      evidenceFailure.authorityConsumed = true
      evidenceFailure.journalPath = journalPath
      throw evidenceFailure
    }
    const partial = new Error(`AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS: authority consumed; mutation stopped after ${completed.length} completed operations`)
    partial.code = "AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS"
    partial.authorityConsumed = true
    partial.journalPath = journalPath
    throw partial
  }
  return { ...evidence, status: "APPLIED", completed_mutations: completed }
}

export const applyAegisStandingHashPrerequisites = provisionAegisStandingHashPrerequisites
export const executeAegisStandingHashProvisioning = provisionAegisStandingHashPrerequisites

function parseCli(argv) {
  const result = { mode: null, authorityPath: null, publicKeyPath: null, keyEvidencePath: null, reviewedCheckoutSourcePath: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--dry-run" || argument === "--apply") {
      if (result.mode !== null) fail("AEGIS_PROVISION_USAGE_INVALID", "choose exactly one of --dry-run or --apply")
      result.mode = argument.slice(2)
      continue
    }
    if (argument === "--authority" || argument === "--public-key" || argument === "--key-evidence" || argument === "--reviewed-checkout") {
      const value = argv[++index]
      const field = argument === "--authority" ? "authorityPath"
        : argument === "--public-key" ? "publicKeyPath"
          : argument === "--key-evidence" ? "keyEvidencePath" : "reviewedCheckoutSourcePath"
      if (!value || result[field] !== null) fail("AEGIS_PROVISION_USAGE_INVALID", `${argument} requires one path exactly once`)
      result[field] = path.resolve(value)
      continue
    }
    fail("AEGIS_PROVISION_USAGE_INVALID", `unknown argument ${argument}`)
  }
  if (!result.mode || !result.authorityPath || !result.publicKeyPath || !result.keyEvidencePath || !result.reviewedCheckoutSourcePath) {
    fail("AEGIS_PROVISION_USAGE_INVALID", "use --authority <json> --public-key <pub> --key-evidence <json> --reviewed-checkout <path> and exactly one mode")
  }
  if (path.extname(result.publicKeyPath) !== ".pub") {
    fail("AEGIS_PROVISION_PUBLIC_KEY_INVALID", "--public-key must name a dedicated .pub file; non-public key paths are never read")
  }
  return result
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const fsApi = dependencies.fsApi ?? fs
  try {
    const cli = parseCli(argv)
    const authorityBytes = readStableFile(fsApi, cli.authorityPath, { maximumBytes: 64 * 1024 })
    const publicKeyBytes = readStableFile(fsApi, cli.publicKeyPath, { maximumBytes: 16 * 1024 })
    const keyEvidenceBytes = readStableFile(fsApi, cli.keyEvidencePath, { maximumBytes: 64 * 1024 })
    let authority
    let keyGenerationEvidence
    try { authority = JSON.parse(authorityBytes.toString("utf8")) } catch {
      fail("AEGIS_PROVISION_AUTHORITY_INVALID", "authority file is not valid JSON")
    }
    try { keyGenerationEvidence = JSON.parse(keyEvidenceBytes.toString("utf8")) } catch {
      fail("AEGIS_PROVISION_KEY_GENERATION_EVIDENCE_INVALID", "key generation evidence is not valid JSON")
    }
    const evidence = provisionAegisStandingHashPrerequisites({
      ...dependencies,
      fsApi,
      authority,
      publicKeyBytes,
      keyGenerationEvidence,
      reviewedCheckoutSourcePath: cli.reviewedCheckoutSourcePath,
      mode: cli.mode,
    })
    ;(dependencies.stdout ?? process.stdout).write(`${canonicalize(evidence)}\n`)
    return 0
  } catch (error) {
    ;(dependencies.stderr ?? process.stderr).write(`${canonicalize({
      schema_version: "1.0-aegis-standing-hash-root-provisioning-error",
      status: "FAILED_CLOSED",
      code: error?.code ?? "AEGIS_PROVISION_REJECTED",
      detail: String(error?.message ?? error).slice(0, 512),
      authority_consumed: error?.authorityConsumed === true,
      mutation_journal: error?.journalPath ?? null,
      private_key_generated: false,
      private_key_inspected: false,
      replay_epoch_initialized: false,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    })}\n`)
    return error?.code === "AEGIS_PROVISION_USAGE_INVALID" ? 64 : 2
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) process.exitCode = main()
