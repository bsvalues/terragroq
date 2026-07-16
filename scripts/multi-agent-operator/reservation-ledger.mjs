import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  checkReservationCompatibility,
  normalizeReservationSet,
} from "./reservation-set.mjs"

const LEDGER_SCHEMA_VERSION = 1
const LEDGER_ARTIFACT_TYPE = "MULTI_AGENT_RESERVATION_LEDGER"
const LOCK_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4))
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_STALE_LOCK_MS = 30_000
const COLLISION_REASON_ORDER = Object.freeze([
  "PATH_EXACT_COLLISION",
  "PATH_ANCESTOR_COLLISION",
  "CONTRACT_COLLISION",
  "ENVIRONMENT_COLLISION",
  "REPOSITORY_COLLISION",
  "REPOSITORY_PATH_CONTEXT_UNRESOLVED",
  "REPOSITORY_PATH_COLLISION",
  "PROTECTED_RESOURCE_COLLISION",
])

function fsyncDirectoryBestEffort(directory) {
  if (process.platform === "win32") return
  let handle
  try {
    handle = fs.openSync(directory, "r")
    fs.fsyncSync(handle)
  } finally {
    if (handle !== undefined) fs.closeSync(handle)
  }
}

function stableCompare(left, right) {
  return left.localeCompare(right, "en", { sensitivity: "variant" })
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function identity(value) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized === "" || normalized.includes("\0") ? null : normalized
}

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum
}

