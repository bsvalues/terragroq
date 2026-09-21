import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { readBoundedRegularFile } from "./proposal-artifacts.mjs"
import { assertApplicationProposalRuntimePath, resolveApplicationProposalRuntimeRoot } from "./proposal-runtime-root.mjs"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const REAPER_WAIT_MS = 5_000
const MAX_LOCK_BYTES = 16 * 1024
const activeRecoveryClaims = new Set()
const activeRepositoryLocks = new Set()
const lockReadBackoff = new Int32Array(new SharedArrayBuffer(4))

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex")
const canonical = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value)
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
function readLock(target, allowMissing = false) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      return readBoundedRegularFile(target, {
        maxBytes: MAX_LOCK_BYTES,
        errorCode: "APPLICATION_PROPOSAL_LOCK_UNCERTAIN",
        allowMissing,
      })
    } catch (error) {
      // `syncedExclusive` publishes with a hard-link then immediately removes
      // its private name. Another process may observe that owned nlink=2
      // window; retry briefly, while persistent/hostile links still fail shut.
      if (attempt === 8 || error?.message !== "APPLICATION_PROPOSAL_LOCK_UNCERTAIN") throw error
      Atomics.wait(lockReadBackoff, 0, 0, 1)
    }
  }
}
const readLockText = (target) => readLock(target).toString("utf8")

function syncedPrivateFile(directory, content, runtimeRoot) {
  fs.mkdirSync(directory, { recursive: true })
  assertApplicationProposalRuntimePath(runtimeRoot, directory)
  const temporary = path.join(directory, `.lock-write-${crypto.randomUUID()}.tmp`)
  let descriptor
  let complete = false
  try {
    descriptor = fs.openSync(temporary, "wx")
    fs.writeFileSync(descriptor, content)
    fs.fsyncSync(descriptor)
    complete = true
    return temporary
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (!complete) {
      try { fs.rmSync(temporary, { force: true }) } catch { /* a crash residue is private and ignored */ }
    }
  }
}

function removeFailedPublishedLink(target, temporary, content) {
  let descriptor
  try {
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
    fs.unlinkSync(target)
    if (fs.existsSync(target)) throw new Error()
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* cleanup already decided */ } }
}

function syncedExclusive(target, content, runtimeRoot) {
  const directory = path.dirname(target)
  const temporary = syncedPrivateFile(directory, content, runtimeRoot)
  let published = false
  try {
    assertApplicationProposalRuntimePath(runtimeRoot, directory)
    fs.linkSync(temporary, target)
    published = true
    fs.unlinkSync(temporary)
    if (readLockText(target) !== content) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  } catch (error) {
    if (published) removeFailedPublishedLink(target, temporary, content)
    throw error
  } finally {
    try { fs.rmSync(temporary, { force: true }) } catch { /* a complete private file is harmless */ }
  }
}

function atomicReplace(target, expected, content, runtimeRoot) {
  const directory = path.dirname(target)
  assertApplicationProposalRuntimePath(runtimeRoot, directory)
  if (readLockText(target) !== expected) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  const temporary = syncedPrivateFile(directory, content, runtimeRoot)
  try {
    assertApplicationProposalRuntimePath(runtimeRoot, directory)
    if (readLockText(target) !== expected) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    for (let attempt = 1; attempt <= 5; attempt++) {
      try { fs.renameSync(temporary, target); break }
      catch (error) {
        if (attempt === 5 || !["EACCES", "EBUSY", "EPERM"].includes(error?.code)) throw error
      }
    }
    if (readLockText(target) !== content) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  } finally { try { fs.rmSync(temporary, { force: true }) } catch { /* replacement may have completed */ } }
}

function parseLock(bytes, expectedRepositoryDigest) {
  let value
  try { value = JSON.parse(bytes) } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  const keys = ["schemaVersion", "token", "processId", "startedAt", "repositoryDigest", "proposalId"]
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== keys.sort().join(",") || value.schemaVersion !== 1
    || !UUID.test(value.token) || !Number.isSafeInteger(value.processId) || value.processId < 1
    || typeof value.startedAt !== "string" || new Date(value.startedAt).toISOString() !== value.startedAt
    || value.repositoryDigest !== expectedRepositoryDigest || !SHA256.test(value.repositoryDigest)
    || !UUID.test(value.proposalId)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  return value
}

