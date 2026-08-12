import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalizeJcs } from "../canonical-json.mjs"

export const EMBEDDING_CONTRACT = Object.freeze({
  workOrderId: "WO-R1B-EXEC-001",
  corpusSourceCommit: "d544f19708e4aa9c7f430c3cc9fde4ff0f5c1b85",
  nodeId: "hermes-node",
  providerId: "resident-hermes",
  endpoint: "http://127.0.0.1:11434/api/embed",
  corpusManifestPath: "scripts/embedding-bakeoff/corpus/manifest.json",
  corpusManifestSha256: "0b0fdf909583990975a771195c7f7a8b6e5e938f01800369b1d6cf9fb5ca7dee",
  corpusId: "williamos-r1b-adversarial-v1",
  corpusFingerprint: "ee6177d86d905ccf3402aa248f1b6a724bcbcc0cf9067aad207f1616c22c0318",
  evaluatorPath: "scripts/embedding-bakeoff/fabric_measure.py",
  bakeoffPath: "scripts/embedding-bakeoff/bakeoff.py",
  embedPath: "scripts/embedding-bakeoff/embed.py",
  metricsPath: "scripts/embedding-bakeoff/metrics.py",
  adapterPath: "scripts/execution-fabric/bounded-dispatch/resident-hermes-embedding-bakeoff.mjs",
  runnerPath: "scripts/execution-fabric/bounded-dispatch/run-resident-hermes-embedding-bakeoff.mjs",
  permissionPath: "config/execution-fabric/agent-forge-embedding-bakeoff-permission.json",
  authorityRegistryPath: "config/execution-fabric/embedding-bakeoff-authority-registry.json",
})

const SHA256 = /^[a-f0-9]{64}$/
const SHA40 = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{1,254}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const PROHIBITED_FIELD = /(?:^|_)(?:url|endpoint|host|hostname|node|machine|command|cmd|shell|script|argv|args|executable|exec|spawn|cwd|environment|env|output|output_path|result_path|credential|password|secret|token|api_key|authorization)(?:$|_)/i
const SECRET_VALUE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b)/i

export class HermesEmbeddingBakeoffError extends Error {
  constructor(code, detail) {
    super(`HERMES_EMBEDDING_BAKEOFF_INVALID: ${code}: ${detail}`)
    this.name = "HermesEmbeddingBakeoffError"
    this.code = code
  }
}

function fail(code, detail) { throw new HermesEmbeddingBakeoffError(code, detail) }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INPUT_INVALID", `${label} must be an object`)
  return value
}
function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) fail("INPUT_INVALID", `${label} fields do not match the contract`)
}
function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("INPUT_INVALID", `${label} must be a safe identifier`)
  return value
}
function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("INPUT_INVALID", `${label} must be lowercase SHA-256`)
  return value
}
function timestamp(value, label) {
  if (typeof value !== "string" || !UTC.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("INPUT_INVALID", `${label} must be a canonical UTC timestamp`)
  }
  return value
}
function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INPUT_INVALID", `${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex") }
function canonicalDigest(value) { return sha256(canonicalizeJcs(value)) }

function admittedSourceClosure(admission) {
  return {
    [EMBEDDING_CONTRACT.evaluatorPath]: admission.runtime.evaluator_sha256,
    [EMBEDDING_CONTRACT.bakeoffPath]: admission.runtime.bakeoff_sha256,
    [EMBEDDING_CONTRACT.embedPath]: admission.runtime.embed_sha256,
    [EMBEDDING_CONTRACT.metricsPath]: admission.runtime.metrics_sha256,
    [EMBEDDING_CONTRACT.adapterPath]: admission.runtime.adapter_sha256,
    [EMBEDDING_CONTRACT.runnerPath]: admission.runtime.runner_sha256,
  }
}

function rejectUnsafe(value, label = "request") {
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectUnsafe(entry, `${label}[${index}]`))
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (PROHIBITED_FIELD.test(key.replace(/-/g, "_"))) fail("CALLER_CONTROLLED_CAPABILITY", `${label}.${key} is prohibited`)
      rejectUnsafe(entry, `${label}.${key}`)
    }
  } else if (typeof value === "string" && SECRET_VALUE.test(value)) {
    fail("SECRET_LIKE_VALUE", `${label} contains secret-like material`)
  }
}

