import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"

const WAIT = new Int32Array(new SharedArrayBuffer(4))
const HASH = /^[a-f0-9]{64}$/
const OWNER_FIELDS = ["statePath", "pid", "hostname", "nonce", "generation", "issuedAt", "heartbeatAt", "expiresAt", "lockFence"]
const HEARTBEAT_LIFECYCLE_TIMEOUT_MS = 5_000
const HEARTBEAT_LIFECYCLE_TIMEOUT_MAX_MS = 60_000

export class SchedulerLockLeaseError extends Error {
  constructor(code, detail = null) {
    super(`${code}${detail === null ? "" : `:${detail}`}`)
    this.name = "SchedulerLockLeaseError"
    this.code = code
    this.detail = detail
  }
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
}

function hash(value) { return crypto.createHash("sha256").update(canonical(value)).digest("hex") }
function wall(code, detail = null) { throw new SchedulerLockLeaseError(code, detail) }

export function schedulerLockFence(owner) {
  return hash({
    statePath: owner.statePath,
    pid: owner.pid,
    hostname: owner.hostname,
    nonce: owner.nonce,
    generation: owner.generation,
    issuedAt: owner.issuedAt,
    heartbeatAt: owner.heartbeatAt,
    expiresAt: owner.expiresAt,
  })
}

export function schedulerLockOwnerRecord({ statePath, pid, hostname, nonce, generation, issuedAt, heartbeatAt, expiresAt }) {
  const owner = { statePath, pid, hostname, nonce, generation, issuedAt, heartbeatAt, expiresAt }
  return { ...owner, lockFence: schedulerLockFence(owner) }
}

function validOwner(owner, statePath) {
  return owner && typeof owner === "object" && !Array.isArray(owner)
    && Object.keys(owner).sort().join("\0") === [...OWNER_FIELDS].sort().join("\0")
    && owner.statePath === statePath
    && Number.isSafeInteger(owner.pid) && owner.pid > 0
    && typeof owner.hostname === "string" && owner.hostname.length > 0
    && typeof owner.nonce === "string" && owner.nonce.length > 0
    && Number.isSafeInteger(owner.generation) && owner.generation > 0
    && Number.isSafeInteger(owner.issuedAt) && Number.isSafeInteger(owner.heartbeatAt) && Number.isSafeInteger(owner.expiresAt)
    && owner.issuedAt <= owner.heartbeatAt && owner.heartbeatAt < owner.expiresAt
    && HASH.test(owner.lockFence) && owner.lockFence === schedulerLockFence(owner)
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return
  let descriptor
  try { descriptor = fs.openSync(directory, "r"); fs.fsyncSync(descriptor) } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
}

export function atomicPersistSchedulerLockOwner(ownerPath, owner) {
  if (!validOwner(owner, owner.statePath)) wall("SCHEDULER_LOCK_WALL", "INVALID_OWNER_RECORD")
  const directory = path.dirname(ownerPath)
  const temporary = path.join(directory, `.owner-${owner.nonce}-${owner.generation}-${crypto.randomUUID()}.tmp`)
  let descriptor
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600)
    fs.writeFileSync(descriptor, canonical(owner))
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor); descriptor = undefined
    fs.renameSync(temporary, ownerPath)
    fsyncDirectory(directory)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { fs.rmSync(temporary, { force: true }) } catch { /* best-effort unpublished temporary cleanup */ }
  }
}

