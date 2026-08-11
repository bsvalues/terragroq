import crypto from "node:crypto"

import {
  aegisStandingJobScope,
  aegisStandingRequestBindingSha256,
  aegisStandingJobScopeSha256,
  aegisStandingAuthoritySha256,
  evaluateAegisStandingEligibility,
  validateAegisStandingAuthority,
} from "./evaluate-aegis-standing-authority.mjs"

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,255}$/
const ISSUER_FIELDS = ["authority", "request", "admission_id", "issued_at", "expires_at"]

export class AegisStandingAdmissionIssuerError extends Error {
  constructor(code, detail) {
    super(detail)
    this.name = "AegisStandingAdmissionIssuerError"
    this.code = code
  }
}

const fail = (code, detail) => { throw new AegisStandingAdmissionIssuerError(code, detail) }

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ISSUER_INPUT_INVALID", `${label} must be an object`)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail("ISSUER_INPUT_INVALID", `${label} fields do not match the contract`)
}

function clone(value, label) {
  try {
    return structuredClone(value)
  } catch {
    fail("ISSUER_INPUT_INVALID", `${label} must be cloneable structured data`)
  }
}

function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("INVALID_TIMESTAMP", `${label} must be a millisecond UTC timestamp`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail("INVALID_TIMESTAMP", `${label} must name a real UTC instant`)
  return parsed
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

const sha256 = (value) => crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex")

function bindAdmissionDigest(request, admissionSha256) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return request
  if (!request.claim || typeof request.claim !== "object" || Array.isArray(request.claim)) return request
  request.claim.admission_sha256 = admissionSha256
  return request
}

function requireExactAuthorization(evaluation, authority, request, admission, admissionSha256, requestBindingSha256, jobScopeSha256) {
  if (
    evaluation.status !== "ADMITTED"
    || evaluation.execution_authorized !== true
    || evaluation.dispatch_allowed !== true
    || evaluation.scheduler_activated !== false
    || evaluation.autonomous_selection !== false
    || evaluation.authority_id !== authority.authority_id
    || evaluation.authority_sha256 !== admission.authority_sha256
    || evaluation.job_id !== request.job_id
    || evaluation.admission_id !== admission.admission_id
    || evaluation.admission_sha256 !== admissionSha256
    || evaluation.request_binding_sha256 !== requestBindingSha256
    || evaluation.job_scope_sha256 !== jobScopeSha256
  ) {
    fail(evaluation.code || "ISSUANCE_NOT_AUTHORIZED", evaluation.detail || "standing evaluator did not authorize the exact HASH admission binding")
  }
}

export function issueAegisStandingHashAdmission(input) {
  exact(input, ISSUER_FIELDS, "issuer input")

  const authority = clone(input.authority, "authority")
  const request = clone(input.request, "request")
  validateAegisStandingAuthority(authority)

  if (typeof input.admission_id !== "string" || !SAFE_ID.test(input.admission_id)) {
    fail("INVALID_IDENTIFIER", "admission_id must be a safe identifier")
  }
  const issuedAtMs = timestamp(input.issued_at, "issued_at")
  const expiresAtMs = timestamp(input.expires_at, "expires_at")
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > authority.evidence_policy.maximum_admission_age_ms) {
    fail("ADMISSION_LIFETIME_INVALID", "admission lifetime must be positive and no longer than the authority maximum")
  }

  const requestBindingSha256 = aegisStandingRequestBindingSha256(request)
  const jobScopeSha256 = aegisStandingJobScopeSha256(request)
  const admission = {
    schema_version: "1.0-aegis-standing-job-admission",
    admission_id: input.admission_id,
    issuer: "williamos-authority-control-plane",
    authority_id: authority.authority_id,
    authority_sha256: aegisStandingAuthoritySha256(authority),
    status: "ACTIVE",
    single_use: true,
    consumption_count: 0,
    consumed_at: null,
    revoked_at: null,
    job_scope: aegisStandingJobScope(request),
    job_scope_sha256: jobScopeSha256,
    approval_provenance: {
      mode: "REVIEWED_MAIN",
      authority_reference: authority.authority_reference,
      outcome_id: request.outcome.outcome_id,
      work_order_id: request.work_order_id,
      dependency_status: request.outcome.dependency_status,
    },
    issued_at: input.issued_at,
    expires_at: input.expires_at,
  }
  const admissionSha256 = sha256(admission)
  bindAdmissionDigest(request, admissionSha256)

  const evaluation = evaluateAegisStandingEligibility({
    authority,
    request,
    candidateAdmission: admission,
    now: () => issuedAtMs,
  })
  requireExactAuthorization(evaluation, authority, request, admission, admissionSha256, requestBindingSha256, jobScopeSha256)

  return { admission, request, evaluation }
}