function readConfined(root, relativePath, label) {
  const realRoot = fs.realpathSync(path.resolve(root))
  const lexical = path.resolve(realRoot, relativePath)
  const relative = path.relative(realRoot, lexical)
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("PATH_ESCAPE", `${label} escapes the repository`)
  let real
  try { real = fs.realpathSync(lexical) } catch { fail("REVIEWED_ARTIFACT_MISSING", `${label} is missing`) }
  const realRelative = path.relative(realRoot, real)
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative) || fs.lstatSync(lexical).isSymbolicLink()) {
    fail("PATH_ESCAPE", `${label} is not a regular repository artifact`)
  }
  const bytes = fs.readFileSync(real)
  return { bytes, sha256: sha256(bytes) }
}

function validatePermission(value) {
  exactKeys(value, ["schema_version", "permission_set_id", "agent_identity", "provider_identity", "allowed_actions", "prohibited_actions", "maximum_attempts", "maximum_concurrency", "scheduler_activation_allowed", "autonomous_dispatch_allowed", "fallback_allowed", "external_provider_allowed", "status"], "Forge permission")
  const allowed = ["invoke-fixed-loopback-embedding-endpoint", "invoke-fixed-reviewed-evaluator", "emit-bounded-result-receipt"]
  const prohibited = ["arbitrary-executable", "arbitrary-network-endpoint", "authority-mutation", "autonomous-scheduling", "canonical-vector-write", "database-mutation", "external-provider-access", "model-download", "silent-fallback"]
  if (value.schema_version !== "1.0-agent-forge-embedding-bakeoff-permission"
    || value.permission_set_id !== "resident-hermes-embedding-bakeoff-v1"
    || value.agent_identity !== EMBEDDING_CONTRACT.providerId || value.provider_identity !== EMBEDDING_CONTRACT.providerId
    || JSON.stringify(value.allowed_actions) !== JSON.stringify(allowed)
    || JSON.stringify(value.prohibited_actions) !== JSON.stringify(prohibited)
    || value.maximum_attempts !== 1 || value.maximum_concurrency !== 1
    || value.scheduler_activation_allowed !== false || value.autonomous_dispatch_allowed !== false
    || value.fallback_allowed !== false || value.external_provider_allowed !== false
    || value.status !== "SCOPE_ONLY_NOT_AUTHORITY") fail("FORGE_PERMISSION_MISMATCH", "Forge permission is not the reviewed non-authorizing scope")
}

function validateRequest(request) {
  rejectUnsafe(request)
  exactKeys(request, ["schema_version", "request_id", "admission_sha256"], "request")
  if (request.schema_version !== "1.0-hermes-embedding-bakeoff-request") fail("INPUT_INVALID", "request schema is unsupported")
  identifier(request.request_id, "request.request_id")
  digest(request.admission_sha256, "request.admission_sha256")
}

