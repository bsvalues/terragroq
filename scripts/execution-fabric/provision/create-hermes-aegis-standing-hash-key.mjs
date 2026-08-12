#!/usr/bin/node
import childProcess from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"

export const MANIFEST_PATH = "config/execution-fabric/aegis-standing-hash-provisioning-package.v1.json"
export const PACKAGE_ID = "aegis-standing-hash-provisioning-issue-595-v1"
export const GENERATION_HOST = "hermes"
export const GENERATION_ACCOUNT = "bs"
export const SOURCE_ADDRESS = "192.168.1.154"
export const KEY_ALGORITHM = "ssh-ed25519"
export const PRIVATE_KEY_PATH = "C:\\Users\\bs\\.ssh\\id_ed25519_williamos_aegis_standing_hash"
export const PUBLIC_KEY_PATH = `${PRIVATE_KEY_PATH}.pub`
export const EVIDENCE_PATH = `${PRIVATE_KEY_PATH}.generation-evidence.json`
export const JOURNAL_PATH = `${PRIVATE_KEY_PATH}.generation-journal.jsonl`
export const RECOVERY_CLAIM_PATH = `${JOURNAL_PATH}.recovery-claim.json`
export const SSH_KEYGEN_PATH = "C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe"
export const ICACLS_PATH = "C:\\Windows\\System32\\icacls.exe"
export const WHOAMI_PATH = "C:\\Windows\\System32\\whoami.exe"
export const KEY_COMMENT = "williamos-aegis-standing-hash@hermes"

const AUTHORITY_KEYS = Object.freeze([
  "schemaVersion", "authorityId", "purpose", "packageId", "manifestSha256",
  "generationHost", "generationAccount", "sourceAddress", "algorithm",
  "privateKeyPath", "publicKeyPath", "evidencePath", "issuedAt", "expiresAt",
  "singleUse", "consumed", "recovery",
])
export const AUTHORITY_PURPOSE = "GENERATE_DEDICATED_HERMES_AEGIS_STANDING_HASH_TRANSPORT_KEY"
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[a-f0-9]{64}$/
const SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/
const MAX_AUTHORITY_AGE_MS = 15 * 60 * 1000
const MAX_FILE_BYTES = 1024 * 1024
const RECOVERABLE_LEGACY_MANIFEST_SHA256 = "614a0723adae356aa729966b29aeae7dcd5859c78ab99beda1dc256c6dd0e9fd"

export const canonicalize = canonicalizeJcs

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
export const canonicalSha256 = (value) => sha256(Buffer.from(canonicalize(value), "utf8"))
const same = (left, right) => canonicalize(left) === canonicalize(right)
const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort())

function fail(code, detail, properties = {}) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  Object.assign(error, properties)
  throw error
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function flags(fsApi) {
  return fsApi.constants ?? fs.constants
}

function writeAll(fsApi, descriptor, bytes) {
  let offset = 0
  while (offset < bytes.length) {
    const written = fsApi.writeSync(descriptor, bytes, offset, bytes.length - offset, null)
    if (!Number.isSafeInteger(written) || written <= 0) {
      fail("HERMES_KEY_WRITE_FAILED", "file write made no progress")
    }
    offset += written
  }
}

function existsNoFollow(fsApi, target) {
  try {
    return { exists: true, stats: fsApi.lstatSync(target) }
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, stats: null }
    throw error
  }
}

function assertDirectFile(fsApi, target, code) {
  const stats = fsApi.lstatSync(target)
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
    || path.win32.normalize(fsApi.realpathSync(target)).toLowerCase() !== path.win32.normalize(target).toLowerCase()) {
    fail(code, `${target} must be a direct single-link file`)
  }
  return stats
}