function parseReaper(bytes, expectedRepositoryDigest, expectedName) {
  let value
  try { value = JSON.parse(bytes) } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  const keys = ["schemaVersion", "token", "processId", "startedAt", "repositoryDigest", "ticket"]
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== keys.sort().join(",") || value.schemaVersion !== 1
    || !UUID.test(value.token) || expectedName !== `${expectedRepositoryDigest}.reap-${value.token}.json`
    || !Number.isSafeInteger(value.processId) || value.processId < 1
    || typeof value.startedAt !== "string" || new Date(value.startedAt).toISOString() !== value.startedAt
    || value.repositoryDigest !== expectedRepositoryDigest || !SHA256.test(value.repositoryDigest)
    || !Number.isSafeInteger(value.ticket) || value.ticket < 0 || value.ticket > 1_000_000_000) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  return value
}

function processAlive(processId) {
  try { process.kill(processId, 0); return true }
  catch (error) { return error?.code === "EPERM" }
}

function unlinkExact(target, expected, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (!readLock(target).equals(expected)) throw new Error()
      fs.unlinkSync(target)
      if (fs.existsSync(target)) throw new Error()
      return
    } catch (error) {
      if (attempt === attempts) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
  }
}

function reaperClaims(directory, repositoryDigest) {
  const prefix = `${repositoryDigest}.reap-`
  const claims = []
  for (const name of fs.readdirSync(directory).filter((entry) => entry.startsWith(prefix)
    && entry.endsWith(".json") && UUID.test(entry.slice(prefix.length, -5)))) {
    const target = path.join(directory, name)
    let bytes
    bytes = readLock(target, true)
    // A claimant always removes only its own bakery file. It may disappear
    // after readdir and before this read without making a surviving claim ambiguous.
    if (bytes === null) continue
    const value = parseReaper(bytes, repositoryDigest, name)
    if (!processAlive(value.processId)
      || (value.processId === process.pid && !activeRecoveryClaims.has(value.token))) {
      try {
        if (!readLock(target).equals(bytes)) throw new Error()
        unlinkExact(target, bytes)
      } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
    } else claims.push(value)
  }
  return claims
}

