import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { readBoundedRegularFile } from "./proposal-artifacts.mjs"
import { assertApplicationProposalRuntimePath, resolveApplicationProposalRuntimeRoot } from "./proposal-runtime-root.mjs"

// Portable Node has no inode-conditional unlink. Capture the trusted intrinsic
// once so final deletion of a verified, unguessable release path has no
// mutable hook or application callback between its last identity check and
// the filesystem call. Other cleanup keeps the injectable path used by tests.
const unlinkSyncIntrinsic = fs.unlinkSync.bind(fs)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const REAPER_WAIT_MS = 5_000
const MAX_LOCK_BYTES = 16 * 1024
const MAX_LOCK_DIRECTORY_ENTRIES = 256
const activeRecoveryClaims = new Set()
const activeRepositoryLocks = new Set()
const activePrivatePublications = new Set()
const repositoryLockGuardRegistryKey = Symbol.for("williamos.applicationProposalRepositoryLockGuards.v1")
const repositoryLockGuards = globalThis[repositoryLockGuardRegistryKey] instanceof Map
  ? globalThis[repositoryLockGuardRegistryKey]
  : new Map()
globalThis[repositoryLockGuardRegistryKey] = repositoryLockGuards
const lockReadBackoff = new Int32Array(new SharedArrayBuffer(4))
let ownProcessIdentity

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex")
const canonical = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value)
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
function readLock(target, allowMissing = false, directoryGuard) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      assertLockDirectoryGuard(directoryGuard)
      repairInterruptedLockPublication(target, directoryGuard)
      assertLockDirectoryGuard(directoryGuard)
      const bytes = readBoundedRegularFile(target, {
        maxBytes: MAX_LOCK_BYTES,
        errorCode: "APPLICATION_PROPOSAL_LOCK_UNCERTAIN",
        allowMissing,
      })
      assertLockDirectoryGuard(directoryGuard)
      return bytes
    } catch (error) {
      // `syncedExclusive` publishes with a hard-link then immediately removes
      // its private name. Another process may observe that owned nlink=2
      // window; retry briefly, while persistent/hostile links still fail shut.
      if (attempt === 8 || error?.message !== "APPLICATION_PROPOSAL_LOCK_UNCERTAIN") throw error
      Atomics.wait(lockReadBackoff, 0, 0, 1)
    }
  }
}
const readLockText = (target, directoryGuard) => readLock(target, false, directoryGuard).toString("utf8")

function privatePublicationPath(publicationTarget, content) {
  return `${publicationTarget}.${digest(content)}.write`
}

function publicationToken(content) {
  try {
    const value = JSON.parse(content)
    return UUID.test(value?.token) ? value.token : null
  } catch { return null }
}

function sameFileIdentity(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino)
}