function hasExactFields(value, allowed, required = allowed) {
  if (!plainObject(value)) return false
  const keys = Object.keys(value)
  const allowedSet = new Set(allowed)
  return keys.every((key) => allowedSet.has(key))
    && required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function strictReservationSetShape(value) {
  if (!hasExactFields(value,
    ["schemaVersion", "artifactType", "reservationSetId", "workerId", "workOrderId", "reservations"])) {
    return false
  }
  if (!hasExactFields(value.reservations,
    ["paths", "contracts", "environments", "repositories", "protectedResources"])) return false
  if (!Array.isArray(value.reservations.paths)) return false
  return value.reservations.paths.every((entry) => typeof entry === "string"
    || hasExactFields(entry, ["repository", "path"]))
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (plainObject(value)) {
    return `{${Object.keys(value).sort(stableCompare)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function tokenDigest(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex")
}

function sameDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString()
}

function emptyLedger(ledgerId) {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    artifactType: LEDGER_ARTIFACT_TYPE,
    ledgerId,
    version: 0,
    nextFencingToken: 1,
    updatedAt: null,
    reservations: [],
    releases: [],
    authorityGranted: false,
  }
}

class LedgerWall extends Error {
  constructor(code, detail = null) {
    super(code)
    this.name = "ReservationLedgerWall"
    this.code = code
    this.detail = detail
  }
}

function wall(code, detail = null) {
  throw new LedgerWall(code, detail)
}

function result(status, detail = {}) {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_LEDGER_RESULT",
    status,
    ...detail,
    localLedgerOnly: true,
    authorityGranted: false,
  })
}

function wallResult(error) {
  return result(error instanceof LedgerWall ? error.code : "RESERVATION_LEDGER_IO_WALL", {
    acquired: false,
    released: false,
    reasonCodes: Object.freeze([error instanceof LedgerWall ? error.code : "RESERVATION_LEDGER_IO_WALL"]),
    ...(error instanceof LedgerWall && error.detail !== null ? { detail: error.detail } : {}),
  })
}

function validateStoredEntry(raw, ledgerVersion) {
  if (!hasExactFields(raw, [
    "reservationSetId", "workerId", "workOrderId", "laneId", "holderTokenDigest",
    "fencingToken", "acquiredAt", "reservationSet",
  ])
    || identity(raw.reservationSetId) === null
    || identity(raw.workerId) === null
    || identity(raw.workOrderId) === null
    || identity(raw.laneId) === null
    || !/^[a-f0-9]{64}$/.test(raw.holderTokenDigest)
    || !integer(raw.fencingToken, 1)
    || raw.fencingToken > ledgerVersion
    || typeof raw.acquiredAt !== "string"
    || !strictReservationSetShape(raw.reservationSet)) {
    wall("RESERVATION_LEDGER_CORRUPT", "invalid-reservation-entry")
  }
  const normalized = normalizeReservationSet(raw.reservationSet)
  if (!normalized.valid
    || normalized.reservationSet.reservationSetId !== raw.reservationSetId
    || normalized.reservationSet.workerId !== raw.workerId
    || normalized.reservationSet.workOrderId !== raw.workOrderId) {
    wall("RESERVATION_LEDGER_CORRUPT", "invalid-stored-reservation-set")
  }
  return {
    reservationSetId: raw.reservationSetId,
    workerId: raw.workerId,
    workOrderId: raw.workOrderId,
    laneId: raw.laneId,
    holderTokenDigest: raw.holderTokenDigest,
    fencingToken: raw.fencingToken,
    acquiredAt: raw.acquiredAt,
    reservationSet: normalized.reservationSet,
  }
}

function validateRelease(raw, ledgerVersion) {
  if (!hasExactFields(raw, ["reservationSetId", "holderTokenDigest", "fencingToken", "releasedAt"])
    || identity(raw.reservationSetId) === null
    || !/^[a-f0-9]{64}$/.test(raw.holderTokenDigest)
    || !integer(raw.fencingToken, 1)
    || raw.fencingToken > ledgerVersion
    || typeof raw.releasedAt !== "string") {
    wall("RESERVATION_LEDGER_CORRUPT", "invalid-release-entry")
  }
  return { ...raw }
}

function validateLedger(raw, expectedLedgerId) {
  if (!hasExactFields(raw, [
    "schemaVersion", "artifactType", "ledgerId", "version", "nextFencingToken", "updatedAt",
    "reservations", "releases", "authorityGranted",
  ])
    || raw.schemaVersion !== LEDGER_SCHEMA_VERSION
    || raw.artifactType !== LEDGER_ARTIFACT_TYPE
    || identity(raw.ledgerId) === null
    || (expectedLedgerId !== null && raw.ledgerId !== expectedLedgerId)
    || !integer(raw.version)
    || !integer(raw.nextFencingToken, 1)
    || (raw.updatedAt !== null && typeof raw.updatedAt !== "string")
    || !Array.isArray(raw.reservations)
    || !Array.isArray(raw.releases)
    || raw.authorityGranted !== false) {
    wall("RESERVATION_LEDGER_CORRUPT", "invalid-ledger-schema")
  }

  const reservations = raw.reservations.map((entry) => validateStoredEntry(entry, raw.version))
    .sort((a, b) => stableCompare(a.reservationSetId, b.reservationSetId))
  const releases = raw.releases.map((entry) => validateRelease(entry, raw.version))
    .sort((a, b) => stableCompare(a.reservationSetId, b.reservationSetId)
      || a.fencingToken - b.fencingToken)
  const ids = new Set()
  const fences = new Set()
  for (const entry of reservations) {
    if (ids.has(entry.reservationSetId) || fences.has(entry.fencingToken)) {
      wall("RESERVATION_LEDGER_CORRUPT", "duplicate-active-identity")
    }
    ids.add(entry.reservationSetId)
    fences.add(entry.fencingToken)
  }
  const releasedIds = new Set()
  for (const entry of releases) {
    if (releasedIds.has(entry.reservationSetId) || fences.has(entry.fencingToken)) {
      wall("RESERVATION_LEDGER_CORRUPT", "duplicate-release-identity")
    }
    releasedIds.add(entry.reservationSetId)
    fences.add(entry.fencingToken)
  }
  for (const reservationSetId of ids) {
    if (releasedIds.has(reservationSetId)) {
      wall("RESERVATION_LEDGER_CORRUPT", "active-release-identity-overlap")
    }
  }
  for (let left = 0; left < reservations.length; left += 1) {
    for (let right = left + 1; right < reservations.length; right += 1) {
      if (!checkReservationCompatibility(
        reservations[left].reservationSet,
        reservations[right].reservationSet,
      ).compatible) wall("RESERVATION_LEDGER_CORRUPT", "colliding-active-reservations")
    }
  }
  const maximumFence = [...reservations, ...releases]
    .reduce((maximum, entry) => Math.max(maximum, entry.fencingToken), 0)
  if (raw.nextFencingToken <= maximumFence) {
    wall("RESERVATION_LEDGER_CORRUPT", "invalid-next-fencing-token")
  }
  if (raw.nextFencingToken > raw.version + 1) {
    wall("RESERVATION_LEDGER_CORRUPT", "unreachable-next-fencing-token")
  }
  return { ...raw, reservations, releases }
}

function readLedgerFile(ledgerPath, ledgerId, createIfMissing) {
  let content
  try {
    content = fs.readFileSync(ledgerPath, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT" && createIfMissing) return emptyLedger(ledgerId)
    if (error?.code === "ENOENT") wall("RESERVATION_LEDGER_NOT_FOUND")
    wall("RESERVATION_LEDGER_IO_WALL")
  }
  try {
    return validateLedger(JSON.parse(content), ledgerId)
  } catch (error) {
    if (error instanceof LedgerWall) throw error
    wall("RESERVATION_LEDGER_CORRUPT", "invalid-json")
  }
}

function durableWrite(ledgerPath, ledger) {
  const directory = path.dirname(ledgerPath)
  const temporary = `${ledgerPath}.tmp-${process.pid}-${crypto.randomUUID()}`
  let handle
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    handle = fs.openSync(temporary, "wx", 0o600)
    fs.writeFileSync(handle, `${JSON.stringify(ledger, null, 2)}\n`, "utf8")
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = null
    fs.renameSync(temporary, ledgerPath)
    fsyncDirectoryBestEffort(directory)
  } catch {
    if (handle !== null && handle !== undefined) {
      try { fs.closeSync(handle) } catch { /* preserve the typed wall */ }
    }
    try { fs.rmSync(temporary, { force: true }) } catch { /* preserve the typed wall */ }
    wall("RESERVATION_LEDGER_IO_WALL")
  }
}

function processAlive(pid) {
  if (!integer(pid, 1)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

function staleLock(lockPath, staleAfterMs, now) {
  let stats
  try { stats = fs.statSync(lockPath) } catch { return false }
  if (now - stats.mtimeMs < staleAfterMs) return false
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"))
    return owner.hostname === os.hostname() && !processAlive(owner.pid)
  } catch {
    return true
  }
}

function acquireFileLock(ledgerPath, options = {}) {
  const lockPath = `${ledgerPath}.lock`
  const timeoutMs = integer(options.lockTimeoutMs) ? options.lockTimeoutMs : DEFAULT_LOCK_TIMEOUT_MS
  const staleAfterMs = integer(options.staleLockMs) ? options.staleLockMs : DEFAULT_STALE_LOCK_MS
  const started = Date.now()
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true, mode: 0o700 })
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 })
      try {
        fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: nowIso(),
          nonce: crypto.randomUUID(),
        }), { encoding: "utf8", mode: 0o600, flag: "wx" })
      } catch {
        fs.rmSync(lockPath, { recursive: true, force: true })
        wall("RESERVATION_LEDGER_LOCK_WALL")
      }
      return () => fs.rmSync(lockPath, { recursive: true, force: true })
    } catch (error) {
      if (error instanceof LedgerWall) throw error
      if (error?.code !== "EEXIST") wall("RESERVATION_LEDGER_LOCK_WALL")
      if (staleLock(lockPath, staleAfterMs, Date.now())) {
        const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`
        try {
          fs.renameSync(lockPath, stalePath)
          fs.rmSync(stalePath, { recursive: true, force: true })
          continue
        } catch (staleError) {
          if (staleError?.code === "ENOENT") continue
        }
      }
      if (Date.now() - started >= timeoutMs) wall("RESERVATION_LEDGER_LOCK_TIMEOUT")
      Atomics.wait(LOCK_WAIT_BUFFER, 0, 0, 10)
    }
  }
}

