import crypto from "node:crypto"

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,255}$/
const SAFE_RELATIVE_PATH = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
const WORK_ORDER = /^WO-[A-Z0-9][A-Z0-9-]{2,127}$/
const UNSAFE_KEY = /(?:^|[_-])(?:command|commands|cmd|shell|script|argv|args|executable|exec|spawn|cwd|stdin|environment|env|endpoint|credential|credentials|password|passwd|private[_-]?key|secret|secrets|token|tokens|api[_-]?key|connection[_-]?string|authorization)(?:$|[_-])/i
const SECRET_LIKE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,})/i
const HASH_MAX_INPUT_BYTES = 1048576

const EXPECTED_AUTHORITY = {
  $schema: "./aegis-standing-compute-authority.schema.v1.json",
  schema_version: "1.0",
  authority_id: "aegis-standing-compute-authority-v1",
  authority_reference: "github-issue-586",
  authority_status: "ACTIVE",
  repository: "bsvalues/terragroq",
  allowed_risk_classes: ["R0", "R1"],
  outcome_eligibility: { origin: "WILLIAMOS_NATIVE", approval_status: "ALREADY_APPROVED", dependency_status: "CLEARED" },
  node_identity: {
    node_id: "aegis",
    hostname: "aegis",
    machine_id_sha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b",
    execution_account: "williamos-fabric",
    privilege: "non-root-no-sudo",
  },
  resource_limits: {
    maximum_concurrency: 1,
    maximum_cpu_threads: 12,
    maximum_memory_bytes: 8589934592,
    maximum_runtime_ms: 1800000,
    maximum_output_bytes: 536870912,
    maximum_scratch_write_bytes: 5368709120,
    minimum_free_bytes_after_requested_writes: 107374182400,
  },
  execution_boundary: {
    network_scope: "none",
    durable_storage_allowed: false,
    control_evidence_storage_required: true,
    nas_allowed: false,
    backup_allowed: false,
    archive_authority_allowed: false,
    destructive_disk_allowed: false,
    sudo_allowed: false,
    privilege_escalation_allowed: false,
    scheduler_state: "disabled",
    scheduler_authority: "not-granted",
    autonomous_selection: false,
  },
  evidence_policy: {
    maximum_age_ms: 300000,
    maximum_admission_age_ms: 86400000,
    placement_required: true,
    capability_required: true,
    exact_source_commit_required: true,
    reviewed_adapter_template_profile_digests_required: true,
    one_time_job_claim_required: true,
    lease_and_fencing_required: true,
  },
  standing_integration: {
    integration_id: "aegis-hash-verify-standing-integration-v1",
    operation_core_sha256: "c5965a206b5f26c0db21176a609775d1ca176409b644bbc241fde74565bd8d8f",
    runtime_sha256: "77266f3cf7302b7c7d3acf9ebb2b28df0c7f84ef69edaa0070172a7c18547e45",
    resident_runner_sha256: "f749041dd36a38d295d82c952c68039b1b6ac0aea2b2f1dd6e9ba7a5c58001c2",
    standing_contract_sha256: "0ad6aa6ef3a5e10a19de1417bf82edcf9a7f4b9c12e3c736fa6150b99d4e7163",
    trusted_release_manifest_required: true,
    status: "ACTIVE",
  },
  workload_adapters: [
    { workload_class: "CI_BUILD_TEST", template_id: "aegis.ci-build-test.v1", adapter_id: null, profile_id: "williamos.standard-validation.v1", adapter_sha256: null, template_sha256: null, profile_sha256: null, status: "ADAPTER_BLOCKED" },
    { workload_class: "HASH_VERIFY", template_id: "aegis.hash-verify.v1", adapter_id: "resident-aegis-hash-verify-v1", profile_id: "resident-aegis-bounded-hash-verify-v1", adapter_sha256: "b0c625b92414bbab62fb3d7356b2e04a179377d8076590fe1c521335eb2a30c9", template_sha256: "7217d0486fb67e17d27b7854bb8f44d0ba7d063bddde7d45282c091306d8d58b", profile_sha256: "ff8587a3e05eeb0aa7abaa80ed882b0f43010ad2fd119e71f0b58e353dfd2989", status: "ACTIVE" },
    { workload_class: "COMPRESSION", template_id: "aegis.compression.v1", adapter_id: null, profile_id: "tar-zstd.deterministic.v1", adapter_sha256: null, template_sha256: null, profile_sha256: null, status: "ADAPTER_BLOCKED" },
  ],
}