function captureLockDirectoryIdentity(runtimeRoot, directory) {
  try {
    const exact = assertApplicationProposalRuntimePath(runtimeRoot, directory)
    const stat = fs.lstatSync(exact, { bigint: true })
    const realPath = fs.realpathSync(exact)
    if (!stat.isDirectory() || stat.isSymbolicLink() || canonical(realPath) !== canonical(exact)) throw new Error()
    return Object.freeze({ dev: stat.dev, ino: stat.ino, realPath: canonical(realPath) })
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
}

function assertLockDirectoryIdentity(runtimeRoot, directory, expected) {
  try {
    const exact = assertApplicationProposalRuntimePath(runtimeRoot, directory)
    const stat = fs.lstatSync(exact, { bigint: true })
    const realPath = fs.realpathSync(exact)
    if (!expected || !stat.isDirectory() || stat.isSymbolicLink()
      || !sameFileIdentity(stat, expected) || canonical(realPath) !== expected.realPath
      || canonical(realPath) !== canonical(exact)) throw new Error()
    return exact
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
}

function assertLockDirectoryGuard(guard) {
  if (!guard) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  return assertLockDirectoryIdentity(guard.runtimeRoot, guard.directory, guard.directoryIdentity)
}

function guardedUnlinkOwnedPrivateFile(
  target,
  expectedStat,
  allowedLinks,
  directoryGuard,
  beforeUnlink,
  trustedFinalUnlink = false,
) {
  assertLockDirectoryGuard(directoryGuard)
  const removed = unlinkOwnedPrivateFile(
    target,
    expectedStat,
    allowedLinks,
    () => {
      beforeUnlink?.()
      assertLockDirectoryGuard(directoryGuard)
    },
    trustedFinalUnlink ? unlinkSyncIntrinsic : undefined,
  )
  assertLockDirectoryGuard(directoryGuard)
  return removed
}

function confirmExactChildMissing(runtimeRoot, directory, directoryIdentity, candidate) {
  assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
  if (canonical(path.dirname(candidate)) !== canonical(directory)) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  try {
    fs.lstatSync(candidate)
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_LOCK_UNCERTAIN" || error?.code !== "ENOENT") {
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
  }
  assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
  return null
}

function unlinkOwnedPrivateFile(
  target,
  expectedStat,
  allowedLinks = [1n, 2n],
  beforeUnlink,
  unlink = fs.unlinkSync,
) {
  let current
  try { current = fs.lstatSync(target, { bigint: true }) }
  catch (error) {
    if (error?.code === "ENOENT") return false
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  if (!current.isFile() || current.isSymbolicLink() || !sameFileIdentity(current, expectedStat)
    || !allowedLinks.includes(current.nlink)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  beforeUnlink?.()
  try {
    const immediate = fs.lstatSync(target, { bigint: true })
    if (!immediate.isFile() || immediate.isSymbolicLink() || !sameFileIdentity(immediate, expectedStat)
      || !allowedLinks.includes(immediate.nlink)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_LOCK_UNCERTAIN" || error?.code !== "ENOENT") {
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
    return false
  }
  try { unlink(target) }
  catch (error) {
    if (error?.code !== "ENOENT") throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    try {
      fs.lstatSync(target)
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    } catch (observed) {
      if (observed?.message === "APPLICATION_PROPOSAL_LOCK_UNCERTAIN" || observed?.code !== "ENOENT") {
        throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      }
      return false
    }
  }
  return true
}

function syncedPrivateFile(directory, content, runtimeRoot, publicationTarget, directoryGuard) {
  fs.mkdirSync(directory, { recursive: true })
  assertLockDirectoryGuard(directoryGuard)
  const temporary = privatePublicationPath(publicationTarget, content)
  assertApplicationProposalRuntimePath(runtimeRoot, temporary, { allowMissing: true })
  let descriptor
  let createdStat
  let complete = false
  try {
    assertLockDirectoryGuard(directoryGuard)
    descriptor = fs.openSync(temporary, "wx")
    createdStat = fs.fstatSync(descriptor, { bigint: true })
    assertLockDirectoryGuard(directoryGuard)
    fs.writeFileSync(descriptor, content)
    fs.fsyncSync(descriptor)
    assertLockDirectoryGuard(directoryGuard)
    complete = true
    return Object.freeze({ path: temporary, stat: createdStat })
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (createdStat !== undefined && !complete) {
      try { guardedUnlinkOwnedPrivateFile(temporary, createdStat, [1n], directoryGuard) }
      catch { /* the original failure retains any path whose boundary is no longer provable */ }
    }
  }
}

function removeFailedPublishedLink(target, temporary, content, directoryGuard) {
  let descriptor
  try {
    assertLockDirectoryGuard(directoryGuard)
    const expected = Buffer.from(content)
    const targetStat = fs.lstatSync(target, { bigint: true })
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.size !== BigInt(expected.length)
      || targetStat.nlink < 1n || targetStat.nlink > 2n) throw new Error()
    if (fs.existsSync(temporary)) {
      const privateStat = fs.lstatSync(temporary, { bigint: true })
      if (String(privateStat.dev) !== String(targetStat.dev) || String(privateStat.ino) !== String(targetStat.ino)) throw new Error()
    }
    const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow)
    const opened = fs.fstatSync(descriptor, { bigint: true })
    if (String(opened.dev) !== String(targetStat.dev) || String(opened.ino) !== String(targetStat.ino)) throw new Error()
    const actual = Buffer.alloc(expected.length)
    let offset = 0
    while (offset < actual.length) {
      const count = fs.readSync(descriptor, actual, offset, actual.length - offset, offset)
      if (count <= 0) throw new Error()
      offset += count
    }
    if (!actual.equals(expected)) throw new Error()
    assertLockDirectoryGuard(directoryGuard)
    fs.unlinkSync(target)
    assertLockDirectoryGuard(directoryGuard)
    if (fs.existsSync(target)) throw new Error()
    assertLockDirectoryGuard(directoryGuard)
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* cleanup already decided */ } }
}

function syncedExclusive(target, content, runtimeRoot, directoryGuard, onLinked, onPrivateStaged) {
  const directory = path.dirname(target)
  let privateFile
  let published = false
  const token = publicationToken(content)
  if (token) activePrivatePublications.add(token)
  try {
    privateFile = syncedPrivateFile(directory, content, runtimeRoot, target, directoryGuard)
    onPrivateStaged?.()
    assertLockDirectoryGuard(directoryGuard)
    fs.linkSync(privateFile.path, target)
    published = true
    onLinked?.()
    guardedUnlinkOwnedPrivateFile(privateFile.path, privateFile.stat, [2n], directoryGuard)
    if (readLockText(target, directoryGuard) !== content) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  } catch (error) {
    if (published) removeFailedPublishedLink(target, privateFile.path, content, directoryGuard)
    throw error
  } finally {
    if (token) activePrivatePublications.delete(token)
    if (privateFile) guardedUnlinkOwnedPrivateFile(privateFile.path, privateFile.stat, [1n, 2n], directoryGuard)
  }
}

function atomicReplace(target, expected, content, runtimeRoot, directoryGuard, onPrivateStaged) {
  const directory = path.dirname(target)
  assertLockDirectoryGuard(directoryGuard)
  if (readLockText(target, directoryGuard) !== expected) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  const token = publicationToken(content)
  let privateFile
  if (token) activePrivatePublications.add(token)
  try {
    privateFile = syncedPrivateFile(directory, content, runtimeRoot, target, directoryGuard)
    onPrivateStaged?.()
    assertLockDirectoryGuard(directoryGuard)
    if (readLockText(target, directoryGuard) !== expected) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        assertLockDirectoryGuard(directoryGuard)
        fs.renameSync(privateFile.path, target)
        assertLockDirectoryGuard(directoryGuard)
        break
      }
      catch (error) {
        if (attempt === 5 || !["EACCES", "EBUSY", "EPERM"].includes(error?.code)) throw error
      }
    }
    if (readLockText(target, directoryGuard) !== content) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  } finally {
    if (token) activePrivatePublications.delete(token)
    if (privateFile) guardedUnlinkOwnedPrivateFile(privateFile.path, privateFile.stat, [1n], directoryGuard)
  }
}

