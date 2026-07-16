import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const INPUT_FIELDS = new Set([
  "schemaVersion", "artifactType", "handoffId", "storeId", "workOrderId", "laneId",
  "repository", "workspacePath", "branch", "expectedSequence", "sourceRole", "targetRole",
  "roleAssignments", "reservation", "lease", "workspace", "evidenceEventId", "idempotencyKey",
])
const ROLE_FIELDS = new Set(["builder", "reviewer", "remediator", "verifier"])
const RESERVATION_FIELDS = new Set([
  "reservationSetId", "holderWorkerId", "fencingToken", "ledgerVersion", "released",
])
const LEASE_FIELDS = new Set([
  "workerId", "fencingToken", "checkpointSequence", "status",
])
const WORKSPACE_FIELDS = new Set([
  "ownerWorkerId", "clean", "headCommitSha", "checkpointHeadCommitSha",
])
const STORE_FIELDS = new Set(["schemaVersion", "artifactType", "storeId", "version", "lanes", "operations"])
const LANE_STATE_FIELDS = new Set([
  "workOrderId", "laneId", "repository", "workspacePath", "branch", "sequence",
  "activeRole", "activeWorkerId", "builderWorkerId", "reviewerWorkerId",
  "remediatorWorkerId", "verifierWorkerId", "writeHolderWorkerId", "reservationSetId",
  "reservationFencingToken", "reservationLedgerVersion", "leaseFencingToken", "checkpointSequence",
  "checkpointHeadCommitSha", "evidenceEventId", "bindingHash",
])
const OPERATION_FIELDS = new Set(["idempotencyKey", "requestHash", "request", "result"])
const RESULT_FIELDS = new Set([
  "schemaVersion", "artifactType", "handoffId", "storeId", "workOrderId", "laneId",
  "idempotencyKey",
  "sequence", "sourceRole", "sourceWorkerId", "targetRole", "targetWorkerId", "accessMode",
  "writeHolderWorkerId", "reservationSetId", "reservationFencingToken", "reservationLedgerVersion",
  "leaseFencingToken", "checkpointSequence", "checkpointHeadCommitSha", "evidenceEventId",
  "trustBindingHash", "persistencePerformed", "reservationReleased", "leaseReleased",
  "secondWriterEnabled", "authorityGranted", "ownerOperationsRequired", "idempotent",
])
const AUTHORITY_FIELDS = new Set([
  "authorityGranted", "executionAuthorized", "mutationAuthorized", "reservationReleased",
  "leaseReleased", "secondWriterEnabled", "writeAccessGranted",
])
const ROLES = new Set(["BUILDER", "REVIEWER", "REMEDIATOR", "VERIFIER"])
const TRANSITIONS = new Set([
  "BUILDER:REVIEWER", "BUILDER:VERIFIER", "REVIEWER:REMEDIATOR",
  "REMEDIATOR:REVIEWER", "REVIEWER:VERIFIER",
])
const IDENTIFIER = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
const COMMIT_SHA = /^[0-9a-f]{40}$/
const BRANCH = /^[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,254}[A-Za-z0-9])?$/

export class ReservationAwareHandoffError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "ReservationAwareHandoffError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new ReservationAwareHandoffError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exact(value, fields, field) {
  if (!plainObject(value)) wall("HANDOFF_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()
  if (unknown.length) wall("HANDOFF_UNKNOWN_FIELD_WALL", `${field}.${unknown[0]}`)
  if (missing.length) wall("HANDOFF_MISSING_FIELD_WALL", `${field}.${missing[0]}`)
}

function text(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) {
    wall("HANDOFF_FORMAT_WALL", field)
  }
  return value
}

function positiveInteger(value, field, { zero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) {
    wall("HANDOFF_TYPE_WALL", field, zero ? "NON_NEGATIVE_SAFE_INTEGER_REQUIRED" : "POSITIVE_SAFE_INTEGER_REQUIRED")
  }
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}

export function canonicalReservationAwareHandoffJson(value) {
  return JSON.stringify(canonicalize(value))
}