function cleanLegacyRecovery(target) {
  const legacy = `${target}.recovery`
  if (!fs.existsSync(legacy)) return
  let bytes
  let value
  try {
    bytes = readLock(legacy)
    value = JSON.parse(bytes)
    if (!value || value.schemaVersion !== 1 || !UUID.test(value.token) || !UUID.test(value.staleToken)
      || !Number.isSafeInteger(value.processId) || value.processId < 1) throw new Error()
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  if (processAlive(value.processId)) throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
  try {
    if (!readLock(legacy).equals(bytes)) throw new Error()
    fs.unlinkSync(legacy)
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
export async function withApplicationRepositoryRecoveryClaim({ runtimeRoot, repositoryRoot, action, waitMs = REAPER_WAIT_MS }) {
  if (typeof action !== "function" || !Number.isFinite(waitMs) || waitMs < 1) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_INVALID")
  }
  const repositoryDigest = applicationRepositoryLockIdentity(repositoryRoot)
  const root = resolveApplicationProposalRuntimeRoot(runtimeRoot)
  const directory = assertApplicationProposalRuntimePath(root, path.join(root, "application-proposal-locks"), { allowMissing: true })
  fs.mkdirSync(directory, { recursive: true })
  assertApplicationProposalRuntimePath(root, directory)
  const token = crypto.randomUUID()
  const target = path.join(directory, `${repositoryDigest}.reap-${token}.json`)
  let value = { schemaVersion: 1, token, processId: process.pid, startedAt: new Date().toISOString(), repositoryDigest, ticket: 0 }
  let text = `${JSON.stringify(value, null, 2)}\n`
  const deadline = Date.now() + Math.floor(waitMs)
  let published = false
  activeRecoveryClaims.add(token)
  try {
    syncedExclusive(target, text, root)
    published = true
    const initial = reaperClaims(directory, repositoryDigest)
    value = { ...value, ticket: Math.max(0, ...initial.map((entry) => entry.ticket)) + 1 }
    if (value.ticket > 1_000_000_000) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    const selected = `${JSON.stringify(value, null, 2)}\n`
    atomicReplace(target, text, selected, root)
    text = selected
    while (true) {
      const claims = reaperClaims(directory, repositoryDigest)
      const own = claims.find((entry) => entry.token === token)
      if (!own || own.processId !== process.pid || own.ticket !== value.ticket) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      const blocked = claims.some((entry) => entry.token !== token
        && (entry.ticket === 0 || entry.ticket < value.ticket || (entry.ticket === value.ticket && entry.token < token)))
      if (!blocked) return await action()
      if (Date.now() >= deadline) throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
      await sleep(Math.min(20, Math.max(1, deadline - Date.now())))
    }
  } finally {
    try {
      if (published) unlinkExact(target, Buffer.from(text))
    } finally { activeRecoveryClaims.delete(token) }
  }
}

export async function acquireApplicationRepositoryLock({ runtimeRoot, repositoryRoot, proposalId, recoverStale }) {
  if (!UUID.test(proposalId) || typeof recoverStale !== "function") throw new Error("APPLICATION_PROPOSAL_LOCK_INVALID")
  const repositoryDigest = applicationRepositoryLockIdentity(repositoryRoot)
  const target = applicationRepositoryLockPath(runtimeRoot, repositoryRoot)
  let acquired
  try {
    return await withApplicationRepositoryRecoveryClaim({ runtimeRoot, repositoryRoot, action: async () => {
      cleanLegacyRecovery(target)
      for (let attempt = 0; attempt < 2; attempt++) {
        const value = { schemaVersion: 1, token: crypto.randomUUID(), processId: process.pid, startedAt: new Date().toISOString(), repositoryDigest, proposalId }
        const text = `${JSON.stringify(value, null, 2)}\n`
        try {
          syncedExclusive(target, text, runtimeRoot)
          if (readLockText(target) !== text) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
          activeRepositoryLocks.add(value.token)
          acquired = Object.freeze({ target, value: Object.freeze(value), text })
          return acquired
        } catch (error) {
          if (error?.code !== "EEXIST") throw error
          let bytes
          try { bytes = readLock(target) } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
          const stale = parseLock(bytes, repositoryDigest)
          if (processAlive(stale.processId)
            && !(stale.processId === process.pid && !activeRepositoryLocks.has(stale.token))) {
            throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
          }
          if (!readLock(target).equals(bytes)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
          const recoveryFailure = await recoverStale(stale)
          if (recoveryFailure !== undefined && !(recoveryFailure instanceof Error)) {
            throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
          }
          if (!readLock(target).equals(bytes)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
          unlinkExact(target, bytes)
          // Recovery may establish a durable terminal/quarantine outcome that
          // the caller must observe without retaining the dead public lock.
          if (recoveryFailure) throw recoveryFailure
        }
      }
      throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
    } })
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
  if (!claim || typeof claim.text !== "string") throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  try { unlinkExact(claim.target, Buffer.from(claim.text)) }
  finally { if (claim.value?.token) activeRepositoryLocks.delete(claim.value.token) }
}

/** Repair only the exact public lock owned by an already-proven terminal proposal. */
export async function reconcileTerminalApplicationRepositoryLock({ runtimeRoot, repositoryRoot, proposalId }) {
  if (!UUID.test(proposalId)) throw new Error("APPLICATION_PROPOSAL_LOCK_INVALID")
  const repositoryDigest = applicationRepositoryLockIdentity(repositoryRoot)
  const target = applicationRepositoryLockPath(runtimeRoot, repositoryRoot)
  return withApplicationRepositoryRecoveryClaim({ runtimeRoot, repositoryRoot, action: async () => {
    if (!fs.existsSync(target)) return false
    let bytes
    try { bytes = readLock(target) } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
    const value = parseLock(bytes, repositoryDigest)
    if (value.proposalId !== proposalId) return false
    unlinkExact(target, bytes)
    return true
  } })
}
