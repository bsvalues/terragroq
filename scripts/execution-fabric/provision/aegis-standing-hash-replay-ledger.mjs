import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { canonicalizeJcs } from "../canonical-json.mjs"

export const REPLAY_JOURNAL_BASENAME = "aegis-standing-hash-replay-journal.jsonl"
export const REPLAY_JOURNAL_MAX_BYTES = 4 * 1024 * 1024

const DIGEST = /^[a-f0-9]{64}$/
const ENVELOPE_KEYS = Object.freeze([
  "entry_sha256",
  "previous_entry_sha256",
  "record",
  "recorded_at",
  "sequence",
])

function ledgerError(code, detail) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  return error
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalizeJcs(value), "utf8").digest("hex")
}

function syncDirectoryDurably(fsApi, directoryPath) {
  const descriptor = fsApi.openSync(directoryPath, fsApi.constants.O_RDONLY)
  try { fsApi.fsyncSync(descriptor) } finally { fsApi.closeSync(descriptor) }
}

function validateRoot(fsApi, ledgerRoot, uid, validateDirectory) {
  const lexical = path.resolve(ledgerRoot)
  let stats
  let real
  try {
    stats = fsApi.lstatSync(lexical)
    real = fsApi.realpathSync(lexical)
  } catch {
    throw ledgerError("AEGIS_REPLAY_JOURNAL_UNAVAILABLE", "private ledger root is unavailable")
  }
  if (real !== lexical || !validateDirectory(stats, uid)) {
    throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private ledger root is not direct and owner-only")
  }
  return real
}

function readJournalBytes(fsApi, journalPath, uid, validateFile) {
  let descriptor
  try {
    const stats = fsApi.lstatSync(journalPath)
    if (!validateFile(stats, uid) || stats.size > REPLAY_JOURNAL_MAX_BYTES) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal metadata is invalid")
    }
    if (fsApi.realpathSync(journalPath) !== journalPath) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal path is indirect")
    }
    descriptor = fsApi.openSync(journalPath, fsApi.constants.O_RDONLY | (fsApi.constants.O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (!validateFile(opened, uid) || opened.dev !== stats.dev || opened.ino !== stats.ino
      || opened.size !== stats.size || opened.mtimeMs !== stats.mtimeMs || opened.ctimeMs !== stats.ctimeMs) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal changed during acquisition")
    }
    return fsApi.readFileSync(descriptor, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    if (String(error?.code ?? "").startsWith("AEGIS_REPLAY_")) throw error
    throw ledgerError("AEGIS_REPLAY_JOURNAL_UNAVAILABLE", "private replay journal cannot be read")
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function parseJournal(bytes) {
  if (bytes === "") return []
  if (bytes === null || typeof bytes !== "string" || !bytes.endsWith("\n")) {
    throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal is missing or truncated")
  }
  const entries = []
  let previous = null
  for (const [index, line] of bytes.slice(0, -1).split("\n").entries()) {
    let envelope
    try { envelope = JSON.parse(line) } catch {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal contains malformed JSON")
    }
    if (!exactKeys(envelope, ENVELOPE_KEYS) || canonicalizeJcs(envelope) !== line
      || envelope.sequence !== index + 1 || envelope.previous_entry_sha256 !== previous
      || !canonicalTimestamp(envelope.recorded_at) || envelope.record === null
      || typeof envelope.record !== "object" || Array.isArray(envelope.record)
      || !DIGEST.test(envelope.entry_sha256 ?? "")) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal envelope is invalid")
    }
    const body = { ...envelope }
    delete body.entry_sha256
    if (envelope.entry_sha256 !== sha256Canonical(body)) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal hash chain is invalid")
    }
    previous = envelope.entry_sha256
    entries.push({
      record: envelope.record,
      realtime_ms: Date.parse(envelope.recorded_at),
      uid: null,
      identifier: "williamos-aegis-standing-hash",
      sequence: envelope.sequence,
      previous_entry_sha256: envelope.previous_entry_sha256,
      entry_sha256: envelope.entry_sha256,
    })
  }
  return entries
}