class AdmissionFailure extends Error {
  constructor(code, detail) {
    super(detail)
    this.name = "AdmissionFailure"
    this.code = code
  }
}

const fail = (code, detail) => { throw new AdmissionFailure(code, detail) }

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

const sha256 = (value) => crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex")

function requestBinding(request) {
  return {
    schema_version: request.schema_version,
    job_id: request.job_id,
    outcome: request.outcome,
    work_order_id: request.work_order_id,
    source: request.source,
    workload: request.workload,
    execution_identity: request.execution_identity,
    reviewed_binding: request.reviewed_binding,
    input: request.input,
    placement_evidence: request.placement_evidence,
    capability_evidence: request.capability_evidence,
    limits: request.limits,
    boundary: request.boundary,
    lease: request.lease,
    claim: { claim_id: request.claim?.claim_id },
  }
}

function jobScope(request) {
  return {
    schema_version: request.schema_version,
    job_id: request.job_id,
    outcome: request.outcome,
    work_order_id: request.work_order_id,
    source: request.source,
    workload: request.workload,
    execution_identity: request.execution_identity,
    reviewed_binding: request.reviewed_binding,
    input: request.input,
    limits: request.limits,
    boundary: request.boundary,
  }
}

export function aegisStandingJobScope(request) {
  return structuredClone(jobScope(request))
}

export function aegisStandingRequestBindingSha256(request) {
  return sha256(requestBinding(request))
}

export function aegisStandingJobScopeSha256(request) {
  return sha256(jobScope(request))
}

export function aegisStandingAuthoritySha256(authority) {
  return sha256(authority)
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_SHAPE", `${label} must be an object`)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail("INVALID_SHAPE", `${label} fields do not match the contract`)
}