function writeInitialOwner(ownerPath, owner) {
  let descriptor
  try {
    descriptor = fs.openSync(ownerPath, "wx", 0o600)
    fs.writeFileSync(descriptor, canonical(owner))
    fs.fsyncSync(descriptor)
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
  fsyncDirectory(path.dirname(ownerPath))
}

function readOwner(ownerPath) {
  const text = fs.readFileSync(ownerPath, "utf8")
  const owner = JSON.parse(text)
  return { text: canonical(owner), owner }
}

function sameHostPidAlive(owner, hostname) {
  if (owner.hostname !== hostname) return false
  try { process.kill(owner.pid, 0); return true } catch (error) { return error?.code === "EPERM" }
}

function staleOwner(owner, hostname, now) {
  return owner.expiresAt <= now || (owner.hostname === hostname && !sameHostPidAlive(owner, hostname))
}

function boundedHeartbeatTimeout(value, field) {
  if (!Number.isSafeInteger(value) || value < 1 || value > HEARTBEAT_LIFECYCLE_TIMEOUT_MAX_MS) {
    wall("SCHEDULER_LOCK_WALL", field)
  }
  return value
}

function normalizeHeartbeatTestDelays(value) {
  if (value === undefined) return { startAckMs: 0, stopAckMs: 0 }
  if (process.env.NODE_ENV !== "test" || value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== "startAckMs\0stopAckMs"
    || !Number.isSafeInteger(value.startAckMs) || value.startAckMs < 0 || value.startAckMs > HEARTBEAT_LIFECYCLE_TIMEOUT_MAX_MS
    || !Number.isSafeInteger(value.stopAckMs) || value.stopAckMs < 0 || value.stopAckMs > HEARTBEAT_LIFECYCLE_TIMEOUT_MAX_MS) {
    wall("SCHEDULER_LOCK_WALL", "INVALID_HEARTBEAT_TEST_DELAYS")
  }
  return { startAckMs: value.startAckMs, stopAckMs: value.stopAckMs }
}

function stopHeartbeat(heartbeat) {
  Atomics.store(heartbeat.control, 0, 1)
  Atomics.notify(heartbeat.control, 0)
  if (Atomics.load(heartbeat.control, 3) === 0) {
    Atomics.wait(heartbeat.control, 3, 0, heartbeat.stopTimeoutMs)
  }
  const stopped = Atomics.load(heartbeat.control, 3) !== 0
  void heartbeat.worker.terminate()
  return stopped
}

function heartbeatStartupFailure(heartbeat) {
  const stopped = stopHeartbeat(heartbeat)
  const error = new SchedulerLockLeaseError(
    "SCHEDULER_LOCK_WALL",
    stopped ? "HEARTBEAT_START_REQUIRED" : "HEARTBEAT_STOP_REQUIRED",
  )
  Object.defineProperties(error, {
    heartbeatQuiesced: { value: stopped },
    heartbeatGeneration: { value: Atomics.load(heartbeat.control, 2) },
  })
  throw error
}

function confirmedHeartbeatOwner(ownerPath, owner, heartbeat) {
  const deadline = Date.now() + heartbeat.confirmationTimeoutMs
  for (;;) {
    if (Atomics.load(heartbeat.control, 4) !== 0) return null
    try {
      const current = readOwner(ownerPath).owner
      const generation = Atomics.load(heartbeat.control, 2)
      if (validOwner(current, owner.statePath) && current.nonce === owner.nonce
        && current.generation === generation && current.expiresAt > Date.now()) {
        return current
      }
      const renewalPublicationInProgress = validOwner(current, owner.statePath)
        && current.nonce === owner.nonce && current.generation === generation + 1
      if (!renewalPublicationInProgress) return null
    } catch { /* retry a bounded atomic-replace visibility race */ }
    if (Date.now() >= deadline) return null
    Atomics.wait(WAIT, 0, 0, 1)
  }
}

function startHeartbeat(ownerPath, owner, leaseDurationMs, heartbeatIntervalMs, lifecycle) {
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 5)
  const control = new Int32Array(controlBuffer)
  Atomics.store(control, 2, owner.generation)
  const worker = new Worker(new URL("./scheduler-lock-heartbeat.mjs", import.meta.url), {
    workerData: {
      ownerPath, owner, leaseDurationMs, heartbeatIntervalMs, controlBuffer,
      lifecycleDelays: lifecycle.testDelays,
    },
    // The heartbeat is a self-contained file worker. Do not inherit test-runner or
    // stdin-only parent flags that can make Node reject the worker entrypoint.
    execArgv: [],
  })
  const heartbeat = {
    worker,
    control,
    stopTimeoutMs: lifecycle.stopTimeoutMs,
    confirmationTimeoutMs: Math.min(lifecycle.startTimeoutMs, Math.max(100, heartbeatIntervalMs * 2)),
  }
  const ready = Atomics.wait(control, 1, 0, lifecycle.startTimeoutMs)
  if (ready === "timed-out" || Atomics.load(control, 4) !== 0 || Atomics.load(control, 2) <= owner.generation) {
    heartbeatStartupFailure(heartbeat)
  }
  if (confirmedHeartbeatOwner(ownerPath, owner, heartbeat) === null) heartbeatStartupFailure(heartbeat)
  return heartbeat
}

