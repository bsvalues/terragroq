#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { createAegisStandingHashReplayLedger } from "./aegis-standing-hash-replay-ledger.mjs"

export const JOURNAL_IDENTIFIER = "williamos-aegis-standing-hash"
export const JOURNAL_EPOCH_ID = "aegis-standing-hash-replay-epoch-v1"
export const LEDGER_ROOT = "/var/lib/williamos/fabric/standing-hash-ledger"
export const EPOCH_LOCK_BASENAME = "standing-hash-mutation.lock"

const DIGEST = /^[a-f0-9]{64}$/
const BOOT_ID = /^[a-f0-9-]{36}$/
const PROCESS_TICKS = /^[1-9][0-9]*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EPOCH_KEYS = Object.freeze([
  "epoch_id",
  "initialized_at",
  "journal_record_sha256",
  "record_type",
])
const HOLDER_KEYS = Object.freeze(["boot_id", "pid", "process_start_ticks", "token", "uid"])

function reject(code, detail) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  throw error
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value, expected) {
  return plainObject(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalizeJcs(value), "utf8").digest("hex")
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function parseJournalUid(value) {
  if (Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  reject("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "journal entry UID is invalid")
}

function processStartTicks(fsApi, pid) {
  const stat = fsApi.readFileSync(`/proc/${pid}/stat`, "utf8")
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)
  if (!PROCESS_TICKS.test(fields[19] ?? "")) {
    reject("AEGIS_REPLAY_LOCK_IDENTITY_INVALID", "process start ticks are unavailable")
  }
  return fields[19]
}

function defaultHolderIdentity(fsApi, uid, token) {
  const bootId = fsApi.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
  if (!BOOT_ID.test(bootId)) {
    reject("AEGIS_REPLAY_LOCK_IDENTITY_INVALID", "kernel boot identity is unavailable")
  }
  return {
    pid: process.pid,
    uid,
    boot_id: bootId,
    process_start_ticks: processStartTicks(fsApi, process.pid),
    token,
  }
}

function defaultHolderLiveness(fsApi, holder) {
  let bootId
  try {
    bootId = fsApi.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
  } catch {
    return "UNKNOWN"
  }
  if (!BOOT_ID.test(bootId)) return "UNKNOWN"
  if (bootId !== holder.boot_id) return "DEAD"
  try {
    return processStartTicks(fsApi, holder.pid) === holder.process_start_ticks ? "ALIVE" : "DEAD"
  } catch (error) {
    return error?.code === "ENOENT" ? "DEAD" : "UNKNOWN"
  }
}

function validateHolder(holder, uid) {
  if (!exactKeys(holder, HOLDER_KEYS)
    || !Number.isSafeInteger(holder.pid) || holder.pid <= 0
    || holder.uid !== uid
    || !BOOT_ID.test(holder.boot_id ?? "")
    || !PROCESS_TICKS.test(holder.process_start_ticks ?? "")
    || !UUID.test(holder.token ?? "")) {
    reject("AEGIS_REPLAY_LOCK_UNTRUSTED", "epoch lock holder identity is invalid")
  }
  return holder
}

function syncDirectoryDurably(fsApi, directoryPath) {
  const descriptor = fsApi.openSync(directoryPath, fsApi.constants.O_RDONLY)
  try { fsApi.fsyncSync(descriptor) } finally { fsApi.closeSync(descriptor) }
}

function readPrivateJson(fsApi, filePath, uid, validateFile) {
  let descriptor
  try {
    descriptor = fsApi.openSync(filePath, fsApi.constants.O_RDONLY | (fsApi.constants.O_NOFOLLOW ?? 0))
    const stats = fsApi.fstatSync(descriptor)
    if (!validateFile(stats, uid) || stats.size > 4096) {
      reject("AEGIS_REPLAY_LOCK_UNTRUSTED", "epoch lock holder file is not private")
    }
    return JSON.parse(fsApi.readFileSync(descriptor, "utf8"))
  } catch (error) {
    if (error?.code === "AEGIS_REPLAY_LOCK_UNTRUSTED") throw error
    reject("AEGIS_REPLAY_LOCK_UNTRUSTED", "epoch lock holder evidence is unreadable")
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function writePrivateJsonDurably(fsApi, filePath, value, syncDirectory) {
  let descriptor
  try {
    descriptor = fsApi.openSync(
      filePath,
      fsApi.constants.O_CREAT | fsApi.constants.O_EXCL | fsApi.constants.O_WRONLY,
      0o600,
    )
    fsApi.writeFileSync(descriptor, `${canonicalizeJcs(value)}\n`, "utf8")
    fsApi.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
  syncDirectory(path.dirname(filePath))
}

function createEpochLock({
  fsApi,
  ledgerRoot,
  uid,
  holderIdentity,
  holderLiveness,
  randomUUID,
  validateDirectory,
  validateFile,
  syncDirectory,
}) {
  const lexicalRoot = path.resolve(ledgerRoot)
  let rootStats
  let realRoot
  try {
    rootStats = fsApi.lstatSync(lexicalRoot)
    realRoot = fsApi.realpathSync(lexicalRoot)
  } catch {
    reject("AEGIS_REPLAY_LOCK_PATH_REJECTED", "ledger root is unavailable")
  }
  if (realRoot !== lexicalRoot || !validateDirectory(rootStats, uid)) {
    reject("AEGIS_REPLAY_LOCK_PATH_REJECTED", "ledger root must be a private current-user directory")
  }

  const lockPath = path.join(realRoot, EPOCH_LOCK_BASENAME)
  if (path.dirname(lockPath) !== realRoot || path.basename(lockPath) !== EPOCH_LOCK_BASENAME) {
    reject("AEGIS_REPLAY_LOCK_PATH_REJECTED", "epoch lock path escaped the private ledger")
  }

  const inspectLock = (targetPath) => {
    let stats
    let entries
    try {
      stats = fsApi.lstatSync(targetPath)
      if (fsApi.realpathSync(targetPath) !== targetPath || !validateDirectory(stats, uid)) {
        reject("AEGIS_REPLAY_LOCK_UNTRUSTED", "epoch lock is not a private directory")
      }
      entries = fsApi.readdirSync(targetPath)
    } catch (error) {
      if (error?.code === "AEGIS_REPLAY_LOCK_UNTRUSTED") throw error
      if (error?.code === "ENOENT") throw error
      reject("AEGIS_REPLAY_LOCK_UNTRUSTED", "epoch lock cannot be inspected safely")
    }
    if (entries.length !== 1 || entries[0] !== "holder.json") {
      reject("AEGIS_REPLAY_LOCK_UNTRUSTED", "epoch lock contents are invalid")
    }
    return validateHolder(readPrivateJson(
      fsApi,
      path.join(targetPath, "holder.json"),
      uid,
      validateFile,
    ), uid)
  }

  const cleanupCandidate = (candidatePath) => {
    const holderPath = path.join(candidatePath, "holder.json")
    try { fsApi.unlinkSync(holderPath) } catch (error) { if (error?.code !== "ENOENT") throw error }
    try { fsApi.rmdirSync(candidatePath) } catch (error) { if (error?.code !== "ENOENT") throw error }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomUUID()
    if (!UUID.test(token)) reject("AEGIS_REPLAY_LOCK_IDENTITY_INVALID", "lock token is invalid")
    const candidatePath = path.join(realRoot, `.aegis-replay-epoch-candidate-${token}`)
    const candidateHolderPath = path.join(candidatePath, "holder.json")
    const holder = validateHolder(holderIdentity(uid, token), uid)
    let installed = false
    try {
      fsApi.mkdirSync(candidatePath, { mode: 0o700 })
      writePrivateJsonDurably(fsApi, candidateHolderPath, holder, syncDirectory)
      syncDirectory(candidatePath)
      fsApi.renameSync(candidatePath, lockPath)
      installed = true
      syncDirectory(realRoot)
    } catch (error) {
      if (!installed) cleanupCandidate(candidatePath)
      if (!installed && ["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code)) {
        let retained
        try { retained = inspectLock(lockPath) } catch (inspectError) {
          if (inspectError?.code === "AEGIS_REPLAY_LOCK_UNTRUSTED") throw inspectError
          if (inspectError?.code === "ENOENT") continue
          throw inspectError
        }
        let liveness = "UNKNOWN"
        try { liveness = holderLiveness(retained) } catch {}
        if (liveness !== "DEAD") {
          reject("AEGIS_REPLAY_LOCK_BUSY", "another initializer holds the replay epoch lock")
        }
        const recoveryToken = randomUUID()
        if (!UUID.test(recoveryToken)) reject("AEGIS_REPLAY_LOCK_IDENTITY_INVALID", "recovery token is invalid")
        const recoveryPath = path.join(realRoot, `.aegis-replay-epoch-recovery-${recoveryToken}`)
        try { fsApi.renameSync(lockPath, recoveryPath) } catch (renameError) {
          if (["ENOENT", "EEXIST", "ENOTEMPTY", "EPERM"].includes(renameError?.code)) continue
          throw renameError
        }
        const moved = inspectLock(recoveryPath)
        if (canonicalizeJcs(moved) !== canonicalizeJcs(retained)) {
          reject("AEGIS_REPLAY_LOCK_UNTRUSTED", "epoch lock holder changed during stale recovery")
        }
        fsApi.unlinkSync(path.join(recoveryPath, "holder.json"))
        fsApi.rmdirSync(recoveryPath)
        syncDirectory(realRoot)
        continue
      }
      throw error
    }

    const release = () => {
      const retained = inspectLock(lockPath)
      if (canonicalizeJcs(retained) !== canonicalizeJcs(holder)) {
        reject("AEGIS_REPLAY_LOCK_LOST", "epoch lock ownership changed before cleanup")
      }

      const releaseToken = randomUUID()
      if (!UUID.test(releaseToken)) {
        reject("AEGIS_REPLAY_LOCK_IDENTITY_INVALID", "release token is invalid")
      }
      const releasePath = path.join(realRoot, `.aegis-replay-epoch-release-${releaseToken}`)
      try {
        fsApi.renameSync(lockPath, releasePath)
      } catch (error) {
        reject(
          "AEGIS_REPLAY_LOCK_LOST",
          `epoch lock could not be isolated for cleanup: ${String(error?.code ?? "UNKNOWN")}`,
        )
      }
      syncDirectory(realRoot)

      const isolated = inspectLock(releasePath)
      if (canonicalizeJcs(isolated) !== canonicalizeJcs(holder)) {
        reject("AEGIS_REPLAY_LOCK_LOST", "epoch lock ownership changed during cleanup isolation")
      }
      fsApi.unlinkSync(path.join(releasePath, "holder.json"))
      fsApi.rmdirSync(releasePath)
      syncDirectory(realRoot)
    }
    return { lockPath, release }
  }
  reject("AEGIS_REPLAY_LOCK_BUSY", "epoch lock could not be acquired after bounded stale recovery")
}

export function createAegisStandingHashEpochRecord(initializedAt) {
  if (!canonicalTimestamp(initializedAt)) {
    reject("AEGIS_REPLAY_EPOCH_TIME_INVALID", "initializer clock must return a canonical ISO timestamp")
  }
  const body = {
    record_type: "EPOCH",
    epoch_id: JOURNAL_EPOCH_ID,
    initialized_at: initializedAt,
  }
  return { ...body, journal_record_sha256: sha256Canonical(body) }
}

export function validateAegisStandingHashEpochRecord(record) {
  if (!exactKeys(record, EPOCH_KEYS)
    || record.record_type !== "EPOCH"
    || record.epoch_id !== JOURNAL_EPOCH_ID
    || !canonicalTimestamp(record.initialized_at)
    || !DIGEST.test(record.journal_record_sha256 ?? "")) {
    reject("AEGIS_REPLAY_EPOCH_INVALID", "retained epoch record is malformed or conflicting")
  }
  const body = {
    record_type: record.record_type,
    epoch_id: record.epoch_id,
    initialized_at: record.initialized_at,
  }
  if (record.journal_record_sha256 !== sha256Canonical(body)) {
    reject("AEGIS_REPLAY_EPOCH_INVALID", "retained epoch digest does not match its canonical payload")
  }
  return record
}

export function parseAegisStandingHashJournal(output, uid) {
  if (typeof output !== "string" || !Number.isSafeInteger(uid) || uid <= 0) {
    reject("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "journal response or current UID is invalid")
  }

  const records = []
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) continue
    let envelope
    let record
    try {
      envelope = JSON.parse(line)
      if (!plainObject(envelope) || typeof envelope.MESSAGE !== "string") throw new Error("invalid envelope")
      record = JSON.parse(envelope.MESSAGE)
      if (!plainObject(record)) throw new Error("invalid record")
    } catch {
      reject("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "journal contains malformed JSON evidence")
    }
    if (envelope.SYSLOG_IDENTIFIER !== JOURNAL_IDENTIFIER || parseJournalUid(envelope._UID) !== uid) {
      reject("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "journal entry identity does not match this initializer")
    }
    records.push(record)
  }

  const epochs = []
  for (const record of records) {
    const refersToEpoch = record.record_type === "EPOCH" || Object.hasOwn(record, "epoch_id")
    if (!refersToEpoch) continue
    epochs.push(validateAegisStandingHashEpochRecord(record))
  }
  if (epochs.length > 1) {
    reject("AEGIS_REPLAY_EPOCH_MULTIPLE", "retained journal contains multiple replay epochs")
  }
  return { records, epochs }
}

export function initializeAegisStandingHashReplayEpoch({
  platform = process.platform,
  getuid = process.getuid,
  getgid = process.getgid,
  username = () => os.userInfo().username,
  hostname = os.hostname,
  clock = () => new Date().toISOString(),
  fsApi = fs,
  ledgerRoot = LEDGER_ROOT,
  randomUUID = crypto.randomUUID,
  holderIdentity = (uid, token) => defaultHolderIdentity(fsApi, uid, token),
  holderLiveness = (holder) => defaultHolderLiveness(fsApi, holder),
  validateDirectory = (stats, currentUid) => stats.isDirectory() && !stats.isSymbolicLink()
    && stats.uid === currentUid && (stats.mode & 0o077) === 0,
  validateFile = (stats, currentUid) => stats.isFile() && !stats.isSymbolicLink()
    && stats.nlink === 1 && stats.uid === currentUid && (stats.mode & 0o077) === 0,
  syncDirectory = (directoryPath) => syncDirectoryDurably(fsApi, directoryPath),
  replayLedger = null,
} = {}) {
  if (platform !== "linux") reject("AEGIS_REPLAY_LINUX_REQUIRED", "initializer is Linux-only")
  const uid = typeof getuid === "function" ? getuid() : undefined
  const gid = typeof getgid === "function" ? getgid() : undefined
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0
    || username() !== "williamos-fabric") {
    reject("AEGIS_REPLAY_IDENTITY_REJECTED", "exact non-root williamos-fabric identity is required")
  }
  if (hostname() !== "aegis") reject("AEGIS_REPLAY_HOST_REJECTED", "exact aegis hostname is required")

  const ledger = replayLedger ?? createAegisStandingHashReplayLedger({
    ledgerRoot,
    uid,
    gid,
    fsApi,
    clock,
    validateDirectory,
    syncDirectory,
  })
  const readJournal = () => {
    const records = ledger.read().map(({ record }) => record)
    return {
      records,
      epochs: records
        .filter((record) => record?.record_type === "EPOCH" || Object.hasOwn(record ?? {}, "epoch_id"))
        .map(validateAegisStandingHashEpochRecord),
    }
  }

  const lock = createEpochLock({
    fsApi,
    ledgerRoot,
    uid,
    holderIdentity,
    holderLiveness,
    randomUUID,
    validateDirectory,
    validateFile,
    syncDirectory,
  })
  try {
    let retained = readJournal()
    if (retained.epochs.length === 1) {
      const [epoch] = retained.epochs
      retained = readJournal()
      if (retained.epochs.length !== 1
        || canonicalizeJcs(retained.epochs[0]) !== canonicalizeJcs(epoch)) {
        reject(
          "AEGIS_REPLAY_EPOCH_NOT_RETAINED",
          "synchronized journal did not retain exactly the canonical existing epoch",
        )
      }
      return {
        schema_version: "1.0-aegis-standing-hash-replay-epoch-evidence",
        status: "ALREADY_ESTABLISHED",
        already_established: true,
        identifier: JOURNAL_IDENTIFIER,
        uid,
        ...epoch,
        epoch_count: 1,
        workload_executed: false,
        scheduler_activated: false,
        network_accessed: false,
      }
    }
    if (retained.records.length !== 0) {
      reject("AEGIS_REPLAY_EPOCH_PREEXISTING_RECORDS", "journal contains standing records without a retained epoch")
    }

    const epoch = createAegisStandingHashEpochRecord(clock())
    ledger.append(epoch)

    retained = readJournal()
    if (retained.epochs.length !== 1
      || canonicalizeJcs(retained.epochs[0]) !== canonicalizeJcs(epoch)) {
      reject("AEGIS_REPLAY_EPOCH_NOT_RETAINED", "journal did not retain exactly the canonical appended epoch")
    }
    return {
      schema_version: "1.0-aegis-standing-hash-replay-epoch-evidence",
      status: "ESTABLISHED",
      already_established: false,
      identifier: JOURNAL_IDENTIFIER,
      uid,
      ...epoch,
      epoch_count: 1,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    }
  } finally {
    lock.release()
  }
}

export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length !== 0) reject("AEGIS_REPLAY_ARGUMENT_REJECTED", "initializer accepts no arguments")
    const evidence = initializeAegisStandingHashReplayEpoch()
    process.stdout.write(`${canonicalizeJcs(evidence)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema_version: "1.0-aegis-standing-hash-replay-epoch-error",
      status: "FAILED_CLOSED",
      code: error?.code ?? "AEGIS_REPLAY_EPOCH_INITIALIZER_REJECTED",
      detail: String(error?.message ?? error).slice(0, 256),
      execution_authorized: false,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    })}\n`)
    return 2
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) process.exitCode = main()