function withLedgerLock(ledgerPath, options, operation) {
  let unlock
  try {
    unlock = acquireFileLock(ledgerPath, options)
    return operation()
  } finally {
    if (unlock) unlock()
  }
}

function validateAcquireRequest(request) {
  if (!hasExactFields(request,
    ["schemaVersion", "artifactType", "laneId", "holderToken", "expectedVersion", "reservationSet"],
    ["schemaVersion", "artifactType", "laneId", "holderToken", "reservationSet"])
    || request.schemaVersion !== 1
    || request.artifactType !== "MULTI_AGENT_RESERVATION_ACQUIRE_REQUEST"
    || identity(request.laneId) === null
    || identity(request.holderToken) === null
    || (request.expectedVersion !== undefined && !integer(request.expectedVersion))
    || !strictReservationSetShape(request.reservationSet)) {
    wall("RESERVATION_ACQUIRE_REQUEST_INVALID")
  }
  const normalized = normalizeReservationSet(request.reservationSet)
  if (!normalized.valid) wall("RESERVATION_ACQUIRE_REQUEST_INVALID", "invalid-reservation-set")
  return {
    laneId: request.laneId.trim(),
    holderTokenDigest: tokenDigest(request.holderToken),
    expectedVersion: request.expectedVersion,
    reservationSet: normalized.reservationSet,
  }
}

