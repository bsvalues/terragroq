import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { validateDispatchEnvelope } from "../multi-agent-operator/dispatch-envelope.mjs"
import { normalizeReservationSet } from "../multi-agent-operator/reservation-set.mjs"

const SHA256 = /^[A-F0-9]{64}$/
const GIT_SHA40 = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/
const PROHIBITED_ACTIONS = [
  "authority-mutation",
  "autonomous-scheduling",
  "destructive-action",
  "paid-overage",
  "production-mutation",
  "protected-data-access",
  "remote-dispatch",
  "secret-inspection",
]
const REQUIRED_COMPLETION_EVIDENCE = [
  "commit_sha",
  "merge_sha",
  "pr_url",
  "review_result_sha256",
  "test_result_sha256",
  "verification_sha256",
]
const SECRET_LIKE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:[^\s/@]+@)/i
const EXECUTABLE_FIELD = /(?:^|_)(?:command|shell|script|argv|args|executable|endpoint|credential|password|private_key|secret)(?:$|_)/i

class DispatchContractError extends Error {
  constructor(detail) {
    super(`FABRIC_DISPATCH_CONTRACT_INVALID: ${detail}`)
    this.name = "DispatchContractError"
  }
}

function fail(detail) {
  throw new DispatchContractError(detail)
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} fields do not match the contract`)
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`)
  return value
}

function identifier(value, label) {
  text(value, label)
  if (!SAFE_ID.test(value)) fail(`${label} must be a safe identifier`)
  return value
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${label} must be an integer >= ${minimum}`)
  return value
}

function boolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`)
  return value
}

function stringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
    || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    fail(`${label} must be an array of non-empty strings`)
  }
  if (new Set(value).size !== value.length) fail(`${label} must not contain duplicates`)
  return value
}