function validateAdmission(admission) {
  exactKeys(admission, ["schema_version", "admission_id", "work_order_id", "corpus_source_commit", "execution_commit", "corpus", "model", "runtime", "placement", "limits", "permission_set_sha256", "valid_from", "expires_at", "maximum_attempts", "status"], "admission")
  if (admission.schema_version !== "1.0-hermes-embedding-bakeoff-admission" || admission.work_order_id !== EMBEDDING_CONTRACT.workOrderId
    || admission.corpus_source_commit !== EMBEDDING_CONTRACT.corpusSourceCommit
    || !SHA40.test(admission.execution_commit) || admission.maximum_attempts !== 1
    || admission.status !== "ADMITTED_SINGLE_USE") fail("ADMISSION_INVALID", "admission identity, source, attempt, or status is invalid")
  identifier(admission.admission_id, "admission.admission_id")
  exactKeys(admission.corpus, ["manifest_path", "manifest_sha256", "corpus_id", "corpus_fingerprint", "documents", "queries"], "admission.corpus")
  if (admission.corpus.manifest_path !== EMBEDDING_CONTRACT.corpusManifestPath
    || admission.corpus.manifest_sha256 !== EMBEDDING_CONTRACT.corpusManifestSha256
    || admission.corpus.corpus_id !== EMBEDDING_CONTRACT.corpusId
    || admission.corpus.corpus_fingerprint !== EMBEDDING_CONTRACT.corpusFingerprint
    || admission.corpus.documents !== 49 || admission.corpus.queries !== 80) fail("CORPUS_BINDING_MISMATCH", "admission does not bind the frozen corpus")
  exactKeys(admission.model, ["model_id", "revision", "weights_sha256", "license", "source", "manifest_sha256"], "admission.model")
  for (const key of ["model_id", "revision", "license", "source"]) identifier(admission.model[key], `admission.model.${key}`)
  digest(admission.model.weights_sha256, "admission.model.weights_sha256")
  digest(admission.model.manifest_sha256, "admission.model.manifest_sha256")
  exactKeys(admission.runtime, ["runtime_id", "version", "executable_sha256", "evaluator_sha256", "bakeoff_sha256", "embed_sha256", "metrics_sha256", "adapter_sha256", "runner_sha256", "manifest_sha256"], "admission.runtime")
  identifier(admission.runtime.runtime_id, "admission.runtime.runtime_id")
  identifier(admission.runtime.version, "admission.runtime.version")
  for (const key of ["executable_sha256", "evaluator_sha256", "bakeoff_sha256", "embed_sha256", "metrics_sha256", "adapter_sha256", "runner_sha256", "manifest_sha256"]) digest(admission.runtime[key], `admission.runtime.${key}`)
  exactKeys(admission.placement, ["node_id", "inventory_snapshot_sha256", "host_manifest_sha256", "endpoint_contract"], "admission.placement")
  if (admission.placement.node_id !== EMBEDDING_CONTRACT.nodeId || admission.placement.endpoint_contract !== "ollama-loopback-api-embed-v1") {
    fail("PLACEMENT_BINDING_MISMATCH", "admission is not for the fixed resident HERMES endpoint contract")
  }
  digest(admission.placement.inventory_snapshot_sha256, "admission.placement.inventory_snapshot_sha256")
  digest(admission.placement.host_manifest_sha256, "admission.placement.host_manifest_sha256")
  exactKeys(admission.limits, ["timeout_ms", "max_input_bytes", "max_scratch_bytes", "max_result_bytes", "network_scope"], "admission.limits")
  integer(admission.limits.timeout_ms, "admission.limits.timeout_ms", 1000, 3_600_000)
  for (const key of ["max_input_bytes", "max_scratch_bytes", "max_result_bytes"]) integer(admission.limits[key], `admission.limits.${key}`, 1, Number.MAX_SAFE_INTEGER)
  const maximumRetainedBytes = admission.limits.max_input_bytes + admission.limits.max_result_bytes
  if (!Number.isSafeInteger(maximumRetainedBytes) || admission.limits.max_scratch_bytes < maximumRetainedBytes) {
    fail("SCRATCH_CEILING_INVALID", "scratch ceiling must cover the sealed input and bounded result")
  }
  if (admission.limits.network_scope !== "loopback-only") fail("NETWORK_SCOPE_INVALID", "only loopback networking is admitted")
  digest(admission.permission_set_sha256, "admission.permission_set_sha256")
  timestamp(admission.valid_from, "admission.valid_from")
  timestamp(admission.expires_at, "admission.expires_at")
  if (Date.parse(admission.valid_from) >= Date.parse(admission.expires_at)) fail("ADMISSION_INVALID", "admission window is invalid")
}