function validateReleaseRequest(request) {
  if (!hasExactFields(request,
    ["schemaVersion", "artifactType", "reservationSetId", "holderToken", "fencingToken", "expectedVersion"],
    ["schemaVersion", "artifactType", "reservationSetId", "holderToken", "fencingToken"])
    || request.schemaVersion !== 1
    || request.artifactType !== "MULTI_AGENT_RESERVATION_RELEASE_REQUEST"
    || identity(request.reservationSetId) === null
    || identity(request.holderToken) === null
    || !integer(request.fencingToken, 1)
    || (request.expectedVersion !== undefined && !integer(request.expectedVersion))) {
    wall("RESERVATION_RELEASE_REQUEST_INVALID")
  }
  return {
    reservationSetId: request.reservationSetId.trim(),
    holderTokenDigest: tokenDigest(request.holderToken),
    fencingToken: request.fencingToken,
    expectedVersion: request.expectedVersion,
  }
}

function validateInspectRequest(request) {
  if (!hasExactFields(request, ["schemaVersion", "artifactType"])
    || request.schemaVersion !== 1
    || request.artifactType !== "MULTI_AGENT_RESERVATION_INSPECT_REQUEST") {
    wall("RESERVATION_INSPECT_REQUEST_INVALID")
  }
}

export function acquireReservations(ledgerPath, ledgerId, request, options = {}) {
  try {
    if (identity(ledgerPath) === null || identity(ledgerId) === null) {
      wall("RESERVATION_LEDGER_CONFIGURATION_WALL")
    }
    const candidate = validateAcquireRequest(request)
    return withLedgerLock(ledgerPath, options, () => {
      const ledger = readLedgerFile(ledgerPath, ledgerId, true)
      if (candidate.expectedVersion !== undefined && candidate.expectedVersion !== ledger.version) {
        wall("RESERVATION_LEDGER_VERSION_CONFLICT")
      }
      const existing = ledger.reservations.find(
        (entry) => entry.reservationSetId === candidate.reservationSet.reservationSetId,
      )
      if (existing) {
        const identical = sameDigest(existing.holderTokenDigest, candidate.holderTokenDigest)
          && existing.laneId === candidate.laneId
          && canonical(existing.reservationSet) === canonical(candidate.reservationSet)
        if (!identical) wall("RESERVATION_SET_ID_ALREADY_ACTIVE")
        return result("RESERVATION_ACQUIRE_IDEMPOTENT", {
          acquired: true,
          released: false,
          ledgerId,
          ledgerVersion: ledger.version,
          reservationSetId: existing.reservationSetId,
          fencingToken: existing.fencingToken,
          reasonCodes: Object.freeze([]),
          dispatchReservationGateSatisfied: true,
        })
      }

      const collisions = []
      for (const active of ledger.reservations) {
        const compatibility = checkReservationCompatibility(active.reservationSet, candidate.reservationSet)
        if (!compatibility.compatible) collisions.push(Object.freeze({
          blockingReservationSetId: active.reservationSetId,
          blockingWorkOrderId: active.workOrderId,
          reasonCodes: compatibility.reasonCodes,
          conflicts: compatibility.conflicts,
        }))
      }
      collisions.sort((a, b) => stableCompare(a.blockingReservationSetId, b.blockingReservationSetId))
      if (collisions.length > 0) return result("RESERVATION_COLLISION", {
        acquired: false,
        released: false,
        ledgerId,
        ledgerVersion: ledger.version,
        reservationSetId: candidate.reservationSet.reservationSetId,
        reasonCodes: Object.freeze([...new Set(collisions.flatMap((item) => item.reasonCodes))]
          .sort((left, right) => COLLISION_REASON_ORDER.indexOf(left)
            - COLLISION_REASON_ORDER.indexOf(right) || stableCompare(left, right))),
        collisions: Object.freeze(collisions),
        dispatchReservationGateSatisfied: false,
      })

      const timestamp = nowIso(options.now?.() ?? Date.now())
      const fencingToken = ledger.nextFencingToken
      const next = {
        ...ledger,
        version: ledger.version + 1,
        nextFencingToken: fencingToken + 1,
        updatedAt: timestamp,
        reservations: [...ledger.reservations, {
          reservationSetId: candidate.reservationSet.reservationSetId,
          workerId: candidate.reservationSet.workerId,
          workOrderId: candidate.reservationSet.workOrderId,
          laneId: candidate.laneId,
          holderTokenDigest: candidate.holderTokenDigest,
          fencingToken,
          acquiredAt: timestamp,
          reservationSet: candidate.reservationSet,
        }].sort((a, b) => stableCompare(a.reservationSetId, b.reservationSetId)),
        releases: ledger.releases.filter(
          (entry) => entry.reservationSetId !== candidate.reservationSet.reservationSetId,
        ),
      }
      durableWrite(ledgerPath, next)
      return result("RESERVATION_ACQUIRED", {
        acquired: true,
        released: false,
        ledgerId,
        ledgerVersion: next.version,
        reservationSetId: candidate.reservationSet.reservationSetId,
        fencingToken,
        reasonCodes: Object.freeze([]),
        dispatchReservationGateSatisfied: true,
      })
    })
  } catch (error) {
    return wallResult(error)
  }
}

