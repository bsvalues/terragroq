import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const COUNTER_ALIASES = Object.freeze({
  ownerOperationTouchCount: "OWNER_OPERATION_TOUCH_COUNT",
  ownerCredentialTouchCount: "OWNER_CREDENTIAL_TOUCH_COUNT",
  ownerDiagnosticTouchCount: "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  ownerRoutineDecisionCount: "OWNER_ROUTINE_DECISION_COUNT",
  ownerRoutineContactCount: "OWNER_ROUTINE_CONTACT_COUNT",
})
const COUNTER_NAMES = Object.freeze(Object.values(COUNTER_ALIASES))
const STALE_LOCK_MS = 10 * 60 * 1000

function fail(code, message = code) {
  const error = new Error(message)
  error.code = code
  throw error
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : now ?? Date.now()
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : value
  if (!Number.isFinite(milliseconds)) fail("INVALID_TIMESTAMP")
  return { milliseconds, iso: new Date(milliseconds).toISOString() }
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function initialState(storeId, now) {
  return {
    schemaVersion: 1,
    storeId,
    revision: 0,
    nextFencingToken: 1,
    updatedAt: timestamp(now).iso,
    killSwitch: { active: false, reason: null, updatedAt: null },
    ownerTouchCounters: Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])),
    executions: {},
    idempotency: {},
  }
}

function atomicWrite(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const handle = fs.openSync(temporary, "wx", 0o600)
  try {
    fs.writeFileSync(handle, `${JSON.stringify(state, null, 2)}\n`, "utf8")
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  try {
    fs.renameSync(temporary, filePath)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
}

function validateState(state, storeId) {
  if (!state || state.schemaVersion !== 1 || state.storeId !== storeId
    || !Number.isInteger(state.revision) || !Number.isInteger(state.nextFencingToken)
    || state.nextFencingToken < 1 || typeof state.executions !== "object"
    || typeof state.idempotency !== "object" || typeof state.ownerTouchCounters !== "object") {
    fail("HERMES_STATE_CORRUPT")
  }
  return state
}

export function readHermesState(filePath, storeId = "hermes-bridge") {
  if (!fs.existsSync(filePath)) return initialState(storeId)
  try {
    return validateState(JSON.parse(fs.readFileSync(filePath, "utf8")), storeId)
  } catch (error) {
    if (error?.code === "HERMES_STATE_CORRUPT") throw error
    fail("HERMES_STATE_CORRUPT", `Unable to read Hermes state: ${error.message}`)
  }
}

function withLock(filePath, operation) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const lockPath = `${filePath}.lock`
  let lock
  try {
    lock = fs.openSync(lockPath, "wx", 0o600)
  } catch (error) {
    if (error?.code !== "EEXIST") throw error
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs
      if (age <= STALE_LOCK_MS) fail("HERMES_STATE_BUSY")
      fs.unlinkSync(lockPath)
      lock = fs.openSync(lockPath, "wx", 0o600)
    } catch (recoveryError) {
      if (recoveryError?.code === "HERMES_STATE_BUSY") throw recoveryError
      fail("HERMES_STATE_BUSY")
    }
  }
  try { return operation() } finally {
    fs.closeSync(lock)
    fs.unlinkSync(lockPath)
  }
}

function mutate(filePath, storeId, idempotencyKey, request, now, operation) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") fail("IDEMPOTENCY_KEY_REQUIRED")
  return withLock(filePath, () => {
    const state = readHermesState(filePath, storeId)
    const requestHash = digest(request)
    const prior = state.idempotency[idempotencyKey]
    if (prior) {
      if (prior.requestHash !== requestHash) fail("IDEMPOTENCY_CONFLICT")
      return { ...prior.result, idempotent: true }
    }
    const result = operation(state, timestamp(now))
    const next = {
      ...state,
      revision: state.revision + 1,
      updatedAt: timestamp(now).iso,
      idempotency: { ...state.idempotency, [idempotencyKey]: { requestHash, result } },
    }
    atomicWrite(filePath, validateState(next, storeId))
    return { ...result, idempotent: false }
  })
}

function assertRunning(state) {
  if (state.killSwitch.active) fail("KILL_SWITCH_ACTIVE")
}

function execution(state, outcomeId) {
  const current = state.executions[outcomeId]
  if (!current) fail("EXECUTION_NOT_FOUND")
  return current
}