function contentHash(value) {
  return crypto.createHash("sha256").update(canonicalReservationAwareHandoffJson(value)).digest("hex")
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function normalize(input) {
  if (plainObject(input)) {
    const authorityField = Object.keys(input).find((key) => AUTHORITY_FIELDS.has(key))
    if (authorityField) wall("HANDOFF_AUTHORITY_MINT_WALL", authorityField, "OMIT_REQUIRED")
  }
  exact(input, INPUT_FIELDS, "input")
  if (input.schemaVersion !== 1) wall("HANDOFF_INPUT_WALL", "schemaVersion", "UNSUPPORTED_SCHEMA_VERSION")
  if (input.artifactType !== "MULTI_AGENT_RESERVATION_AWARE_HANDOFF_REQUEST") {
    wall("HANDOFF_INPUT_WALL", "artifactType", "UNSUPPORTED_ARTIFACT_TYPE")
  }
  exact(input.roleAssignments, ROLE_FIELDS, "roleAssignments")
  const roleAssignments = Object.fromEntries([...ROLE_FIELDS].map((role) => [
    role,
    text(input.roleAssignments[role], `roleAssignments.${role}`, /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  ]))
  if (roleAssignments.remediator !== roleAssignments.builder) {
    wall("HANDOFF_ROLE_WALL", "roleAssignments.remediator", "REMEDIATOR_MUST_EQUAL_BUILDER")
  }
  if (roleAssignments.reviewer === roleAssignments.builder || roleAssignments.verifier === roleAssignments.builder
    || roleAssignments.verifier === roleAssignments.reviewer) {
    wall("HANDOFF_ROLE_WALL", "roleAssignments", "READ_ONLY_ROLE_INDEPENDENCE_REQUIRED")
  }
  const sourceRole = text(input.sourceRole, "sourceRole", /^[A-Z]+$/)
  const targetRole = text(input.targetRole, "targetRole", /^[A-Z]+$/)
  if (!ROLES.has(sourceRole) || !ROLES.has(targetRole) || !TRANSITIONS.has(`${sourceRole}:${targetRole}`)) {
    wall("HANDOFF_TRANSITION_WALL", "targetRole", `${sourceRole}_TO_${targetRole}_FORBIDDEN`)
  }
  exact(input.reservation, RESERVATION_FIELDS, "reservation")
  exact(input.lease, LEASE_FIELDS, "lease")
  exact(input.workspace, WORKSPACE_FIELDS, "workspace")
  const rFence = positiveInteger(input.reservation.fencingToken, "reservation.fencingToken")
  const reservation = {
    reservationSetId: text(input.reservation.reservationSetId, "reservation.reservationSetId"),
    holderWorkerId: text(input.reservation.holderWorkerId, "reservation.holderWorkerId"),
    fencingToken: rFence,
    ledgerVersion: positiveInteger(input.reservation.ledgerVersion, "reservation.ledgerVersion"),
    released: input.reservation.released,
  }
  if (reservation.released !== false || reservation.holderWorkerId !== roleAssignments.builder) {
    wall("HANDOFF_RESERVATION_WALL", "reservation", "ACTIVE_ORIGINAL_BUILDER_HOLDER_REQUIRED")
  }
  const lFence = positiveInteger(input.lease.fencingToken, "lease.fencingToken")
  const lease = {
    workerId: text(input.lease.workerId, "lease.workerId"),
    fencingToken: lFence,
    checkpointSequence: positiveInteger(input.lease.checkpointSequence, "lease.checkpointSequence"),
    status: text(input.lease.status, "lease.status", /^[A-Z]+$/),
  }
  if (lease.status !== "ACTIVE" || lease.workerId !== roleAssignments.builder) {
    wall("HANDOFF_LEASE_WALL", "lease", "ACTIVE_ORIGINAL_BUILDER_HOLDER_REQUIRED")
  }
  const workspace = {
    ownerWorkerId: text(input.workspace.ownerWorkerId, "workspace.ownerWorkerId"),
    clean: input.workspace.clean,
    headCommitSha: text(input.workspace.headCommitSha, "workspace.headCommitSha", COMMIT_SHA),
    checkpointHeadCommitSha: text(input.workspace.checkpointHeadCommitSha, "workspace.checkpointHeadCommitSha", COMMIT_SHA),
  }
  if (workspace.ownerWorkerId !== roleAssignments.builder || workspace.clean !== true
    || workspace.headCommitSha !== workspace.checkpointHeadCommitSha) {
    wall("HANDOFF_WORKSPACE_WALL", "workspace", "CLEAN_CHECKPOINTED_BUILDER_WORKSPACE_REQUIRED")
  }
  return {
    schemaVersion: 1,
    artifactType: input.artifactType,
    handoffId: text(input.handoffId, "handoffId"),
    storeId: text(input.storeId, "storeId"),
    workOrderId: text(input.workOrderId, "workOrderId", WORK_ORDER_ID),
    laneId: text(input.laneId, "laneId"),
    repository: text(input.repository, "repository", REPOSITORY),
    workspacePath: text(input.workspacePath, "workspacePath", /^(?:[A-Za-z]:[\\/]|\/).+/),
    branch: text(input.branch, "branch", BRANCH),
    expectedSequence: positiveInteger(input.expectedSequence, "expectedSequence", { zero: true }),
    sourceRole,
    targetRole,
    sourceWorkerId: roleAssignments[sourceRole.toLowerCase()],
    targetWorkerId: roleAssignments[targetRole.toLowerCase()],
    roleAssignments,
    reservation,
    lease,
    workspace,
    evidenceEventId: text(input.evidenceEventId, "evidenceEventId"),
    idempotencyKey: text(input.idempotencyKey, "idempotencyKey"),
  }
}

function planFrom(normalized) {
  const targetReadOnly = normalized.targetRole === "REVIEWER" || normalized.targetRole === "VERIFIER"
  const plan = {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_AWARE_HANDOFF_PLAN",
    handoffId: normalized.handoffId,
    storeId: normalized.storeId,
    workOrderId: normalized.workOrderId,
    laneId: normalized.laneId,
    expectedSequence: normalized.expectedSequence,
    sourceRole: normalized.sourceRole,
    sourceWorkerId: normalized.sourceWorkerId,
    targetRole: normalized.targetRole,
    targetWorkerId: normalized.targetWorkerId,
    accessMode: targetReadOnly ? "READ_ONLY" : "ORIGINAL_WRITER_CONTINUATION",
    writeHolderWorkerId: normalized.roleAssignments.builder,
    reservationAction: "RETAIN",
    leaseAction: "RETAIN",
    bindingHash: contentHash(normalized),
    planningOnly: true,
    persistencePerformed: false,
    reservationReleased: false,
    leaseReleased: false,
    secondWriterEnabled: false,
    authorityGranted: false,
    ownerOperationsRequired: false,
  }
  return freeze({ ...plan, planHash: contentHash(plan) })
}

export function planReservationAwareHandoff(input) {
  return planFrom(normalize(input))
}

function emptyStore(storeId) {
  return { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_AWARE_HANDOFF_STORE", storeId,
    version: 0, lanes: [], operations: [] }
}

function validateStoredLane(entry, index) {
  exact(entry, LANE_STATE_FIELDS, `store.lanes[${index}]`)
  if (entry.sequence < 1 || !Number.isSafeInteger(entry.sequence)
    || typeof entry.activeRole !== "string" || !ROLES.has(entry.activeRole)
    || typeof entry.checkpointHeadCommitSha !== "string" || typeof entry.bindingHash !== "string"
    || entry.builderWorkerId !== entry.remediatorWorkerId
    || entry.writeHolderWorkerId !== entry.builderWorkerId
    || entry.activeWorkerId !== entry[`${entry.activeRole.toLowerCase()}WorkerId`]
    || !COMMIT_SHA.test(entry.checkpointHeadCommitSha)
    || !/^[a-f0-9]{64}$/.test(entry.bindingHash)) {
    wall("HANDOFF_STORE_WALL", `store.lanes[${index}]`, "VALID_FENCED_LANE_REQUIRED")
  }
}

function validateStoredOperation(entry, index, storePath) {
  exact(entry, OPERATION_FIELDS, `store.operations[${index}]`)
  exact(entry.result, RESULT_FIELDS, `store.operations[${index}].result`)
  let storedRequest
  try {
    const rawRequest = { ...entry.request }
    delete rawRequest.sourceWorkerId
    delete rawRequest.targetWorkerId
    storedRequest = normalize(rawRequest)
    if (contentHash(storedRequest) !== contentHash(entry.request)) throw new Error("normalized-request-mismatch")
  } catch {
    wall("HANDOFF_STORE_WALL", `store.operations[${index}].request`, "VALID_CANONICAL_REQUEST_REQUIRED")
  }
  const storedPlan = planFrom(storedRequest)
  const expectedTrustBindingHash = contentHash({ verified: true, ...storedRequest,
    canonicalStorePath: storeFile(storePath), planHash: storedPlan.planHash })
  if (typeof entry.idempotencyKey !== "string" || typeof entry.requestHash !== "string"
    || !IDENTIFIER.test(entry.idempotencyKey) || !/^[a-f0-9]{64}$/.test(entry.requestHash)
    || entry.requestHash !== contentHash(storedRequest)
    || entry.result.schemaVersion !== 1
    || entry.result.artifactType !== "MULTI_AGENT_RESERVATION_AWARE_HANDOFF_RESULT"
    || entry.result.idempotencyKey !== entry.idempotencyKey
    || entry.result.handoffId !== storedRequest.handoffId
    || entry.result.storeId !== storedRequest.storeId
    || entry.result.workOrderId !== storedRequest.workOrderId
    || entry.result.laneId !== storedRequest.laneId
    || entry.result.sourceRole !== storedRequest.sourceRole
    || entry.result.sourceWorkerId !== storedRequest.sourceWorkerId
    || entry.result.targetRole !== storedRequest.targetRole
    || entry.result.targetWorkerId !== storedRequest.targetWorkerId
    || entry.result.writeHolderWorkerId !== storedRequest.roleAssignments.builder
    || entry.result.reservationSetId !== storedRequest.reservation.reservationSetId
    || entry.result.reservationFencingToken !== storedRequest.reservation.fencingToken
    || entry.result.reservationLedgerVersion !== storedRequest.reservation.ledgerVersion
    || entry.result.leaseFencingToken !== storedRequest.lease.fencingToken
    || entry.result.checkpointSequence !== storedRequest.lease.checkpointSequence
    || entry.result.checkpointHeadCommitSha !== storedRequest.workspace.checkpointHeadCommitSha
    || entry.result.evidenceEventId !== storedRequest.evidenceEventId
    || !Number.isSafeInteger(entry.result.sequence) || entry.result.sequence < 1
    || !ROLES.has(entry.result.sourceRole) || !ROLES.has(entry.result.targetRole)
    || !TRANSITIONS.has(`${entry.result.sourceRole}:${entry.result.targetRole}`)
    || entry.result.accessMode !== (entry.result.targetRole === "REMEDIATOR"
      ? "ORIGINAL_WRITER_CONTINUATION" : "READ_ONLY")
    || typeof entry.result.trustBindingHash !== "string"
    || !/^[a-f0-9]{64}$/.test(entry.result.trustBindingHash)
    || entry.result.trustBindingHash !== expectedTrustBindingHash
    || entry.result.persistencePerformed !== true || entry.result.idempotent !== false
    || entry.result.reservationReleased !== false || entry.result.leaseReleased !== false
    || entry.result.secondWriterEnabled !== false || entry.result.authorityGranted !== false
    || entry.result.ownerOperationsRequired !== false) {
    wall("HANDOFF_STORE_WALL", `store.operations[${index}]`, "VALID_NON_AUTHORITY_RESULT_REQUIRED")
  }
}

function validateStoredHistory(store) {
  if (store.version !== store.operations.length
    || new Set(store.operations.map((entry) => entry.idempotencyKey)).size !== store.operations.length
    || new Set(store.lanes.map((entry) => entry.workOrderId)).size !== store.lanes.length
    || new Set(store.lanes.map((entry) => entry.laneId)).size !== store.lanes.length) {
    wall("HANDOFF_STORE_WALL", "store", "UNIQUE_LINEAR_HISTORY_REQUIRED")
  }
  for (const lane of store.lanes) {
    const historyEntries = store.operations
      .filter((entry) => entry.result.workOrderId === lane.workOrderId && entry.result.laneId === lane.laneId)
      .sort((left, right) => left.result.sequence - right.result.sequence)
    const history = historyEntries.map((entry) => entry.result)
    const lastEntry = historyEntries.at(-1)
    const last = lastEntry?.result
    const lastRequest = lastEntry?.request
    if (history.length !== lane.sequence
      || history.some((result) => result.storeId !== store.storeId)
      || history[0]?.sourceRole !== "BUILDER"
      || history.some((result, index) => result.sequence !== index + 1
        || (index > 0 && result.sourceRole !== history[index - 1].targetRole
          || index > 0 && result.sourceWorkerId !== history[index - 1].targetWorkerId))
      || !last || last.targetRole !== lane.activeRole || last.targetWorkerId !== lane.activeWorkerId
      || last.writeHolderWorkerId !== lane.writeHolderWorkerId
      || last.reservationSetId !== lane.reservationSetId
      || last.reservationFencingToken !== lane.reservationFencingToken
      || last.reservationLedgerVersion !== lane.reservationLedgerVersion
      || last.leaseFencingToken !== lane.leaseFencingToken
      || last.checkpointSequence !== lane.checkpointSequence
      || last.checkpointHeadCommitSha !== lane.checkpointHeadCommitSha
      || last.evidenceEventId !== lane.evidenceEventId
      || lastRequest.roleAssignments.builder !== lane.builderWorkerId
      || lastRequest.roleAssignments.reviewer !== lane.reviewerWorkerId
      || lastRequest.roleAssignments.remediator !== lane.remediatorWorkerId
      || lastRequest.roleAssignments.verifier !== lane.verifierWorkerId
      || planFrom(lastRequest).bindingHash !== lane.bindingHash) {
      wall("HANDOFF_STORE_WALL", "store", "CONSISTENT_LINEAR_HISTORY_REQUIRED")
    }
  }
  if (store.operations.some((entry) => !store.lanes.some((lane) =>
    lane.workOrderId === entry.result.workOrderId && lane.laneId === entry.result.laneId))) {
    wall("HANDOFF_STORE_WALL", "store", "ORPHAN_OPERATION_FORBIDDEN")
  }
}

function storeFile(storePath) {
  return path.resolve(storePath)
}

function readStore(storePath, storeId) {
  const file = storeFile(storePath)
  if (!fs.existsSync(file)) return emptyStore(storeId)
  let value
  try { value = JSON.parse(fs.readFileSync(file, "utf8")) } catch {
    wall("HANDOFF_STORE_WALL", "store", "READABLE_JSON_REQUIRED")
  }
  exact(value, STORE_FIELDS, "store")
  if (value.schemaVersion !== 1 || value.artifactType !== "MULTI_AGENT_RESERVATION_AWARE_HANDOFF_STORE"
    || value.storeId !== storeId || !Number.isSafeInteger(value.version) || value.version < 0
    || !Array.isArray(value.lanes) || !Array.isArray(value.operations)) {
    wall("HANDOFF_STORE_WALL", "store", "SUPPORTED_STORE_REQUIRED")
  }
  value.lanes.forEach(validateStoredLane)
  value.operations.forEach((entry, index) => validateStoredOperation(entry, index, storePath))
  validateStoredHistory(value)
  return value
}

function writeStore(storePath, value) {
  const file = storeFile(storePath)
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  let handle = null
  try {
    handle = fs.openSync(temporary, "wx", 0o600)
    fs.writeFileSync(handle, `${canonicalReservationAwareHandoffJson(value)}\n`, "utf8")
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = null
    fs.renameSync(temporary, file)
    if (process.platform !== "win32") {
      const directoryHandle = fs.openSync(directory, "r")
      try { fs.fsyncSync(directoryHandle) } finally { fs.closeSync(directoryHandle) }
    }
  } finally {
    if (handle !== null) try { fs.closeSync(handle) } catch { /* original error wins */ }
    fs.rmSync(temporary, { force: true })
  }
}

function trustRecord(normalized, plan, storePath) {
  return { ...normalized, canonicalStorePath: storeFile(storePath), planHash: plan.planHash }
}

function verifyTrust(normalized, plan, storePath, trustedContext) {
  if (!trustedContext || typeof trustedContext.verifyHandoffBinding !== "function") {
    wall("HANDOFF_TRUST_WALL", "trustedContext", "HOST_VERIFIER_REQUIRED")
  }
  const requested = trustRecord(normalized, plan, storePath)
  const verified = trustedContext.verifyHandoffBinding(requested)
  if (contentHash(verified) !== contentHash({ verified: true, ...requested })) {
    wall("HANDOFF_TRUST_WALL", "trustedContext", "EXACT_LIVE_BINDING_REQUIRED")
  }
  return contentHash(verified)
}

function verifyStorePathAuthorization(storePath, trustedContext) {
  if (!trustedContext || typeof trustedContext.authorizeStorePath !== "function") {
    wall("HANDOFF_TRUST_WALL", "trustedContext", "STORE_PATH_AUTHORIZER_REQUIRED")
  }
  const canonicalStorePath = storeFile(storePath)
  const verified = trustedContext.authorizeStorePath(canonicalStorePath)
  if (contentHash(verified) !== contentHash({ authorized: true, canonicalStorePath })) {
    wall("HANDOFF_TRUST_WALL", "trustedContext", "EXACT_STORE_PATH_AUTHORIZATION_REQUIRED")
  }
}

export function applyReservationAwareHandoff(storePath, input, trustedContext = undefined) {
  const normalized = normalize(input)
  const plan = planFrom(normalized)
  verifyStorePathAuthorization(storePath, trustedContext)
  const lock = `${storeFile(storePath)}.lock`
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  try { fs.mkdirSync(lock) } catch { wall("HANDOFF_LOCK_WALL", "store", "HANDOFF_ALREADY_ACTIVE") }
  try {
    const store = readStore(storePath, normalized.storeId)
    const requestHash = contentHash(normalized)
    const priorOperation = store.operations.find((entry) => entry.idempotencyKey === normalized.idempotencyKey)
    if (priorOperation) {
      if (priorOperation.requestHash !== requestHash) wall("HANDOFF_IDEMPOTENCY_WALL", "idempotencyKey", "KEY_REUSE")
      return freeze({ ...priorOperation.result, idempotent: true })
    }
    const trustBindingHash = verifyTrust(normalized, plan, storePath, trustedContext)
    const laneIndex = store.lanes.findIndex((entry) => entry.workOrderId === normalized.workOrderId
      || entry.laneId === normalized.laneId)
    const current = laneIndex === -1 ? null : store.lanes[laneIndex]
    const currentSequence = current?.sequence ?? 0
    if (normalized.expectedSequence !== currentSequence) {
      wall("HANDOFF_SEQUENCE_WALL", "expectedSequence", "COMPARE_AND_SWAP_REQUIRED")
    }
    if (current === null) {
      if (normalized.sourceRole !== "BUILDER" || normalized.sourceWorkerId !== normalized.roleAssignments.builder) {
        wall("HANDOFF_SOURCE_WALL", "sourceRole", "INITIAL_BUILDER_REQUIRED")
      }
    } else if (current.workOrderId !== normalized.workOrderId || current.laneId !== normalized.laneId
      || current.repository !== normalized.repository || current.workspacePath !== normalized.workspacePath
      || current.branch !== normalized.branch
      || current.builderWorkerId !== normalized.roleAssignments.builder
      || current.reviewerWorkerId !== normalized.roleAssignments.reviewer
      || current.remediatorWorkerId !== normalized.roleAssignments.remediator
      || current.verifierWorkerId !== normalized.roleAssignments.verifier
      || current.activeRole !== normalized.sourceRole || current.activeWorkerId !== normalized.sourceWorkerId
      || current.writeHolderWorkerId !== normalized.roleAssignments.builder
      || current.reservationSetId !== normalized.reservation.reservationSetId
      || current.reservationFencingToken !== normalized.reservation.fencingToken
      || current.reservationLedgerVersion > normalized.reservation.ledgerVersion
      || current.leaseFencingToken !== normalized.lease.fencingToken
      || (normalized.sourceRole === "REMEDIATOR"
        ? (normalized.lease.checkpointSequence <= current.checkpointSequence
          || normalized.workspace.checkpointHeadCommitSha === current.checkpointHeadCommitSha)
        : (current.checkpointSequence !== normalized.lease.checkpointSequence
          || current.checkpointHeadCommitSha !== normalized.workspace.checkpointHeadCommitSha))) {
      wall("HANDOFF_SOURCE_WALL", "source", "EXACT_CURRENT_STATE_REQUIRED")
    }
    const sequence = currentSequence + 1
    const rFence = normalized.reservation.fencingToken
    const lFence = normalized.lease.fencingToken
    const nextLane = {
      workOrderId: normalized.workOrderId,
      laneId: normalized.laneId,
      repository: normalized.repository,
      workspacePath: normalized.workspacePath,
      branch: normalized.branch,
      sequence,
      activeRole: normalized.targetRole,
      activeWorkerId: normalized.targetWorkerId,
      builderWorkerId: normalized.roleAssignments.builder,
      reviewerWorkerId: normalized.roleAssignments.reviewer,
      remediatorWorkerId: normalized.roleAssignments.remediator,
      verifierWorkerId: normalized.roleAssignments.verifier,
      writeHolderWorkerId: normalized.roleAssignments.builder,
      reservationSetId: normalized.reservation.reservationSetId,
      reservationFencingToken: rFence,
      reservationLedgerVersion: normalized.reservation.ledgerVersion,
      leaseFencingToken: lFence,
      checkpointSequence: normalized.lease.checkpointSequence,
      checkpointHeadCommitSha: normalized.workspace.checkpointHeadCommitSha,
      evidenceEventId: normalized.evidenceEventId,
      bindingHash: plan.bindingHash,
    }
    const result = {
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_RESERVATION_AWARE_HANDOFF_RESULT",
      handoffId: normalized.handoffId,
      idempotencyKey: normalized.idempotencyKey,
      storeId: normalized.storeId,
      workOrderId: normalized.workOrderId,
      laneId: normalized.laneId,
      sequence,
      sourceRole: normalized.sourceRole,
      sourceWorkerId: normalized.sourceWorkerId,
      targetRole: normalized.targetRole,
      targetWorkerId: normalized.targetWorkerId,
      accessMode: plan.accessMode,
      writeHolderWorkerId: normalized.roleAssignments.builder,
      reservationSetId: normalized.reservation.reservationSetId,
      reservationFencingToken: rFence,
      reservationLedgerVersion: normalized.reservation.ledgerVersion,
      leaseFencingToken: lFence,
      checkpointSequence: normalized.lease.checkpointSequence,
      checkpointHeadCommitSha: normalized.workspace.checkpointHeadCommitSha,
      evidenceEventId: normalized.evidenceEventId,
      trustBindingHash,
      persistencePerformed: true,
      reservationReleased: false,
      leaseReleased: false,
      secondWriterEnabled: false,
      authorityGranted: false,
      ownerOperationsRequired: false,
      idempotent: false,
    }
    const lanes = [...store.lanes]
    if (laneIndex === -1) lanes.push(nextLane); else lanes[laneIndex] = nextLane
    const nextStore = { ...store, version: store.version + 1,
      lanes: lanes.sort((left, right) => left.laneId.localeCompare(right.laneId)),
      operations: [...store.operations, { idempotencyKey: normalized.idempotencyKey, requestHash,
        request: normalized, result }], }
    writeStore(storePath, nextStore)
    return freeze(result)
  } finally {
    fs.rmSync(lock, { recursive: true, force: true })
  }
}

export function inspectReservationAwareHandoffStore(storePath, storeId) {
  return freeze(readStore(storePath, text(storeId, "storeId")))
}