export function releaseReservations(ledgerPath, ledgerId, request, options = {}) {
  try {
    if (identity(ledgerPath) === null || identity(ledgerId) === null) {
      wall("RESERVATION_LEDGER_CONFIGURATION_WALL")
    }
    const candidate = validateReleaseRequest(request)
    return withLedgerLock(ledgerPath, options, () => {
      const ledger = readLedgerFile(ledgerPath, ledgerId, false)
      if (candidate.expectedVersion !== undefined && candidate.expectedVersion !== ledger.version) {
        wall("RESERVATION_LEDGER_VERSION_CONFLICT")
      }
      const active = ledger.reservations.find(
        (entry) => entry.reservationSetId === candidate.reservationSetId,
      )
      if (!active) {
        const prior = ledger.releases.find((entry) => entry.reservationSetId === candidate.reservationSetId
          && entry.fencingToken === candidate.fencingToken
          && sameDigest(entry.holderTokenDigest, candidate.holderTokenDigest))
        if (!prior) wall("RESERVATION_RELEASE_NOT_HOLDER")
        return result("RESERVATION_RELEASE_IDEMPOTENT", {
          acquired: false,
          released: true,
          ledgerId,
          ledgerVersion: ledger.version,
          reservationSetId: prior.reservationSetId,
          fencingToken: prior.fencingToken,
          reasonCodes: Object.freeze([]),
          dispatchReservationGateSatisfied: false,
        })
      }
      if (active.fencingToken !== candidate.fencingToken
        || !sameDigest(active.holderTokenDigest, candidate.holderTokenDigest)) {
        wall("RESERVATION_RELEASE_NOT_HOLDER")
      }

      const timestamp = nowIso(options.now?.() ?? Date.now())
      const next = {
        ...ledger,
        version: ledger.version + 1,
        updatedAt: timestamp,
        reservations: ledger.reservations.filter(
          (entry) => entry.reservationSetId !== candidate.reservationSetId,
        ),
        releases: [...ledger.releases.filter(
          (entry) => entry.reservationSetId !== candidate.reservationSetId,
        ), {
          reservationSetId: active.reservationSetId,
          holderTokenDigest: active.holderTokenDigest,
          fencingToken: active.fencingToken,
          releasedAt: timestamp,
        }].sort((a, b) => stableCompare(a.reservationSetId, b.reservationSetId)),
      }
      durableWrite(ledgerPath, next)
      return result("RESERVATION_RELEASED", {
        acquired: false,
        released: true,
        ledgerId,
        ledgerVersion: next.version,
        reservationSetId: active.reservationSetId,
        fencingToken: active.fencingToken,
        reasonCodes: Object.freeze([]),
        dispatchReservationGateSatisfied: false,
      })
    })
  } catch (error) {
    return wallResult(error)
  }
}

export function inspectReservationLedger(ledgerPath, ledgerId, request) {
  try {
    if (identity(ledgerPath) === null || identity(ledgerId) === null) {
      wall("RESERVATION_LEDGER_CONFIGURATION_WALL")
    }
    validateInspectRequest(request)
    const ledger = readLedgerFile(ledgerPath, ledgerId, false)
    return result("RESERVATION_LEDGER_VALID", {
      valid: true,
      ledgerId,
      ledgerVersion: ledger.version,
      reservations: Object.freeze(ledger.reservations.map((entry) => Object.freeze({
        reservationSetId: entry.reservationSetId,
        workerId: entry.workerId,
        workOrderId: entry.workOrderId,
        laneId: entry.laneId,
        fencingToken: entry.fencingToken,
        acquiredAt: entry.acquiredAt,
        reservationSet: entry.reservationSet,
      }))),
      releaseCount: ledger.releases.length,
    })
  } catch (error) {
    return wallResult(error)
  }
}