function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) fail(`${label} must be an explicit UTC timestamp`)
  return Date.parse(value)
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be uppercase SHA-256 hex`)
  return value
}

function gitSha(value, label) {
  if (typeof value !== "string" || !GIT_SHA40.test(value)) fail(`${label} must be lowercase 40-character Git SHA`)
  return value
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function rejectExecutableOrSecretInput(value, pathName = "input") {
  if (typeof value === "string") {
    if (SECRET_LIKE.test(value)) fail(`${pathName} contains secret-like material`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectExecutableOrSecretInput(entry, `${pathName}[${index}]`))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_FIELD.test(key)) fail(`${pathName}.${key} is not permitted in a static proof packet`)
    rejectExecutableOrSecretInput(child, `${pathName}.${key}`)
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex").toUpperCase()
}

function authorityTuple(packet) {
  return {
    program_id: packet.authority.program_id,
    goal_id: packet.authority.goal_id,
    loop_id: packet.authority.loop_id,
    work_order_id: packet.authority.work_order_id,
    repository: packet.authority.repository,
    selected_node_id: packet.authority.selected_node_id,
    risk_ceiling: packet.authority.risk_ceiling,
    allowed_actions: packet.authority.allowed_actions,
    path_scope: packet.authority.path_scope,
    version: packet.authority.version,
    nonce: packet.authority.nonce,
  }
}

function bindingValues(packet) {
  return {
    dispatch_envelope_sha256: sha256(packet.dispatch_envelope),
    reservation_set_sha256: sha256(packet.reservation_set),
    recommendation_sha256: sha256(packet.recommendation),
    workload_envelope_sha256: sha256(packet.workload_envelope),
    authority_sha256: sha256(packet.authority),
    reservation_sha256: sha256(packet.reservation),
    lease_sha256: sha256(packet.lease),
    recovery_sha256: sha256(packet.recovery),
    completion_sha256: sha256(packet.completion),
  }
}

export function bindDispatchContract(input) {
  const packet = structuredClone(input)
  delete packet.bindings
  packet.authority.authority_tuple_sha256 = sha256(authorityTuple(packet))
  packet.completion.evidence_sha256 = packet.completion.state === "COMPLETE"
    ? sha256(packet.completion.evidence)
    : null
  packet.bindings = bindingValues(packet)
  return packet
}

function reason(code, detail, required, observed, evidenceRef) {
  return { code, detail, required, observed, evidence_ref: evidenceRef }
}

function validateShape(packet) {
  rejectExecutableOrSecretInput(packet)
  exactKeys(packet, [
    "schema_version", "proof_mode", "contract_id", "phase", "recommendation", "workload_envelope",
    "dispatch_envelope", "reservation_set", "authority", "reservation", "lease", "checkpoint",
    "recovery", "completion", "safety", "bindings",
  ], "contract")
  if (packet.schema_version !== "0.1-dispatch-contract-proof") fail("unsupported schema_version")
  if (packet.proof_mode !== "STATIC_NON_CONSUMABLE") fail("proof_mode must be STATIC_NON_CONSUMABLE")
  identifier(packet.contract_id, "contract_id")
  if (!['PRE_DISPATCH', 'COMPLETION_CLAIM'].includes(packet.phase)) fail("unsupported phase")

  exactKeys(packet.recommendation, [
    "schema_version", "status", "recommendation_only", "snapshot_sha256", "workload_id",
    "workload_sha256", "selected_node_id", "rank", "evaluated_at", "expires_at", "execution_authorized",
    "dispatch_allowed",
  ], "recommendation")
  exactKeys(packet.workload_envelope, [
    "job_id", "work_order_id", "repository", "base_ref", "base_sha", "risk_class", "selected_node_id",
    "path_scope", "contract_scope", "environment_scope", "allowed_actions", "denied_actions", "resource_limits", "data_classification",
    "storage_semantics", "network_scope", "max_attempts", "timeout_seconds",
  ], "workload_envelope")
  exactKeys(packet.workload_envelope.resource_limits, [
    "max_cpu_threads", "max_memory_bytes", "max_scratch_bytes", "minimum_free_scratch_bytes",
  ], "workload_envelope.resource_limits")
  exactKeys(packet.authority, [
    "evidence_kind", "grant_id", "program_id", "goal_id", "loop_id", "work_order_id", "repository",
    "selected_node_id", "risk_ceiling", "allowed_actions", "path_scope", "version", "decision",
    "issued_at", "expires_at", "revoked_at", "single_use", "consumption_count", "consumed_at", "nonce",
    "authority_tuple_sha256", "status_event_head_sha256", "current_status_event_head_sha256",
    "revocation_head_sha256", "current_revocation_head_sha256", "trusted_owner_bundle_sha256",
    "status_event_ref", "revocation_event_ref",
  ], "authority")
  exactKeys(packet.reservation, [
    "reservation_id", "status", "holder_id", "selected_node_id", "repository", "path_scope", "version",
    "holder_token_digest", "acquisition_count", "conflict_count", "issued_at", "expires_at",
  ], "reservation")
  exactKeys(packet.lease, [
    "lease_id", "status", "holder_id", "holder_token_digest", "reservation_id", "fencing_token", "generation", "issued_at",
    "expires_at", "lost_at", "released_at",
  ], "lease")
  exactKeys(packet.checkpoint, [
    "sequence", "state", "recorded_at", "lease_id", "holder_id", "holder_token_digest", "fencing_token", "evidence_sha256",
  ], "checkpoint")
  exactKeys(packet.recovery, [
    "max_attempts", "current_attempt", "reclaim_requires_expired_lease", "next_fencing_token",
    "retryable_codes", "terminal_codes",
  ], "recovery")
  exactKeys(packet.completion, ["state", "claimed_at", "required_evidence", "evidence", "evidence_anchor", "evidence_sha256"], "completion")
  exactKeys(packet.completion.evidence, [
    "commit_sha", "test_result_sha256", "review_result_sha256", "pr_url", "merge_sha",
    "verification_sha256",
  ], "completion.evidence")
  exactKeys(packet.completion.evidence_anchor, [
    "ledger_id", "event_count", "head_event_sha256", "manifest_sha256", "source_refs_sha256",
  ], "completion.evidence_anchor")
  exactKeys(packet.safety, [
    "scheduler_state", "scheduler_authority", "autonomous_dispatch", "remote_mutation",
    "authority_mutation", "execution_performed",
  ], "safety")
  exactKeys(packet.bindings, Object.keys(bindingValues(packet)), "bindings")
}

function validateValues(packet) {
  for (const [label, value] of [
    ["recommendation.snapshot_sha256", packet.recommendation.snapshot_sha256],
    ["recommendation.workload_sha256", packet.recommendation.workload_sha256],
    ["authority.authority_tuple_sha256", packet.authority.authority_tuple_sha256],
    ["authority.status_event_head_sha256", packet.authority.status_event_head_sha256],
    ["authority.current_status_event_head_sha256", packet.authority.current_status_event_head_sha256],
    ["authority.revocation_head_sha256", packet.authority.revocation_head_sha256],
    ["authority.current_revocation_head_sha256", packet.authority.current_revocation_head_sha256],
    ["authority.trusted_owner_bundle_sha256", packet.authority.trusted_owner_bundle_sha256],
    ["reservation.holder_token_digest", packet.reservation.holder_token_digest],
    ["lease.holder_token_digest", packet.lease.holder_token_digest],
    ["checkpoint.holder_token_digest", packet.checkpoint.holder_token_digest],
    ["completion.evidence_anchor.head_event_sha256", packet.completion.evidence_anchor.head_event_sha256],
    ["completion.evidence_anchor.manifest_sha256", packet.completion.evidence_anchor.manifest_sha256],
    ["completion.evidence_anchor.source_refs_sha256", packet.completion.evidence_anchor.source_refs_sha256],
    ...Object.entries(packet.bindings).map(([key, value]) => [`bindings.${key}`, value]),
  ]) digest(value, label)
  for (const [label, value] of [
    ["workload_envelope.job_id", packet.workload_envelope.job_id],
    ["workload_envelope.work_order_id", packet.workload_envelope.work_order_id],
    ["authority.grant_id", packet.authority.grant_id],
    ["authority.status_event_ref", packet.authority.status_event_ref],
    ["authority.revocation_event_ref", packet.authority.revocation_event_ref],
    ["authority.nonce", packet.authority.nonce],
    ["reservation.reservation_id", packet.reservation.reservation_id],
    ["reservation.holder_id", packet.reservation.holder_id],
    ["lease.lease_id", packet.lease.lease_id],
    ["completion.evidence_anchor.ledger_id", packet.completion.evidence_anchor.ledger_id],
  ]) identifier(value, label)
  gitSha(packet.workload_envelope.base_sha, "workload_envelope.base_sha")
  integer(packet.recommendation.rank, "recommendation.rank", 1)
  for (const [label, value] of [
    ["recommendation.evaluated_at", packet.recommendation.evaluated_at],
    ["recommendation.expires_at", packet.recommendation.expires_at],
    ["authority.issued_at", packet.authority.issued_at],
    ["authority.expires_at", packet.authority.expires_at],
    ["reservation.issued_at", packet.reservation.issued_at],
    ["reservation.expires_at", packet.reservation.expires_at],
    ["lease.issued_at", packet.lease.issued_at],
    ["lease.expires_at", packet.lease.expires_at],
    ["checkpoint.recorded_at", packet.checkpoint.recorded_at],
  ]) timestamp(value, label)
  for (const [label, value] of [
    ["recommendation.recommendation_only", packet.recommendation.recommendation_only],
    ["recommendation.execution_authorized", packet.recommendation.execution_authorized],
    ["recommendation.dispatch_allowed", packet.recommendation.dispatch_allowed],
    ["authority.single_use", packet.authority.single_use],
    ["recovery.reclaim_requires_expired_lease", packet.recovery.reclaim_requires_expired_lease],
    ["safety.autonomous_dispatch", packet.safety.autonomous_dispatch],
    ["safety.remote_mutation", packet.safety.remote_mutation],
    ["safety.authority_mutation", packet.safety.authority_mutation],
    ["safety.execution_performed", packet.safety.execution_performed],
  ]) boolean(value, label)
  for (const [label, value, minimum] of [
    ["workload_envelope.max_attempts", packet.workload_envelope.max_attempts, 1],
    ["workload_envelope.timeout_seconds", packet.workload_envelope.timeout_seconds, 1],
    ["authority.version", packet.authority.version, 1],
    ["authority.consumption_count", packet.authority.consumption_count, 0],
    ["reservation.version", packet.reservation.version, 1],
    ["reservation.acquisition_count", packet.reservation.acquisition_count, 1],
    ["reservation.conflict_count", packet.reservation.conflict_count, 0],
    ["lease.fencing_token", packet.lease.fencing_token, 1],
    ["lease.generation", packet.lease.generation, 1],
    ["checkpoint.sequence", packet.checkpoint.sequence, 0],
    ["checkpoint.fencing_token", packet.checkpoint.fencing_token, 1],
    ["recovery.max_attempts", packet.recovery.max_attempts, 1],
    ["recovery.current_attempt", packet.recovery.current_attempt, 1],
    ["recovery.next_fencing_token", packet.recovery.next_fencing_token, 2],
  ]) integer(value, label, minimum)
  for (const [label, value] of [
    ["workload_envelope.path_scope", packet.workload_envelope.path_scope],
    ["workload_envelope.allowed_actions", packet.workload_envelope.allowed_actions],
    ["workload_envelope.denied_actions", packet.workload_envelope.denied_actions],
    ["authority.allowed_actions", packet.authority.allowed_actions],
    ["authority.path_scope", packet.authority.path_scope],
    ["reservation.path_scope", packet.reservation.path_scope],
    ["recovery.retryable_codes", packet.recovery.retryable_codes],
    ["recovery.terminal_codes", packet.recovery.terminal_codes],
    ["completion.required_evidence", packet.completion.required_evidence],
  ]) stringArray(value, label, { allowEmpty: false })
  for (const [label, value] of [
    ["workload_envelope.contract_scope", packet.workload_envelope.contract_scope],
    ["workload_envelope.environment_scope", packet.workload_envelope.environment_scope],
  ]) stringArray(value, label, { allowEmpty: false })
  if (JSON.stringify([...packet.completion.required_evidence].sort()) !== JSON.stringify(REQUIRED_COMPLETION_EVIDENCE)) {
    fail("completion.required_evidence must contain the exact canonical evidence set")
  }
  for (const [key, value] of Object.entries(packet.workload_envelope.resource_limits)) integer(value, `resource_limits.${key}`, 1)
  if (packet.authority.revoked_at !== null) timestamp(packet.authority.revoked_at, "authority.revoked_at")
  if (packet.authority.consumed_at !== null) timestamp(packet.authority.consumed_at, "authority.consumed_at")
  if (packet.lease.lost_at !== null) timestamp(packet.lease.lost_at, "lease.lost_at")
  if (packet.lease.released_at !== null) timestamp(packet.lease.released_at, "lease.released_at")
  if (packet.completion.claimed_at !== null) timestamp(packet.completion.claimed_at, "completion.claimed_at")
  integer(packet.completion.evidence_anchor.event_count, "completion.evidence_anchor.event_count", 0)
  if (packet.checkpoint.evidence_sha256 !== null) digest(packet.checkpoint.evidence_sha256, "checkpoint.evidence_sha256")
  if (packet.completion.evidence_sha256 !== null) digest(packet.completion.evidence_sha256, "completion.evidence_sha256")
}

function evaluateOrThrow(input, options = {}) {
  const packet = structuredClone(input)
  validateShape(packet)
  validateValues(packet)
  const at = timestamp(options.evaluatedAt, "evaluated_at")
  const reasons = []
  const add = (code, detail, required, observed, refs) => reasons.push(reason(code, detail, required, observed, refs))

  let dispatchEnvelope
  try {
    dispatchEnvelope = validateDispatchEnvelope(packet.dispatch_envelope)
  } catch (error) {
    fail(`canonical dispatch envelope rejected: ${error.code ?? error.message}:${error.field ?? "unknown"}:${error.detail ?? ""}`)
  }
  const reservationSet = normalizeReservationSet(packet.reservation_set)
  if (!reservationSet.valid) {
    fail(`canonical reservation set rejected: ${reservationSet.diagnostics.map((entry) => entry.reasonCode).join(",")}`)
  }

  const expectedBindings = bindingValues(packet)
  for (const [key, expected] of Object.entries(expectedBindings)) {
    if (packet.bindings[key] !== expected) add("BINDING_MISMATCH", key, expected, packet.bindings[key], [`bindings.${key}`])
  }
  const expectedAuthorityTuple = sha256(authorityTuple(packet))
  if (packet.authority.authority_tuple_sha256 !== expectedAuthorityTuple) {
    add("AUTHORITY_TUPLE_MISMATCH", "authority tuple digest changed", expectedAuthorityTuple,
      packet.authority.authority_tuple_sha256, ["authority.authority_tuple_sha256"])
  }

  if (packet.safety.scheduler_state !== "disabled" || packet.safety.scheduler_authority !== "not-granted") {
    add("SCHEDULER_AUTHORITY_WALL", "scheduler must remain disabled / not-granted",
      { state: "disabled", authority: "not-granted" }, packet.safety,
      ["safety.scheduler_state", "safety.scheduler_authority"])
  }
  for (const key of ["autonomous_dispatch", "remote_mutation", "authority_mutation", "execution_performed"]) {
    if (packet.safety[key]) add("PROOF_MODE_VIOLATION", key, false, true, [`safety.${key}`])
  }
  if (packet.recommendation.schema_version !== "0.1-placement-recommendation"
    || packet.recommendation.status !== "RECOMMENDED" || !packet.recommendation.recommendation_only
    || packet.recommendation.rank !== 1
    || packet.recommendation.execution_authorized || packet.recommendation.dispatch_allowed) {
    add("PLACEMENT_RECOMMENDATION_INVALID", "placement must remain recommendation-only", true,
      packet.recommendation, ["recommendation"])
  }
  if (at > Date.parse(packet.recommendation.expires_at) || at < Date.parse(packet.recommendation.evaluated_at)) {
    add("PLACEMENT_EVIDENCE_STALE", "evaluation is outside recommendation validity", packet.recommendation.expires_at,
      options.evaluatedAt, ["recommendation.evaluated_at", "recommendation.expires_at"])
  }

  const envelope = packet.workload_envelope
  const authority = packet.authority
  const reservation = packet.reservation
  const lease = packet.lease
  const canonicalEnvelope = dispatchEnvelope.envelope
  if (dispatchEnvelope.validationOnly !== true || dispatchEnvelope.authorityGranted !== false
    || canonicalEnvelope.ownerOperationsAllowed !== false) {
    add("DISPATCH_ENVELOPE_AUTHORITY_WALL", "canonical envelope must remain validation-only",
      { validationOnly: true, authorityGranted: false, ownerOperationsAllowed: false }, dispatchEnvelope,
      ["dispatch_envelope"])
  }
  if (canonicalEnvelope.programId !== authority.program_id || canonicalEnvelope.goalId !== authority.goal_id
    || canonicalEnvelope.loopId !== authority.loop_id || canonicalEnvelope.workOrderId !== envelope.work_order_id
    || canonicalEnvelope.riskClass !== envelope.risk_class
    || canonicalEnvelope.repositories.length !== 1 || canonicalEnvelope.repositories[0] !== envelope.repository
    || canonicalEnvelope.baseRefs.length !== 1 || canonicalEnvelope.baseRefs[0].commitSha !== envelope.base_sha
    || canonicalEnvelope.baseRefs[0].ref !== envelope.base_ref
    || canonicalJson(canonicalEnvelope.allowedActions) !== canonicalJson(envelope.allowed_actions)
    || canonicalJson(canonicalEnvelope.allowedActions) !== canonicalJson(authority.allowed_actions)
    || canonicalEnvelope.authorityGrantRefs.length !== 1
    || canonicalEnvelope.authorityGrantRefs[0] !== authority.grant_id
    || canonicalEnvelope.programActivationGrantRef !== authority.grant_id
    || canonicalEnvelope.grantStatusEventRefs.length !== 1
    || canonicalEnvelope.grantStatusEventRefs[0] !== authority.status_event_ref) {
    add("DISPATCH_ENVELOPE_SCOPE_MISMATCH", "canonical dispatch envelope must bind the same authority and work",
      true, canonicalEnvelope, ["dispatch_envelope", "workload_envelope", "authority"])
  }
  const normalizedReservation = reservationSet.reservationSet
  if (normalizedReservation.reservationSetId !== reservation.reservation_id
    || normalizedReservation.workerId !== reservation.holder_id
    || normalizedReservation.workOrderId !== envelope.work_order_id
    || canonicalJson(normalizedReservation.reservations.paths) !== canonicalJson(canonicalEnvelope.reservations.paths)
    || canonicalJson(normalizedReservation.reservations.contracts) !== canonicalJson(canonicalEnvelope.reservations.contracts)
    || canonicalJson(normalizedReservation.reservations.environments) !== canonicalJson(canonicalEnvelope.reservations.environments)
    || canonicalJson(normalizedReservation.reservations.paths.map((entry) => entry.path)) !== canonicalJson(envelope.path_scope)
    || canonicalJson(normalizedReservation.reservations.contracts) !== canonicalJson(envelope.contract_scope)
    || canonicalJson(normalizedReservation.reservations.environments) !== canonicalJson(envelope.environment_scope)) {
    add("RESERVATION_CONTRACT_MISMATCH", "canonical reservation set and dispatch envelope must match",
      canonicalEnvelope.reservations, normalizedReservation, ["dispatch_envelope.reservations", "reservation_set"])
  }
  for (const [field, values] of [
    ["work_order_id", [envelope.work_order_id, authority.work_order_id]],
    ["repository", [envelope.repository, authority.repository, reservation.repository]],
    ["selected_node_id", [packet.recommendation.selected_node_id, envelope.selected_node_id,
      authority.selected_node_id, reservation.selected_node_id]],
  ]) {
    if (new Set(values).size !== 1) add("SCOPE_BINDING_MISMATCH", field, values[0], values, [field])
  }
  if (JSON.stringify(envelope.path_scope) !== JSON.stringify(authority.path_scope)
    || JSON.stringify(envelope.path_scope) !== JSON.stringify(reservation.path_scope)) {
    add("PATH_SCOPE_MISMATCH", "path scopes must match exactly", envelope.path_scope,
      { authority: authority.path_scope, reservation: reservation.path_scope },
      ["workload_envelope.path_scope", "authority.path_scope", "reservation.path_scope"])
  }
  if (canonicalJson(canonicalEnvelope.forbiddenActions) !== canonicalJson([
    "BRANCH_PROTECTION_BYPASS", "CREDENTIAL_ACCESS", "DESTRUCTIVE_GIT", "OWNER_CONTACT",
    "PRODUCTION_WRITE", "RUNTIME_ACTIVATION",
  ])) {
    add("DISPATCH_ENVELOPE_FORBIDDEN_ACTION_MISMATCH", "canonical forbidden actions must retain every protected wall",
      true, canonicalEnvelope.forbiddenActions, ["dispatch_envelope.forbiddenActions"])
  }
  if (envelope.risk_class !== "R1" || authority.risk_ceiling !== "R1") {
    add("RISK_AUTHORITY_MISMATCH", "bounded proof is R1 only", "R1",
      { workload: envelope.risk_class, authority: authority.risk_ceiling },
      ["workload_envelope.risk_class", "authority.risk_ceiling"])
  }
  const denied = new Set(envelope.denied_actions)
  const allowed = new Set(envelope.allowed_actions)
  const authorityAllowed = new Set(authority.allowed_actions)
  for (const action of envelope.allowed_actions) {
    if (denied.has(action)) add("ACTION_CONFLICT", action, "not both allowed and denied", action,
      ["workload_envelope.allowed_actions", "workload_envelope.denied_actions"])
    if (!authorityAllowed.has(action)) add("ACTION_NOT_AUTHORIZED", action, true, false,
      ["authority.allowed_actions", "workload_envelope.allowed_actions"])
  }
  for (const action of PROHIBITED_ACTIONS) {
    if (allowed.has(action) || authorityAllowed.has(action) || !denied.has(action)) {
      add("PROHIBITED_ACTION_NOT_FENCED", action, "denied and not allowed",
        { workload_allowed: allowed.has(action), authority_allowed: authorityAllowed.has(action), denied: denied.has(action) },
        ["workload_envelope.allowed_actions", "workload_envelope.denied_actions", "authority.allowed_actions"])
    }
  }
  if (authority.evidence_kind !== "proof-fixture" || authority.decision !== "GRANTED" || !authority.single_use) {
    add("AUTHORITY_EVIDENCE_INVALID", "proof requires a single-use non-live authority fixture",
      { evidence_kind: "proof-fixture", decision: "GRANTED", single_use: true }, authority,
      ["authority.evidence_kind", "authority.decision", "authority.single_use"])
  }
  if (authority.revoked_at !== null) add("AUTHORITY_REVOKED", "authority is revoked", null,
    authority.revoked_at, ["authority.revoked_at"])
  if (authority.status_event_head_sha256 !== authority.current_status_event_head_sha256) {
    add("AUTHORITY_CHANGED", "authority status head moved after binding", authority.status_event_head_sha256,
      authority.current_status_event_head_sha256,
      ["authority.status_event_head_sha256", "authority.current_status_event_head_sha256"])
  }
  if (authority.revocation_head_sha256 !== authority.current_revocation_head_sha256) {
    add("REVOCATION_HEAD_CHANGED", "authority revocation head moved after binding", authority.revocation_head_sha256,
      authority.current_revocation_head_sha256,
      ["authority.revocation_head_sha256", "authority.current_revocation_head_sha256"])
  }
  if (at >= Date.parse(authority.expires_at) || at < Date.parse(authority.issued_at)) {
    add("AUTHORITY_EXPIRED", "evaluation is outside authority validity", authority.expires_at,
      options.evaluatedAt, ["authority.issued_at", "authority.expires_at"])
  }

  if (reservation.status !== "SIMULATED_HELD" || reservation.conflict_count !== 0
    || reservation.acquisition_count !== 1) {
    add("RESERVATION_NOT_EXCLUSIVE", "one simulated acquisition and zero conflicts required",
      { status: "SIMULATED_HELD", acquisition_count: 1, conflict_count: 0 }, reservation,
      ["reservation.status", "reservation.acquisition_count", "reservation.conflict_count"])
  }
  if (at >= Date.parse(reservation.expires_at) || at < Date.parse(reservation.issued_at)) {
    add("RESERVATION_EXPIRED", "evaluation is outside reservation validity", reservation.expires_at,
      options.evaluatedAt, ["reservation.issued_at", "reservation.expires_at"])
  }
  if (lease.reservation_id !== reservation.reservation_id || lease.holder_id !== reservation.holder_id
    || packet.checkpoint.holder_id !== lease.holder_id || packet.checkpoint.lease_id !== lease.lease_id) {
    add("LEASE_BINDING_MISMATCH", "lease/checkpoint holder and reservation must match", true,
      { lease, checkpoint: packet.checkpoint, reservation }, ["lease", "checkpoint", "reservation"])
  }
  if (lease.holder_token_digest !== reservation.holder_token_digest
    || packet.checkpoint.holder_token_digest !== lease.holder_token_digest) {
    add("HOLDER_TOKEN_DIGEST_MISMATCH", "reservation, lease, and checkpoint must share one holder digest",
      reservation.holder_token_digest,
      { lease: lease.holder_token_digest, checkpoint: packet.checkpoint.holder_token_digest },
      ["reservation.holder_token_digest", "lease.holder_token_digest", "checkpoint.holder_token_digest"])
  }
  if (packet.checkpoint.fencing_token !== lease.fencing_token
    || packet.recovery.next_fencing_token <= lease.fencing_token) {
    add("FENCING_TOKEN_CONFLICT", "checkpoint must use the current fence and recovery must advance it",
      { checkpoint: lease.fencing_token, next: `>${lease.fencing_token}` },
      { checkpoint: packet.checkpoint.fencing_token, next: packet.recovery.next_fencing_token },
      ["lease.fencing_token", "checkpoint.fencing_token", "recovery.next_fencing_token"])
  }
  if (lease.lost_at !== null) add("LEASE_LOST", "lease has recorded loss", null, lease.lost_at, ["lease.lost_at"])
  if (packet.recovery.current_attempt > packet.recovery.max_attempts
    || packet.recovery.max_attempts !== envelope.max_attempts) {
    add("RECOVERY_BUDGET_INVALID", "attempt budget must match and remain bounded", envelope.max_attempts,
      packet.recovery, ["workload_envelope.max_attempts", "recovery"])
  }
  if (!packet.recovery.reclaim_requires_expired_lease) add("UNSAFE_LEASE_RECLAIM", "reclaim requires expiry",
    true, false, ["recovery.reclaim_requires_expired_lease"])
  const terminal = new Set(packet.recovery.terminal_codes)
  for (const code of packet.recovery.retryable_codes) {
    if (terminal.has(code)) add("RECOVERY_CLASS_CONFLICT", code, "one recovery class", "both",
      ["recovery.retryable_codes", "recovery.terminal_codes"])
  }

  const requiredEvidence = new Set(packet.completion.required_evidence)
  const actualEvidence = packet.completion.evidence
  if (packet.phase === "PRE_DISPATCH") {
    if (lease.status !== "SIMULATED_ACTIVE" || lease.released_at !== null || at >= Date.parse(lease.expires_at)) {
      add("LEASE_NOT_HELD", "pre-dispatch proof requires an unexpired simulated lease", "SIMULATED_ACTIVE", lease,
        ["lease.status", "lease.expires_at", "lease.released_at"])
    }
    if (packet.checkpoint.sequence !== 0 || packet.checkpoint.state !== "PRE_DISPATCH"
      || packet.checkpoint.evidence_sha256 !== null) {
      add("CHECKPOINT_INVALID", "pre-dispatch checkpoint must be sequence zero without evidence", true,
        packet.checkpoint, ["checkpoint"])
    }
    if (Date.parse(packet.checkpoint.recorded_at) > at
      || Date.parse(packet.checkpoint.recorded_at) < Date.parse(lease.issued_at)) {
      add("CHECKPOINT_CHRONOLOGY_INVALID", "pre-dispatch checkpoint must be recorded during the active lease",
        `${lease.issued_at} <= recorded_at <= ${options.evaluatedAt}`, packet.checkpoint.recorded_at,
        ["lease.issued_at", "checkpoint.recorded_at"])
    }
    if (authority.consumption_count !== 0 || authority.consumed_at !== null) {
      add("AUTHORITY_REPLAY", "unused single-use authority required", 0, authority.consumption_count,
        ["authority.consumption_count", "authority.consumed_at"])
    }
    if (packet.completion.state !== "PENDING" || packet.completion.claimed_at !== null
      || packet.completion.evidence_sha256 !== null || packet.completion.evidence_anchor.event_count !== 0
      || Object.values(actualEvidence).some((value) => value !== null)) {
      add("PREMATURE_COMPLETION_CLAIM", "completion must remain pending before dispatch", "PENDING",
        packet.completion, ["completion"])
    }
  } else {
    if (lease.status !== "SIMULATED_RELEASED" || lease.released_at === null) {
      add("LEASE_NOT_RELEASED", "completion requires a released simulated lease", "SIMULATED_RELEASED", lease,
        ["lease.status", "lease.released_at"])
    }
    if (packet.checkpoint.sequence < 1 || packet.checkpoint.state !== "COMPLETE") {
      add("CHECKPOINT_INVALID", "completion requires a positive COMPLETE checkpoint", "COMPLETE",
        packet.checkpoint, ["checkpoint"])
    }
    if (authority.consumption_count !== 1 || authority.consumed_at === null) {
      add("AUTHORITY_CONSUMPTION_INVALID", "single-use authority must be consumed exactly once", 1,
        authority.consumption_count, ["authority.consumption_count", "authority.consumed_at"])
    }
    const consumedAt = authority.consumed_at === null ? Number.NaN : Date.parse(authority.consumed_at)
    const releasedAt = lease.released_at === null ? Number.NaN : Date.parse(lease.released_at)
    const checkpointAt = Date.parse(packet.checkpoint.recorded_at)
    const claimedAt = packet.completion.claimed_at === null ? Number.NaN : Date.parse(packet.completion.claimed_at)
    if (![consumedAt, checkpointAt, releasedAt, claimedAt].every(Number.isFinite)
      || consumedAt < Date.parse(authority.issued_at)
      || consumedAt < Date.parse(lease.issued_at)
      || consumedAt >= Date.parse(authority.expires_at)
      || consumedAt >= Date.parse(reservation.expires_at)
      || consumedAt >= Date.parse(lease.expires_at)
      || checkpointAt <= consumedAt || releasedAt <= checkpointAt || claimedAt <= releasedAt || at < claimedAt) {
      add("COMPLETION_CHRONOLOGY_INVALID",
        "completion events must be ordered, in-force, and already observed at evaluation time",
        "issued <= consumed < checkpoint <= released <= claimed <= evaluated, all before expiry",
        { consumed_at: authority.consumed_at, checkpoint_at: packet.checkpoint.recorded_at,
          released_at: lease.released_at, claimed_at: packet.completion.claimed_at, evaluated_at: options.evaluatedAt },
        ["authority.consumed_at", "checkpoint.recorded_at", "lease.released_at", "completion.claimed_at"])
    }
    if (packet.completion.state !== "COMPLETE") {
      add("COMPLETION_STATE_INVALID", "completion claim must be COMPLETE", "COMPLETE",
        packet.completion.state, ["completion.state"])
    }
    for (const field of requiredEvidence) {
      if (!Object.hasOwn(actualEvidence, field) || typeof actualEvidence[field] !== "string"
        || actualEvidence[field].trim() === "") {
        add("COMPLETION_EVIDENCE_MISSING", field, "non-empty evidence", actualEvidence[field] ?? null,
          [`completion.evidence.${field}`])
      }
    }
    const expectedEvidenceDigest = sha256(actualEvidence)
    if (packet.completion.evidence_sha256 !== expectedEvidenceDigest
      || packet.checkpoint.evidence_sha256 !== expectedEvidenceDigest) {
      add("COMPLETION_EVIDENCE_MISMATCH", "completion and checkpoint must bind the same evidence digest",
        expectedEvidenceDigest,
        { completion: packet.completion.evidence_sha256, checkpoint: packet.checkpoint.evidence_sha256 },
        ["completion.evidence_sha256", "checkpoint.evidence_sha256"])
    }
    if (packet.completion.evidence_anchor.event_count < 1
      || packet.completion.evidence_anchor.source_refs_sha256 !== expectedEvidenceDigest) {
      add("COMPLETION_EVIDENCE_ANCHOR_INVALID", "completion must bind retained source references and at least one ledger event",
        { minimum_events: 1, source_refs_sha256: expectedEvidenceDigest }, packet.completion.evidence_anchor,
        ["completion.evidence_anchor"])
    }
    let trustedManifest = null
    if (typeof options.resolveTrustedEvidenceManifest === "function") {
      try {
        trustedManifest = options.resolveTrustedEvidenceManifest(structuredClone(packet.completion.evidence_anchor))
      } catch {
        trustedManifest = null
      }
    }
    if (!trustedManifest || trustedManifest.verified !== true
      || trustedManifest.manifest_sha256 !== packet.completion.evidence_anchor.manifest_sha256) {
      add("COMPLETION_EVIDENCE_UNATTESTED", "packet-local evidence cannot attest itself",
        "host-injected verified evidence resolver with matching immutable manifest",
        packet.completion.evidence_anchor.manifest_sha256, ["completion.evidence_anchor.manifest_sha256"])
    }
  }

  reasons.sort((left, right) => left.code.localeCompare(right.code) || left.detail.localeCompare(right.detail))
  return {
    schema_version: "0.1-dispatch-contract-decision",
    status: reasons.length === 0 ? "CONTRACT_READY" : "CONTRACT_BLOCKED",
    phase: packet.phase,
    contract_id: packet.contract_id,
    selected_node_id: packet.recommendation.selected_node_id,
    reasons,
    evidence_used: [
      "recommendation", "workload_envelope", "authority", "reservation", "lease", "checkpoint",
      "recovery", "completion", "safety", "bindings",
    ],
    recommendation_only: true,
    contract_proof_only: true,
    proof_mode: "STATIC_NON_CONSUMABLE",
    execution_authorized: false,
    dispatch_allowed: false,
    scheduler: { state: packet.safety.scheduler_state, authority: packet.safety.scheduler_authority },
    authority_mutated: false,
    remote_systems_modified: false,
  }
}

function inputRejected(error) {
  return {
    schema_version: "0.1-dispatch-contract-decision",
    status: "INPUT_REJECTED",
    phase: null,
    contract_id: null,
    selected_node_id: null,
    reasons: [{
      code: "INPUT_REJECTED",
      detail: String(error.message).replace(/^FABRIC_DISPATCH_CONTRACT_INVALID:\s*/, ""),
      required: "valid dispatch-contract proof packet",
      observed: "invalid input",
      evidence_ref: ["input"],
    }],
    evidence_used: [],
    recommendation_only: true,
    contract_proof_only: true,
    proof_mode: "STATIC_NON_CONSUMABLE",
    execution_authorized: false,
    dispatch_allowed: false,
    scheduler: { state: "disabled", authority: "not-granted" },
    authority_mutated: false,
    remote_systems_modified: false,
  }
}

export function evaluateDispatchContract(input, options = {}) {
  try {
    return evaluateOrThrow(input, options)
  } catch (error) {
    if (error instanceof DispatchContractError) return inputRejected(error)
    throw error
  }
}

export function runCli(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) return inputRejected(new DispatchContractError("arguments must use --name value pairs"))
    args[argv[index].slice(2)] = argv[index + 1]
  }
  if (!args.contract || !args.at) return inputRejected(new DispatchContractError("--contract and --at are required"))
  try {
    const packet = JSON.parse(fs.readFileSync(path.resolve(args.contract), "utf8"))
    return evaluateDispatchContract(packet, { evaluatedAt: args.at })
  } catch (error) {
    return inputRejected(new DispatchContractError(`unable to read contract: ${error.message}`))
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const result = runCli(process.argv.slice(2))
  const stream = result.status === "INPUT_REJECTED" ? process.stderr : process.stdout
  stream.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status === "INPUT_REJECTED") process.exitCode = 2
}