function validateHostAttestation(value, admission, observedAt) {
  exactKeys(value, ["schema_version", "collector_id", "node_id", "machine_id_sha256", "inventory_snapshot_sha256", "host_manifest_sha256", "model_id", "weights_sha256", "runtime_id", "runtime_version", "runtime_executable_sha256", "endpoint", "observed_at", "expires_at", "attestation_sha256", "verified"], "host attestation")
  if (value.schema_version !== "1.0-trusted-hermes-embedding-host-attestation" || value.collector_id !== "trusted-resident-hermes-collector"
    || value.node_id !== EMBEDDING_CONTRACT.nodeId || value.inventory_snapshot_sha256 !== admission.placement.inventory_snapshot_sha256
    || value.host_manifest_sha256 !== admission.placement.host_manifest_sha256 || value.model_id !== admission.model.model_id
    || value.weights_sha256 !== admission.model.weights_sha256 || value.runtime_id !== admission.runtime.runtime_id
    || value.runtime_version !== admission.runtime.version || value.runtime_executable_sha256 !== admission.runtime.executable_sha256
    || value.endpoint !== EMBEDDING_CONTRACT.endpoint || value.verified !== true) fail("HOST_ATTESTATION_MISMATCH", "trusted host attestation does not match the exact admission")
  digest(value.machine_id_sha256, "host attestation.machine_id_sha256")
  digest(value.attestation_sha256, "host attestation.attestation_sha256")
  timestamp(value.observed_at, "host attestation.observed_at")
  timestamp(value.expires_at, "host attestation.expires_at")
  const body = structuredClone(value); delete body.attestation_sha256
  if (value.attestation_sha256 !== canonicalDigest(body) || Date.parse(value.observed_at) > Date.parse(observedAt)
    || Date.parse(value.expires_at) <= Date.parse(observedAt)) fail("HOST_ATTESTATION_INVALID", "host attestation digest or freshness is invalid")
}

