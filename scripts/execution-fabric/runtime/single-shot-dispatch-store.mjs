import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalizeJcs } from "../canonical-json.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const STATES = new Set([
  "ADMITTED",
  "LEASED",
  "REQUEST_STARTED",
  "COMPLETE",
  "FAILED_TERMINAL",
  "OUTCOME_UNKNOWN_DO_NOT_REPLAY",
])
const TERMINAL = new Set(["COMPLETE", "FAILED_TERMINAL", "OUTCOME_UNKNOWN_DO_NOT_REPLAY"])
const SECRET_LIKE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b|\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:[^\s/@]+@)/i

export class SingleShotDispatchStateError extends Error {
  constructor(code, detail = code) {
    super(`${code}: ${detail}`)
    this.name = "SingleShotDispatchStateError"
    this.code = code
  }
}

function fail(code, detail) {
  throw new SingleShotDispatchStateError(code, detail)
}

function nowValue(clock) {
  const raw = typeof clock === "function" ? clock() : clock ?? Date.now()
  const milliseconds = raw instanceof Date ? raw.getTime() : typeof raw === "string" ? Date.parse(raw) : raw
  if (!Number.isFinite(milliseconds)) fail("DISPATCH_TIME_INVALID")
  return { milliseconds, iso: new Date(milliseconds).toISOString() }
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("DISPATCH_STATE_INVALID", label)
  return value
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("DISPATCH_STATE_INVALID", label)
  return value
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(canonicalizeJcs(value), "utf8")
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function initialState(storeId, clock, genesisNonce = crypto.randomBytes(32).toString("hex")) {
  const createdAt = nowValue(clock).iso
  const state = {
    schema_version: "0.1-single-shot-dispatch-state",
    store_id: identifier(storeId, "store_id"),
    genesis_nonce: digest(genesisNonce, "genesis_nonce"),
    created_at: createdAt,
    genesis_sha256: null,
    revision: 0,
    next_fencing_token: 1,
    updated_at: createdAt,
    dispatches: {},
  }
  state.genesis_sha256 = sha256({
    schema_version: state.schema_version,
    store_id: state.store_id,
    genesis_nonce: state.genesis_nonce,
    created_at: state.created_at,
  })
  return state
}

function validateEvent(event, index, previous) {
  const keys = ["at", "event", "event_sha256", "payload_sha256", "previous_sha256", "sequence"]
  if (!event || typeof event !== "object" || Array.isArray(event)
    || JSON.stringify(Object.keys(event).sort()) !== JSON.stringify(keys)) fail("DISPATCH_STATE_CORRUPT", `event ${index}`)
  if (event.sequence !== index + 1 || !SAFE_ID.test(event.event)) fail("DISPATCH_STATE_CORRUPT", `event ${index}`)
  nowValue(event.at)
  digest(event.payload_sha256, `event ${index} payload`)
  if (event.previous_sha256 !== previous) fail("DISPATCH_STATE_CORRUPT", `event ${index} chain`)
  const expected = sha256({
    at: event.at,
    event: event.event,
    payload_sha256: event.payload_sha256,
    previous_sha256: event.previous_sha256,
    sequence: event.sequence,
  })
  if (event.event_sha256 !== expected) fail("DISPATCH_STATE_CORRUPT", `event ${index} digest`)
  return expected
}

function validateDispatch(record, key) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || record.dispatch_id !== key || !STATES.has(record.state)
    || !Array.isArray(record.events) || record.events.length === 0
    || !Number.isSafeInteger(record.fencing_token) || record.fencing_token < 0
    || typeof record.request_started !== "boolean") fail("DISPATCH_STATE_CORRUPT", key)
  for (const field of ["dispatch_id", "work_order_id", "authority_reference", "template_id", "selected_node_id"]) {
    identifier(record[field], `${key}.${field}`)
  }
  for (const field of ["admission_sha256", "template_sha256"]) digest(record[field], `${key}.${field}`)
  if (record.request_sha256 !== null) digest(record.request_sha256, `${key}.request_sha256`)
  if (record.response_sha256 !== null) digest(record.response_sha256, `${key}.response_sha256`)
  let previous = null
  for (const [index, event] of record.events.entries()) previous = validateEvent(event, index, previous)
  if (record.event_head_sha256 !== previous) fail("DISPATCH_STATE_CORRUPT", `${key}.event_head_sha256`)
  if (record.request_started !== ["REQUEST_STARTED", ...TERMINAL].includes(record.state)
    && record.state !== "FAILED_TERMINAL") fail("DISPATCH_STATE_CORRUPT", `${key}.request_started`)
  if (record.state === "COMPLETE" && (!record.request_started || record.response_sha256 === null || !record.receipt)) {
    fail("DISPATCH_STATE_CORRUPT", `${key}.completion`)
  }
}

