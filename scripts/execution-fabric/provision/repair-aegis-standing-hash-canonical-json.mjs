#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

/**
 * @typedef {{dev:number, ino:number, mode:number, nlink:number, uid:number, gid:number, size:number,
 * mtimeMs:number, ctimeMs:number, isFile:()=>boolean, isDirectory:()=>boolean, isSymbolicLink:()=>boolean}} RepairStats
 * @typedef {{constants:typeof fs.constants, lstatSync:(path:import("node:fs").PathLike)=>RepairStats,
 * fstatSync:(fd:number)=>RepairStats, realpathSync:(path:import("node:fs").PathLike)=>string,
 * openSync:(path:import("node:fs").PathLike, flags:number, mode?:number)=>number,
 * readFileSync:(path:import("node:fs").PathLike|number)=>Buffer, closeSync:(fd:number)=>void,
 * fsyncSync:(fd:number)=>void, writeSync:(fd:number, buffer:Buffer, offset:number, length:number, position:number|null)=>number,
 * fchmodSync:(fd:number, mode:number)=>void, fchownSync:(fd:number, uid:number, gid:number)=>void,
 * linkSync:(existing:import("node:fs").PathLike, target:import("node:fs").PathLike)=>void,
 * unlinkSync:(path:import("node:fs").PathLike)=>void}} RepairFsApi
 * @typedef {{platform:string, getuid?:()=>number}} RepairProcessApi
 */

export const MANIFEST_PATH = "config/execution-fabric/aegis-standing-hash-provisioning-package.v1.json"
export const TARGET_PATH = "/usr/local/libexec/canonical-json.mjs"
export const PREVIOUS_JOURNAL_PREFIX = "/var/lib/williamos-aegis-standing-hash-"
export const REPAIR_JOURNAL_PREFIX = "/var/lib/williamos-aegis-standing-hash-canonical-json-repair-"

const SHA256 = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_JSON_BYTES = 1024 * 1024
const GIT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const GIT_EXECUTABLE = "/usr/bin/git"
const EXPECTED_MACHINE_SHA256 = "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b"
const EXPECTED_COMMIT = "13709f5789c25dea408283730a6bd35e8fd894ab"
const EXPECTED_PREVIOUS_MANIFEST_SHA256 = "adb43b325199e3eb167298887ed01e7c434a88b0838ace17f1086132ae0f46ec"
const EXPECTED_SOURCE_SHA256 = "b1df628a845cdb43374e5850bb4e1b43cd203eb4baf9c0a32244578112ad9b21"
const EXPECTED_INSTALLED_ASSETS = Object.freeze([
  Object.freeze({
    id: "bootstrap",
    path: "/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs",
    sha256: "7d4b713c00f73726ce39f20856c53a69865968d98d2daf08e2ce038c612ce14b",
    mode: "0555",
  }),
  Object.freeze({
    id: "ssh-entrypoint",
    path: "/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs",
    sha256: "ebcf0d068e11c1a3f98b515f9a59a456955d8d30abdbb8bab7897b9b315caf9a",
    mode: "0555",
  }),
  Object.freeze({
    id: "replay-epoch-initializer",
    path: "/usr/local/libexec/williamos/aegis-standing-hash-replay-epoch.mjs",
    sha256: "c796c9742052ada8e7744385a55ca630245a236a694632566ec0e1a232f40802",
    mode: "0555",
  }),
])
const EXPECTED_PREVIOUS_ROOT_MUTATION_IDS = Object.freeze([
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
const EXPECTED_PRIVATE_ROOTS = Object.freeze([
  "/var/lib/williamos/fabric/standing-hash-requests",
  "/var/lib/williamos/fabric/standing-hash-ledger",
  "/var/lib/williamos/fabric/ledger",
])
const AUTHORIZED_KEYS_PATH = "/home/williamos-fabric/.ssh/authorized_keys"
const EXPECTED_SERVICE_ACCOUNT = Object.freeze({
  name: "williamos-fabric",
  home: "/var/empty/williamos-fabric",
  shell: "/bin/bash",
})
const EXPECTED_HISTORICAL_PLAN = Object.freeze([
  Object.freeze({ type: "CREATE_DIRECTORY", path: "/opt/williamos" }),
  Object.freeze({ type: "CREATE_DIRECTORY", path: "/opt/williamos/releases" }),
  Object.freeze({ type: "CREATE_DIRECTORY", path: "/usr/local/libexec/williamos" }),
  Object.freeze({ type: "CREATE_DIRECTORY", path: "/etc/williamos" }),
  Object.freeze({ type: "CREATE_DIRECTORY", path: "/etc/williamos/fabric" }),
  ...EXPECTED_PRIVATE_ROOTS.map((directoryPath) => Object.freeze({ type: "CREATE_DIRECTORY", path: directoryPath })),
  Object.freeze({ type: "CREATE_DIRECTORY", path: "/home/williamos-fabric/.ssh" }),
  Object.freeze({
    type: "INSTALL_REVIEWED_CHECKOUT",
    path: `/opt/williamos/releases/${EXPECTED_COMMIT}`,
    source_path: "/opt/williamos/source/terragroq",
    commit: EXPECTED_COMMIT,
  }),
  ...EXPECTED_INSTALLED_ASSETS.map(({ id, path: assetPath }) => Object.freeze({
    type: "INSTALL_FILE",
    id,
    path: assetPath,
  })),
  Object.freeze({ type: "INSTALL_FILE", id: "authorized-keys", path: AUTHORIZED_KEYS_PATH }),
  Object.freeze({
    type: "INSTALL_FILE",
    id: "release-manifest",
    path: "/etc/williamos/fabric/trusted-main-release.json",
  }),
])
const AUTHORIZED_KEY_PREFIX = [
  "restrict",
  'from="192.168.88.9"',
  'command="/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs"',
  "no-agent-forwarding",
  "no-port-forwarding",
  "no-X11-forwarding",
  "no-pty",
  "no-user-rc",
].join(",") + " ssh-ed25519 "
const AUTHORITY_KEYS = Object.freeze([
  "schemaVersion", "authorityId", "repairId", "packageId", "manifestSha256", "repository",
  "trustedMainCommit", "machineIdSha256", "previousProvisioningAuthorityId",
  "previousProvisioningManifestSha256", "previousProvisioningJournalSha256",
  "previousProvisioningPlanSha256", "installedReleaseManifestSha256",
  "installedAuthorizedKeysSha256", "installedAssetSha256", "sourceSha256", "targetPath",
  "issuedAt", "expiresAt", "singleUse", "consumed",
])

function assertValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("JCS strings must not contain lone surrogates")
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("JCS strings must not contain lone surrogates")
    }
  }
}