function parseLock(bytes, expectedRepositoryDigest) {
  let value
  try { value = JSON.parse(bytes) } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  const legacyKeys = ["schemaVersion", "token", "processId", "startedAt", "repositoryDigest", "proposalId"]
  const currentKeys = [...legacyKeys, "processIdentity"]
  const hasIdentity = Object.hasOwn(value ?? {}, "processIdentity")
  const keys = value?.schemaVersion === 1 ? legacyKeys : value?.schemaVersion === 2 ? currentKeys : []
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== keys.sort().join(",") || ![1, 2].includes(value.schemaVersion)
    || !UUID.test(value.token) || !Number.isSafeInteger(value.processId) || value.processId < 1
    || (value.schemaVersion === 1 ? hasIdentity : !hasIdentity || typeof value.processIdentity !== "string"
      || !/^(?:win|linux|posix):[A-Za-z0-9 .:+-]{1,120}$/.test(value.processIdentity))
    || typeof value.startedAt !== "string" || new Date(value.startedAt).toISOString() !== value.startedAt
    || value.repositoryDigest !== expectedRepositoryDigest || !SHA256.test(value.repositoryDigest)
    || !UUID.test(value.proposalId)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  return value
}

function parseReaper(bytes, expectedRepositoryDigest, expectedName) {
  let value
  try { value = JSON.parse(bytes) } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  const legacyKeys = ["schemaVersion", "token", "processId", "startedAt", "repositoryDigest", "ticket"]
  const currentKeys = [...legacyKeys, "processIdentity"]
  const hasIdentity = Object.hasOwn(value ?? {}, "processIdentity")
  const keys = value?.schemaVersion === 1 ? legacyKeys : value?.schemaVersion === 2 ? currentKeys : []
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== keys.sort().join(",") || ![1, 2].includes(value.schemaVersion)
    || !UUID.test(value.token) || expectedName !== `${expectedRepositoryDigest}.reap-${value.token}.json`
    || !Number.isSafeInteger(value.processId) || value.processId < 1
    || (value.schemaVersion === 1 ? hasIdentity : !hasIdentity || typeof value.processIdentity !== "string"
      || !/^(?:win|linux|posix):[A-Za-z0-9 .:+-]{1,120}$/.test(value.processIdentity))
    || typeof value.startedAt !== "string" || new Date(value.startedAt).toISOString() !== value.startedAt
    || value.repositoryDigest !== expectedRepositoryDigest || !SHA256.test(value.repositoryDigest)
    || !Number.isSafeInteger(value.ticket) || value.ticket < 0 || value.ticket > 1_000_000_000) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  return value
}

function processStartIdentity(processId) {
  if (!Number.isSafeInteger(processId) || processId < 1) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  if (processId === process.pid && ownProcessIdentity) return ownProcessIdentity
  let identity
  if (process.platform === "win32") {
    const windowsRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows"
    const executable = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const output = execFileSync(executable, [
      "-NoProfile", "-NonInteractive", "-Command",
      `$p=Get-Process -Id ${processId} -ErrorAction Stop; [Console]::Out.Write($p.StartTime.ToUniversalTime().Ticks)`,
    ], { encoding: "utf8", windowsHide: true, timeout: 5_000, maxBuffer: 4_096, stdio: ["ignore", "pipe", "ignore"] })
    if (!/^\d{10,20}$/.test(output)) throw new Error()
    identity = `win:${output}`
  } else if (process.platform === "linux") {
    const stat = fs.readFileSync(`/proc/${processId}/stat`, "utf8")
    const close = stat.lastIndexOf(")")
    const fields = close >= 0 ? stat.slice(close + 2).trim().split(/\s+/) : []
    if (!/^\d+$/.test(fields[19] ?? "")) throw new Error()
    const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
    if (!/^[0-9a-f-]{36}$/i.test(bootId)) throw new Error()
    identity = `linux:${bootId}:${fields[19]}`
  } else throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  if (processId === process.pid) ownProcessIdentity = identity
  return identity
}

function currentProcessIdentity() {
  try { return processStartIdentity(process.pid) }
  catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_LOCK_UNCERTAIN") throw error
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
}

function processAlive(value) {
  if (value.schemaVersion === 1) return processIdAlive(value.processId)
  try { process.kill(value.processId, 0) }
  catch (error) { if (error?.code !== "EPERM") return false }
  try { return processStartIdentity(value.processId) === value.processIdentity }
  catch { return true /* inability to prove staleness retains the lock */ }
}