function scanSafety(value, label = "request") {
  if (Array.isArray(value)) return value.forEach((entry, index) => scanSafety(entry, `${label}[${index}]`))
  if (typeof value === "string") {
    if (SECRET_LIKE.test(value)) fail("SECRET_LIKE_VALUE", `${label} contains secret-like material`)
    if (/[^\x20-\x7e]/.test(value)) fail("UNSAFE_VALUE", `${label} must contain printable ASCII only`)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (key !== "fencing_token" && UNSAFE_KEY.test(key)) fail("UNSAFE_FIELD", `${label}.${key} is not permitted`)
    scanSafety(child, `${label}.${key}`)
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("INVALID_IDENTIFIER", `${label} must be a safe identifier`)
  return value
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("INVALID_DIGEST", `${label} must be lowercase SHA-256 hex`)
  return value
}

function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("INVALID_TIMESTAMP", `${label} must be a millisecond UTC timestamp`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail("INVALID_TIMESTAMP", `${label} must name a real UTC instant`)
  return parsed
}

function same(actual, expected, code, detail) {
  if (actual !== expected) fail(code, detail)
}

function validateEvidence(evidence, label, request, authority, nowMs, capability = false) {
  const keys = ["evidence_id", "node_id", "machine_id_sha256", "observed_at", "expires_at", "evidence_sha256"]
  if (capability) keys.push("available_cpu_threads", "available_memory_bytes", "free_scratch_bytes")
  exact(evidence, keys, label)
  identifier(evidence.evidence_id, `${label}.evidence_id`)
  digest(evidence.evidence_sha256, `${label}.evidence_sha256`)
  const { evidence_sha256: retainedDigest, ...evidenceBody } = evidence
  same(retainedDigest, sha256(evidenceBody), "EVIDENCE_DIGEST_MISMATCH", `${label} digest does not bind its exact claims`)
  same(evidence.node_id, authority.node_identity.node_id, "NODE_MISMATCH", `${label} names the wrong node`)
  same(evidence.machine_id_sha256, authority.node_identity.machine_id_sha256, "IDENTITY_MISMATCH", `${label} names the wrong machine identity`)
  const observedAt = timestamp(evidence.observed_at, `${label}.observed_at`)
  const expiresAt = timestamp(evidence.expires_at, `${label}.expires_at`)
  if (observedAt > nowMs || expiresAt <= nowMs || nowMs - observedAt > authority.evidence_policy.maximum_age_ms) {
    fail("EVIDENCE_STALE", `${label} is stale, future-dated, or expired`)
  }
  if (capability) {
    for (const field of ["available_cpu_threads", "available_memory_bytes", "free_scratch_bytes"]) {
      if (!Number.isSafeInteger(evidence[field]) || evidence[field] < 0) fail("CAPABILITY_INVALID", `${label}.${field} must be a non-negative safe integer`)
    }
    if (evidence.available_cpu_threads < request.limits.cpu_threads || evidence.available_memory_bytes < request.limits.memory_bytes) {
      fail("CAPABILITY_INSUFFICIENT", "fresh capability evidence does not cover requested CPU and memory")
    }
    const requiredFree = request.limits.scratch_write_bytes + authority.resource_limits.minimum_free_bytes_after_requested_writes
    if (!Number.isSafeInteger(requiredFree) || evidence.free_scratch_bytes < requiredFree) {
      fail("FREE_RESERVE_INSUFFICIENT", "fresh capability evidence does not preserve the required free reserve")
    }
  }
}

export function validateAegisStandingAuthority(authority) {
  scanSafety(authority, "authority")
  if (canonical(authority) !== canonical(EXPECTED_AUTHORITY)) {
    fail("AUTHORITY_INVALID", "standing authority does not match the reviewed v1 contract")
  }
  return true
}

function validateRequest(request, authority, nowMs) {
  scanSafety(request)
  exact(request, ["schema_version", "job_id", "outcome", "work_order_id", "source", "workload", "execution_identity", "reviewed_binding", "input", "placement_evidence", "capability_evidence", "limits", "boundary", "lease", "claim"], "request")
  same(request.schema_version, "1.0-aegis-standing-admission-request", "INVALID_VERSION", "request schema_version is unsupported")
  identifier(request.job_id, "request.job_id")

  exact(request.outcome, ["outcome_id", "origin", "risk_class", "approval_status", "dependency_status"], "request.outcome")
  identifier(request.outcome.outcome_id, "request.outcome.outcome_id")
  same(request.outcome.origin, authority.outcome_eligibility.origin, "OUTCOME_NOT_NATIVE", "outcome must be WilliamOS-native")
  same(request.outcome.approval_status, authority.outcome_eligibility.approval_status, "OUTCOME_NOT_APPROVED", "outcome must already be approved")
  same(request.outcome.dependency_status, authority.outcome_eligibility.dependency_status, "DEPENDENCIES_NOT_CLEARED", "outcome dependencies must already be cleared")
  if (!authority.allowed_risk_classes.includes(request.outcome.risk_class)) fail("RISK_NOT_AUTHORIZED", "only R0 and R1 outcomes are authorized")
  if (typeof request.work_order_id !== "string" || !WORK_ORDER.test(request.work_order_id)) fail("WORK_ORDER_INVALID", "an exact Work Order ID is required")

  exact(request.source, ["repository", "commit_sha"], "request.source")
  same(request.source.repository, authority.repository, "REPOSITORY_MISMATCH", "source repository is not authorized")
  if (typeof request.source.commit_sha !== "string" || !COMMIT.test(request.source.commit_sha)) fail("SOURCE_COMMIT_INVALID", "exact full lowercase source commit is required")

  exact(request.workload, ["workload_class", "template_id", "adapter_id", "profile_id"], "request.workload")
  const adapter = authority.workload_adapters.find((entry) => entry.workload_class === request.workload.workload_class)
  if (!adapter) fail("WORKLOAD_NOT_AUTHORIZED", "workload class is outside standing authority")
  if (adapter.status !== "ACTIVE") fail("ADAPTER_INACTIVE", "workload is authority-covered but no durable standing-authority adapter is active")
  for (const field of ["template_id", "adapter_id", "profile_id"]) same(request.workload[field], adapter[field], "ADAPTER_MISMATCH", `request workload ${field} does not match active reviewed binding`)

  exact(request.execution_identity, ["node_id", "machine_id_sha256", "execution_account", "privilege"], "request.execution_identity")
  for (const field of ["node_id", "machine_id_sha256", "execution_account", "privilege"]) same(request.execution_identity[field], authority.node_identity[field], "IDENTITY_MISMATCH", `execution identity ${field} does not match`)

  exact(request.reviewed_binding, ["adapter_sha256", "template_sha256", "profile_sha256", "operation_core_sha256", "runtime_sha256", "resident_runner_sha256", "standing_contract_sha256"], "request.reviewed_binding")
  for (const field of ["adapter_sha256", "template_sha256", "profile_sha256"]) {
    digest(request.reviewed_binding[field], `request.reviewed_binding.${field}`)
    same(request.reviewed_binding[field], adapter[field], "REVIEWED_DIGEST_MISMATCH", `${field} does not match the active reviewed binding`)
  }
  for (const field of ["operation_core_sha256", "runtime_sha256", "resident_runner_sha256", "standing_contract_sha256"]) {
    digest(request.reviewed_binding[field], `request.reviewed_binding.${field}`)
    same(request.reviewed_binding[field], authority.standing_integration[field], "REVIEWED_DIGEST_MISMATCH", `${field} does not match the active standing integration`)
  }

  exact(request.input, ["relative_path", "expected_sha256", "expected_byte_length"], "request.input")
  if (typeof request.input.relative_path !== "string" || request.input.relative_path.length > 240 || !SAFE_RELATIVE_PATH.test(request.input.relative_path) || request.input.relative_path.split("/").some((part) => part === "." || part === "..")) {
    fail("INPUT_PATH_INVALID", "input path must be a canonical relative path")
  }
  digest(request.input.expected_sha256, "request.input.expected_sha256")
  if (!Number.isSafeInteger(request.input.expected_byte_length) || request.input.expected_byte_length < 0 || request.input.expected_byte_length > HASH_MAX_INPUT_BYTES) {
    fail("INPUT_LENGTH_INVALID", "input byte length is invalid or exceeds the reviewed hash adapter limit")
  }

  exact(request.limits, ["cpu_threads", "memory_bytes", "runtime_ms", "output_bytes", "scratch_write_bytes"], "request.limits")
  const ceilings = {
    cpu_threads: authority.resource_limits.maximum_cpu_threads,
    memory_bytes: authority.resource_limits.maximum_memory_bytes,
    runtime_ms: authority.resource_limits.maximum_runtime_ms,
    output_bytes: authority.resource_limits.maximum_output_bytes,
    scratch_write_bytes: authority.resource_limits.maximum_scratch_write_bytes,
  }
  for (const [field, ceiling] of Object.entries(ceilings)) {
    if (!Number.isSafeInteger(request.limits[field]) || request.limits[field] < 1 || request.limits[field] > ceiling) fail("LIMIT_EXCEEDED", `${field} exceeds standing authority or is invalid`)
  }

  exact(request.boundary, Object.keys(authority.execution_boundary), "request.boundary")
  for (const [field, expected] of Object.entries(authority.execution_boundary)) same(request.boundary[field], expected, "BOUNDARY_MISMATCH", `${field} does not preserve the standing safety boundary`)

  validateEvidence(request.placement_evidence, "request.placement_evidence", request, authority, nowMs)
  validateEvidence(request.capability_evidence, "request.capability_evidence", request, authority, nowMs, true)

  exact(request.lease, ["lease_id", "fencing_token"], "request.lease")
  identifier(request.lease.lease_id, "request.lease.lease_id")
  if (!Number.isSafeInteger(request.lease.fencing_token) || request.lease.fencing_token < 1) fail("FENCING_INVALID", "a positive integer fencing token is required")
  exact(request.claim, ["claim_id", "admission_sha256"], "request.claim")
  identifier(request.claim.claim_id, "request.claim.claim_id")
  digest(request.claim.admission_sha256, "request.claim.admission_sha256")
}

function validateCandidateAdmission(admission, request, authority, nowMs) {
  scanSafety(admission, "candidate admission")
  exact(admission, [
    "schema_version", "admission_id", "issuer", "authority_id", "authority_sha256", "status", "single_use",
    "consumption_count", "consumed_at", "revoked_at", "job_scope", "job_scope_sha256", "approval_provenance", "issued_at", "expires_at",
  ], "candidate admission")
  same(admission.schema_version, "1.0-aegis-standing-job-admission", "ADMISSION_INVALID", "candidate admission version is unsupported")
  identifier(admission.admission_id, "candidate admission.admission_id")
  same(admission.issuer, "williamos-authority-control-plane", "ADMISSION_UNTRUSTED", "candidate admission issuer is not the expected WilliamOS authority control plane")
  same(admission.authority_id, authority.authority_id, "ADMISSION_AUTHORITY_MISMATCH", "admission does not bind the active standing authority")
  digest(admission.authority_sha256, "candidate admission.authority_sha256")
  same(admission.authority_sha256, aegisStandingAuthoritySha256(authority), "ADMISSION_AUTHORITY_MISMATCH", "admission does not bind the exact active standing authority")
  if (admission.status === "REVOKED" || admission.revoked_at !== null) fail("ADMISSION_REVOKED", "candidate admission has been revoked")
  same(admission.status, "ACTIVE", "ADMISSION_INACTIVE", "candidate admission is not active")
  same(admission.single_use, true, "ADMISSION_NOT_SINGLE_USE", "candidate admission must be single use")
  if (admission.consumption_count !== 0 || admission.consumed_at !== null) fail("ADMISSION_REPLAYED", "candidate admission has already been consumed")
  digest(admission.job_scope_sha256, "candidate admission.job_scope_sha256")
  exact(admission.approval_provenance, ["mode", "authority_reference", "outcome_id", "work_order_id", "dependency_status"], "candidate admission.approval_provenance")
  same(admission.approval_provenance.mode, "REVIEWED_MAIN", "ADMISSION_UNTRUSTED", "admission must be retained on reviewed main")
  same(admission.approval_provenance.authority_reference, authority.authority_reference, "ADMISSION_AUTHORITY_MISMATCH", "admission approval reference does not match standing authority")
  same(admission.approval_provenance.outcome_id, request.outcome.outcome_id, "OUTCOME_BINDING_MISMATCH", "admission does not bind the approved outcome")
  same(admission.approval_provenance.work_order_id, request.work_order_id, "WORK_ORDER_BINDING_MISMATCH", "admission does not bind the approved Work Order")
  same(admission.approval_provenance.dependency_status, authority.outcome_eligibility.dependency_status, "DEPENDENCIES_NOT_CLEARED", "admission does not attest cleared dependencies")
  const issuedAt = timestamp(admission.issued_at, "candidate admission.issued_at")
  const expiresAt = timestamp(admission.expires_at, "candidate admission.expires_at")
  if (issuedAt > nowMs || expiresAt <= nowMs || expiresAt - issuedAt > authority.evidence_policy.maximum_admission_age_ms) {
    fail("ADMISSION_EXPIRED", "trusted admission is future-dated, expired, or exceeds the bounded lifetime")
  }
  const jobScopeSha256 = aegisStandingJobScopeSha256(request)
  same(canonical(admission.job_scope), canonical(jobScope(request)), "JOB_SCOPE_BINDING_MISMATCH", "candidate admission does not retain the complete immutable job scope")
  same(admission.job_scope_sha256, jobScopeSha256, "JOB_SCOPE_BINDING_MISMATCH", "candidate admission does not bind the immutable job scope")
  const requestBindingSha256 = aegisStandingRequestBindingSha256(request)
  const admissionSha256 = sha256(admission)
  same(request.claim.admission_sha256, admissionSha256, "ADMISSION_DIGEST_MISMATCH", "claim does not bind the exact trusted admission")
  return { admissionSha256, requestBindingSha256, jobScopeSha256 }
}

export function evaluateAegisStandingEligibility({ authority, request, candidateAdmission, now = () => Date.now() }) {
  try {
    validateAegisStandingAuthority(authority)
    if (typeof now !== "function") fail("CLOCK_INVALID", "now must be a function")
    const nowMs = now()
    if (!Number.isFinite(nowMs)) fail("CLOCK_INVALID", "clock returned a non-finite value")
    validateRequest(request, authority, nowMs)
    if (!candidateAdmission) fail("ADMISSION_REQUIRED", "a separately verified control-plane admission is required")
    const { admissionSha256, requestBindingSha256, jobScopeSha256 } = validateCandidateAdmission(candidateAdmission, request, authority, nowMs)
    return {
      status: "ADMITTED",
      authority_id: authority.authority_id,
      authority_sha256: candidateAdmission.authority_sha256,
      job_id: request.job_id,
      admission_id: candidateAdmission.admission_id,
      admission_sha256: admissionSha256,
      request_binding_sha256: requestBindingSha256,
      job_scope_sha256: jobScopeSha256,
      execution_authorized: true,
      dispatch_allowed: true,
      scheduler_activated: false,
      autonomous_selection: false,
    }
  } catch (error) {
    if (!(error instanceof AdmissionFailure)) throw error
    return {
      status: "REJECTED",
      code: error.code,
      detail: error.message,
      execution_authorized: false,
      dispatch_allowed: false,
      scheduler_activated: false,
      autonomous_selection: false,
    }
  }
}
