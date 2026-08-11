import crypto from "node:crypto"

import {
  aegisStandingRequestBindingSha256,
  aegisStandingJobScopeSha256,
  evaluateAegisStandingEligibility,
} from "../admission/evaluate-aegis-standing-authority.mjs"
import { verifyAegisHashBytes } from "./aegis-hash-core.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const FORBIDDEN_RUNTIME_FIELDS = new Set([
  "command",
  "commands",
  "shell",
  "argv",
  "args",
  "executable",
  "exec",
  "spawn",
  "environment",
  "env",
  "network",
  "endpoint",
  "url",
  "uri",
])

export class AegisStandingHashRuntimeError extends Error {
  constructor(code, detail) {
    super(detail)
    this.name = "AegisStandingHashRuntimeError"
    this.code = code
  }
}

const fail = (code, detail) => {
  throw new AegisStandingHashRuntimeError(code, detail)
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

const sha256Object = (value) => crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex")

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_RUNTIME_CONTRACT", `${label} must be an object`)
  }
  return value
}

function exact(value, keys, label) {
  object(value, label)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail("INVALID_RUNTIME_CONTRACT", `${label} fields do not match the runtime contract`)
  }
}

function finiteClock(now) {
  const value = now()
  if (!Number.isFinite(value)) fail("CLOCK_INVALID", "now returned a non-finite value")
  return value
}

function timestamp(value, label) {
  if (typeof value !== "string") fail("INVALID_CALLBACK_RESULT", `${label} must be a UTC timestamp`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail("INVALID_CALLBACK_RESULT", `${label} must be a millisecond UTC timestamp`)
  }
  return value
}

function scanForbiddenFields(value, label = "request") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForbiddenFields(entry, `${label}[${index}]`))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RUNTIME_FIELDS.has(key.toLowerCase())) {
      fail("FORBIDDEN_RUNTIME_FIELD", `${label}.${key} is not permitted`)
    }
    scanForbiddenFields(child, `${label}.${key}`)
  }
}

function validateInput(input) {
  exact(input, ["relative_path", "expected_byte_length", "expected_sha256"], "request.input")
  if (typeof input.relative_path !== "string") fail("INPUT_PATH_INVALID", "input path must be relative")
  const segments = input.relative_path.split("/")
  if (segments.length === 0 || segments.some((segment) => !SAFE_PATH_SEGMENT.test(segment))) {
    fail("INPUT_PATH_INVALID", "input path must be a normalized safe relative path")
  }
  if (!Number.isSafeInteger(input.expected_byte_length) || input.expected_byte_length < 0) {
    fail("INPUT_LENGTH_INVALID", "expected input length must be a non-negative safe integer")
  }
  if (typeof input.expected_sha256 !== "string" || !SHA256.test(input.expected_sha256)) {
    fail("INPUT_DIGEST_INVALID", "expected input digest must be lowercase SHA-256 hex")
  }
}

function validateHashRequest(request) {
  scanForbiddenFields(request)
  object(request.workload, "request.workload")
  if (
    request.workload.workload_class !== "HASH_VERIFY"
    || request.workload.template_id !== "aegis.hash-verify.v1"
    || request.workload.adapter_id !== "resident-aegis-hash-verify-v1"
    || request.workload.profile_id !== "resident-aegis-bounded-hash-verify-v1"
  ) {
    fail("HASH_WORKLOAD_MISMATCH", "request does not name the reviewed HASH_VERIFY binding")
  }
  object(request.claim, "request.claim")
  if (typeof request.claim.claim_id !== "string" || !SHA256.test(request.claim.admission_sha256)) {
    fail("CLAIM_BINDING_INVALID", "request claim is incomplete")
  }
  object(request.lease, "request.lease")
  if (typeof request.lease.lease_id !== "string" || !Number.isSafeInteger(request.lease.fencing_token) || request.lease.fencing_token < 1) {
    fail("LEASE_BINDING_INVALID", "request lease is incomplete")
  }
  object(request.limits, "request.limits")
  if (!Number.isSafeInteger(request.limits.runtime_ms) || request.limits.runtime_ms < 1) {
    fail("RUNTIME_LIMIT_INVALID", "request runtime limit must be a positive safe integer")
  }
  validateInput(request.input)
}