function assertHeartbeatOwnership(ownerPath, owner, heartbeat) {
  if (confirmedHeartbeatOwner(ownerPath, owner, heartbeat) === null) wall("SCHEDULER_LOCK_WALL", "LEASE_LOST")
}

function restoreQuarantine(lock, quarantine) {
  if (fs.existsSync(lock)) wall("SCHEDULER_LOCK_WALL", "QUARANTINE_RESTORE_CONFLICT")
  fs.renameSync(quarantine, lock)
  fsyncDirectory(path.dirname(lock))
}

function cleanupCreatedLock(
  lock,
  statePath,
  expectedOwner,
  ownerPublished,
  allowRenewedOwner = false,
  quarantineHook = null,
  exactStoppedGeneration = null,
) {
  const quarantine = `${lock}.failed-${expectedOwner.nonce}-${expectedOwner.generation}-${crypto.randomUUID()}`
  try { fs.renameSync(lock, quarantine); fsyncDirectory(path.dirname(lock)) } catch (error) {
    if (error?.code === "ENOENT") return
    wall("SCHEDULER_LOCK_WALL", "FAILED_OWNER_QUARANTINE_REQUIRED")
  }
  quarantineHook?.({ lockPath: lock, quarantinePath: quarantine, expectedOwner })
  let removable = false
  try {
    const quarantinedOwnerPath = path.join(quarantine, "owner.json")
    if (!ownerPublished && !fs.existsSync(quarantinedOwnerPath)) removable = true
    else {
      const current = readOwner(quarantinedOwnerPath).owner
      const exactInitialOwner = current.generation === expectedOwner.generation
        && current.lockFence === expectedOwner.lockFence
      const stoppedRenewedOwner = allowRenewedOwner
        && current.pid === expectedOwner.pid && current.hostname === expectedOwner.hostname
        && current.issuedAt === expectedOwner.issuedAt && current.generation >= expectedOwner.generation
        && (exactStoppedGeneration === null || current.generation === exactStoppedGeneration)
      removable = validOwner(current, statePath) && current.nonce === expectedOwner.nonce
        && (exactInitialOwner || stoppedRenewedOwner)
    }
  } catch { /* preserve unknown ownership rather than deleting it */ }
  if (removable) {
    fs.rmSync(quarantine, { recursive: true, force: true })
    fsyncDirectory(path.dirname(lock))
  } else if (!fs.existsSync(lock)) restoreQuarantine(lock, quarantine)
}