function canonicalize(value) {
  if (typeof value === "string") {
    assertValidUnicode(value)
    return JSON.stringify(value)
  }
  if (value === null || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON numbers must be finite")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      assertValidUnicode(key)
      return `${JSON.stringify(key)}:${canonicalize(value[key])}`
    }).join(",")}}`
  }
  throw new TypeError("unsupported canonical JSON value")
}

export const canonicalizeRepairJcs = canonicalize

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalSha256 = (value) => sha256(Buffer.from(canonicalize(value), "utf8"))
const same = (left, right) => canonicalize(left) === canonicalize(right)
const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort())
const normalizeLf = (bytes) => Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"), "utf8")

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

function flags(fsApi) {
  return fsApi.constants ?? fs.constants
}

function existsNoFollow(fsApi, targetPath) {
  try { return { exists: true, stats: fsApi.lstatSync(targetPath) } } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, stats: null }
    throw error
  }
}

function readStableFile(fsApi, filePath, {
  maximumBytes = MAX_JSON_BYTES,
  uid,
  gid,
  mode,
  direct = false,
  nonWritable = false,
} = {}) {
  let descriptor
  try {
    descriptor = fsApi.openSync(filePath, flags(fsApi).O_RDONLY | (flags(fsApi).O_NOFOLLOW ?? 0))
    const before = fsApi.fstatSync(descriptor)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes) {
      fail("AEGIS_CANONICAL_REPAIR_STATE_UNTRUSTED", `${filePath} is not one bounded direct file`)
    }
    if ((uid !== undefined && before.uid !== uid) || (gid !== undefined && before.gid !== gid)
      || (mode !== undefined && (before.mode & 0o7777) !== mode)
      || (nonWritable && (before.mode & 0o022) !== 0)) {
      fail("AEGIS_CANONICAL_REPAIR_STATE_UNTRUSTED", `${filePath} ownership or mode differs`)
    }
    if (direct && fsApi.realpathSync(filePath) !== filePath) {
      fail("AEGIS_CANONICAL_REPAIR_SYMLINK_REJECTED", `${filePath} is indirect`)
    }
    const bytes = Buffer.from(fsApi.readFileSync(descriptor))
    const after = fsApi.fstatSync(descriptor)
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      fail("AEGIS_CANONICAL_REPAIR_STATE_CHANGED", `${filePath} changed while it was inspected`)
    }
    return bytes
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function assertDirectDirectory(fsApi, directoryPath, { uid, gid, mode }) {
  const stats = fsApi.lstatSync(directoryPath)
  if (!stats.isDirectory() || stats.isSymbolicLink() || fsApi.realpathSync(directoryPath) !== directoryPath
    || stats.uid !== uid || stats.gid !== gid || (stats.mode & 0o7777) !== mode) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", `${directoryPath} directory state differs`)
  }
}

function assertHardenedCheckoutDirectory(fsApi, directoryPath, label = directoryPath) {
  const stats = fsApi.lstatSync(directoryPath)
  const mode = stats.mode & 0o7777
  if (!stats.isDirectory() || stats.isSymbolicLink() || fsApi.realpathSync(directoryPath) !== directoryPath
    || stats.uid !== 0 || stats.gid !== 0 || (mode & 0o7000) !== 0
    || (mode & 0o022) !== 0 || (mode & 0o500) !== 0o500) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_DIRECTORY_METADATA_DRIFT", `${label} directory is outside the hardened mode set`)
  }
}

function hardenedRegularFileMode(stats, { executable, label }) {
  const mode = stats.mode & 0o7777
  const executableModeMatches = executable ? (mode & 0o100) === 0o100 : (mode & 0o111) === 0
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
    || stats.uid !== 0 || stats.gid !== 0 || (mode & 0o7000) !== 0
    || (mode & 0o022) !== 0 || (mode & 0o400) !== 0o400 || !executableModeMatches) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_FILE_METADATA_DRIFT", `${label} file is outside the hardened mode set`)
  }
}

function runFixedGit(args, cwd, { acceptedStatuses = [0] } = {}) {
  const result = spawnSync(GIT_EXECUTABLE, [
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "credential.helper=",
    "--no-replace-objects",
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
      GIT_OPTIONAL_LOCKS: "0",
    },
  })
  if (result.error || result.signal || !acceptedStatuses.includes(result.status)) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_GIT_FAILED", `fixed local Git operation failed: ${args.at(-1) ?? "unknown"}`)
  }
  return { status: result.status, stdout: Buffer.from(result.stdout ?? Buffer.alloc(0)) }
}

function resolveServiceAccount(fsApi) {
  const passwd = readStableFile(fsApi, "/etc/passwd", { maximumBytes: 1024 * 1024 }).toString("utf8")
  const group = readStableFile(fsApi, "/etc/group", { maximumBytes: 1024 * 1024 }).toString("utf8")
  const passwdMatches = passwd.split("\n").filter((line) => line.startsWith(`${EXPECTED_SERVICE_ACCOUNT.name}:`))
  const groupMatches = group.split("\n").filter((line) => line.startsWith(`${EXPECTED_SERVICE_ACCOUNT.name}:`))
  const passwdFields = passwdMatches[0]?.split(":")
  const groupFields = groupMatches[0]?.split(":")
  const uid = Number(passwdFields?.[2])
  const gid = Number(passwdFields?.[3])
  if (passwdMatches.length !== 1 || groupMatches.length !== 1 || passwdFields?.length !== 7
    || groupFields?.length !== 4 || passwdFields[5] !== EXPECTED_SERVICE_ACCOUNT.home
    || passwdFields[6] !== EXPECTED_SERVICE_ACCOUNT.shell
    || !Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0
    || Number(groupFields[2]) !== gid) {
    fail("AEGIS_CANONICAL_REPAIR_ACCOUNT_INVALID", "exact williamos-fabric account identity differs")
  }
  return { uid, gid }
}

function parseJson(bytes, code, label) {
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")) } catch {
    fail(code, `${label} is not valid JSON`)
  }
}

function assertSafeRootParent(fsApi, targetPath) {
  if (!path.posix.isAbsolute(targetPath)) fail("AEGIS_CANONICAL_REPAIR_SYMLINK_REJECTED", "target is not absolute")
  const parents = []
  let candidate = path.posix.dirname(targetPath)
  while (true) {
    parents.push(candidate)
    if (candidate === "/") break
    candidate = path.posix.dirname(candidate)
  }
  for (const parent of parents.reverse()) {
    const stats = fsApi.lstatSync(parent)
    if (!stats.isDirectory() || stats.isSymbolicLink() || fsApi.realpathSync(parent) !== parent
      || stats.uid !== 0 || stats.gid !== 0 || (stats.mode & 0o022) !== 0) {
      fail("AEGIS_CANONICAL_REPAIR_PARENT_UNTRUSTED", `${parent} is not a direct root-owned non-writable directory`)
    }
  }
}

function fsyncParent(fsApi, targetPath) {
  const descriptor = fsApi.openSync(path.posix.dirname(targetPath), flags(fsApi).O_RDONLY)
  try { fsApi.fsyncSync(descriptor) } finally { fsApi.closeSync(descriptor) }
}

function writeAll(fsApi, descriptor, bytes) {
  let offset = 0
  while (offset < bytes.length) {
    const written = fsApi.writeSync(descriptor, bytes, offset, bytes.length - offset, null)
    if (!Number.isSafeInteger(written) || written <= 0) {
      fail("AEGIS_CANONICAL_REPAIR_WRITE_FAILED", "bounded write made no progress")
    }
    offset += written
  }
}

function journalPersistenceError(code, detail, cause, journalPath, phase, terminalRecordState) {
  const error = new Error(`${code}: ${detail}`, { cause })
  error.code = code
  error.causeCode = cause?.code ?? null
  error.authorityConsumed = true
  error.journalPath = journalPath
  error.journalMayExist = true
  error.journalDurability = "UNCERTAIN"
  error.journalPhase = phase
  error.terminalRecordState = terminalRecordState
  return error
}

function createJournal(fsApi, journalPath, record) {
  assertSafeRootParent(fsApi, journalPath)
  let descriptor
  let createAttempted = false
  try {
    createAttempted = true
    descriptor = fsApi.openSync(journalPath,
      flags(fsApi).O_WRONLY | flags(fsApi).O_CREAT | flags(fsApi).O_EXCL | (flags(fsApi).O_NOFOLLOW ?? 0), 0o600)
    fsApi.fchmodSync(descriptor, 0o600)
    fsApi.fchownSync(descriptor, 0, 0)
    writeAll(fsApi, descriptor, Buffer.from(`${canonicalize(record)}\n`, "utf8"))
    fsApi.fsyncSync(descriptor)
    fsApi.closeSync(descriptor)
    descriptor = undefined
    fsyncParent(fsApi, journalPath)
  } catch (error) {
    const code = error?.code === "EEXIST"
      ? "AEGIS_CANONICAL_REPAIR_AUTHORITY_REPLAY"
      : "AEGIS_CANONICAL_REPAIR_CONSUMPTION_UNCERTAIN"
    const detail = error?.code === "EEXIST"
      ? "repair authority journal already exists"
      : "repair authority journal creation or durability failed"
    throw journalPersistenceError(
      code,
      detail,
      error,
      journalPath,
      createAttempted ? "AUTHORITY_CONSUMED_CREATE" : "PRE_CREATE",
      "NOT_STARTED",
    )
  } finally {
    if (descriptor !== undefined) {
      try { fsApi.closeSync(descriptor) } catch {}
    }
  }
}

function appendJournal(fsApi, journalPath, record) {
  let descriptor
  try {
    const before = fsApi.lstatSync(journalPath)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.uid !== 0 || before.gid !== 0 || (before.mode & 0o7777) !== 0o600
      || fsApi.realpathSync(journalPath) !== journalPath) {
      fail("AEGIS_CANONICAL_REPAIR_JOURNAL_UNTRUSTED", "repair journal ownership or mode changed")
    }
    descriptor = fsApi.openSync(journalPath,
      flags(fsApi).O_WRONLY | flags(fsApi).O_APPEND | (flags(fsApi).O_NOFOLLOW ?? 0))
    const acquired = fsApi.fstatSync(descriptor)
    if (acquired.dev !== before.dev || acquired.ino !== before.ino) {
      fail("AEGIS_CANONICAL_REPAIR_JOURNAL_UNTRUSTED", "repair journal changed during acquisition")
    }
    writeAll(fsApi, descriptor, Buffer.from(`${canonicalize(record)}\n`, "utf8"))
    fsApi.fsyncSync(descriptor)
    fsApi.closeSync(descriptor)
    descriptor = undefined
    fsyncParent(fsApi, journalPath)
    return
  } catch (error) {
    throw journalPersistenceError(
      "AEGIS_CANONICAL_REPAIR_TERMINAL_STATE_UNCERTAIN",
      `${record.record_type} journal append or durability failed`,
      error,
      journalPath,
      record.record_type,
      "ABSENT_PARTIAL_OR_DURABILITY_UNCERTAIN",
    )
  } finally {
    if (descriptor !== undefined) {
      try { fsApi.closeSync(descriptor) } catch {}
    }
  }
}

function installExclusive(fsApi, bytes, randomUUID) {
  const temporaryPath = `${TARGET_PATH}.repair-${randomUUID()}.tmp`
  let descriptor
  let temporaryCreated = false
  try {
    assertSafeRootParent(fsApi, TARGET_PATH)
    if (existsNoFollow(fsApi, TARGET_PATH).exists) {
      fail("AEGIS_CANONICAL_REPAIR_TARGET_EXISTS", "target exists; overwrite and adoption are refused")
    }
    descriptor = fsApi.openSync(temporaryPath,
      flags(fsApi).O_WRONLY | flags(fsApi).O_CREAT | flags(fsApi).O_EXCL | (flags(fsApi).O_NOFOLLOW ?? 0), 0o444)
    temporaryCreated = true
    fsApi.fchmodSync(descriptor, 0o444)
    fsApi.fchownSync(descriptor, 0, 0)
    writeAll(fsApi, descriptor, bytes)
    fsApi.fsyncSync(descriptor)
    fsApi.closeSync(descriptor)
    descriptor = undefined
    fsApi.linkSync(temporaryPath, TARGET_PATH)
    fsyncParent(fsApi, TARGET_PATH)
    fsApi.unlinkSync(temporaryPath)
    temporaryCreated = false
    fsyncParent(fsApi, TARGET_PATH)
  } catch (error) {
    if (error?.code === "EEXIST") fail("AEGIS_CANONICAL_REPAIR_TARGET_EXISTS", "target was claimed concurrently")
    throw error
  } finally {
    if (descriptor !== undefined) {
      try { fsApi.closeSync(descriptor) } catch {}
    }
    if (temporaryCreated) {
      try { fsApi.unlinkSync(temporaryPath) } catch {}
    }
  }
}

export function validateHistoricalRootMutationIds(rootMutationIds) {
  if (!same(rootMutationIds, EXPECTED_PREVIOUS_ROOT_MUTATION_IDS)) {
    fail("AEGIS_CANONICAL_REPAIR_PACKAGE_INVALID", "historical root mutation semantics differ")
  }
  return [...rootMutationIds]
}

export function validateHistoricalReleaseRoot(manifest, previousPlannedMutations) {
  const expectedReleaseRoot = `/opt/williamos/releases/${manifest?.trustedMain?.commit ?? "<invalid>"}`
  const checkout = previousPlannedMutations?.find?.(({ type }) => type === "INSTALL_REVIEWED_CHECKOUT")
  if (manifest?.reviewedRelease?.releaseRoot !== expectedReleaseRoot || checkout?.path !== expectedReleaseRoot
    || checkout?.commit !== manifest?.trustedMain?.commit) {
    fail("AEGIS_CANONICAL_REPAIR_PACKAGE_INVALID", "historical release root differs from the trusted commit plan")
  }
  return expectedReleaseRoot
}

function validateManifest(manifest) {
  const repair = manifest?.repair
  const assets = repair?.installedAssets
  if (manifest?.schemaVersion !== 1 || manifest.packageId !== "aegis-standing-hash-provisioning-issue-595-v1"
    || manifest.issue?.number !== 595 || manifest.issue?.workOrderId !== "WO-EF-AEGIS-STANDING-001"
    || manifest.trustedMain?.repository !== "bsvalues/terragroq" || manifest.trustedMain?.commit !== EXPECTED_COMMIT
    || manifest.identity?.hostname !== "aegis" || manifest.identity?.machineIdSha256 !== EXPECTED_MACHINE_SHA256
    || repair?.id !== "aegis-standing-hash-canonical-json-repair-v1"
    || repair.sourcePath !== "scripts/execution-fabric/canonical-json.mjs" || repair.targetPath !== TARGET_PATH
    || repair.targetOwner !== "root" || repair.targetGroup !== "root" || repair.targetMode !== "0444"
    || repair.targetSingleLink !== true || repair.previousAppliedManifestSha256 !== EXPECTED_PREVIOUS_MANIFEST_SHA256
    || repair.previousProvisioningJournalRequired !== true || repair.previousProvisioningApplyCompleteRequired !== true
    || repair.singleUseAuthorityRequired !== true || repair.consumeBeforeMutationRequired !== true
    || repair.missingTargetOnly !== true || repair.overwriteAllowed !== false || repair.adoptionAllowed !== false
    || repair.atomicExclusiveInstallRequired !== true || repair.durableRepairJournalRequired !== true
    || repair.networkAllowed !== false || repair.schedulerAllowed !== false || repair.workloadAllowed !== false
    || repair.trustedReleaseManifestPath !== "/etc/williamos/fabric/trusted-main-release.json"
    || repair.trustedReleaseRootRequired !== true || repair.privateRootsRequired !== true
    || repair.historicalCheckoutGitExecutable !== GIT_EXECUTABLE
    || repair.historicalCheckoutOriginRepository !== "bsvalues/terragroq"
    || repair.historicalCheckoutDetachedHeadRequired !== true
    || repair.historicalCheckoutCleanTrackedAndUntrackedRequired !== true
    || repair.historicalCheckoutAlternatesAllowed !== false
    || repair.historicalCheckoutExactTrackedFileMetadataRequired !== true
    || !same(repair.historicalCheckoutHardenedModePolicy, {
      owner: "root",
      group: "root",
      specialBitsAllowed: false,
      groupOrWorldWriteAllowed: false,
      regularFileOwnerReadRequired: true,
      gitNonExecutableBitsAllowed: false,
      gitExecutableOwnerExecuteRequired: true,
      directoryOwnerReadExecuteRequired: true,
    })
    || repair.historicalCheckoutExactTrackedPathAncestorMetadataRequired !== true
    || repair.targetParentPath !== "/usr/local/libexec" || repair.targetParentOwner !== "root"
    || repair.targetParentGroup !== "root" || repair.targetParentDirectRequired !== true
    || repair.targetParentGroupOrWorldWriteAllowed !== false
    || repair.serviceAccount === undefined || !same(repair.serviceAccount, EXPECTED_SERVICE_ACCOUNT)
    || repair.authorizedKeysPath !== AUTHORIZED_KEYS_PATH || repair.authorizedKeyExactRecordRequired !== true
    || !Number.isFinite(repair.authorityMaximumAgeSeconds) || repair.authorityMaximumAgeSeconds <= 0
    || !same(assets, EXPECTED_INSTALLED_ASSETS)
    || !same(repair.previousPlannedMutations, EXPECTED_HISTORICAL_PLAN)) {
    fail("AEGIS_CANONICAL_REPAIR_PACKAGE_INVALID", "repair package semantics differ")
  }
  validateHistoricalRootMutationIds(repair.previousRootMutationIds)
  validateHistoricalReleaseRoot(manifest, repair.previousPlannedMutations)
  const sourceBinding = manifest.bindings?.find(({ path: bindingPath }) => bindingPath === repair.sourcePath)
  if (!sourceBinding || sourceBinding.sha256 !== EXPECTED_SOURCE_SHA256 || sourceBinding.textNormalization !== "LF") {
    fail("AEGIS_CANONICAL_REPAIR_PACKAGE_INVALID", "canonical JSON source binding differs")
  }
  return { manifest, repair, sourceBinding }
}

export function validateCanonicalJsonRepairManifest(manifest) {
  return validateManifest(structuredClone(manifest))
}

function validateAuthority(manifest, repair, sourceBinding, authority, now) {
  if (!exactKeys(authority, AUTHORITY_KEYS) || authority.schemaVersion !== 1
    || !UUID.test(authority.authorityId ?? "") || !UUID.test(authority.previousProvisioningAuthorityId ?? "")
    || authority.singleUse !== true) {
    fail("AEGIS_CANONICAL_REPAIR_AUTHORITY_INVALID", "repair authority format differs")
  }
  if (authority.consumed !== false) fail("AEGIS_CANONICAL_REPAIR_AUTHORITY_REPLAY", "repair authority is consumed")
  const installedAssetSha256 = Object.fromEntries(repair.installedAssets.map(({ id, sha256: digest }) => [id, digest]))
  const expected = {
    repairId: repair.id,
    packageId: manifest.packageId,
    manifestSha256: canonicalSha256(manifest),
    repository: manifest.trustedMain.repository,
    trustedMainCommit: manifest.trustedMain.commit,
    machineIdSha256: manifest.identity.machineIdSha256,
    previousProvisioningManifestSha256: repair.previousAppliedManifestSha256,
    installedAssetSha256,
    sourceSha256: sourceBinding.sha256,
    targetPath: TARGET_PATH,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!same(authority[key], value)) fail("AEGIS_CANONICAL_REPAIR_AUTHORITY_SCOPE_MISMATCH", `${key} differs`)
  }
  for (const key of [
    "previousProvisioningJournalSha256",
    "previousProvisioningPlanSha256",
    "installedReleaseManifestSha256",
    "installedAuthorizedKeysSha256",
  ]) {
    if (!SHA256.test(authority[key] ?? "")) fail("AEGIS_CANONICAL_REPAIR_AUTHORITY_SCOPE_MISMATCH", `${key} is invalid`)
  }
  const issued = Date.parse(authority.issuedAt)
  const expires = Date.parse(authority.expiresAt)
  const current = Date.parse(now)
  const maximumAgeMs = repair.authorityMaximumAgeSeconds * 1000
  if (!canonicalTimestamp(authority.issuedAt) || !canonicalTimestamp(authority.expiresAt)
    || !canonicalTimestamp(now) || expires <= issued || expires - issued > maximumAgeMs
    || current < issued || current >= expires) {
    fail("AEGIS_CANONICAL_REPAIR_AUTHORITY_EXPIRED", "repair authority is outside its bounded validity window")
  }
}

function verifyMachine(fsApi, processApi, hostname, expectedMachineSha256, injectedMachineSha256) {
  if (processApi.platform !== "linux") fail("AEGIS_CANONICAL_REPAIR_LINUX_REQUIRED", "repair is Linux-only")
  if (typeof processApi.getuid !== "function" || processApi.getuid() !== 0) {
    fail("AEGIS_CANONICAL_REPAIR_ROOT_REQUIRED", "repair requires effective root")
  }
  if (hostname() !== "aegis") fail("AEGIS_CANONICAL_REPAIR_HOST_REJECTED", "exact aegis hostname is required")
  let observed = injectedMachineSha256
  if (observed === undefined) {
    const machineId = readStableFile(fsApi, "/etc/machine-id", { maximumBytes: 128 }).toString("utf8").trim()
    if (!/^[a-fA-F0-9]{32}$/.test(machineId)) fail("AEGIS_CANONICAL_REPAIR_MACHINE_REJECTED", "machine identity is invalid")
    observed = sha256(Buffer.from(machineId, "utf8"))
  }
  if (observed !== expectedMachineSha256) fail("AEGIS_CANONICAL_REPAIR_MACHINE_REJECTED", "machine identity differs")
}

function validateHistoricalPlan(plan, manifest, repair, authority) {
  if (canonicalSha256(plan) !== authority.previousProvisioningPlanSha256) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_PLAN_INVALID", "historical mutation plan digest differs from repair authority")
  }
  if (!same(plan, repair.previousPlannedMutations) || !same(plan, EXPECTED_HISTORICAL_PLAN)) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_PLAN_INVALID", "historical mutation plan order or content differs")
  }
}

function normalizeCompletedForPlan(completed, authority, repair) {
  const expectedFileSha256 = {
    ...Object.fromEntries(repair.installedAssets.map(({ id, sha256: digest }) => [id, digest])),
    "authorized-keys": authority.installedAuthorizedKeysSha256,
    "release-manifest": authority.installedReleaseManifestSha256,
  }
  return completed.map((operation) => {
    if (operation?.type !== "INSTALL_FILE") return operation
    if (!exactKeys(operation, ["type", "id", "path", "sha256"])
      || !SHA256.test(operation.sha256 ?? "") || operation.sha256 !== expectedFileSha256[operation.id]) {
      fail("AEGIS_CANONICAL_REPAIR_PRIOR_JOURNAL_INVALID", `historical file digest differs: ${operation?.id ?? "<invalid>"}`)
    }
    const plannedOperation = { ...operation }
    delete plannedOperation.sha256
    return plannedOperation
  })
}

function verifyPreviousJournal(bytes, authority, manifest, repair) {
  if (sha256(bytes) !== authority.previousProvisioningJournalSha256) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", "previous provisioning journal digest differs")
  }
  let records
  try {
    records = bytes.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line))
  } catch {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_JOURNAL_INVALID", "previous provisioning journal is malformed")
  }
  if (records.length < 3 || records.some((record, index) => record?.sequence !== index)
    || records.some(({ record_type }) => record_type === "APPLY_FAILED_PARTIAL_STATE")) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_JOURNAL_INVALID", "previous provisioning journal sequence or terminal state differs")
  }
  const consumed = records[0]
  const complete = records.at(-1)
  const mutationDescription = (record) => {
    const description = { ...record }
    delete description.record_type
    delete description.sequence
    return description
  }
  const started = records.filter(({ record_type }) => record_type === "MUTATION_STARTED")
    .map(mutationDescription)
  const completed = records.filter(({ record_type }) => record_type === "MUTATION_COMPLETED")
    .map(mutationDescription)
  const normalizedCompleted = normalizeCompletedForPlan(completed, authority, repair)
  if (consumed.schema_version !== "1.0-aegis-standing-hash-mutation-journal"
    || consumed.record_type !== "AUTHORITY_CONSUMED"
    || consumed.authority_id !== authority.previousProvisioningAuthorityId
    || consumed.package_id !== manifest.packageId
    || consumed.manifest_sha256 !== authority.previousProvisioningManifestSha256
    || !Array.isArray(consumed.planned_mutations)
    || complete.record_type !== "APPLY_COMPLETE" || complete.replay_epoch_initialized !== false
    || complete.workload_executed !== false || complete.scheduler_activated !== false
    || complete.completed_mutation_count !== completed.length
    || records.length !== 2 + (completed.length * 2)
    || !same(started, completed) || !same(consumed.planned_mutations, normalizedCompleted)
    || completed.some((description, index) => records[(index * 2) + 1]?.record_type !== "MUTATION_STARTED"
      || records[(index * 2) + 2]?.record_type !== "MUTATION_COMPLETED")) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_JOURNAL_INVALID", "previous provisioning did not complete its exact plan")
  }
  validateHistoricalPlan(consumed.planned_mutations, manifest, repair, authority)
  return { records, completed }
}

function canonicalRepository(value) {
  const normalized = String(value).trim().replace(/\\/g, "/")
  if ([
    "https://github.com/bsvalues/terragroq.git",
    "https://github.com/bsvalues/terragroq",
    "git@github.com:bsvalues/terragroq.git",
    "ssh://git@github.com/bsvalues/terragroq.git",
    "ssh://git@ssh.github.com:443/bsvalues/terragroq.git",
  ].includes(normalized)) return "bsvalues/terragroq"
  fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_REPOSITORY_REJECTED", "historical checkout origin is not bsvalues/terragroq")
}

function validateHistoricalGitConfig(fsApi, checkoutRoot) {
  const configPath = path.posix.join(checkoutRoot, ".git", "config")
  hardenedRegularFileMode(fsApi.lstatSync(configPath), { executable: false, label: ".git/config" })
  const text = readStableFile(fsApi, configPath, {
    uid: 0,
    gid: 0,
    direct: true,
    nonWritable: true,
    maximumBytes: 64 * 1024,
  }).toString("utf8").replace(/\r\n/g, "\n")
  if (text.includes("\0") || /\\\n/.test(text)) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_CONFIG_INVALID", "historical Git config contains ambiguous data")
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
        fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_CONFIG_INVALID", `historical Git config section differs: ${section.name}`)
      }
      continue
    }
    if (!section) fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_CONFIG_INVALID", "historical Git config key has no section")
    const assignment = /^([A-Za-z][A-Za-z0-9.-]*)\s*=\s*(.*)$/.exec(line)
    if (!assignment) fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_CONFIG_INVALID", "historical Git config line is unsupported")
    const key = assignment[1].toLowerCase()
    const value = assignment[2].trim()
    const qualified = `${section.name}.${section.subsection ?? ""}.${key}`
    const allowed = section.name === "core"
      ? section.subsection === null
        && ["repositoryformatversion", "filemode", "bare", "logallrefupdates", "ignorecase", "precomposeunicode"].includes(key)
      : section.name === "remote"
        ? section.subsection === "origin" && ["url", "fetch"].includes(key)
        : section.subsection !== null && ["remote", "merge"].includes(key)
    if (!allowed || seen.has(qualified)) {
      fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_CONFIG_INVALID", `historical Git config key differs: ${qualified}`)
    }
    if (qualified === "core..repositoryformatversion" && value !== "0"
      || qualified === "core..filemode" && value !== "true"
      || qualified === "core..bare" && value !== "false"
      || qualified === "remote.origin.fetch" && value !== "+refs/heads/*:refs/remotes/origin/*"
      || section.name === "branch" && key === "remote" && value !== "origin"
      || section.name === "branch" && key === "merge" && !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(value)) {
      fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_CONFIG_INVALID", `historical Git config value differs: ${qualified}`)
    }
    if (qualified === "remote.origin.url") canonicalRepository(value)
    seen.set(qualified, value)
  }
  if (seen.get("core..repositoryformatversion") !== "0"
    || seen.get("core..filemode") !== "true"
    || seen.get("core..bare") !== "false"
    || !seen.has("remote.origin.url") || !seen.has("remote.origin.fetch")) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_CONFIG_INVALID", "historical Git config lacks its exact required identity")
  }
}

function validateTrackedFileMetadata(fsApi, checkoutRoot, bytes, requiredPaths) {
  const entries = bytes.toString("utf8").split("\0").filter(Boolean)
  const seen = new Set()
  const trackedFiles = []
  const ancestorDirectories = new Set()
  for (const entry of entries) {
    const match = /^(100644|100755) [a-f0-9]{40,64} 0\t([^\0]+)$/.exec(entry)
    if (!match) fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_INDEX_INVALID", "historical index contains a non-regular or staged entry")
    const relativePath = match[2]
    if (path.posix.isAbsolute(relativePath) || relativePath.includes("\\")
      || path.posix.normalize(relativePath) !== relativePath || relativePath.startsWith("../") || seen.has(relativePath)) {
      fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_INDEX_INVALID", "historical index path is unsafe or duplicated")
    }
    seen.add(relativePath)
    let ancestor = path.posix.dirname(relativePath)
    while (ancestor !== ".") {
      ancestorDirectories.add(ancestor)
      ancestor = path.posix.dirname(ancestor)
    }
    trackedFiles.push({ relativePath, executable: match[1] === "100755" })
  }
  for (const relativeDirectory of [...ancestorDirectories].sort((left, right) =>
    left.split("/").length - right.split("/").length || left.localeCompare(right))) {
    const directoryPath = path.posix.join(checkoutRoot, relativeDirectory)
    assertHardenedCheckoutDirectory(fsApi, directoryPath, relativeDirectory)
  }
  for (const { relativePath, executable } of trackedFiles) {
    const installedPath = path.posix.join(checkoutRoot, relativePath)
    const stats = fsApi.lstatSync(installedPath)
    hardenedRegularFileMode(stats, { executable, label: relativePath })
    if (fsApi.realpathSync(installedPath) !== installedPath) {
      fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_FILE_METADATA_DRIFT", `${relativePath} is indirect`)
    }
  }
  if (trackedFiles.length === 0 || requiredPaths.some((relativePath) => !seen.has(relativePath))) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_INDEX_INVALID", "historical index omits the required release closure")
  }
}

function validateHistoricalCheckout(fsApi, manifest, gitRunner) {
  const checkoutRoot = manifest.reviewedRelease.releaseRoot
  const gitRoot = path.posix.join(checkoutRoot, ".git")
  assertDirectDirectory(fsApi, checkoutRoot, { uid: 0, gid: 0, mode: 0o755 })
  assertHardenedCheckoutDirectory(fsApi, gitRoot, ".git")
  const alternatesPath = path.posix.join(gitRoot, "objects", "info", "alternates")
  if (existsNoFollow(fsApi, alternatesPath).exists) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_ALTERNATES_REJECTED", "historical checkout uses Git object alternates")
  }
  validateHistoricalGitConfig(fsApi, checkoutRoot)
  const run = (args, options) => gitRunner(["-C", checkoutRoot, ...args], "/", options)
  const topLevel = run(["rev-parse", "--show-toplevel"]).stdout.toString("utf8").trim()
  if (path.posix.resolve(topLevel) !== checkoutRoot) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_INVALID", "historical checkout is not the exact Git top level")
  }
  const head = run(["rev-parse", "--verify", "HEAD^{commit}"]).stdout.toString("utf8").trim()
  const symbolic = run(["symbolic-ref", "-q", "HEAD"], { acceptedStatuses: [0, 1] })
  const headPath = path.posix.join(gitRoot, "HEAD")
  hardenedRegularFileMode(fsApi.lstatSync(headPath), { executable: false, label: ".git/HEAD" })
  const headText = readStableFile(fsApi, headPath, {
    uid: 0,
    gid: 0,
    direct: true,
    nonWritable: true,
    maximumBytes: 128,
  }).toString("utf8")
  if (head !== EXPECTED_COMMIT || symbolic.status !== 1 || symbolic.stdout.length !== 0
    || headText !== `${EXPECTED_COMMIT}\n`) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_HEAD_MISMATCH", "historical checkout is not detached at the exact trusted commit")
  }
  const origin = run(["remote", "get-url", "--all", "origin"]).stdout.toString("utf8").trim().split(/\r?\n/)
  if (origin.length !== 1 || canonicalRepository(origin[0]) !== manifest.reviewedRelease.repository) {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_REPOSITORY_REJECTED", "historical checkout origin differs")
  }
  if (run(["status", "--porcelain=v1", "--untracked-files=all"]).stdout.toString("utf8") !== "") {
    fail("AEGIS_CANONICAL_REPAIR_CHECKOUT_DIRTY", "historical checkout contains tracked or untracked changes")
  }
  validateTrackedFileMetadata(
    fsApi,
    checkoutRoot,
    run(["ls-files", "--stage", "-z"]).stdout,
    manifest.reviewedRelease.runtimeClosurePaths,
  )
}

function validateInstalledState(fsApi, manifest, repair, authority, previous, account) {
  for (const asset of repair.installedAssets) {
    const bytes = readStableFile(fsApi, asset.path, { uid: 0, gid: 0, mode: Number.parseInt(asset.mode, 8), direct: true })
    if (sha256(bytes) !== asset.sha256) {
      fail("AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", `${asset.id} digest differs from successful provisioning`)
    }
  }
  for (const directoryPath of [
    "/opt/williamos",
    "/opt/williamos/releases",
    "/usr/local/libexec/williamos",
    "/etc/williamos",
    "/etc/williamos/fabric",
  ]) {
    assertDirectDirectory(fsApi, directoryPath, { uid: 0, gid: 0, mode: 0o755 })
  }
  for (const directoryPath of [...EXPECTED_PRIVATE_ROOTS, "/home/williamos-fabric/.ssh"]) {
    assertDirectDirectory(fsApi, directoryPath, { ...account, mode: 0o700 })
  }
  const authorizedKeyBytes = readStableFile(fsApi, AUTHORIZED_KEYS_PATH,
    { ...account, mode: 0o600, direct: true, maximumBytes: 16 * 1024 })
  const authorizedKeyText = authorizedKeyBytes.toString("utf8")
  if (sha256(authorizedKeyBytes) !== authority.installedAuthorizedKeysSha256
    || !authorizedKeyText.startsWith(AUTHORIZED_KEY_PREFIX)
    || !/^[^\r\n ]+\n$/.test(authorizedKeyText.slice(AUTHORIZED_KEY_PREFIX.length))
    || authorizedKeyText.trimEnd().split(/\r?\n/).length !== 1) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", "installed restricted authorized key differs")
  }

  assertDirectDirectory(fsApi, manifest.reviewedRelease.releaseRoot, { uid: 0, gid: 0, mode: 0o755 })
  assertHardenedCheckoutDirectory(fsApi, path.posix.join(manifest.reviewedRelease.releaseRoot, ".git"), ".git")
  const releaseHead = readStableFile(fsApi, path.posix.join(manifest.reviewedRelease.releaseRoot, ".git", "HEAD"),
    { uid: 0, gid: 0, direct: true, nonWritable: true, maximumBytes: 128 }).toString("utf8")
  if (releaseHead !== `${EXPECTED_COMMIT}\n`) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", "installed release checkout HEAD differs")
  }
  for (const relativePath of manifest.reviewedRelease.runtimeClosurePaths) {
    const expectedDigest = manifest.bindings.find(({ path: bindingPath }) => bindingPath === relativePath)?.sha256
    const installedPath = path.posix.join(manifest.reviewedRelease.releaseRoot, relativePath)
    const bytes = normalizeLf(readStableFile(fsApi, installedPath,
      { uid: 0, gid: 0, direct: true, nonWritable: true }))
    if (sha256(bytes) !== expectedDigest) {
      fail("AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", `installed release artifact differs: ${relativePath}`)
    }
  }
  const releaseBytes = readStableFile(fsApi, repair.trustedReleaseManifestPath,
    { uid: 0, gid: 0, mode: 0o444, direct: true })
  if (sha256(releaseBytes) !== authority.installedReleaseManifestSha256) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", "installed trusted release manifest digest differs")
  }
  const release = parseJson(releaseBytes, "AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", "trusted release manifest")
  const { release_manifest_sha256: retainedDigest, ...body } = release
  const expectedClosure = Object.fromEntries(manifest.reviewedRelease.runtimeClosurePaths.map((relativePath) => [
    relativePath,
    manifest.bindings.find(({ path: bindingPath }) => bindingPath === relativePath)?.sha256,
  ]))
  if (release.schema_version !== manifest.reviewedRelease.manifestSchemaVersion
    || release.repository !== manifest.trustedMain.repository || release.trusted_ref !== manifest.trustedMain.ref
    || release.head_commit !== manifest.trustedMain.commit || release.release_root !== manifest.reviewedRelease.releaseRoot
    || release.reviewed !== true || !same(release.file_sha256, expectedClosure)
    || retainedDigest !== canonicalSha256(body)) {
    fail("AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT", "trusted release manifest semantics differ")
  }
}

/**
 * @param {{authority?:object, mode?:string, repoRoot?:string, fsApi?:RepairFsApi, processApi?:RepairProcessApi,
 * hostname?:()=>string, clock?:()=>string, machineIdentitySha256?:string, randomUUID?:()=>string,
 * gitRunner?:(args:string[], cwd:string)=>{status:number|null,stdout:Buffer,stderr?:Buffer,error?:Error}}} [options]
 */
export function repairAegisStandingHashCanonicalJson({
  authority,
  mode = "dry-run",
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  fsApi = fs,
  processApi = process,
  hostname = os.hostname,
  clock = () => new Date().toISOString(),
  machineIdentitySha256,
  randomUUID = crypto.randomUUID,
  gitRunner = runFixedGit,
} = {}) {
  if (!["dry-run", "apply"].includes(mode)) fail("AEGIS_CANONICAL_REPAIR_MODE_INVALID", "mode must be dry-run or apply")
  const manifestPath = path.resolve(repoRoot, ...MANIFEST_PATH.split("/"))
  const { manifest, repair, sourceBinding } = validateManifest(parseJson(
    readStableFile(fsApi, manifestPath),
    "AEGIS_CANONICAL_REPAIR_PACKAGE_INVALID",
    "provisioning manifest",
  ))
  verifyMachine(fsApi, processApi, hostname, manifest.identity.machineIdSha256, machineIdentitySha256)
  const account = resolveServiceAccount(fsApi)
  const now = clock()
  validateAuthority(manifest, repair, sourceBinding, authority, now)

  const sourcePath = path.resolve(repoRoot, ...repair.sourcePath.split("/"))
  const sourceBytes = normalizeLf(readStableFile(fsApi, sourcePath))
  if (sha256(sourceBytes) !== sourceBinding.sha256) {
    fail("AEGIS_CANONICAL_REPAIR_SOURCE_DRIFT", "canonical JSON source differs from the manifest binding")
  }
  const repairJournalPath = `${REPAIR_JOURNAL_PREFIX}${authority.authorityId}.journal.jsonl`
  if (existsNoFollow(fsApi, repairJournalPath).exists) {
    throw journalPersistenceError(
      "AEGIS_CANONICAL_REPAIR_AUTHORITY_REPLAY",
      "repair authority journal already exists",
      null,
      repairJournalPath,
      "PREFLIGHT_EXISTING_JOURNAL",
      "UNKNOWN_EXISTING",
    )
  }
  const target = existsNoFollow(fsApi, TARGET_PATH)
  if (target.exists) fail("AEGIS_CANONICAL_REPAIR_TARGET_EXISTS", "target exists; overwrite and adoption are refused")
  assertSafeRootParent(fsApi, TARGET_PATH)

  const previousJournalPath = `${PREVIOUS_JOURNAL_PREFIX}${authority.previousProvisioningAuthorityId}.mutation-journal.jsonl`
  const previousBytes = readStableFile(fsApi, previousJournalPath, { uid: 0, gid: 0, mode: 0o600, direct: true })
  const previous = verifyPreviousJournal(previousBytes, authority, manifest, repair)
  validateHistoricalCheckout(fsApi, manifest, gitRunner)
  validateInstalledState(fsApi, manifest, repair, authority, previous, account)

  const evidence = {
    schema_version: "1.0-aegis-standing-hash-canonical-json-repair-evidence",
    status: mode === "apply" ? "APPLY_PENDING" : "DRY_RUN",
    mode: mode.toUpperCase(),
    repair_id: repair.id,
    authority_id: authority.authorityId,
    authority_consumed: false,
    previous_provisioning_authority_id: authority.previousProvisioningAuthorityId,
    previous_provisioning_journal_sha256: authority.previousProvisioningJournalSha256,
    previous_provisioning_plan_sha256: authority.previousProvisioningPlanSha256,
    trusted_release_manifest_sha256: authority.installedReleaseManifestSha256,
    installed_authorized_keys_sha256: authority.installedAuthorizedKeysSha256,
    target_path: TARGET_PATH,
    target_sha256: sourceBinding.sha256,
    repair_journal: mode === "apply" ? repairJournalPath : null,
    target_installed: false,
    replay_epoch_initialized: false,
    workload_executed: false,
    scheduler_activated: false,
    network_accessed: false,
  }
  if (mode === "dry-run") return evidence

  const applyAt = clock()
  validateAuthority(manifest, repair, sourceBinding, authority, applyAt)
  createJournal(fsApi, repairJournalPath, {
    schema_version: "1.0-aegis-standing-hash-canonical-json-repair-journal",
    record_type: "AUTHORITY_CONSUMED",
    sequence: 0,
    authority_id: authority.authorityId,
    authority_sha256: canonicalSha256(authority),
    repair_id: repair.id,
    manifest_sha256: authority.manifestSha256,
    previous_provisioning_authority_id: authority.previousProvisioningAuthorityId,
    previous_provisioning_manifest_sha256: authority.previousProvisioningManifestSha256,
    previous_provisioning_journal_sha256: authority.previousProvisioningJournalSha256,
    previous_provisioning_plan_sha256: authority.previousProvisioningPlanSha256,
    installed_release_manifest_sha256: authority.installedReleaseManifestSha256,
    installed_authorized_keys_sha256: authority.installedAuthorizedKeysSha256,
    consumed_at: applyAt,
    target_path: TARGET_PATH,
    target_sha256: sourceBinding.sha256,
  })
  evidence.authority_consumed = true
  try {
    const retainedPreviousBytes = readStableFile(fsApi, previousJournalPath, { uid: 0, gid: 0, mode: 0o600, direct: true })
    const retainedPrevious = verifyPreviousJournal(retainedPreviousBytes, authority, manifest, repair)
    validateInstalledState(fsApi, manifest, repair, authority, retainedPrevious, account)
    installExclusive(fsApi, sourceBytes, randomUUID)
    const installedBytes = readStableFile(fsApi, TARGET_PATH, { uid: 0, gid: 0, mode: 0o444, direct: true })
    if (sha256(installedBytes) !== sourceBinding.sha256) {
      fail("AEGIS_CANONICAL_REPAIR_INSTALL_VERIFY_FAILED", "installed canonical JSON digest differs")
    }
    appendJournal(fsApi, repairJournalPath, {
      record_type: "REPAIR_COMPLETE",
      sequence: 1,
      completed_at: clock(),
      target_path: TARGET_PATH,
      target_sha256: sourceBinding.sha256,
      target_owner: "root",
      target_group: "root",
      target_mode: "0444",
      target_single_link: true,
      replay_epoch_initialized: false,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    })
  } catch (error) {
    if (error?.code === "AEGIS_CANONICAL_REPAIR_TERMINAL_STATE_UNCERTAIN") {
      error.targetInstalled = existsNoFollow(fsApi, TARGET_PATH).exists
      throw error
    }
    let failure = error
    if (!String(error?.code ?? "").startsWith("AEGIS_CANONICAL_REPAIR_")) {
      failure = new Error("AEGIS_CANONICAL_REPAIR_WRITE_FAILED: exclusive target installation failed", { cause: error })
      failure.code = "AEGIS_CANONICAL_REPAIR_WRITE_FAILED"
      failure.causeCode = error?.code ?? null
    }
    try {
      appendJournal(fsApi, repairJournalPath, {
        record_type: "REPAIR_FAILED",
        sequence: 1,
        failed_at: clock(),
        failure_code: failure.code,
        failure_cause_code: failure.causeCode ?? null,
        target_installed: existsNoFollow(fsApi, TARGET_PATH).exists,
        workload_executed: false,
        scheduler_activated: false,
        network_accessed: false,
      })
    } catch (journalError) {
      const evidenceError = new Error("AEGIS_CANONICAL_REPAIR_EVIDENCE_WRITE_FAILED: repair failure evidence was not durable")
      evidenceError.code = "AEGIS_CANONICAL_REPAIR_EVIDENCE_WRITE_FAILED"
      evidenceError.originalFailureCode = failure.code
      evidenceError.causeCode = journalError?.code ?? "AEGIS_CANONICAL_REPAIR_JOURNAL_WRITE_FAILED"
      evidenceError.authorityConsumed = true
      evidenceError.journalPath = repairJournalPath
      evidenceError.journalMayExist = true
      evidenceError.journalDurability = "UNCERTAIN"
      evidenceError.journalPhase = journalError?.journalPhase ?? "REPAIR_FAILED"
      evidenceError.terminalRecordState = journalError?.terminalRecordState
        ?? "ABSENT_PARTIAL_OR_DURABILITY_UNCERTAIN"
      evidenceError.targetInstalled = existsNoFollow(fsApi, TARGET_PATH).exists
      throw evidenceError
    }
    failure.authorityConsumed = true
    failure.journalPath = repairJournalPath
    failure.journalMayExist = true
    failure.journalDurability = "DURABLE"
    failure.journalPhase = "REPAIR_FAILED"
    failure.terminalRecordState = "REPAIR_FAILED_DURABLE"
    failure.targetInstalled = existsNoFollow(fsApi, TARGET_PATH).exists
    throw failure
  }
  return { ...evidence, status: "REPAIRED", authority_consumed: true, target_installed: true }
}

export function canonicalJsonRepairErrorEvidence(error) {
  return {
    schema_version: "1.0-aegis-standing-hash-canonical-json-repair-error",
    status: "FAILED_CLOSED",
    code: error?.code ?? "AEGIS_CANONICAL_REPAIR_REJECTED",
    detail: String(error?.message ?? error).slice(0, 512),
    authority_consumed: error?.authorityConsumed === true,
    repair_journal: error?.journalPath ?? null,
    journal_may_exist: error?.journalMayExist === true,
    journal_durability: error?.journalDurability ?? "NOT_CREATED",
    journal_phase: error?.journalPhase ?? null,
    terminal_record_state: error?.terminalRecordState ?? "NOT_STARTED",
    target_installed: error?.targetInstalled === true,
    original_failure_code: error?.originalFailureCode ?? null,
    cause_code: error?.causeCode ?? null,
    replay_epoch_initialized: false,
    workload_executed: false,
    scheduler_activated: false,
    network_accessed: false,
  }
}

function parseCli(argv) {
  const result = { mode: null, authorityPath: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (["--dry-run", "--apply"].includes(argument)) {
      if (result.mode !== null) fail("AEGIS_CANONICAL_REPAIR_USAGE_INVALID", "choose exactly one mode")
      result.mode = argument.slice(2)
    } else if (argument === "--authority") {
      const value = argv[++index]
      if (!value || result.authorityPath !== null) fail("AEGIS_CANONICAL_REPAIR_USAGE_INVALID", "--authority requires one path")
      result.authorityPath = path.resolve(value)
    } else {
      fail("AEGIS_CANONICAL_REPAIR_USAGE_INVALID", `unknown argument ${argument}`)
    }
  }
  if (!result.mode || !result.authorityPath) {
    fail("AEGIS_CANONICAL_REPAIR_USAGE_INVALID", "use --authority <json> and exactly one of --dry-run or --apply")
  }
  return result
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const fsApi = dependencies.fsApi ?? fs
  try {
    const cli = parseCli(argv)
    const authority = parseJson(
      readStableFile(fsApi, cli.authorityPath, { maximumBytes: 64 * 1024 }),
      "AEGIS_CANONICAL_REPAIR_AUTHORITY_INVALID",
      "repair authority",
    )
    const evidence = repairAegisStandingHashCanonicalJson({ ...dependencies, fsApi, authority, mode: cli.mode })
    ;(dependencies.stdout ?? process.stdout).write(`${canonicalize(evidence)}\n`)
    return 0
  } catch (error) {
    ;(dependencies.stderr ?? process.stderr).write(`${canonicalize(canonicalJsonRepairErrorEvidence(error))}\n`)
    return error?.code === "AEGIS_CANONICAL_REPAIR_USAGE_INVALID" ? 64 : 2
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) process.exitCode = main()