function requireFresh(request, candidateAdmission, authority, nowMs) {
  const deadlines = [
    [candidateAdmission.expires_at, "ADMISSION_EXPIRED"],
    [request.placement_evidence?.expires_at, "EVIDENCE_STALE"],
    [request.capability_evidence?.expires_at, "EVIDENCE_STALE"],
  ]
  for (const [value, code] of deadlines) {
    const deadline = Date.parse(value)
    if (!Number.isFinite(deadline) || deadline <= nowMs) fail(code, "standing execution evidence is stale or expired")
  }

  const maximumAge = authority.evidence_policy?.maximum_age_ms
  if (!Number.isSafeInteger(maximumAge) || maximumAge < 1) fail("EVIDENCE_POLICY_INVALID", "authority freshness policy is invalid")
  for (const evidence of [request.placement_evidence, request.capability_evidence]) {
    const observedAt = Date.parse(evidence?.observed_at)
    if (!Number.isFinite(observedAt) || observedAt > nowMs || nowMs - observedAt > maximumAge) {
      fail("EVIDENCE_STALE", "standing execution evidence is stale or future-dated")
    }
  }
}

function requireAuthorized(result, expected) {
  object(result, "eligibility result")
  if (result.execution_authorized !== true || result.dispatch_allowed !== true) {
    fail(result.code || "ELIGIBILITY_NOT_AUTHORIZED", result.detail || result.reason_code || "standing eligibility did not authorize execution")
  }
  for (const field of ["authority_id", "authority_sha256", "job_id", "admission_id", "admission_sha256", "request_binding_sha256", "job_scope_sha256"]) {
    if (result[field] !== expected[field]) fail("ELIGIBILITY_BINDING_MISMATCH", `eligibility ${field} does not match the exact request`)
  }
}

function sameBinding(actual, expected, fields, code, label) {
  for (const field of fields) {
    if (actual[field] !== expected[field]) fail(code, `${label} ${field} does not match the exact request binding`)
  }
}

async function releaseAcquiredLease(releaseLease, acquiredLease, priorFailure) {
  try {
    const released = await releaseLease(acquiredLease)
    object(released, "release result")
    if (
      released.released !== true
      || released.lease_id !== acquiredLease.lease_id
      || released.fencing_token !== acquiredLease.fencing_token
    ) {
      fail("LEASE_RELEASE_FAILED", "acquired lease was not released with its exact fencing token")
    }
  } catch (error) {
    if (!priorFailure) throw error
    priorFailure.release_error = error
  }
}