function processIdAlive(processId) {
  try { process.kill(processId, 0); return true }
  catch (error) { return error?.code === "EPERM" }
}

function rawLinkedLockBytes(target, expectedStat) {
  let descriptor
  try {
    const size = Number(expectedStat.size)
    if (!expectedStat.isFile() || expectedStat.isSymbolicLink() || expectedStat.nlink !== 2n
      || !Number.isSafeInteger(size) || size < 1 || size > MAX_LOCK_BYTES) throw new Error()
    const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow)
    const opened = fs.fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || opened.dev !== expectedStat.dev || opened.ino !== expectedStat.ino
      || opened.size !== expectedStat.size || opened.nlink !== 2n) throw new Error()
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) throw new Error()
      offset += count
    }
    return bytes
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* read already failed closed */ } }
}

/** Complete only the dead writer's post-link publication window. The private
 * name is content-derived, and both names must still identify the same inode. */
function repairInterruptedLockPublication(target, directoryGuard) {
  assertLockDirectoryGuard(directoryGuard)
  let targetStat
  try { targetStat = fs.lstatSync(target, { bigint: true }) }
  catch (error) {
    if (error?.code === "ENOENT") return false
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  if (targetStat.nlink === 1n) return false
  const name = path.basename(target)
  const lock = /^([0-9a-f]{64})\.lock$/.exec(name)
  const reaper = /^([0-9a-f]{64})\.reap-([0-9a-f-]{36})\.json$/i.exec(name)
  if ((!lock && !reaper) || !targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 2n) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  const bytes = rawLinkedLockBytes(target, targetStat)
  assertLockDirectoryGuard(directoryGuard)
  const repositoryDigest = lock?.[1] ?? reaper[1]
  const value = lock ? parseLock(bytes, repositoryDigest) : parseReaper(bytes, repositoryDigest, name)
  if (value.schemaVersion !== 2) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  const locallyActive = value.processId === process.pid && (
    activePrivatePublications.has(value.token)
    || activeRecoveryClaims.has(value.token)
    || activeRepositoryLocks.has(value.token)
  )
  if (processAlive(value) && (value.processId !== process.pid || locallyActive)) return false

  const privatePath = `${target}.${digest(bytes)}.write`
  try {
    assertLockDirectoryGuard(directoryGuard)
    const privateStat = fs.lstatSync(privatePath, { bigint: true })
    const currentTarget = fs.lstatSync(target, { bigint: true })
    if (!privateStat.isFile() || privateStat.isSymbolicLink() || privateStat.nlink !== 2n
      || currentTarget.nlink !== 2n || privateStat.dev !== currentTarget.dev || privateStat.ino !== currentTarget.ino
      || currentTarget.dev !== targetStat.dev || currentTarget.ino !== targetStat.ino
      || !fs.readFileSync(target).equals(bytes)) throw new Error()
    assertLockDirectoryGuard(directoryGuard)
    fs.unlinkSync(privatePath)
    assertLockDirectoryGuard(directoryGuard)
    const repaired = fs.lstatSync(target, { bigint: true })
    if (repaired.dev !== targetStat.dev || repaired.ino !== targetStat.ino || repaired.nlink !== 1n) throw new Error()
    return true
  } catch (error) {
    // A concurrent live publisher may have completed between observations.
    try {
      assertLockDirectoryGuard(directoryGuard)
      const repaired = fs.lstatSync(target, { bigint: true })
      if (repaired.dev === targetStat.dev && repaired.ino === targetStat.ino && repaired.nlink === 1n) return true
    } catch { /* fail closed below */ }
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
}

/** Stable process-start identity used by durable proposal ownership records. */
export function applicationProposalProcessIdentity() {
  return currentProcessIdentity()
}

/** True only when both the PID and its OS process-start identity still match. */
export function applicationProposalProcessAlive(value) {
  if (!value || typeof value !== "object") return false
  return processAlive(value)
}

function restoreUnexpectedRenamedChild(target, releasePath, movedStat, directoryGuard) {
  assertLockDirectoryGuard(directoryGuard)
  try {
    fs.lstatSync(target)
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_LOCK_UNCERTAIN" || error?.code !== "ENOENT") {
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
  }
  const current = fs.lstatSync(releasePath, { bigint: true })
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n
    || !sameFileIdentity(current, movedStat)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  assertLockDirectoryGuard(directoryGuard)
  fs.renameSync(releasePath, target)
  assertLockDirectoryGuard(directoryGuard)
  const restored = fs.lstatSync(target, { bigint: true })
  if (!sameFileIdentity(restored, movedStat)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
}

function unlinkExact(target, expected, directoryGuard, attempts = 3, onReleaseStaged) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let renamed = false
    try {
      assertLockDirectoryGuard(directoryGuard)
      const before = fs.lstatSync(target, { bigint: true })
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
        || before.size !== BigInt(expected.length)) throw new Error()
      if (!readLock(target, false, directoryGuard).equals(expected)) throw new Error()
      assertLockDirectoryGuard(directoryGuard)
      const after = fs.lstatSync(target, { bigint: true })
      if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n
        || !sameFileIdentity(before, after) || after.size !== before.size) throw new Error()
      const releasePath = `${target}.${digest(expected)}.${crypto.randomUUID()}.release`
      assertApplicationProposalRuntimePath(directoryGuard.runtimeRoot, releasePath, { allowMissing: true })
      confirmExactChildMissing(
        directoryGuard.runtimeRoot,
        directoryGuard.directory,
        directoryGuard.directoryIdentity,
        releasePath,
      )
      fs.renameSync(target, releasePath)
      renamed = true
      assertLockDirectoryGuard(directoryGuard)
      const moved = fs.lstatSync(releasePath, { bigint: true })
      if (!moved.isFile() || moved.isSymbolicLink() || moved.nlink !== 1n
        || !sameFileIdentity(after, moved) || moved.size !== after.size) {
        restoreUnexpectedRenamedChild(target, releasePath, moved, directoryGuard)
        throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      }
      const movedBytes = readLock(releasePath, false, directoryGuard)
      const verified = fs.lstatSync(releasePath, { bigint: true })
      if (!movedBytes.equals(expected) || !sameFileIdentity(moved, verified) || verified.nlink !== 1n) {
        restoreUnexpectedRenamedChild(target, releasePath, verified, directoryGuard)
        throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      }
      onReleaseStaged?.()
      guardedUnlinkOwnedPrivateFile(releasePath, verified, [1n], directoryGuard, undefined, true)
      confirmExactChildMissing(
        directoryGuard.runtimeRoot,
        directoryGuard.directory,
        directoryGuard.directoryIdentity,
        releasePath,
      )
      assertLockDirectoryGuard(directoryGuard)
      return
    } catch (error) {
      if (renamed) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      if (attempt === attempts) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
  }
}