export function acquireSchedulerLock(statePath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000
  const leaseDurationMs = options.leaseDurationMs ?? 30_000
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(10, Math.floor(leaseDurationMs / 3))
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 30
    || !Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 5 || heartbeatIntervalMs * 2 >= leaseDurationMs) {
    wall("SCHEDULER_LOCK_WALL", "INVALID_LEASE_CONFIGURATION")
  }
  const heartbeatStartTimeoutMs = boundedHeartbeatTimeout(
    options.heartbeatStartTimeoutMs ?? HEARTBEAT_LIFECYCLE_TIMEOUT_MS,
    "INVALID_HEARTBEAT_START_TIMEOUT",
  )
  const heartbeatStopTimeoutMs = boundedHeartbeatTimeout(
    options.heartbeatStopTimeoutMs ?? HEARTBEAT_LIFECYCLE_TIMEOUT_MS,
    "INVALID_HEARTBEAT_STOP_TIMEOUT",
  )
  const heartbeatTestDelays = normalizeHeartbeatTestDelays(options.heartbeatTestDelays)
  const releaseQuarantineHook = options.releaseQuarantineHook
  if (releaseQuarantineHook !== undefined
    && (process.env.NODE_ENV !== "test" || typeof releaseQuarantineHook !== "function")) {
    wall("SCHEDULER_LOCK_WALL", "INVALID_RELEASE_QUARANTINE_HOOK")
  }
  const lock = `${statePath}.lock`
  const ownerPath = path.join(lock, "owner.json")
  const started = Date.now()
  const hostname = options.ownerHostname ?? os.hostname()
  if (typeof hostname !== "string" || hostname.length === 0) wall("SCHEDULER_LOCK_WALL", "INVALID_OWNER_HOSTNAME")
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 })
  for (;;) {
    let created = false
    let createdOwner = null
    let ownerPublished = false
    try {
      fs.mkdirSync(lock, { mode: 0o700 })
      created = true
      const now = Date.now()
      const owner = schedulerLockOwnerRecord({
        statePath, pid: process.pid, hostname, nonce: crypto.randomUUID(), generation: 1,
        issuedAt: now, heartbeatAt: now, expiresAt: now + leaseDurationMs,
      })
      createdOwner = owner
      writeInitialOwner(ownerPath, owner)
      ownerPublished = true
      const heartbeat = startHeartbeat(ownerPath, owner, leaseDurationMs, heartbeatIntervalMs, {
        startTimeoutMs: heartbeatStartTimeoutMs,
        stopTimeoutMs: heartbeatStopTimeoutMs,
        testDelays: heartbeatTestDelays,
      })
      const release = () => {
        if (!stopHeartbeat(heartbeat)) wall("SCHEDULER_LOCK_WALL", "HEARTBEAT_STOP_REQUIRED")
        cleanupCreatedLock(
          lock,
          statePath,
          owner,
          true,
          true,
          releaseQuarantineHook,
          Atomics.load(heartbeat.control, 2),
        )
      }
      release.assertOwned = () => assertHeartbeatOwnership(ownerPath, owner, heartbeat)
      return release
    } catch (error) {
      if (created) {
        if (createdOwner !== null && error?.heartbeatQuiesced !== false) {
          cleanupCreatedLock(
            lock,
            statePath,
            createdOwner,
            ownerPublished,
            error?.heartbeatQuiesced === true,
            null,
            error?.heartbeatQuiesced === true ? error.heartbeatGeneration : null,
          )
        }
        if (error instanceof SchedulerLockLeaseError) throw error
        wall("SCHEDULER_LOCK_WALL", "OWNER_RECORD_REQUIRED")
      }
      if (error?.code !== "EEXIST") {
        if (error instanceof SchedulerLockLeaseError) throw error
        wall("SCHEDULER_LOCK_WALL")
      }
      try {
        const first = readOwner(ownerPath)
        if (validOwner(first.owner, statePath) && staleOwner(first.owner, hostname, Date.now())) {
          const observed = readOwner(ownerPath)
          if (validOwner(observed.owner, statePath) && staleOwner(observed.owner, hostname, Date.now())) {
            const quarantine = `${lock}.stale-${observed.owner.nonce}-${observed.owner.generation}-${crypto.randomUUID()}`
            try {
              fs.renameSync(lock, quarantine)
              options.quarantineHook?.({ quarantinePath: quarantine, observedOwner: observed.owner })
              const quarantined = readOwner(path.join(quarantine, "owner.json"))
              if (!validOwner(quarantined.owner, statePath) || quarantined.text !== observed.text) {
                restoreQuarantine(lock, quarantine)
              } else {
                fs.rmSync(quarantine, { recursive: true, force: true })
                fsyncDirectory(path.dirname(lock))
              }
              continue
            } catch (reclaimError) {
              if (reclaimError instanceof SchedulerLockLeaseError) throw reclaimError
              if (reclaimError?.code === "ENOENT") continue
              wall("SCHEDULER_LOCK_WALL", "STALE_RECLAIM_FAILED")
            }
          }
        }
      } catch (readError) {
        if (readError instanceof SchedulerLockLeaseError) throw readError
        /* malformed or concurrently changing ownership times out rather than being stolen */
      }
      if (Date.now() - started >= timeoutMs) wall("SCHEDULER_LOCK_TIMEOUT")
      Atomics.wait(WAIT, 0, 0, Math.min(10, timeoutMs))
    }
  }
}