export function createAegisStandingHashReplayLedger({
  ledgerRoot,
  uid,
  gid,
  fsApi = fs,
  clock = () => new Date().toISOString(),
  validateDirectory = (stats, currentUid) => stats.isDirectory() && !stats.isSymbolicLink()
    && stats.uid === currentUid && (stats.mode & 0o077) === 0,
  validateFile = (stats) => stats.isFile() && !stats.isSymbolicLink()
    && stats.nlink === 1 && stats.uid === 0 && stats.gid === gid && (stats.mode & 0o7777) === 0o660,
  hasAppendOnlyAttribute = (journalPath) => {
    const result = spawnSync("/usr/bin/lsattr", ["-d", "--", journalPath], {
      encoding: "utf8",
      env: { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      maxBuffer: 64 * 1024,
      shell: false,
      timeout: 15_000,
      windowsHide: true,
    })
    if (result.error || result.status !== 0) return false
    const [attributes, retainedPath, ...extra] = String(result.stdout ?? "").trim().split(/\s+/)
    return extra.length === 0 && retainedPath === journalPath && /^[A-Za-z-]+$/.test(attributes ?? "")
      && attributes.includes("a")
  },
  syncDirectory = (directoryPath) => syncDirectoryDurably(fsApi, directoryPath),
} = {}) {
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) {
    throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal requires a non-root UID")
  }
  const root = validateRoot(fsApi, ledgerRoot, uid, validateDirectory)
  const journalPath = path.join(root, REPLAY_JOURNAL_BASENAME)
  if (path.dirname(journalPath) !== root || path.basename(journalPath) !== REPLAY_JOURNAL_BASENAME) {
    throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay journal escaped its fixed root")
  }
  const initialBytes = readJournalBytes(fsApi, journalPath, uid, validateFile)
  if (initialBytes === null || !hasAppendOnlyAttribute(journalPath)) {
    throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "root-owned append-only replay journal is not established")
  }

  const read = () => parseJournal(readJournalBytes(fsApi, journalPath, uid, validateFile))
  const append = (record) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay record is invalid")
    }
    const retained = read()
    const recordedAt = clock()
    if (!canonicalTimestamp(recordedAt)) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay clock is invalid")
    }
    const body = {
      sequence: retained.length + 1,
      previous_entry_sha256: retained.at(-1)?.entry_sha256 ?? null,
      recorded_at: recordedAt,
      record,
    }
    const envelope = { ...body, entry_sha256: sha256Canonical(body) }
    const bytes = Buffer.from(`${canonicalizeJcs(envelope)}\n`, "utf8")
    const currentBytes = readJournalBytes(fsApi, journalPath, uid, validateFile)
    if ((currentBytes?.length ?? 0) + bytes.length > REPLAY_JOURNAL_MAX_BYTES) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNAVAILABLE", "private replay journal reached its fixed size limit")
    }

    let descriptor
    try {
      if (currentBytes === null || !hasAppendOnlyAttribute(journalPath)) {
        throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "root-owned append-only replay journal disappeared or lost its fence")
      }
      const flags = fsApi.constants.O_WRONLY | fsApi.constants.O_APPEND | (fsApi.constants.O_NOFOLLOW ?? 0)
      descriptor = fsApi.openSync(journalPath, flags)
      const written = fsApi.writeSync(descriptor, bytes, 0, bytes.length, null)
      if (written !== bytes.length) {
        throw ledgerError("AEGIS_REPLAY_JOURNAL_UNAVAILABLE", "private replay journal write was incomplete")
      }
      fsApi.fsyncSync(descriptor)
    } catch (error) {
      if (String(error?.code ?? "").startsWith("AEGIS_REPLAY_")) throw error
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNAVAILABLE", "private replay journal append failed closed")
    } finally {
      if (descriptor !== undefined) fsApi.closeSync(descriptor)
    }
    syncDirectory(root)
    const confirmed = read()
    const last = confirmed.at(-1)
    if (confirmed.length !== retained.length + 1 || last?.entry_sha256 !== envelope.entry_sha256) {
      throw ledgerError("AEGIS_REPLAY_JOURNAL_UNTRUSTED", "private replay append was not retained exactly once")
    }
    return last
  }

  return { journalPath, read, append }
}