function assertFence(current, holderId, fencingToken) {
  if (current.fencingToken !== fencingToken) fail("FENCING_TOKEN_CONFLICT")
  if (current.lease.status !== "ACTIVE" || current.lease.holderId !== holderId) fail("LEASE_NOT_HELD")
}

function metadata(input = {}, current = {}) {
  const prNumber = input.prNumber ?? current.prNumber ?? null
  if (prNumber !== null && (!Number.isInteger(prNumber) || prNumber < 1)) fail("INVALID_PR_NUMBER")
  const outcome = input.outcome ?? current.outcome ?? null
  if (outcome !== null && (typeof outcome !== "object" || Array.isArray(outcome))) fail("INVALID_OUTCOME_SNAPSHOT")
  return {
    threadId: input.threadId ?? current.threadId ?? null,
    turnId: input.turnId ?? current.turnId ?? null,
    branch: input.branch ?? current.branch ?? null,
    prNumber,
    worktreePath: input.worktreePath ?? current.worktreePath ?? null,
    baseSha: input.baseSha ?? current.baseSha ?? null,
    headRefOid: input.headRefOid ?? current.headRefOid ?? null,
    mergeSha: input.mergeSha ?? current.mergeSha ?? null,
    outcome,
  }
}

export function initializeHermesState(filePath, { storeId = "hermes-bridge", now } = {}) {
  return withLock(filePath, () => {
    if (fs.existsSync(filePath)) return readHermesState(filePath, storeId)
    const state = initialState(storeId, now)
    atomicWrite(filePath, state)
    return state
  })
}

export function acquireLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    if (!request.outcomeId || !request.holderId || !Number.isFinite(request.leaseDurationMs) || request.leaseDurationMs <= 0) fail("LEASE_REQUEST_INVALID")
    const existing = state.executions[request.outcomeId]
    if (existing) fail(Date.parse(existing.lease.expiresAt) <= at.milliseconds ? "LEASE_RECLAIM_REQUIRED" : "LEASE_ALREADY_HELD")
    const fencingToken = state.nextFencingToken++
    const current = {
      outcomeId: request.outcomeId,
      fencingToken,
      lease: { status: "ACTIVE", holderId: request.holderId, acquiredAt: at.iso, expiresAt: new Date(at.milliseconds + request.leaseDurationMs).toISOString() },
      checkpoint: { sequence: 0, state: "LEASED", detail: null, recordedAt: at.iso },
      metadata: metadata(request.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: current }
    return { outcomeId: request.outcomeId, fencingToken, checkpointSequence: 0, leaseExpiresAt: current.lease.expiresAt, metadata: current.metadata }
  })
}

export function reclaimLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    if (Date.parse(current.lease.expiresAt) > at.milliseconds) fail("LEASE_NOT_EXPIRED")
    if (!request.holderId || !Number.isFinite(request.leaseDurationMs) || request.leaseDurationMs <= 0) fail("LEASE_REQUEST_INVALID")
    const fencingToken = state.nextFencingToken++
    const reclaimed = {
      ...current,
      fencingToken,
      lease: { status: "ACTIVE", holderId: request.holderId, acquiredAt: at.iso, expiresAt: new Date(at.milliseconds + request.leaseDurationMs).toISOString() },
      metadata: metadata(request.metadata, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: reclaimed }
    return { outcomeId: request.outcomeId, fencingToken, checkpointSequence: reclaimed.checkpoint.sequence, leaseExpiresAt: reclaimed.lease.expiresAt, metadata: reclaimed.metadata }
  })
}

export function writeCheckpoint(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    if (Date.parse(current.lease.expiresAt) <= at.milliseconds) fail("LEASE_EXPIRED")
    if (request.expectedCheckpointSequence !== current.checkpoint.sequence) fail("CHECKPOINT_SEQUENCE_CONFLICT")
    if (typeof request.state !== "string" || request.state.trim() === "") fail("CHECKPOINT_STATE_INVALID")
    const updated = {
      ...current,
      checkpoint: { sequence: current.checkpoint.sequence + 1, state: request.state, detail: request.detail ?? null, recordedAt: at.iso },
      metadata: metadata(request.metadata, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: updated }
    return { outcomeId: request.outcomeId, fencingToken: updated.fencingToken, checkpointSequence: updated.checkpoint.sequence, state: updated.checkpoint.state, metadata: updated.metadata }
  })
}