function prepareOrThrow({ repositoryRoot, request, admission, evaluatedAt, proveTrustedAdmission }) {
  validateRequest(request); validateAdmission(admission); timestamp(evaluatedAt, "evaluatedAt")
  const admissionSha256 = canonicalDigest(admission)
  if (request.admission_sha256 !== admissionSha256) fail("ADMISSION_BINDING_MISMATCH", "request does not bind the exact admission")
  if (Date.parse(admission.valid_from) > Date.parse(evaluatedAt) || Date.parse(admission.expires_at) <= Date.parse(evaluatedAt)) fail("ADMISSION_INACTIVE", "admission is not active")
  const corpus = readConfined(repositoryRoot, EMBEDDING_CONTRACT.corpusManifestPath, "frozen corpus manifest")
  if (corpus.sha256 !== EMBEDDING_CONTRACT.corpusManifestSha256) fail("CORPUS_BINDING_MISMATCH", "frozen corpus manifest bytes changed")
  const evaluator = readConfined(repositoryRoot, EMBEDDING_CONTRACT.evaluatorPath, "reviewed evaluator")
  if (evaluator.sha256 !== admission.runtime.evaluator_sha256) fail("EVALUATOR_BINDING_MISMATCH", "reviewed evaluator bytes do not match admission")
  const bakeoff = readConfined(repositoryRoot, EMBEDDING_CONTRACT.bakeoffPath, "reviewed bake-off module")
  if (bakeoff.sha256 !== admission.runtime.bakeoff_sha256) fail("SOURCE_CLOSURE_MISMATCH", "reviewed bake-off module bytes do not match admission")
  const embed = readConfined(repositoryRoot, EMBEDDING_CONTRACT.embedPath, "reviewed embedding module")
  if (embed.sha256 !== admission.runtime.embed_sha256) fail("SOURCE_CLOSURE_MISMATCH", "reviewed embedding module bytes do not match admission")
  const metrics = readConfined(repositoryRoot, EMBEDDING_CONTRACT.metricsPath, "reviewed metrics module")
  if (metrics.sha256 !== admission.runtime.metrics_sha256) fail("SOURCE_CLOSURE_MISMATCH", "reviewed metrics module bytes do not match admission")
  const adapter = readConfined(repositoryRoot, EMBEDDING_CONTRACT.adapterPath, "reviewed adapter")
  if (adapter.sha256 !== admission.runtime.adapter_sha256) fail("ADAPTER_BINDING_MISMATCH", "reviewed adapter bytes do not match admission")
  const runner = readConfined(repositoryRoot, EMBEDDING_CONTRACT.runnerPath, "reviewed runner")
  if (runner.sha256 !== admission.runtime.runner_sha256) fail("RUNNER_BINDING_MISMATCH", "reviewed runner bytes do not match admission")
  const permission = readConfined(repositoryRoot, EMBEDDING_CONTRACT.permissionPath, "embedding Forge permission")
  let permissionValue
  try { permissionValue = JSON.parse(permission.bytes.toString("utf8")) } catch { fail("FORGE_PERMISSION_MISMATCH", "Forge permission is not JSON") }
  validatePermission(permissionValue)
  if (permission.sha256 !== admission.permission_set_sha256) fail("FORGE_PERMISSION_MISMATCH", "admission does not bind the exact Forge permission bytes")
  if (typeof proveTrustedAdmission !== "function") fail("ADMISSION_UNPROVEN", "trusted admission proof is required")
  const proof = proveTrustedAdmission({ admission: structuredClone(admission), admissionSha256, evaluatedAt })
  exactKeys(proof, ["schema_version", "admission_sha256", "execution_commit", "inventory_snapshot_sha256", "source_closure_sha256", "exact_entry_count", "verified"], "trusted admission proof")
  if (proof.schema_version !== "1.0-trusted-hermes-embedding-admission-proof" || proof.admission_sha256 !== admissionSha256
    || proof.execution_commit !== admission.execution_commit || proof.inventory_snapshot_sha256 !== admission.placement.inventory_snapshot_sha256
    || proof.source_closure_sha256 !== canonicalDigest(admittedSourceClosure(admission))
    || proof.exact_entry_count !== 1 || proof.verified !== true) fail("ADMISSION_UNPROVEN", "trusted admission proof is invalid")
  const preparation = {
    schema_version: "1.0-hermes-embedding-bakeoff-preparation", status: "READY_FOR_SINGLE_USE_CLAIM",
    request_id: request.request_id, work_order_id: EMBEDDING_CONTRACT.workOrderId, admission_id: admission.admission_id,
    request_sha256: canonicalDigest(request), admission_sha256: admissionSha256,
    corpus_source_commit: admission.corpus_source_commit, execution_commit: admission.execution_commit,
    corpus_manifest_sha256: corpus.sha256, evaluator_sha256: evaluator.sha256,
    bakeoff_sha256: bakeoff.sha256, embed_sha256: embed.sha256, metrics_sha256: metrics.sha256,
    adapter_sha256: adapter.sha256, runner_sha256: runner.sha256, permission_set_sha256: permission.sha256,
    node_id: EMBEDDING_CONTRACT.nodeId, endpoint_contract: admission.placement.endpoint_contract,
    model_id: admission.model.model_id, runtime_id: admission.runtime.runtime_id, prepared_at: evaluatedAt,
    valid_until: admission.expires_at, maximum_attempts: 1, maximum_concurrency: 1,
    execution_authorized: true, dispatch_allowed: false, scheduler_activated: false, autonomous_dispatch: false,
    fallback_allowed: false, external_provider_allowed: false,
  }
  preparation.preparation_sha256 = canonicalDigest(preparation)
  return { preparation, admission: structuredClone(admission) }
}

export function prepareResidentHermesEmbeddingBakeoff(input) {
  try { return prepareOrThrow(input).preparation } catch (error) {
    if (!(error instanceof HermesEmbeddingBakeoffError)) throw error
    return { schema_version: "1.0-hermes-embedding-bakeoff-preparation", status: "BLOCKED", reasons: [{ code: error.code, detail: error.message.split(": ").slice(2).join(": ") }], execution_authorized: false, dispatch_allowed: false, scheduler_activated: false, autonomous_dispatch: false, fallback_allowed: false, external_provider_allowed: false }
  }
}

function annotate(error, state) {
  const value = error instanceof Error ? error : new Error(String(error))
  Object.assign(value, state)
  return value
}

