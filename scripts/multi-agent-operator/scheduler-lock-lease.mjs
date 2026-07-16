import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"

const WAIT = new Int32Array(new SharedArrayBuffer(4))
const HASH = /^[a-f0-9]{64}$/
const OWNER_FIELDS = ["statePath", "pid", "hostname", "nonce", "generation", "issuedAt", "heartbeatAt", "expiresAt", "lockFence"]

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

function startHeartbeat(ownerPath, owner, leaseDurationMs, heartbeatIntervalMs) {
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 5)
  const control = new Int32Array(controlBuffer)
  Atomics.store(control, 2, owner.generation)
  const worker = new Worker(new URL("./scheduler-lock-heartbeat.mjs", import.meta.url), {
    workerData: { ownerPath, owner, leaseDurationMs, heartbeatIntervalMs, controlBuffer },
    // The heartbeat is a self-contained file worker. Do not inherit test-runner or
    // stdin-only parent flags that can make Node reject the worker entrypoint.
    execArgv: [],
  })
  const ready = Atomics.wait(control, 1, 0, Math.max(1000, heartbeatIntervalMs * 4))
  if (ready === "timed-out" || Atomics.load(control, 4) !== 0 || Atomics.load(control, 2) <= owner.generation) {
    Atomics.store(control, 0, 1); Atomics.notify(control, 0)
    void worker.terminate()
    wall("SCHEDULER_LOCK_WALL", "HEARTBEAT_START_REQUIRED")
  }
  return { worker, control }
}

function assertHeartbeatOwnership(ownerPath, owner, heartbeat) {
  if (Atomics.load(heartbeat.control, 4) !== 0) wall("SCHEDULER_LOCK_WALL", "LEASE_LOST")
  try {
    const current = readOwner(ownerPath).owner
    const generation = Atomics.load(heartbeat.control, 2)
    if (!validOwner(current, owner.statePath) || current.nonce !== owner.nonce
      || current.generation !== generation || current.expiresAt <= Date.now()) {
      wall("SCHEDULER_LOCK_WALL", "LEASE_LOST")
    }
  } catch (error) {
    if (error instanceof SchedulerLockLeaseError) throw error
    wall("SCHEDULER_LOCK_WALL", "LEASE_LOST")
  }
}

function stopHeartbeat(heartbeat) {
  Atomics.store(heartbeat.control, 0, 1)
  Atomics.notify(heartbeat.control, 0)
  Atomics.wait(heartbeat.control, 3, 0, 1000)
  void heartbeat.worker.terminate()
}

function restoreQuarantine(lock, quarantine) {
  if (fs.existsSync(lock)) wall("SCHEDULER_LOCK_WALL", "QUARANTINE_RESTORE_CONFLICT")
  fs.renameSync(quarantine, lock)
  fsyncDirectory(path.dirname(lock))
}

function cleanupCreatedLock(lock, statePath, expectedOwner, ownerPublished) {
  const quarantine = `${lock}.failed-${expectedOwner.nonce}-${expectedOwner.generation}-${crypto.randomUUID()}`
  try { fs.renameSync(lock, quarantine); fsyncDirectory(path.dirname(lock)) } catch (error) {
    if (error?.code === "ENOENT") return
    wall("SCHEDULER_LOCK_WALL", "FAILED_OWNER_QUARANTINE_REQUIRED")
  }
  let removable = false
  try {
    const quarantinedOwnerPath = path.join(quarantine, "owner.json")
    if (!ownerPublished && !fs.existsSync(quarantinedOwnerPath)) removable = true
    else {
      const current = readOwner(quarantinedOwnerPath).owner
      removable = validOwner(current, statePath) && current.nonce === expectedOwner.nonce
        && current.generation === expectedOwner.generation && current.lockFence === expectedOwner.lockFence
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
      const heartbeat = startHeartbeat(ownerPath, owner, leaseDurationMs, heartbeatIntervalMs)
      const release = () => {
        stopHeartbeat(heartbeat)
        try {
          const current = readOwner(ownerPath).owner
          const generation = Atomics.load(heartbeat.control, 2)
          if (validOwner(current, statePath) && current.nonce === owner.nonce && current.generation === generation
            && current.lockFence === schedulerLockFence(current)) {
            fs.rmSync(lock, { recursive: true, force: true })
            fsyncDirectory(path.dirname(lock))
          }
        } catch { /* a fenced successor or quarantine owns cleanup */ }
      }
      release.assertOwned = () => assertHeartbeatOwnership(ownerPath, owner, heartbeat)
      return release
    } catch (error) {
      if (created) {
        if (createdOwner !== null) cleanupCreatedLock(lock, statePath, createdOwner, ownerPublished)
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