function validateState(state, storeId, expectedGenesisSha256 = null) {
  if (!state || state.schema_version !== "0.1-single-shot-dispatch-state" || state.store_id !== storeId
    || typeof state.genesis_nonce !== "string" || !SHA256.test(state.genesis_nonce)
    || typeof state.genesis_sha256 !== "string" || !SHA256.test(state.genesis_sha256)
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isSafeInteger(state.next_fencing_token) || state.next_fencing_token < 1
    || !state.dispatches || typeof state.dispatches !== "object" || Array.isArray(state.dispatches)
    || SECRET_LIKE.test(JSON.stringify(state))) fail("DISPATCH_STATE_CORRUPT")
  nowValue(state.created_at)
  nowValue(state.updated_at)
  const actualGenesisSha256 = sha256({
    schema_version: state.schema_version,
    store_id: state.store_id,
    genesis_nonce: state.genesis_nonce,
    created_at: state.created_at,
  })
  if (state.genesis_sha256 !== actualGenesisSha256
    || (expectedGenesisSha256 !== null && state.genesis_sha256 !== expectedGenesisSha256)) {
    fail("DISPATCH_STATE_GENESIS_MISMATCH")
  }
  for (const [key, record] of Object.entries(state.dispatches)) validateDispatch(record, key)
  return state
}

function atomicWrite(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  const handle = fs.openSync(temporary, "wx", 0o600)
  try {
    fs.writeFileSync(handle, `${JSON.stringify(state, null, 2)}\n`, "utf8")
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  try { fs.renameSync(temporary, filePath) } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
}

function appendEvent(record, event, payload, at) {
  const previous = record.events.at(-1)?.event_sha256 ?? null
  const entry = {
    at,
    event: identifier(event, "event"),
    payload_sha256: sha256(payload),
    previous_sha256: previous,
    sequence: record.events.length + 1,
  }
  entry.event_sha256 = sha256(entry)
  record.events.push(entry)
  record.event_head_sha256 = entry.event_sha256
}

function readState(filePath, storeId, clock, { requireExisting = false, expectedGenesisSha256 = null } = {}) {
  if (!fs.existsSync(filePath)) {
    if (requireExisting) fail("DISPATCH_STATE_GENESIS_MISSING")
    return initialState(storeId, clock)
  }
  try { return validateState(JSON.parse(fs.readFileSync(filePath, "utf8")), storeId, expectedGenesisSha256) } catch (error) {
    if (error instanceof SingleShotDispatchStateError) throw error
    fail("DISPATCH_STATE_CORRUPT")
  }
}

function acquireLock(lockPath, clock, staleLockMs) {
  const lockRecord = {
    acquired_at: nowValue(clock).iso,
    owner_pid: process.pid,
    token: crypto.randomUUID(),
  }
  try {
    const handle = fs.openSync(lockPath, "wx", 0o600)
    fs.writeFileSync(handle, `${JSON.stringify(lockRecord)}\n`, "utf8")
    fs.fsyncSync(handle)
    return { handle, lockRecord }
  } catch (error) {
    if (error?.code !== "EEXIST") throw error
  }

  let prior
  try {
    prior = JSON.parse(fs.readFileSync(lockPath, "utf8"))
  } catch {
    fail("DISPATCH_STATE_BUSY")
  }
  const acquiredAt = Date.parse(prior?.acquired_at)
  const current = nowValue(clock).milliseconds
  if (!Number.isFinite(acquiredAt) || current - acquiredAt <= staleLockMs) fail("DISPATCH_STATE_BUSY")

  const stalePath = `${lockPath}.stale-${crypto.randomUUID()}`
  try {
    fs.renameSync(lockPath, stalePath)
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) fail("DISPATCH_STATE_BUSY")
    throw error
  }
  try {
    const handle = fs.openSync(lockPath, "wx", 0o600)
    fs.writeFileSync(handle, `${JSON.stringify(lockRecord)}\n`, "utf8")
    fs.fsyncSync(handle)
    return { handle, lockRecord }
  } finally {
    fs.rmSync(stalePath, { force: true })
  }
}