export async function executeResidentHermesEmbeddingBakeoff(options) {
  const required = ["clock", "proveTrustedAdmission", "claimSingleUse", "acquireExclusiveLease", "releaseExclusiveLease", "collectTrustedHostAttestation", "invokeFixedEvaluator"]
  for (const name of required) if (typeof options[name] !== "function") fail("RUNTIME_DEPENDENCY_MISSING", `${name} is required`)
  const preparedAt = timestamp(options.clock(), "trusted preparation clock")
  const prepared = prepareOrThrow({ ...options, evaluatedAt: preparedAt })
  const claim = await options.claimSingleUse({ request_id: options.request.request_id, request_sha256: prepared.preparation.request_sha256, admission_sha256: prepared.preparation.admission_sha256, maximum_attempts: 1 })
  exactKeys(claim, ["claimed", "claim_id", "claimed_at"], "single-use claim")
  if (claim.claimed !== true) fail("REQUEST_ALREADY_CONSUMED", "single-use claim was not acquired")
  identifier(claim.claim_id, "claim.claim_id"); timestamp(claim.claimed_at, "claim.claimed_at")
  const requestedLease = { claim_id: claim.claim_id, request_sha256: prepared.preparation.request_sha256, admission_sha256: prepared.preparation.admission_sha256, node_id: EMBEDDING_CONTRACT.nodeId, fencing_token: 1 }
  const lease = await options.acquireExclusiveLease(requestedLease)
  exactKeys(lease, ["acquired", "lease_id", "fencing_token", "acquired_at"], "exclusive lease")
  if (lease.acquired !== true) fail("CONCURRENCY_LIMIT_REACHED", "resident HERMES embedding lease is occupied")
  identifier(lease.lease_id, "lease.lease_id"); integer(lease.fencing_token, "lease.fencing_token", 1, Number.MAX_SAFE_INTEGER); timestamp(lease.acquired_at, "lease.acquired_at")
  if (lease.fencing_token !== requestedLease.fencing_token) {
    try { await options.releaseExclusiveLease({ lease_id: lease.lease_id, claim_id: claim.claim_id, fencing_token: lease.fencing_token }) } catch {}
    fail("LEASE_FENCE_MISMATCH", "lease fencing token does not match the single admitted attempt")
  }
  let dispatchAttempted = false; let released = false; let executionError = null; let result
  try {
    const startedAt = timestamp(options.clock(), "trusted start clock")
    if (Date.parse(claim.claimed_at) < Date.parse(preparedAt) || Date.parse(claim.claimed_at) > Date.parse(lease.acquired_at) || Date.parse(lease.acquired_at) > Date.parse(startedAt)) fail("CLAIM_LEASE_CHRONOLOGY_INVALID", "claim and lease chronology is not monotonic")
    const rechecked = prepareOrThrow({ ...options, evaluatedAt: startedAt })
    if (rechecked.preparation.preparation_sha256 === prepared.preparation.preparation_sha256 || rechecked.preparation.request_sha256 !== prepared.preparation.request_sha256 || rechecked.preparation.admission_sha256 !== prepared.preparation.admission_sha256) {
      // preparation time must advance while every executable binding remains exact.
      if (startedAt === preparedAt || rechecked.preparation.request_sha256 !== prepared.preparation.request_sha256 || rechecked.preparation.admission_sha256 !== prepared.preparation.admission_sha256) fail("PREPARATION_RECHECK_INVALID", "executable bindings changed or time did not advance")
    }
    const hostAttestation = await options.collectTrustedHostAttestation({ admission: structuredClone(prepared.admission), observed_at: startedAt })
    validateHostAttestation(hostAttestation, prepared.admission, startedAt)
    dispatchAttempted = true
    const output = await options.invokeFixedEvaluator({ admission: structuredClone(prepared.admission), host_attestation: structuredClone(hostAttestation), endpoint: EMBEDDING_CONTRACT.endpoint, evaluator_path: EMBEDDING_CONTRACT.evaluatorPath })
    exactKeys(output, ["result_bytes", "result_sha256", "model_manifest_sha256", "runtime_manifest_sha256", "host_manifest_sha256", "corpus_fingerprint", "model_id", "runtime_id", "node_id", "endpoint", "external_provider_used", "fallback_used"], "evaluator result")
    if (!(output.result_bytes instanceof Uint8Array)) fail("RESULT_INVALID", "evaluator result_bytes must be bytes")
    if (output.result_bytes.byteLength < 1 || output.result_bytes.byteLength > prepared.admission.limits.max_result_bytes || output.result_sha256 !== sha256(output.result_bytes)
      || output.model_manifest_sha256 !== prepared.admission.model.manifest_sha256 || output.runtime_manifest_sha256 !== prepared.admission.runtime.manifest_sha256
      || output.host_manifest_sha256 !== prepared.admission.placement.host_manifest_sha256 || output.corpus_fingerprint !== EMBEDDING_CONTRACT.corpusFingerprint
      || output.model_id !== prepared.admission.model.model_id || output.runtime_id !== prepared.admission.runtime.runtime_id
      || output.node_id !== EMBEDDING_CONTRACT.nodeId || output.endpoint !== EMBEDDING_CONTRACT.endpoint) fail("RESULT_BINDING_MISMATCH", "evaluator result does not match exact admitted model/runtime/host/corpus bindings")
    if (output.external_provider_used !== false || output.fallback_used !== false) fail("FORBIDDEN_SIDE_EFFECT", "evaluator reported fallback or external-provider activity")
    const completedAt = timestamp(options.clock(), "trusted completion clock")
    if (Date.parse(completedAt) < Date.parse(startedAt) || Date.parse(completedAt) >= Date.parse(prepared.admission.expires_at) || Date.parse(completedAt) - Date.parse(startedAt) > prepared.admission.limits.timeout_ms) fail("COMPLETION_CHRONOLOGY_INVALID", "completion exceeds chronology, admission, or timeout")
    result = { schema_version: "1.0-hermes-embedding-bakeoff-result", status: "COMPLETED", result: "SUCCEEDED", request_id: options.request.request_id, work_order_id: EMBEDDING_CONTRACT.workOrderId, admission_id: prepared.admission.admission_id, request_sha256: prepared.preparation.request_sha256, admission_sha256: prepared.preparation.admission_sha256, corpus_source_commit: EMBEDDING_CONTRACT.corpusSourceCommit, execution_commit: prepared.admission.execution_commit, corpus_manifest_sha256: EMBEDDING_CONTRACT.corpusManifestSha256, corpus_fingerprint: EMBEDDING_CONTRACT.corpusFingerprint, model: structuredClone(prepared.admission.model), runtime: structuredClone(prepared.admission.runtime), host_attestation: structuredClone(hostAttestation), result_bundle: { sha256: output.result_sha256, byte_length: output.result_bytes.byteLength }, claim: { claim_id: claim.claim_id, claimed_at: claim.claimed_at, maximum_attempts: 1 }, lease: { lease_id: lease.lease_id, fencing_token: lease.fencing_token, acquired_at: lease.acquired_at }, chronology: { prepared_at: preparedAt, started_at: startedAt, completed_at: completedAt }, endpoint_contract: prepared.admission.placement.endpoint_contract, authority_scope: { canonical_vector_write_authorized: false, database_mutation_authorized: false }, scheduler_activated: false, autonomous_dispatch: false, external_provider_used: false, fallback_used: false, lease_released: false }
  } catch (error) { executionError = annotate(error, { dispatchAttempted, claimId: claim.claim_id, leaseId: lease.lease_id, fencingToken: lease.fencing_token, leaseReleased: false }); throw executionError } finally {
    try { const release = await options.releaseExclusiveLease({ lease_id: lease.lease_id, claim_id: claim.claim_id, fencing_token: lease.fencing_token }); released = release === true } catch { released = false }
    if (executionError) executionError.leaseReleased = released
  }
  if (!released) throw annotate(new HermesEmbeddingBakeoffError("LEASE_RELEASE_FAILED", "exclusive lease release was not confirmed"), { dispatchAttempted, claimId: claim.claim_id, leaseId: lease.lease_id, fencingToken: lease.fencing_token, leaseReleased: false })
  result.lease_released = true
  result.attestation_sha256 = canonicalDigest(result)
  return result
}