function boundedLockDirectoryNames(directory, runtimeRoot, directoryIdentity) {
  const names = []
  assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
  const handle = fs.opendirSync(directory)
  try {
    for (;;) {
      const entry = handle.readSync()
      if (entry === null) break
      names.push(entry.name)
      if (names.length > MAX_LOCK_DIRECTORY_ENTRIES) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  finally { try { handle.closeSync() } catch { /* scan already fails closed on ambiguity */ } }
  assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
  return names
}

function exactRuntimePathIfExists(
  runtimeRoot,
  directory,
  directoryIdentity,
  candidate,
  onPathValidated,
) {
  assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
  if (canonical(path.dirname(candidate)) !== canonical(directory)) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  try { assertApplicationProposalRuntimePath(runtimeRoot, candidate, { allowMissing: true }) }
  catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  onPathValidated?.()
  try { fs.lstatSync(candidate) }
  catch (error) {
    if (error?.code === "ENOENT") {
      return confirmExactChildMissing(runtimeRoot, directory, directoryIdentity, candidate)
    }
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  try {
    const exact = assertApplicationProposalRuntimePath(runtimeRoot, candidate)
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    return exact
  }
  catch {
    try { return confirmExactChildMissing(runtimeRoot, directory, directoryIdentity, candidate) }
    catch (error) { if (error?.message === "APPLICATION_PROPOSAL_LOCK_UNCERTAIN") throw error }
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
}

function sweepPrivateLockResidues(
  directory,
  repositoryDigest,
  runtimeRoot,
  directoryIdentity,
  names,
  onDiscovered,
  onValidated,
  onUnlinking,
) {
  const directoryGuard = { runtimeRoot, directory, directoryIdentity }
  const lockPrefix = `${repositoryDigest}.lock.`
  const reaperPrefix = `${repositoryDigest}.reap-`
  for (const name of names) {
    const isCandidate = (name.startsWith(lockPrefix) || name.startsWith(reaperPrefix))
      && (name.endsWith(".write") || name.endsWith(".release"))
    if (!isCandidate) continue
    const lockWrite = /^([0-9a-f]{64})\.lock\.([0-9a-f]{64})\.write$/.exec(name)
    const reaperWrite = /^([0-9a-f]{64})\.reap-([0-9a-f-]{36})\.json\.([0-9a-f]{64})\.write$/i.exec(name)
    const lockRelease = /^([0-9a-f]{64})\.lock\.([0-9a-f]{64})\.([0-9a-f-]{36})\.release$/i.exec(name)
    const reaperRelease = /^([0-9a-f]{64})\.reap-([0-9a-f-]{36})\.json\.([0-9a-f]{64})\.([0-9a-f-]{36})\.release$/i.exec(name)
    const residue = lockWrite
      ? { kind: "lock", mode: "write", repositoryDigest: lockWrite[1], expectedDigest: lockWrite[2] }
      : reaperWrite
        ? { kind: "reaper", mode: "write", repositoryDigest: reaperWrite[1], token: reaperWrite[2], expectedDigest: reaperWrite[3] }
        : lockRelease
          ? { kind: "lock", mode: "release", repositoryDigest: lockRelease[1], expectedDigest: lockRelease[2], nonce: lockRelease[3] }
          : reaperRelease
            ? { kind: "reaper", mode: "release", repositoryDigest: reaperRelease[1], token: reaperRelease[2], expectedDigest: reaperRelease[3], nonce: reaperRelease[4] }
            : null
    if (!residue || residue.repositoryDigest !== repositoryDigest
      || (residue.token !== undefined && !UUID.test(residue.token))
      || (residue.nonce !== undefined && !UUID.test(residue.nonce))) {
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
    onDiscovered?.()
    let target = exactRuntimePathIfExists(
      runtimeRoot,
      directory,
      directoryIdentity,
      path.join(directory, name),
      () => onValidated?.("path"),
    )
    if (target === null) continue
    const publicName = residue.kind === "lock"
      ? `${repositoryDigest}.lock`
      : `${repositoryDigest}.reap-${residue.token}.json`
    const publicTarget = assertApplicationProposalRuntimePath(
      runtimeRoot,
      path.join(directory, publicName),
      { allowMissing: true },
    )
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    // A post-link crash leaves the exact private name at nlink=2. Complete
    // that already-published record through the stronger two-name/inode proof
    // before considering singly-linked pre-link or replacement residues.
    if (residue.mode === "write") repairInterruptedLockPublication(publicTarget, directoryGuard)
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    target = exactRuntimePathIfExists(runtimeRoot, directory, directoryIdentity, target)
    if (target === null) continue
    let before
    try { before = fs.lstatSync(target, { bigint: true }) }
    catch (error) {
      if (error?.code === "ENOENT") {
        confirmExactChildMissing(runtimeRoot, directory, directoryIdentity, target)
        continue
      }
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
    assertLockDirectoryGuard(directoryGuard)
    const bytes = readBoundedRegularFile(target, {
      maxBytes: MAX_LOCK_BYTES,
      errorCode: "APPLICATION_PROPOSAL_LOCK_UNCERTAIN",
      allowMissing: true,
    })
    assertLockDirectoryGuard(directoryGuard)
    if (bytes === null) {
      confirmExactChildMissing(runtimeRoot, directory, directoryIdentity, target)
      continue
    }
    let after
    try { after = fs.lstatSync(target, { bigint: true }) }
    catch (error) {
      if (error?.code === "ENOENT") {
        confirmExactChildMissing(runtimeRoot, directory, directoryIdentity, target)
        continue
      }
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n || !sameFileIdentity(before, after)) {
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
    if (digest(bytes) !== residue.expectedDigest) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    const value = residue.kind === "lock"
      ? parseLock(bytes, repositoryDigest)
      : parseReaper(bytes, repositoryDigest, `${repositoryDigest}.reap-${residue.token}.json`)
    if (value.schemaVersion !== 2) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    const locallyActive = value.processId === process.pid && (
      activePrivatePublications.has(value.token)
      || activeRecoveryClaims.has(value.token)
      || activeRepositoryLocks.has(value.token)
    )
    if (processAlive(value) && (value.processId !== process.pid || locallyActive)) {
      if (residue.mode === "release") continue
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
    onValidated?.("record")
    guardedUnlinkOwnedPrivateFile(
      target,
      after,
      [1n],
      directoryGuard,
      () => { onUnlinking?.() },
      residue.mode === "release",
    )
    confirmExactChildMissing(runtimeRoot, directory, directoryIdentity, target)
  }
}

function reaperClaims(directory, repositoryDigest, runtimeRoot, directoryIdentity, transactionOperations = {}) {
  const directoryGuard = { runtimeRoot, directory, directoryIdentity }
  const prefix = `${repositoryDigest}.reap-`
  const claims = []
  const names = boundedLockDirectoryNames(directory, runtimeRoot, directoryIdentity)
  sweepPrivateLockResidues(
    directory,
    repositoryDigest,
    runtimeRoot,
    directoryIdentity,
    names,
    () => transactionOperations.checkpoint?.("private_lock_residue_discovered"),
    (phase) => transactionOperations.checkpoint?.(phase === "path"
      ? "private_lock_residue_path_validated"
      : "private_lock_residue_validated"),
    () => transactionOperations.checkpoint?.("private_lock_residue_unlinking"),
  )
  for (const name of names.filter((entry) => entry.startsWith(prefix)
    && entry.endsWith(".json") && UUID.test(entry.slice(prefix.length, -5)))) {
    const target = exactRuntimePathIfExists(
      runtimeRoot,
      directory,
      directoryIdentity,
      path.join(directory, name),
    )
    if (target === null) continue
    let bytes
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    bytes = readLock(target, true, directoryGuard)
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    // A claimant always removes only its own bakery file. It may disappear
    // after readdir and before this read without making a surviving claim ambiguous.
    if (bytes === null) {
      confirmExactChildMissing(runtimeRoot, directory, directoryIdentity, target)
      continue
    }
    const value = parseReaper(bytes, repositoryDigest, name)
    if (!processAlive(value)
      || (value.schemaVersion === 2 && value.processId === process.pid && !activeRecoveryClaims.has(value.token))) {
      try {
        assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
        if (!readLock(target, false, directoryGuard).equals(bytes)) throw new Error()
        assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
        unlinkExact(target, bytes, directoryGuard)
        assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
      } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
    } else claims.push(value)
  }
  assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
  return claims
}

function cleanLegacyRecovery(target, runtimeRoot, directory, directoryIdentity) {
  const directoryGuard = { runtimeRoot, directory, directoryIdentity }
  const legacy = `${target}.recovery`
  assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
  if (!fs.existsSync(legacy)) {
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    return
  }
  let bytes
  let value
  try {
    bytes = readLock(legacy, false, directoryGuard)
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    value = JSON.parse(bytes)
    if (!value || value.schemaVersion !== 1 || !UUID.test(value.token) || !UUID.test(value.staleToken)
      || !Number.isSafeInteger(value.processId) || value.processId < 1) throw new Error()
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  if (processIdAlive(value.processId)) throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
  try {
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    if (!readLock(legacy, false, directoryGuard).equals(bytes)) throw new Error()
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
    fs.unlinkSync(legacy)
    assertLockDirectoryIdentity(runtimeRoot, directory, directoryIdentity)
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
}

export function applicationRepositoryLockIdentity(repositoryRoot) {
  return digest(canonical(repositoryRoot))
}

export function applicationRepositoryLockPath(runtimeRoot, repositoryRoot) {
  const root = resolveApplicationProposalRuntimeRoot(runtimeRoot)
  const directory = assertApplicationProposalRuntimePath(root, path.join(root, "application-proposal-locks"), { allowMissing: true })
  return path.join(directory, `${applicationRepositoryLockIdentity(repositoryRoot)}.lock`)
}

/** A crash-recoverable bakery claim serializes the short lock acquisition/recovery critical section. */
export async function withApplicationRepositoryRecoveryClaim({
  runtimeRoot, repositoryRoot, action, waitMs = REAPER_WAIT_MS, transactionOperations = {},
}) {
  if (typeof action !== "function" || !Number.isFinite(waitMs) || waitMs < 1) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_INVALID")
  }
  const repositoryDigest = applicationRepositoryLockIdentity(repositoryRoot)
  const root = resolveApplicationProposalRuntimeRoot(runtimeRoot)
  const directory = assertApplicationProposalRuntimePath(root, path.join(root, "application-proposal-locks"), { allowMissing: true })
  fs.mkdirSync(directory, { recursive: true })
  assertApplicationProposalRuntimePath(root, directory)
  const directoryIdentity = captureLockDirectoryIdentity(root, directory)
  const directoryGuard = Object.freeze({ runtimeRoot: root, directory, directoryIdentity })
  const token = crypto.randomUUID()
  const target = path.join(directory, `${repositoryDigest}.reap-${token}.json`)
  let value = { schemaVersion: 2, token, processId: process.pid, processIdentity: currentProcessIdentity(), startedAt: new Date().toISOString(), repositoryDigest, ticket: 0 }
  let text = `${JSON.stringify(value, null, 2)}\n`
  const deadline = Date.now() + Math.floor(waitMs)
  let published = false
  activeRecoveryClaims.add(token)
  try {
    syncedExclusive(
      target,
      text,
      root,
      directoryGuard,
      () => transactionOperations.checkpoint?.("recovery_claim_linked"),
      () => transactionOperations.checkpoint?.("recovery_claim_private_staged"),
    )
    published = true
    const initial = reaperClaims(directory, repositoryDigest, root, directoryIdentity, transactionOperations)
    value = { ...value, ticket: Math.max(0, ...initial.map((entry) => entry.ticket)) + 1 }
    if (value.ticket > 1_000_000_000) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    const selected = `${JSON.stringify(value, null, 2)}\n`
    atomicReplace(
      target,
      text,
      selected,
      root,
      directoryGuard,
      () => transactionOperations.checkpoint?.("recovery_claim_replace_staged"),
    )
    text = selected
    while (true) {
      const claims = reaperClaims(directory, repositoryDigest, root, directoryIdentity, transactionOperations)
      const own = claims.find((entry) => entry.token === token)
      if (!own || own.processId !== process.pid || own.ticket !== value.ticket) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      const blocked = claims.some((entry) => entry.token !== token
        && (entry.ticket === 0 || entry.ticket < value.ticket || (entry.ticket === value.ticket && entry.token < token)))
      if (!blocked) {
        assertLockDirectoryIdentity(root, directory, directoryIdentity)
        return await action(Object.freeze({
          runtimeRoot: root,
          directory,
          directoryIdentity,
          directoryGuard,
        }))
      }
      if (Date.now() >= deadline) throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
      await sleep(Math.min(20, Math.max(1, deadline - Date.now())))
    }
  } finally {
    try {
      if (published) {
        assertLockDirectoryIdentity(root, directory, directoryIdentity)
        unlinkExact(target, Buffer.from(text), directoryGuard)
        assertLockDirectoryIdentity(root, directory, directoryIdentity)
      }
    } finally { activeRecoveryClaims.delete(token) }
  }
}

export async function acquireApplicationRepositoryLock({
  runtimeRoot, repositoryRoot, proposalId, recoverStale, transactionOperations = {},
}) {
  if (!UUID.test(proposalId) || typeof recoverStale !== "function") throw new Error("APPLICATION_PROPOSAL_LOCK_INVALID")
  const repositoryDigest = applicationRepositoryLockIdentity(repositoryRoot)
  const target = applicationRepositoryLockPath(runtimeRoot, repositoryRoot)
  let acquired
  try {
    return await withApplicationRepositoryRecoveryClaim({
      runtimeRoot,
      repositoryRoot,
      transactionOperations,
      action: async ({ runtimeRoot: lockRuntimeRoot, directory, directoryIdentity, directoryGuard }) => {
      assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
      cleanLegacyRecovery(target, lockRuntimeRoot, directory, directoryIdentity)
      for (let attempt = 0; attempt < 2; attempt++) {
        assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
        const value = { schemaVersion: 2, token: crypto.randomUUID(), processId: process.pid, processIdentity: currentProcessIdentity(), startedAt: new Date().toISOString(), repositoryDigest, proposalId }
        const text = `${JSON.stringify(value, null, 2)}\n`
        try {
          syncedExclusive(
            target,
            text,
            runtimeRoot,
            directoryGuard,
            () => transactionOperations.checkpoint?.("repository_lock_linked"),
            () => transactionOperations.checkpoint?.("repository_lock_private_staged"),
          )
          assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          if (readLockText(target, directoryGuard) !== text) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
          assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          activeRepositoryLocks.add(value.token)
          assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          acquired = Object.freeze({ target, value: Object.freeze(value), text })
          repositoryLockGuards.set(value.token, Object.freeze({
            directoryGuard,
            target: canonical(target),
            textDigest: digest(text),
            activeTokens: activeRepositoryLocks,
            checkpoint: transactionOperations.checkpoint,
          }))
          return acquired
        } catch (error) {
          if (error?.code !== "EEXIST") throw error
          let bytes
          try {
            assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
            bytes = readLock(target, false, directoryGuard)
            assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
          const stale = parseLock(bytes, repositoryDigest)
          if (processAlive(stale)
            && !(stale.schemaVersion === 2 && stale.processId === process.pid && !activeRepositoryLocks.has(stale.token))) {
            throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
          }
          assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          if (!readLock(target, false, directoryGuard).equals(bytes)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
          assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          const recoveryFailure = await recoverStale(stale)
          assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          if (recoveryFailure !== undefined && !(recoveryFailure instanceof Error)) {
            throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
          }
          if (!readLock(target, false, directoryGuard).equals(bytes)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
          assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          unlinkExact(target, bytes, directoryGuard)
          assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
          // Recovery may establish a durable terminal/quarantine outcome that
          // the caller must observe without retaining the dead public lock.
          if (recoveryFailure) throw recoveryFailure
        }
      }
      throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
      },
    })
  } catch (error) {
    // A failed bakery-claim cleanup must not strand a public repository lock
    // whose claim could never be returned to its caller.
    if (acquired) {
      try { releaseApplicationRepositoryLock(acquired) }
      catch { /* release removes the in-process liveness token in finally */ }
    }
    throw error
  }
}

export function releaseApplicationRepositoryLock(claim) {
  const token = claim?.value?.token
  const registered = typeof token === "string" ? repositoryLockGuards.get(token) : undefined
  const directoryGuard = registered?.directoryGuard
  if (!claim || typeof claim.text !== "string" || !UUID.test(token ?? "") || !directoryGuard
    || registered.target !== canonical(claim.target) || registered.textDigest !== digest(claim.text)) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  try {
    assertLockDirectoryGuard(directoryGuard)
    unlinkExact(
      claim.target,
      Buffer.from(claim.text),
      directoryGuard,
      3,
      () => registered.checkpoint?.("repository_lock_release_staged"),
    )
    assertLockDirectoryGuard(directoryGuard)
  }
  finally {
    repositoryLockGuards.delete(token)
    registered.activeTokens.delete(token)
    activeRepositoryLocks.delete(token)
  }
}

/** Repair only the exact public lock owned by an already-proven terminal proposal. */
export async function reconcileTerminalApplicationRepositoryLock({ runtimeRoot, repositoryRoot, proposalId }) {
  if (!UUID.test(proposalId)) throw new Error("APPLICATION_PROPOSAL_LOCK_INVALID")
  const repositoryDigest = applicationRepositoryLockIdentity(repositoryRoot)
  const target = applicationRepositoryLockPath(runtimeRoot, repositoryRoot)
  return withApplicationRepositoryRecoveryClaim({
    runtimeRoot,
    repositoryRoot,
    action: async ({ runtimeRoot: lockRuntimeRoot, directory, directoryIdentity, directoryGuard }) => {
    assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
    if (!fs.existsSync(target)) {
      assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
      return false
    }
    let bytes
    try {
      assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
      bytes = readLock(target, false, directoryGuard)
      assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
    } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
    const value = parseLock(bytes, repositoryDigest)
    if (value.proposalId !== proposalId) return false
    assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
    unlinkExact(target, bytes, directoryGuard)
    assertLockDirectoryIdentity(lockRuntimeRoot, directory, directoryIdentity)
    return true
    },
  })
}