function withLock(filePath, operation, clock, staleLockMs) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const lockPath = `${filePath}.lock`
  const { handle, lockRecord } = acquireLock(lockPath, clock, staleLockMs)
  try { return operation() } finally {
    fs.closeSync(handle)
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8"))
      if (current.token !== lockRecord.token) fail("DISPATCH_STATE_LOCK_REPLACED")
      fs.unlinkSync(lockPath)
    } catch (error) {
      if (error instanceof SingleShotDispatchStateError) throw error
      if (error?.code !== "ENOENT") throw error
    }
  }
}

export function createSingleShotDispatchStore(filePath, {
  storeId = "execution-fabric-single-shot",
  clock,
  staleLockMs = 300_000,
  requireExisting = false,
  expectedGenesisSha256 = null,
} = {}) {
  const absolute = path.resolve(filePath)
  if (!Number.isSafeInteger(staleLockMs) || staleLockMs < 180_000) fail("STALE_LOCK_WINDOW_INVALID")
  if (expectedGenesisSha256 !== null) digest(expectedGenesisSha256, "expectedGenesisSha256")
  const mutate = (operation) => withLock(absolute, () => {
    const state = readState(absolute, storeId, clock, { requireExisting, expectedGenesisSha256 })
    const at = nowValue(clock)
    const result = operation(state, at)
    state.revision += 1
    if (Date.parse(state.updated_at) <= at.milliseconds) state.updated_at = at.iso
    atomicWrite(absolute, validateState(state, storeId, expectedGenesisSha256))
    return result
  }, clock, staleLockMs)

  const requireHeld = (record, holderId, fencingToken, at) => {
    if (record.fencing_token !== fencingToken) fail("FENCING_TOKEN_CONFLICT")
    if (record.holder_id !== holderId || record.lease_expires_at === null
      || at.milliseconds >= Date.parse(record.lease_expires_at)) fail("LEASE_NOT_HELD")
  }

  return Object.freeze({
    read: () => structuredClone(readState(absolute, storeId, clock, { requireExisting, expectedGenesisSha256 })),
    initialize: () => mutate((state) => ({ revision: state.revision + 1 })),
    admit(admission) {
      return mutate((state, at) => {
        const dispatchId = identifier(admission.dispatch_id, "dispatch_id")
        const admissionSha256 = digest(admission.admission_sha256, "admission_sha256")
        const prior = state.dispatches[dispatchId]
        if (prior) {
          if (prior.admission_sha256 !== admissionSha256) fail("DISPATCH_IDEMPOTENCY_CONFLICT")
          return structuredClone(prior)
        }
        const record = {
          dispatch_id: dispatchId,
          work_order_id: identifier(admission.work_order_id, "work_order_id"),
          authority_reference: identifier(admission.authority_reference, "authority_reference"),
          admission_sha256: admissionSha256,
          template_id: identifier(admission.template_id, "template_id"),
          template_sha256: digest(admission.template_sha256, "template_sha256"),
          selected_node_id: identifier(admission.selected_node_id, "selected_node_id"),
          state: "ADMITTED",
          holder_id: null,
          holder_token_digest: null,
          fencing_token: 0,
          lease_expires_at: null,
          request_started: false,
          request_sha256: null,
          response_sha256: null,
          receipt: null,
          terminal_reason: null,
          events: [],
          event_head_sha256: null,
        }
        appendEvent(record, "ADMITTED", admission, at.iso)
        state.dispatches[dispatchId] = record
        return structuredClone(record)
      })
    },
    acquire({ dispatchId, holderId, holderTokenDigest, leaseDurationMs }) {
      return mutate((state, at) => {
        const record = state.dispatches[identifier(dispatchId, "dispatch_id")]
        if (!record) fail("DISPATCH_NOT_FOUND")
        if (TERMINAL.has(record.state)) return structuredClone(record)
        if (record.state !== "ADMITTED") fail("DISPATCH_ALREADY_LEASED")
        identifier(holderId, "holder_id")
        digest(holderTokenDigest, "holder_token_digest")
        if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1 || leaseDurationMs > 120_000) {
          fail("LEASE_DURATION_INVALID")
        }
        record.state = "LEASED"
        record.holder_id = holderId
        record.holder_token_digest = holderTokenDigest
        record.fencing_token = state.next_fencing_token
        state.next_fencing_token += 1
        record.lease_expires_at = new Date(at.milliseconds + leaseDurationMs).toISOString()
        appendEvent(record, "LEASE_ACQUIRED", {
          holder_id: holderId,
          holder_token_digest: holderTokenDigest,
          fencing_token: record.fencing_token,
          lease_expires_at: record.lease_expires_at,
        }, at.iso)
        return structuredClone(record)
      })
    },
    markRequestStarted({ dispatchId, holderId, fencingToken, requestSha256 }) {
      return mutate((state, at) => {
        const record = state.dispatches[identifier(dispatchId, "dispatch_id")]
        if (!record) fail("DISPATCH_NOT_FOUND")
        requireHeld(record, holderId, fencingToken, at)
        if (record.state === "REQUEST_STARTED") {
          if (record.request_sha256 !== requestSha256) fail("DISPATCH_IDEMPOTENCY_CONFLICT")
          return structuredClone(record)
        }
        if (record.state !== "LEASED" || record.request_started) fail("DISPATCH_REPLAY_REJECTED")
        record.state = "REQUEST_STARTED"
        record.request_started = true
        record.request_sha256 = digest(requestSha256, "request_sha256")
        appendEvent(record, "REQUEST_STARTED", { request_sha256: requestSha256 }, at.iso)
        return structuredClone(record)
      })
    },
    complete({ dispatchId, holderId, fencingToken, responseSha256, receipt }) {
      return mutate((state, at) => {
        const record = state.dispatches[identifier(dispatchId, "dispatch_id")]
        if (!record) fail("DISPATCH_NOT_FOUND")
        if (record.state === "COMPLETE") return structuredClone(record)
        requireHeld(record, holderId, fencingToken, at)
        if (record.state !== "REQUEST_STARTED" || !record.request_started) fail("REQUEST_NOT_STARTED")
        record.state = "COMPLETE"
        record.response_sha256 = digest(responseSha256, "response_sha256")
        record.receipt = structuredClone(receipt)
        record.lease_expires_at = null
        appendEvent(record, "COMPLETE", { response_sha256: responseSha256, receipt }, at.iso)
        return structuredClone(record)
      })
    },
    failTerminal({ dispatchId, holderId, fencingToken, reason }) {
      return mutate((state, at) => {
        const record = state.dispatches[identifier(dispatchId, "dispatch_id")]
        if (!record) fail("DISPATCH_NOT_FOUND")
        if (TERMINAL.has(record.state)) return structuredClone(record)
        requireHeld(record, holderId, fencingToken, at)
        const terminalState = record.request_started ? "OUTCOME_UNKNOWN_DO_NOT_REPLAY" : "FAILED_TERMINAL"
        record.state = terminalState
        record.terminal_reason = identifier(reason, "terminal_reason")
        record.lease_expires_at = null
        appendEvent(record, terminalState, { reason }, at.iso)
        return structuredClone(record)
      })
    },
    recoverExpired({ dispatchId, holderId, holderTokenDigest, expectedFencingToken, leaseDurationMs }) {
      return mutate((state, at) => {
        const record = state.dispatches[identifier(dispatchId, "dispatch_id")]
        if (!record) fail("DISPATCH_NOT_FOUND")
        if (record.fencing_token !== expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
        if (record.lease_expires_at === null || at.milliseconds < Date.parse(record.lease_expires_at)) {
          fail("LEASE_NOT_EXPIRED")
        }
        if (record.request_started) {
          record.state = "OUTCOME_UNKNOWN_DO_NOT_REPLAY"
          record.terminal_reason = "REQUEST_INITIATED_BEFORE_LEASE_EXPIRY"
          record.lease_expires_at = null
          appendEvent(record, "OUTCOME_UNKNOWN_DO_NOT_REPLAY", { prior_fencing_token: expectedFencingToken }, at.iso)
          return structuredClone(record)
        }
        identifier(holderId, "holder_id")
        digest(holderTokenDigest, "holder_token_digest")
        if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1 || leaseDurationMs > 120_000) {
          fail("LEASE_DURATION_INVALID")
        }
        record.state = "LEASED"
        record.holder_id = holderId
        record.holder_token_digest = holderTokenDigest
        record.fencing_token = state.next_fencing_token
        state.next_fencing_token += 1
        record.lease_expires_at = new Date(at.milliseconds + leaseDurationMs).toISOString()
        appendEvent(record, "LEASE_RECLAIMED", {
          prior_fencing_token: expectedFencingToken,
          fencing_token: record.fencing_token,
          holder_id: holderId,
        }, at.iso)
        return structuredClone(record)
      })
    },
  })
}