export async function executeAegisStandingHash(options) {
  exact(options, [
    "authority",
    "request",
    "candidateAdmission",
    "now",
    "claimAdmission",
    "persistClaimFailure",
    "acquireLease",
    "releaseLease",
    "readInput",
    "persistResult",
  ], "runtime options")
  for (const callback of ["now", "claimAdmission", "persistClaimFailure", "acquireLease", "releaseLease", "readInput", "persistResult"]) {
    if (typeof options[callback] !== "function") fail("INVALID_RUNTIME_CONTRACT", `${callback} must be a function`)
  }

  const authority = structuredClone(options.authority)
  const request = structuredClone(options.request)
  const candidateAdmission = structuredClone(options.candidateAdmission)
  scanForbiddenFields(authority, "authority")
  validateHashRequest(request)
  scanForbiddenFields(candidateAdmission, "candidateAdmission")

  const admissionSha256 = sha256Object(candidateAdmission)
  if (request.claim.admission_sha256 !== admissionSha256) {
    fail("ADMISSION_DIGEST_MISMATCH", "claim does not bind the exact candidate admission")
  }
  const requestBindingSha256 = aegisStandingRequestBindingSha256(request)
  const expectedEligibility = {
    authority_id: authority.authority_id,
    authority_sha256: candidateAdmission.authority_sha256,
    job_id: request.job_id,
    admission_id: candidateAdmission.admission_id,
    admission_sha256: admissionSha256,
    request_binding_sha256: requestBindingSha256,
    job_scope_sha256: aegisStandingJobScopeSha256(request),
  }

  const admittedAt = finiteClock(options.now)
  requireFresh(request, candidateAdmission, authority, admittedAt)
  requireAuthorized(evaluateAegisStandingEligibility({
    authority,
    request,
    candidateAdmission,
    now: () => admittedAt,
  }), expectedEligibility)

  const claimBinding = {
    ...expectedEligibility,
    claim_id: request.claim.claim_id,
    request_binding_sha256: requestBindingSha256,
    admission_issued_at: candidateAdmission.issued_at,
    admission_expires_at: candidateAdmission.expires_at,
  }
  const requestedLease = {
    ...claimBinding,
    lease_id: request.lease.lease_id,
    fencing_token: request.lease.fencing_token,
  }
  let acquiredLease = null
  let claim = null
  let claimAcquired = false
  let claimedAt = null
  let failure = null
  let completion = null
  let terminalPersisted = false
  let startedAt = null
  let verification = null

  try {
    claim = object(await options.claimAdmission(claimBinding), "claim result")
    if (claim.claimed !== true) fail("ADMISSION_REPLAY", "exact admission and request binding was already claimed")
    claimAcquired = true
    sameBinding(claim, claimBinding, Object.keys(claimBinding), "CLAIM_BINDING_MISMATCH", "claim")
    claimedAt = timestamp(claim.claimed_at, "claim.claimed_at")

    const lease = object(await options.acquireLease(requestedLease), "lease result")
    if (lease.acquired !== true) fail("CONCURRENCY_LIMIT_REACHED", "the single standing execution lease is occupied")
    acquiredLease = {
      ...claimBinding,
      lease_id: lease.lease_id,
      fencing_token: lease.fencing_token,
      acquired_at: lease.acquired_at,
    }
    timestamp(lease.acquired_at, "lease.acquired_at")
    if (lease.lease_id !== requestedLease.lease_id || lease.fencing_token !== requestedLease.fencing_token) {
      fail("LEASE_FENCE_MISMATCH", "acquired lease does not match the exact requested lease and fence")
    }
    sameBinding(lease, requestedLease, Object.keys(requestedLease), "LEASE_BINDING_MISMATCH", "lease")

    const recheckedAt = finiteClock(options.now)
    requireFresh(request, candidateAdmission, authority, recheckedAt)
    requireAuthorized(evaluateAegisStandingEligibility({
      authority,
      request,
      candidateAdmission,
      now: () => recheckedAt,
    }), expectedEligibility)

    startedAt = finiteClock(options.now)
    requireFresh(request, candidateAdmission, authority, startedAt)
    const bytes = await options.readInput({
      ...claimBinding,
      lease_id: requestedLease.lease_id,
      fencing_token: requestedLease.fencing_token,
      input: structuredClone(request.input),
    })
    if (!(bytes instanceof Uint8Array)) fail("INPUT_TYPE_INVALID", "input reader must return exact bytes")
    const exactBytes = Buffer.from(bytes)
    try {
      verification = verifyAegisHashBytes(exactBytes, request.input.expected_sha256, request.input.expected_byte_length)
    } catch (error) {
      fail(error?.code === "INPUT_CHANGED" ? "INPUT_LENGTH_MISMATCH" : "HASH_OPERATION_REJECTED", String(error?.message ?? error))
    }
    const completedAt = finiteClock(options.now)
    if (completedAt < startedAt || completedAt - startedAt > request.limits.runtime_ms) {
      fail("RUNTIME_TIMEOUT", "HASH_VERIFY exceeded its exact runtime limit")
    }
    requireFresh(request, candidateAdmission, authority, completedAt)
    const observedSha256 = verification.observed_sha256
    if (!verification.matched) {
      fail("HASH_MISMATCH", "input SHA-256 does not match the approved request")
    }

    const evidenceBody = {
      schema_version: "1.0-aegis-standing-hash-completion",
      status: "COMPLETED",
      result: "VERIFIED",
      authority_id: authority.authority_id,
      authority_sha256: candidateAdmission.authority_sha256,
      job_id: request.job_id,
      outcome_id: request.outcome.outcome_id,
      work_order_id: request.work_order_id,
      source: structuredClone(request.source),
      workload: structuredClone(request.workload),
      admission: { admission_id: candidateAdmission.admission_id, admission_sha256: admissionSha256 },
      claim: { claim_id: request.claim.claim_id, claimed_at: claim.claimed_at },
      lease: {
        lease_id: requestedLease.lease_id,
        fencing_token: requestedLease.fencing_token,
        acquired_at: lease.acquired_at,
      },
      request_binding_sha256: requestBindingSha256,
      operation: {
        kind: "HASH_VERIFY",
        relative_path: request.input.relative_path,
        byte_length: exactBytes.byteLength,
        digest_algorithm: "sha256",
        expected_sha256: request.input.expected_sha256,
        observed_sha256: observedSha256,
        matched: true,
      },
      chronology: {
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date(completedAt).toISOString(),
      },
      safety: {
        shell_executed: false,
        network_accessed: false,
        workload_storage_written: false,
        control_evidence_storage_written: true,
        authority_escalated: false,
        autonomous_dispatch: false,
      },
      immutable: true,
    }
    const evidence = deepFreeze({
      ...evidenceBody,
      evidence_sha256: sha256Object(evidenceBody),
    })
    const persisted = object(await options.persistResult(evidence), "persistence result")
    if (persisted.persisted !== true || persisted.evidence_sha256 !== evidence.evidence_sha256) {
      fail("EVIDENCE_PERSISTENCE_FAILED", "immutable completion evidence was not durably acknowledged")
    }
    completion = {
      status: "COMPLETED",
      admission_id: candidateAdmission.admission_id,
      evidence,
      lease_released: false,
    }
    terminalPersisted = true
  } catch (error) {
    failure = error
    if (claimAcquired) try {
      const failedAt = finiteClock(options.now)
      const chronologyFloor = Math.max(
        admittedAt,
        claimedAt === null ? admittedAt : Date.parse(claimedAt),
        acquiredLease ? Date.parse(acquiredLease.acquired_at) : admittedAt,
        startedAt === null ? admittedAt : startedAt,
      )
      if (!Number.isFinite(chronologyFloor) || failedAt < chronologyFloor) {
        fail("FAILURE_CHRONOLOGY_INVALID", "failure evidence chronology is not monotonic")
      }
      const failureBody = {
      schema_version: "1.0-aegis-standing-hash-completion",
      status: "FAILED_CLOSED",
      result: typeof error?.code === "string" ? error.code : "HASH_EXECUTION_FAILED",
      authority_id: authority.authority_id,
      authority_sha256: candidateAdmission.authority_sha256,
      job_id: request.job_id,
      outcome_id: request.outcome.outcome_id,
      work_order_id: request.work_order_id,
      source: structuredClone(request.source),
      workload: structuredClone(request.workload),
      admission: { admission_id: candidateAdmission.admission_id, admission_sha256: admissionSha256 },
      claim: { claim_id: request.claim.claim_id, claimed_at: claimedAt },
      lease: acquiredLease ? {
        lease_id: acquiredLease.lease_id,
        fencing_token: acquiredLease.fencing_token,
      } : null,
      request_binding_sha256: requestBindingSha256,
      operation: verification ? {
        kind: "HASH_VERIFY",
        relative_path: request.input.relative_path,
        byte_length: verification.byte_length,
        digest_algorithm: "sha256",
        expected_sha256: request.input.expected_sha256,
        observed_sha256: verification.observed_sha256,
        matched: verification.matched,
      } : null,
      chronology: {
        started_at: startedAt === null ? null : new Date(startedAt).toISOString(),
        failed_at: new Date(failedAt).toISOString(),
      },
      safety: {
        shell_executed: false,
        network_accessed: false,
        workload_storage_written: false,
        control_evidence_storage_written: true,
        authority_escalated: false,
        autonomous_dispatch: false,
      },
      immutable: true,
    }
      const failureEvidence = deepFreeze({
        ...failureBody,
        evidence_sha256: sha256Object(failureBody),
      })
      const persisted = object(await (acquiredLease
        ? options.persistResult(failureEvidence)
        : options.persistClaimFailure(failureEvidence)), "failure persistence result")
      if (persisted.persisted !== true || persisted.evidence_sha256 !== failureEvidence.evidence_sha256) {
        fail("EVIDENCE_PERSISTENCE_FAILED", "immutable failure evidence was not durably acknowledged")
      }
      terminalPersisted = true
    } catch (persistenceError) {
      failure.persistence_error = persistenceError
    }
  } finally {
    if (acquiredLease && terminalPersisted) {
      try {
        await releaseAcquiredLease(options.releaseLease, acquiredLease, failure)
        if (completion) completion.lease_released = true
      } catch (error) {
        failure = error
      }
    }
  }

  if (failure) throw failure
  return completion
}