function readStableFile(fsApi, target, maximumBytes = MAX_FILE_BYTES) {
  let descriptor
  try {
    const before = assertDirectFile(fsApi, target, "HERMES_KEY_SOURCE_UNTRUSTED")
    if (before.size > maximumBytes) fail("HERMES_KEY_SOURCE_UNTRUSTED", `${target} exceeds the size limit`)
    descriptor = fsApi.openSync(target, flags(fsApi).O_RDONLY | (flags(fsApi).O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
      fail("HERMES_KEY_SOURCE_CHANGED", `${target} changed during acquisition`)
    }
    return Buffer.from(fsApi.readFileSync(descriptor))
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function assertTrustedSshDirectory(fsApi) {
  const sshDirectory = path.win32.dirname(PRIVATE_KEY_PATH)
  const stats = fsApi.lstatSync(sshDirectory)
  if (!stats.isDirectory() || stats.isSymbolicLink()
    || path.win32.normalize(fsApi.realpathSync(sshDirectory)).toLowerCase() !== sshDirectory.toLowerCase()) {
    fail("HERMES_KEY_SSH_DIRECTORY_UNTRUSTED", "the fixed existing .ssh directory must be direct")
  }
}

function assertAbsentTargets(fsApi) {
  for (const target of [PRIVATE_KEY_PATH, PUBLIC_KEY_PATH, EVIDENCE_PATH]) {
    const observed = existsNoFollow(fsApi, target)
    if (!observed.exists) continue
    if (observed.stats.isSymbolicLink()) {
      fail("HERMES_KEY_SYMLINK_REJECTED", `${target} is a symbolic link`)
    }
    fail("HERMES_KEY_EXISTING_TARGET_REJECTED", `${target} already exists; reuse and overwrite are refused`)
  }
}

function assertFixedExecutable(fsApi, target) {
  const stats = fsApi.lstatSync(target)
  if (!stats.isFile() || stats.isSymbolicLink() || !Number.isSafeInteger(stats.nlink) || stats.nlink < 1
    || path.win32.normalize(fsApi.realpathSync(target)).toLowerCase() !== path.win32.normalize(target).toLowerCase()) {
    fail("HERMES_KEY_EXECUTABLE_UNTRUSTED", `${target} must be the fixed direct system executable`)
  }
}

function validateManifest(manifest) {
  const invocation = manifest?.invocationBoundary
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.schemaVersion !== 1 || manifest.packageId !== PACKAGE_ID
    || manifest.status !== "PACKAGE_ONLY_NOT_APPLIED"
    || manifest.applyAuthorized !== false || manifest.executionAuthorized !== false
    || invocation?.sourceHost !== GENERATION_HOST || invocation?.sourceAddress !== SOURCE_ADDRESS
    || invocation?.dedicatedTransportKeyGenerationHost !== GENERATION_HOST
    || invocation?.dedicatedTransportKeyAlgorithm !== KEY_ALGORITHM
    || invocation?.dedicatedTransportPrivateKeyPath !== PRIVATE_KEY_PATH
    || invocation?.dedicatedTransportPublicKeyPath !== PUBLIC_KEY_PATH
    || invocation?.dedicatedTransportKeyGenerationEvidencePath !== EVIDENCE_PATH
    || invocation?.dedicatedTransportKeyGenerationAuthorityRequired !== true
    || invocation?.dedicatedTransportPrivateKeyLocalOnly !== true
    || invocation?.dedicatedTransportPrivateKeyInspectionAllowed !== false
    || invocation?.existingKeyReuseAllowed !== false
    || manifest.apply?.authorityMaximumAgeSeconds !== 900
    || manifest.hermesPrerequisiteMutations?.length !== 1
    || manifest.hermesPrerequisiteMutations[0]?.id !== "CREATE_DEDICATED_HERMES_TRANSPORT_KEY"
    || manifest.hermesPrerequisiteMutations[0]?.separateSingleUseAuthorityRequired !== true) {
    fail("HERMES_KEY_PACKAGE_INVALID", "manifest differs from the dedicated Hermes key-generation contract")
  }
  return manifest
}

export function validateHermesKeyGenerationAuthority(manifest, authority, now, recovery = { recoverable: false }) {
  if (!exactKeys(authority, AUTHORITY_KEYS) || authority.schemaVersion !== 1
    || !GUID.test(authority.authorityId ?? "") || authority.purpose !== AUTHORITY_PURPOSE
    || authority.singleUse !== true) {
    fail("HERMES_KEY_AUTHORITY_INVALID", "authority JSON shape differs from the exact single-use contract")
  }
  if (authority.consumed !== false) fail("HERMES_KEY_AUTHORITY_REPLAY", "authority is already marked consumed")
  const expected = {
    packageId: manifest.packageId,
    manifestSha256: canonicalSha256(manifest),
    generationHost: GENERATION_HOST,
    generationAccount: GENERATION_ACCOUNT,
    sourceAddress: SOURCE_ADDRESS,
    algorithm: KEY_ALGORITHM,
    privateKeyPath: PRIVATE_KEY_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    evidencePath: EVIDENCE_PATH,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (authority[key] !== value) fail("HERMES_KEY_AUTHORITY_SCOPE_MISMATCH", `authority ${key} differs`)
  }
  if (recovery.recoverable) {
    if (!exactKeys(authority.recovery, ["priorAuthorityId", "priorAuthoritySha256", "terminalJournalSha256"])
      || authority.recovery.priorAuthorityId !== recovery.priorAuthorityId
      || authority.recovery.priorAuthoritySha256 !== recovery.priorAuthoritySha256
      || authority.recovery.terminalJournalSha256 !== recovery.terminalJournalSha256) {
      fail("HERMES_KEY_AUTHORITY_SCOPE_MISMATCH", "authority does not bind the exact retained recovery journal")
    }
  } else if (authority.recovery !== null) {
    fail("HERMES_KEY_AUTHORITY_SCOPE_MISMATCH", "initial authority must not claim a recovery journal")
  }
  const issued = Date.parse(authority.issuedAt)
  const expires = Date.parse(authority.expiresAt)
  const current = Date.parse(now)
  if (!canonicalTimestamp(authority.issuedAt) || !canonicalTimestamp(authority.expiresAt)
    || !canonicalTimestamp(now) || ![issued, expires, current].every(Number.isFinite)
    || expires <= issued || expires - issued > MAX_AUTHORITY_AGE_MS || current < issued || current >= expires) {
    fail("HERMES_KEY_AUTHORITY_EXPIRED", "authority is outside its exact bounded validity window")
  }
  if (recovery.recoverable && issued <= Date.parse(recovery.failedAt)) {
    fail("HERMES_KEY_AUTHORITY_SCOPE_MISMATCH", "recovery authority must be issued after the retained failure")
  }
  return authority
}

function verifyHermesIdentity(processApi, hostname, userInfo) {
  if (processApi.platform !== "win32") fail("HERMES_KEY_WINDOWS_REQUIRED", "key generation is Windows-only")
  if (String(hostname()).toLowerCase() !== GENERATION_HOST) {
    fail("HERMES_KEY_HOST_REJECTED", "exact hermes hostname is required")
  }
  const identity = userInfo()
  if (String(identity?.username).toLowerCase() !== GENERATION_ACCOUNT
    || path.win32.normalize(identity?.homedir ?? "").toLowerCase() !== "c:\\users\\bs") {
    fail("HERMES_KEY_ACCOUNT_REJECTED", "exact bs account and profile are required")
  }
}

function verifyNotElevated(isElevated) {
  if (isElevated === true) fail("HERMES_KEY_ELEVATION_REJECTED", "elevated execution is forbidden")
}

function appendJournal(fsApi, record) {
  let descriptor
  try {
    const before = assertDirectFile(fsApi, JOURNAL_PATH, "HERMES_KEY_JOURNAL_UNTRUSTED")
    descriptor = fsApi.openSync(JOURNAL_PATH, flags(fsApi).O_WRONLY | flags(fsApi).O_APPEND | (flags(fsApi).O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) {
      fail("HERMES_KEY_JOURNAL_UNTRUSTED", "generation journal changed during acquisition")
    }
    writeAll(fsApi, descriptor, Buffer.from(`${canonicalize(record)}\n`, "utf8"))
    fsApi.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function inspectRecoverableJournal(fsApi, manifestSha256) {
  if (!existsNoFollow(fsApi, JOURNAL_PATH).exists) {
    if (existsNoFollow(fsApi, RECOVERY_CLAIM_PATH).exists) {
      fail("HERMES_KEY_AUTHORITY_REPLAY", "recovery claim exists without a retained generation journal")
    }
    return Object.freeze({
      recoverable: false,
      nextSequence: 0,
      priorAuthorityId: null,
      priorAuthoritySha256: null,
      terminalJournalSha256: null,
      failedAt: null,
    })
  }
  if (existsNoFollow(fsApi, RECOVERY_CLAIM_PATH).exists) {
    fail("HERMES_KEY_AUTHORITY_REPLAY", "retained recovery claim already fences this journal")
  }
  let records
  let bytes
  try {
    bytes = readStableFile(fsApi, JOURNAL_PATH, 64 * 1024)
    const text = bytes.toString("utf8")
    if (!text.endsWith("\n") || text.endsWith("\n\n") || text.includes("\r")) {
      fail("HERMES_KEY_AUTHORITY_REPLAY", "retained generation journal encoding is not canonical")
    }
    records = text.slice(0, -1).split("\n").map((line) => {
      const parsed = JSON.parse(line)
      if (line !== canonicalize(parsed)) {
        fail("HERMES_KEY_AUTHORITY_REPLAY", "retained generation journal record is not canonical")
      }
      return parsed
    })
  } catch (error) {
    if (error?.code) throw error
    fail("HERMES_KEY_AUTHORITY_REPLAY", "retained generation journal is not canonical JSONL")
  }
  const [consumed, started, failed] = records
  const exactCleanFailure = records.length === 3
    && exactKeys(consumed, [
      "schemaVersion", "recordType", "sequence", "authorityId", "authoritySha256", "packageId",
      "manifestSha256", "consumedAt", "privateKeyPath", "publicKeyPath", "evidencePath",
      "parentDirectoryDurability", "recoveryFence",
    ])
    && consumed.schemaVersion === "1.0-hermes-aegis-standing-hash-key-generation-journal"
    && consumed.recordType === "AUTHORITY_CONSUMED" && consumed.sequence === 0
    && GUID.test(consumed.authorityId ?? "") && SHA256.test(consumed.authoritySha256 ?? "")
    && consumed.packageId === PACKAGE_ID
    && [manifestSha256, RECOVERABLE_LEGACY_MANIFEST_SHA256].includes(consumed.manifestSha256)
    && canonicalTimestamp(consumed.consumedAt)
    && consumed.privateKeyPath === PRIVATE_KEY_PATH && consumed.publicKeyPath === PUBLIC_KEY_PATH
    && consumed.evidencePath === EVIDENCE_PATH
    && consumed.parentDirectoryDurability === "WINDOWS_DIRECTORY_FSYNC_UNAVAILABLE"
    && consumed.recoveryFence === "RETAINED_ARTIFACT_OR_JOURNAL_REJECTS_REUSE"
    && exactKeys(started, ["recordType", "sequence", "startedAt"])
    && started.recordType === "KEY_GENERATION_STARTED" && started.sequence === 1
    && canonicalTimestamp(started.startedAt)
    && exactKeys(failed, [
      "recordType", "sequence", "failedAt", "failureCode", "privateKeyExists", "publicKeyExists",
      "evidenceExists", "privateKeyInspected", "automaticCleanupPerformed",
    ])
    && failed.recordType === "GENERATION_FAILED_PARTIAL_STATE" && failed.sequence === 2
    && canonicalTimestamp(failed.failedAt) && failed.failureCode === "HERMES_KEY_GENERATION_FAILED"
    && failed.privateKeyExists === false && failed.publicKeyExists === false && failed.evidenceExists === false
    && failed.privateKeyInspected === false && failed.automaticCleanupPerformed === false
    && Date.parse(consumed.consumedAt) <= Date.parse(started.startedAt)
    && Date.parse(started.startedAt) <= Date.parse(failed.failedAt)
  if (!exactCleanFailure) {
    fail("HERMES_KEY_AUTHORITY_REPLAY", "retained generation journal is not the exact recoverable no-artifact failure")
  }
  return Object.freeze({
    recoverable: true,
    nextSequence: 3,
    priorAuthorityId: consumed.authorityId,
    priorAuthoritySha256: consumed.authoritySha256,
    terminalJournalSha256: sha256(bytes),
    failedAt: failed.failedAt,
  })
}

function claimRecovery(fsApi, authority, manifestSha256, consumedAt, recovery) {
  const claim = {
    schemaVersion: "1.0-hermes-aegis-standing-hash-recovery-claim",
    authorityId: authority.authorityId,
    authoritySha256: canonicalSha256(authority),
    priorAuthorityId: recovery.priorAuthorityId,
    priorAuthoritySha256: recovery.priorAuthoritySha256,
    terminalJournalSha256: recovery.terminalJournalSha256,
    manifestSha256,
    claimedAt: consumedAt,
    singleUse: true,
    privateKeyInspected: false,
  }
  let descriptor
  let claimCreated = false
  try {
    descriptor = fsApi.openSync(RECOVERY_CLAIM_PATH,
      flags(fsApi).O_WRONLY | flags(fsApi).O_CREAT | flags(fsApi).O_EXCL | (flags(fsApi).O_NOFOLLOW ?? 0), 0o600)
    claimCreated = true
    writeAll(fsApi, descriptor, Buffer.from(`${canonicalize(claim)}\n`, "utf8"))
    fsApi.fsyncSync(descriptor)
  } catch (error) {
    if (error?.code === "EEXIST") fail("HERMES_KEY_AUTHORITY_REPLAY", "exclusive recovery claim already exists")
    if (claimCreated) {
      error.authorityConsumed = true
      error.recoveryClaimPath = RECOVERY_CLAIM_PATH
    }
    throw error
  } finally {
    if (descriptor !== undefined) {
      try {
        fsApi.closeSync(descriptor)
      } catch (error) {
        if (claimCreated) {
          error.authorityConsumed = true
          error.recoveryClaimPath = RECOVERY_CLAIM_PATH
        }
        throw error
      }
    }
  }
}

function consumeAuthority(fsApi, authority, manifestSha256, consumedAt, recovery) {
  if (recovery.recoverable) {
    if (authority.authorityId === recovery.priorAuthorityId) {
      fail("HERMES_KEY_AUTHORITY_REPLAY", "recovery requires a distinct fresh authority")
    }
    claimRecovery(fsApi, authority, manifestSha256, consumedAt, recovery)
    try {
      appendJournal(fsApi, {
        recordType: "RECOVERY_AUTHORITY_CONSUMED",
        sequence: recovery.nextSequence,
        authorityId: authority.authorityId,
        authoritySha256: canonicalSha256(authority),
        priorAuthorityId: recovery.priorAuthorityId,
        priorAuthoritySha256: recovery.priorAuthoritySha256,
        packageId: authority.packageId,
        manifestSha256,
        consumedAt,
        recoveryBasis: "EXACT_NO_ARTIFACT_KEYGEN_FAILURE",
        privateKeyInspected: false,
      })
    } catch (error) {
      error.authorityConsumed = true
      error.recoveryClaimPath = RECOVERY_CLAIM_PATH
      throw error
    }
    return recovery.nextSequence + 1
  }
  const record = {
    schemaVersion: "1.0-hermes-aegis-standing-hash-key-generation-journal",
    recordType: "AUTHORITY_CONSUMED",
    sequence: 0,
    authorityId: authority.authorityId,
    authoritySha256: canonicalSha256(authority),
    packageId: authority.packageId,
    manifestSha256,
    consumedAt,
    privateKeyPath: PRIVATE_KEY_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    evidencePath: EVIDENCE_PATH,
    parentDirectoryDurability: "WINDOWS_DIRECTORY_FSYNC_UNAVAILABLE",
    recoveryFence: "RETAINED_ARTIFACT_OR_JOURNAL_REJECTS_REUSE",
  }
  let descriptor
  try {
    // Node on Windows cannot fsync a directory. The file-fsynced journal plus
    // no-overwrite fences on every retained artifact make crash recovery fail closed.
    descriptor = fsApi.openSync(JOURNAL_PATH,
      flags(fsApi).O_WRONLY | flags(fsApi).O_CREAT | flags(fsApi).O_EXCL | (flags(fsApi).O_NOFOLLOW ?? 0), 0o600)
    writeAll(fsApi, descriptor, Buffer.from(`${canonicalize(record)}\n`, "utf8"))
    fsApi.fsyncSync(descriptor)
  } catch (error) {
    if (error?.code === "EEXIST") fail("HERMES_KEY_AUTHORITY_REPLAY", "exclusive generation journal already exists")
    throw error
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
  return 1
}

function sanitizedEnvironment() {
  return Object.freeze({
    SystemRoot: "C:\\Windows",
    WINDIR: "C:\\Windows",
    SystemDrive: "C:",
    COMSPEC: "C:\\Windows\\System32\\cmd.exe",
    OS: "Windows_NT",
    PATH: "C:\\Windows\\System32\\OpenSSH;C:\\Windows\\System32",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    USERNAME: GENERATION_ACCOUNT,
    USERDOMAIN: "HERMES",
    USERPROFILE: "C:\\Users\\bs",
    HOMEDRIVE: "C:",
    HOMEPATH: "\\Users\\bs",
    HOME: "C:\\Users\\bs",
    LOCALAPPDATA: "C:\\Users\\bs\\AppData\\Local",
    APPDATA: "C:\\Users\\bs\\AppData\\Roaming",
    PROGRAMDATA: "C:\\ProgramData",
    TEMP: "C:\\Users\\bs\\AppData\\Local\\Temp",
    TMP: "C:\\Users\\bs\\AppData\\Local\\Temp",
  })
}

function runFixed(spawnSyncApi, executable, args, code) {
  const result = spawnSyncApi(executable, args, {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    env: sanitizedEnvironment(),
    input: "",
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  })
  if (result?.error || result?.status !== 0 || result?.signal) {
    fail(code, `${path.win32.basename(executable)} failed closed`)
  }
  return String(result.stdout ?? "")
}

function detectElevatedToken(spawnSyncApi) {
  const output = runFixed(spawnSyncApi, WHOAMI_PATH, ["/groups", "/fo", "csv", "/nh"], "HERMES_KEY_ELEVATION_CHECK_FAILED")
  return /S-1-16-(?:12288|16384)/.test(output)
}

function parsePublicKey(bytes) {
  const text = Buffer.from(bytes).toString("utf8")
  if (text.includes("PRIVATE KEY") || text.includes("\0") || Buffer.byteLength(text, "utf8") > 16 * 1024) {
    fail("HERMES_KEY_PUBLIC_KEY_INVALID", "only one bounded public key record is accepted")
  }
  const line = text.replace(/\r\n/g, "\n").replace(/\n$/, "")
  if (line.includes("\n") || line.trim() !== line) {
    fail("HERMES_KEY_PUBLIC_KEY_INVALID", "public key file must contain exactly one canonical line")
  }
  const fields = line.split(/[ \t]+/)
  if (fields.length !== 3 || fields[0] !== KEY_ALGORITHM || fields[2] !== KEY_COMMENT
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(fields[1])) {
    fail("HERMES_KEY_PUBLIC_KEY_INVALID", "generated public key algorithm or comment differs")
  }
  const blob = Buffer.from(fields[1], "base64")
  if (blob.toString("base64").replace(/=+$/, "") !== fields[1].replace(/=+$/, "")) {
    fail("HERMES_KEY_PUBLIC_KEY_INVALID", "public key blob is not canonical base64")
  }
  const readField = (offset) => {
    if (offset + 4 > blob.length) fail("HERMES_KEY_PUBLIC_KEY_INVALID", "public key wire record is truncated")
    const length = blob.readUInt32BE(offset)
    const start = offset + 4
    const end = start + length
    if (end > blob.length) fail("HERMES_KEY_PUBLIC_KEY_INVALID", "public key wire record is truncated")
    return { value: blob.subarray(start, end), next: end }
  }
  const algorithm = readField(0)
  const key = readField(algorithm.next)
  if (algorithm.value.toString("ascii") !== KEY_ALGORITHM || key.value.length !== 32 || key.next !== blob.length) {
    fail("HERMES_KEY_PUBLIC_KEY_INVALID", "public key wire record is not one Ed25519 key")
  }
  return {
    fingerprint: `SHA256:${crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`,
    fileSha256: sha256(bytes),
  }
}

function validateFingerprintOutput(output, expected) {
  const lines = output.replace(/\r\n/g, "\n").trim().split("\n")
  if (lines.length !== 1) fail("HERMES_KEY_FINGERPRINT_INVALID", "ssh-keygen returned ambiguous fingerprint output")
  const match = /^256 (SHA256:[A-Za-z0-9+/]{43}) .+ \(ED25519\)$/.exec(lines[0])
  if (!match || !SSH_FINGERPRINT.test(match[1]) || match[1] !== expected) {
    fail("HERMES_KEY_FINGERPRINT_INVALID", "public fingerprint verification differs")
  }
}

function validatePrivateAclOutput(output) {
  const normalized = output.replace(/\r\n/g, "\n")
  const aclLines = normalized.split("\n").filter((line) => line.includes(":"))
  if (aclLines.length !== 1 || !new RegExp(`(?:^|[\\\\])${GENERATION_ACCOUNT}:\\(F\\)`, "i").test(aclLines[0])
    || /BUILTIN\\Administrators|NT AUTHORITY\\SYSTEM|Everyone|Authenticated Users/i.test(normalized)) {
    fail("HERMES_KEY_PRIVATE_ACL_INVALID", "private key ACL is not restricted to bs only")
  }
}

function atomicPublish(fsApi, target, value) {
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  let descriptor
  let temporaryCreated = false
  let published = false
  try {
    descriptor = fsApi.openSync(temporary,
      flags(fsApi).O_WRONLY | flags(fsApi).O_CREAT | flags(fsApi).O_EXCL | (flags(fsApi).O_NOFOLLOW ?? 0), 0o600)
    temporaryCreated = true
    writeAll(fsApi, descriptor, Buffer.from(`${canonicalize(value)}\n`, "utf8"))
    fsApi.fsyncSync(descriptor)
    fsApi.closeSync(descriptor)
    descriptor = undefined
    fsApi.linkSync(temporary, target)
    published = true
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
    if (temporaryCreated) {
      let cleanupError
      for (let attempt = 0; attempt < 3 && temporaryCreated; attempt += 1) {
        try {
          fsApi.unlinkSync(temporary)
          temporaryCreated = false
        } catch (error) {
          if (error?.code === "ENOENT") {
            temporaryCreated = false
          } else {
            cleanupError = error
          }
        }
      }
      if (temporaryCreated && published) {
        fail("HERMES_KEY_EVIDENCE_TEMPORARY_CLEANUP_FAILED",
          "evidence was published but its temporary hard link could not be removed", {
            causeCode: cleanupError?.code ?? "HERMES_KEY_TEMPORARY_CLEANUP_FAILED",
          })
      }
    }
  }
}

export function createHermesAegisStandingHashKey({
  authority,
  mode = "dry-run",
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  fsApi = fs,
  processApi = process,
  hostname = os.hostname,
  userInfo = os.userInfo,
  isElevated,
  clock = () => new Date().toISOString(),
  spawnSyncApi = childProcess.spawnSync,
} = {}) {
  if (mode !== "dry-run" && mode !== "apply") fail("HERMES_KEY_MODE_INVALID", "mode must be dry-run or apply")
  verifyHermesIdentity(processApi, hostname, userInfo)
  assertFixedExecutable(fsApi, WHOAMI_PATH)
  const elevated = typeof isElevated === "boolean" ? isElevated : detectElevatedToken(spawnSyncApi)
  verifyNotElevated(elevated)
  assertTrustedSshDirectory(fsApi)
  assertFixedExecutable(fsApi, SSH_KEYGEN_PATH)
  assertFixedExecutable(fsApi, ICACLS_PATH)
  assertAbsentTargets(fsApi)

  const manifestFile = path.resolve(repoRoot, ...MANIFEST_PATH.split("/"))
  const manifestBytes = readStableFile(fsApi, manifestFile)
  let manifest
  try {
    manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8")))
  } catch (error) {
    if (error?.code) throw error
    fail("HERMES_KEY_PACKAGE_INVALID", "manifest is not valid JSON")
  }
  const now = clock()
  const manifestSha256 = canonicalSha256(manifest)
  const recovery = inspectRecoverableJournal(fsApi, manifestSha256)
  validateHermesKeyGenerationAuthority(manifest, authority, now, recovery)
  const authoritySha256 = canonicalSha256(authority)
  const planned = {
    schemaVersion: "1.0-hermes-aegis-standing-hash-key-plan",
    status: "DRY_RUN",
    mode: mode.toUpperCase(),
    packageId: manifest.packageId,
    manifestSha256,
    generationAuthorityId: authority.authorityId,
    generationAuthoritySha256: authoritySha256,
    generationHost: GENERATION_HOST,
    generationAccount: GENERATION_ACCOUNT,
    sourceAddress: SOURCE_ADDRESS,
    algorithm: KEY_ALGORITHM,
    privateKeyPath: PRIVATE_KEY_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    evidencePath: EVIDENCE_PATH,
    journalPath: JOURNAL_PATH,
    generatedFresh: false,
    existedBefore: false,
    recoveryEligible: recovery.recoverable,
    authorityConsumed: false,
    privateKeyInspected: false,
    privateKeyLocalOnly: true,
    networkAccessed: false,
    schedulerActivated: false,
    workloadExecuted: false,
  }
  if (mode === "dry-run") return planned

  const consumedAt = clock()
  validateHermesKeyGenerationAuthority(manifest, authority, consumedAt, recovery)
  let sequence = consumeAuthority(fsApi, authority, manifestSha256, consumedAt, recovery)
  try {
    assertAbsentTargets(fsApi)
    appendJournal(fsApi, { recordType: "KEY_GENERATION_STARTED", sequence: sequence++, startedAt: clock() })
    runFixed(spawnSyncApi, SSH_KEYGEN_PATH,
      ["-q", "-t", "ed25519", "-f", PRIVATE_KEY_PATH, "-N", "", "-C", KEY_COMMENT],
      "HERMES_KEY_GENERATION_FAILED")
    assertDirectFile(fsApi, PRIVATE_KEY_PATH, "HERMES_KEY_PRIVATE_KEY_INVALID")
    assertDirectFile(fsApi, PUBLIC_KEY_PATH, "HERMES_KEY_PUBLIC_KEY_INVALID")

    runFixed(spawnSyncApi, ICACLS_PATH,
      [PRIVATE_KEY_PATH, "/inheritance:r", "/remove:g", "*S-1-5-18", "*S-1-5-32-544", "*S-1-1-0", "*S-1-5-11", "/grant:r", `${GENERATION_ACCOUNT}:(F)`],
      "HERMES_KEY_ACL_HARDENING_FAILED")
    const aclOutput = runFixed(spawnSyncApi, ICACLS_PATH, [PRIVATE_KEY_PATH], "HERMES_KEY_ACL_VALIDATION_FAILED")
    validatePrivateAclOutput(aclOutput)

    const publicBytes = readStableFile(fsApi, PUBLIC_KEY_PATH, 16 * 1024)
    const publicKey = parsePublicKey(publicBytes)
    const fingerprintOutput = runFixed(spawnSyncApi, SSH_KEYGEN_PATH,
      ["-lf", PUBLIC_KEY_PATH, "-E", "sha256"], "HERMES_KEY_FINGERPRINT_FAILED")
    validateFingerprintOutput(fingerprintOutput, publicKey.fingerprint)
    if (existsNoFollow(fsApi, EVIDENCE_PATH).exists) {
      fail("HERMES_KEY_EXISTING_TARGET_REJECTED", "generation evidence target appeared during generation")
    }

    const evidence = {
      schemaVersion: "1.0-hermes-aegis-standing-hash-key-evidence",
      status: "GENERATED",
      packageId: manifest.packageId,
      manifestSha256,
      generationAuthorityId: authority.authorityId,
      generationAuthoritySha256: authoritySha256,
      generatedAt: clock(),
      generationHost: GENERATION_HOST,
      generationAccount: GENERATION_ACCOUNT,
      sourceAddress: SOURCE_ADDRESS,
      algorithm: KEY_ALGORITHM,
      privateKeyPath: PRIVATE_KEY_PATH,
      publicKeyPath: PUBLIC_KEY_PATH,
      generatedFresh: true,
      existedBefore: false,
      privateKeyInspected: false,
      privateKeyLocalOnly: true,
      publicKeySha256: publicKey.fileSha256,
      publicKeyFingerprint: publicKey.fingerprint,
    }
    atomicPublish(fsApi, EVIDENCE_PATH, evidence)
    appendJournal(fsApi, {
      recordType: "GENERATION_COMPLETE",
      sequence,
      completedAt: evidence.generatedAt,
      evidencePath: EVIDENCE_PATH,
      evidenceSha256: canonicalSha256(evidence),
      publicKeySha256: publicKey.fileSha256,
      publicKeyFingerprint: publicKey.fingerprint,
      privateKeyInspected: false,
    })
    return evidence
  } catch (error) {
    const privateObserved = existsNoFollow(fsApi, PRIVATE_KEY_PATH)
    const publicObserved = existsNoFollow(fsApi, PUBLIC_KEY_PATH)
    const evidenceObserved = existsNoFollow(fsApi, EVIDENCE_PATH)
    let failureEvidenceWritten = false
    try {
      appendJournal(fsApi, {
        recordType: "GENERATION_FAILED_PARTIAL_STATE",
        sequence,
        failedAt: clock(),
        failureCode: error?.code ?? "HERMES_KEY_GENERATION_FAILED",
        privateKeyExists: privateObserved.exists,
        publicKeyExists: publicObserved.exists,
        evidenceExists: evidenceObserved.exists,
        privateKeyInspected: false,
        automaticCleanupPerformed: false,
      })
      failureEvidenceWritten = true
    } catch (journalError) {
      fail("HERMES_KEY_PARTIAL_STATE_EVIDENCE_FAILED",
        "authority consumed and generation failed; durable failure record could not be appended", {
          causeCode: error?.code ?? "HERMES_KEY_GENERATION_FAILED",
          journalCauseCode: journalError?.code ?? "HERMES_KEY_JOURNAL_WRITE_FAILED",
          authorityConsumed: true,
          journalPath: JOURNAL_PATH,
        })
    }
    if (!failureEvidenceWritten) {
      fail("HERMES_KEY_PARTIAL_STATE_EVIDENCE_FAILED", "durable failure evidence was not confirmed", {
        authorityConsumed: true,
        journalPath: JOURNAL_PATH,
      })
    }
    fail("HERMES_KEY_PARTIAL_STATE", "authority consumed; generation stopped with durable partial-state evidence", {
      causeCode: error?.code ?? "HERMES_KEY_GENERATION_FAILED",
      authorityConsumed: true,
      journalPath: JOURNAL_PATH,
    })
  }
}

export const generateHermesAegisStandingHashKey = createHermesAegisStandingHashKey
export const executeHermesAegisStandingHashKeyGeneration = createHermesAegisStandingHashKey

function parseCli(argv) {
  const result = { mode: "dry-run", authorityPath: null, explicitMode: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--dry-run" || argument === "--apply") {
      if (result.explicitMode) fail("HERMES_KEY_USAGE_INVALID", "choose at most one of --dry-run or --apply")
      result.mode = argument.slice(2)
      result.explicitMode = true
      continue
    }
    if (argument === "--authority") {
      const value = argv[++index]
      if (!value || result.authorityPath !== null) {
        fail("HERMES_KEY_USAGE_INVALID", "--authority requires one path exactly once")
      }
      result.authorityPath = path.resolve(value)
      continue
    }
    fail("HERMES_KEY_USAGE_INVALID", `unknown argument ${argument}`)
  }
  if (!result.authorityPath) fail("HERMES_KEY_USAGE_INVALID", "use --authority <json> [--dry-run|--apply]")
  return result
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const fsApi = dependencies.fsApi ?? fs
  try {
    const cli = parseCli(argv)
    const authorityBytes = readStableFile(fsApi, cli.authorityPath, 64 * 1024)
    let authority
    try {
      authority = JSON.parse(authorityBytes.toString("utf8"))
    } catch {
      fail("HERMES_KEY_AUTHORITY_INVALID", "authority file is not valid JSON")
    }
    const result = createHermesAegisStandingHashKey({
      ...dependencies,
      fsApi,
      authority,
      mode: cli.mode,
    })
    ;(dependencies.stdout ?? process.stdout).write(`${canonicalize(result)}\n`)
    return 0
  } catch (error) {
    ;(dependencies.stderr ?? process.stderr).write(`${canonicalize({
      schemaVersion: "1.0-hermes-aegis-standing-hash-key-error",
      status: "FAILED_CLOSED",
      code: error?.code ?? "HERMES_KEY_REJECTED",
      detail: String(error?.message ?? error).slice(0, 512),
      authorityConsumed: error?.authorityConsumed === true,
      journalPath: error?.journalPath ?? null,
      privateKeyInspected: false,
      privateKeyLocalOnly: true,
      networkAccessed: false,
      schedulerActivated: false,
      workloadExecuted: false,
    })}\n`)
    return error?.code === "HERMES_KEY_USAGE_INVALID" ? 64 : 2
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) process.exitCode = main()