export function renewLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    if (Date.parse(current.lease.expiresAt) <= at.milliseconds) fail("LEASE_EXPIRED")
    if (!Number.isFinite(request.leaseDurationMs) || request.leaseDurationMs <= 0) fail("LEASE_REQUEST_INVALID")
    const renewed = {
      ...current,
      lease: { ...current.lease, expiresAt: new Date(at.milliseconds + request.leaseDurationMs).toISOString(), renewedAt: at.iso },
    }
    state.executions = { ...state.executions, [request.outcomeId]: renewed }
    return { outcomeId: request.outcomeId, fencingToken: current.fencingToken, leaseExpiresAt: renewed.lease.expiresAt }
  })
}

export function releaseLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    const released = { ...current, lease: { ...current.lease, status: "RELEASED", expiresAt: at.iso, releasedAt: at.iso } }
    state.executions = { ...state.executions, [request.outcomeId]: released }
    return { outcomeId: request.outcomeId, fencingToken: current.fencingToken, checkpointSequence: current.checkpoint.sequence, leaseStatus: "RELEASED" }
  })
}

export function abandonLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    const abandoned = {
      ...current,
      lease: { ...current.lease, expiresAt: at.iso, abandonedAt: at.iso, abandonReason: request.reason ?? null },
    }
    state.executions = { ...state.executions, [request.outcomeId]: abandoned }
    return { outcomeId: request.outcomeId, fencingToken: current.fencingToken, leaseExpiresAt: at.iso }
  })
}

export function reopenProviderWall(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    if (current.lease.status !== "RELEASED" || current.checkpoint.state !== "FAILED_TERMINAL"
      || current.checkpoint.detail !== request.expectedDetail) {
      fail("PROVIDER_RECOVERY_STATE_WALL")
    }
    const reopened = {
      ...current,
      lease: {
        ...current.lease,
        status: "ABANDONED",
        expiresAt: at.iso,
        recoveredAt: at.iso,
        recoverReason: "TRANSIENT_NATIVE_PROVIDER_WALL",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "RETRYABLE_PROVIDER_WALL",
        detail: request.expectedDetail,
        recordedAt: at.iso,
      },
    }
    state.executions = { ...state.executions, [request.outcomeId]: reopened }
    return {
      outcomeId: request.outcomeId,
      fencingToken: reopened.fencingToken,
      checkpointSequence: reopened.checkpoint.sequence,
      leaseStatus: reopened.lease.status,
    }
  })
}

export function setKillSwitch(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    if (typeof request.active !== "boolean") fail("KILL_SWITCH_REQUEST_INVALID")
    state.killSwitch = { active: request.active, reason: request.reason ?? null, updatedAt: at.iso }
    return { killSwitch: state.killSwitch }
  })
}

export function recordOwnerTouch(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state) => {
    const counter = COUNTER_ALIASES[request.counter] ?? request.counter
    if (!COUNTER_NAMES.includes(counter)) fail("OWNER_TOUCH_COUNTER_INVALID")
    const amount = request.amount ?? 1
    if (!Number.isInteger(amount) || amount < 1) fail("OWNER_TOUCH_AMOUNT_INVALID")
    state.ownerTouchCounters = { ...state.ownerTouchCounters, [counter]: state.ownerTouchCounters[counter] + amount }
    return { ownerTouchCounters: state.ownerTouchCounters }
  })
}

export function createHermesStateStore(filePath, options = {}) {
  return Object.freeze({
    initialize: () => initializeHermesState(filePath, options),
    read: () => readHermesState(filePath, options.storeId),
    acquireLease: (request) => acquireLease(filePath, request, options),
    reclaimLease: (request) => reclaimLease(filePath, request, options),
    checkpoint: (request) => writeCheckpoint(filePath, request, options),
    renewLease: (request) => renewLease(filePath, request, options),
    abandonLease: (request) => abandonLease(filePath, request, options),
    releaseLease: (request) => releaseLease(filePath, request, options),
    reopenProviderWall: (request) => reopenProviderWall(filePath, request, options),
    setKillSwitch: (request) => setKillSwitch(filePath, request, options),
    recordOwnerTouch: (request) => recordOwnerTouch(filePath, request, options),
  })
}

export const checkpoint = writeCheckpoint
export const readState = readHermesState
export const initializeStateStore = initializeHermesState
