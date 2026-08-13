import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalizeJcs } from "../canonical-json.mjs"

export const GRANITE_R2_CONTRACT = Object.freeze({
  schemaVersion: "1.0-hermes-granite-r2-bakeoff",
  workOrderId: "WO-R1B-EXEC-001",
  corpusSourceCommit: "d544f19708e4aa9c7f430c3cc9fde4ff0f5c1b85",
  nodeId: "hermes-node",
  providerId: "HERMES",
  agentId: "resident-hermes-granite-r2",
  modelId: "ibm-granite/granite-embedding-311m-multilingual-r2",
  revision: "44399559930365213510b1ee2eb15ded83374f0e",
  dimension: 768,
  backend: "local-python-onnx-cls-v1",
  runtimeRoot: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime",
  pythonPath: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\Python313\\python.exe",
  sitePackagesPath: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\Python313\\Lib\\site-packages",
  modelRoot: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\models\\granite-embedding-311m-multilingual-r2",
  corpusManifestPath: "scripts/embedding-bakeoff/corpus/manifest.json",
  corpusManifestSha256: "0b0fdf909583990975a771195c7f7a8b6e5e938f01800369b1d6cf9fb5ca7dee",
  corpusId: "williamos-r1b-adversarial-v1",
  corpusFingerprint: "ee6177d86d905ccf3402aa248f1b6a724bcbcc0cf9067aad207f1616c22c0318",
  evaluatorPath: "scripts/embedding-bakeoff/fabric_measure.py",
  bakeoffPath: "scripts/embedding-bakeoff/bakeoff.py",
  embedPath: "scripts/embedding-bakeoff/embed.py",
  metricsPath: "scripts/embedding-bakeoff/metrics.py",
  graniteModulePath: "scripts/embedding-bakeoff/granite_r2_onnx.py",
  canonicalJsonPath: "scripts/execution-fabric/canonical-json.mjs",
  collectorPath: "scripts/execution-fabric/bounded-dispatch/collect-resident-hermes-granite-r2-evidence.ps1",
  boundedLauncherPath: "scripts/execution-fabric/bounded-dispatch/invoke-bounded-hermes-granite-r2.ps1",
  adapterPath: "scripts/execution-fabric/bounded-dispatch/resident-hermes-granite-r2-bakeoff.mjs",
  runnerPath: "scripts/execution-fabric/bounded-dispatch/run-resident-hermes-granite-r2-bakeoff.mjs",
  permissionPath: "config/execution-fabric/agent-forge-granite-r2-bakeoff-permission.json",
  authorityRegistryPath: "config/execution-fabric/granite-r2-bakeoff-authority-registry.json",
  modelFiles: Object.freeze([
    "onnx/model_quint8_avx2.onnx",
    "tokenizer.json",
    "tokenizer_config.json",
    "config.json",
    "special_tokens_map.json",
    "1_Pooling/config.json",
    "modules.json",
    "config_sentence_transformers.json",
    "sentence_bert_config.json",
  ]),
})

const SHA256 = /^[a-f0-9]{64}$/
const SHA40 = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{1,254}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const PROHIBITED_FIELD = /(?:^|_)(?:url|endpoint|host|hostname|node|machine|command|cmd|shell|script|argv|args|executable|exec|spawn|cwd|environment|env|output|output_path|result_path|credential|password|secret|token|api_key|authorization)(?:$|_)/i
const SECRET_VALUE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b)/i

export class HermesGraniteR2BakeoffError extends Error {
  constructor(code, detail) {
    super(`HERMES_GRANITE_R2_BAKEOFF_INVALID: ${code}: ${detail}`)
    this.name = "HermesGraniteR2BakeoffError"
    this.code = code
  }
}

function fail(code, detail) { throw new HermesGraniteR2BakeoffError(code, detail) }
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
  if (typeof value !== "string" || !UTC.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail("INPUT_INVALID", `${label} must be canonical UTC`)
  return value
}
function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INPUT_INVALID", `${label} is outside its fixed range`)
  return value
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex") }
function canonicalDigest(value) { return sha256(canonicalizeJcs(value)) }

function rejectUnsafe(value, label = "request") {
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectUnsafe(entry, `${label}[${index}]`))
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (PROHIBITED_FIELD.test(key.replace(/-/g, "_"))) fail("CALLER_CONTROLLED_CAPABILITY", `${label}.${key} is prohibited`)
      rejectUnsafe(entry, `${label}.${key}`)
    }
  } else if (typeof value === "string" && SECRET_VALUE.test(value)) fail("SECRET_LIKE_VALUE", `${label} contains secret-like material`)
}

function readConfined(root, relativePath, label) {
  const realRoot = fs.realpathSync(path.resolve(root))
  const lexical = path.resolve(realRoot, relativePath)
  const relative = path.relative(realRoot, lexical)
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("PATH_ESCAPE", `${label} escapes the repository`)
  let real
  try { real = fs.realpathSync(lexical) } catch { fail("REVIEWED_ARTIFACT_MISSING", `${label} is missing`) }
  const realRelative = path.relative(realRoot, real)
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative) || fs.lstatSync(lexical).isSymbolicLink() || !fs.lstatSync(real).isFile()) fail("PATH_ESCAPE", `${label} is not a regular repository file`)
  const bytes = fs.readFileSync(real)
  return { bytes, sha256: sha256(bytes) }
}

function sourceClosureFromAdmission(admission) {
  return {
    [GRANITE_R2_CONTRACT.evaluatorPath]: admission.runtime.evaluator_sha256,
    [GRANITE_R2_CONTRACT.bakeoffPath]: admission.runtime.bakeoff_sha256,
    [GRANITE_R2_CONTRACT.embedPath]: admission.runtime.embed_sha256,
    [GRANITE_R2_CONTRACT.metricsPath]: admission.runtime.metrics_sha256,
    [GRANITE_R2_CONTRACT.graniteModulePath]: admission.runtime.granite_r2_onnx_sha256,
    [GRANITE_R2_CONTRACT.canonicalJsonPath]: admission.runtime.canonical_json_sha256,
    [GRANITE_R2_CONTRACT.collectorPath]: admission.runtime.collector_sha256,
    [GRANITE_R2_CONTRACT.boundedLauncherPath]: admission.runtime.bounded_launcher_sha256,
    [GRANITE_R2_CONTRACT.adapterPath]: admission.runtime.adapter_sha256,
    [GRANITE_R2_CONTRACT.runnerPath]: admission.runtime.runner_sha256,
  }
}

function validatePermission(value) {
  exactKeys(value, ["schema_version", "permission_set_id", "agent_identity", "provider_identity", "allowed_actions", "prohibited_actions", "maximum_attempts", "maximum_concurrency", "scheduler_activation_allowed", "autonomous_dispatch_allowed", "fallback_allowed", "external_provider_allowed", "model_download_allowed", "network_allowed", "database_write_allowed", "vector_write_allowed", "status"], "Forge permission")
  if (value.schema_version !== "1.0-agent-forge-granite-r2-bakeoff-permission" || value.permission_set_id !== "resident-hermes-granite-r2-bakeoff-v1"
    || value.agent_identity !== GRANITE_R2_CONTRACT.agentId || value.provider_identity !== GRANITE_R2_CONTRACT.providerId
    || value.maximum_attempts !== 1 || value.maximum_concurrency !== 1 || value.status !== "SCOPE_ONLY_NOT_AUTHORITY"
    || [value.scheduler_activation_allowed, value.autonomous_dispatch_allowed, value.fallback_allowed, value.external_provider_allowed, value.model_download_allowed, value.network_allowed, value.database_write_allowed, value.vector_write_allowed].some((entry) => entry !== false)
    || !value.prohibited_actions.includes("model-download") || !value.prohibited_actions.includes("network-access")
    || !value.prohibited_actions.includes("database-mutation") || !value.prohibited_actions.includes("canonical-vector-write")) fail("FORGE_PERMISSION_MISMATCH", "permission is not the reviewed non-authorizing Granite scope")
}

function validateRequest(request) {
  rejectUnsafe(request)
  exactKeys(request, ["schema_version", "request_id", "admission_sha256"], "request")
  if (request.schema_version !== "1.0-hermes-granite-r2-bakeoff-request") fail("INPUT_INVALID", "request schema is unsupported")
  identifier(request.request_id, "request.request_id"); digest(request.admission_sha256, "request.admission_sha256")
}

function validateArtifacts(artifacts, label) {
  if (!Array.isArray(artifacts) || artifacts.length !== 9) fail("MODEL_FILE_SET_INVALID", `${label} must contain exactly nine files`)
  const paths = []
  for (const [index, entry] of artifacts.entries()) {
    exactKeys(entry, ["path", "sha256", "byte_length"], `${label}[${index}]`)
    if (entry.path !== GRANITE_R2_CONTRACT.modelFiles[index]) fail("MODEL_FILE_SET_INVALID", `${label} path order or identity changed`)
    digest(entry.sha256, `${label}[${index}].sha256`); integer(entry.byte_length, `${label}[${index}].byte_length`, 1, Number.MAX_SAFE_INTEGER)
    paths.push(entry.path)
  }
  if (new Set(paths).size !== 9) fail("MODEL_FILE_SET_INVALID", `${label} contains duplicate paths`)
}

function validateAdmission(admission) {
  exactKeys(admission, ["schema_version", "admission_id", "work_order_id", "corpus_source_commit", "execution_commit", "corpus", "model", "runtime", "placement", "limits", "permission_set_sha256", "valid_from", "expires_at", "maximum_attempts", "status"], "admission")
  if (admission.schema_version !== "1.0-hermes-granite-r2-bakeoff-admission" || admission.work_order_id !== GRANITE_R2_CONTRACT.workOrderId
    || admission.corpus_source_commit !== GRANITE_R2_CONTRACT.corpusSourceCommit || !SHA40.test(admission.execution_commit)
    || admission.maximum_attempts !== 1 || admission.status !== "ADMITTED_SINGLE_USE") fail("ADMISSION_INVALID", "admission identity or use contract changed")
  identifier(admission.admission_id, "admission.admission_id")
  exactKeys(admission.corpus, ["manifest_path", "manifest_sha256", "corpus_id", "corpus_fingerprint", "documents", "queries"], "admission.corpus")
  if (admission.corpus.manifest_path !== GRANITE_R2_CONTRACT.corpusManifestPath || admission.corpus.manifest_sha256 !== GRANITE_R2_CONTRACT.corpusManifestSha256
    || admission.corpus.corpus_id !== GRANITE_R2_CONTRACT.corpusId || admission.corpus.corpus_fingerprint !== GRANITE_R2_CONTRACT.corpusFingerprint
    || admission.corpus.documents !== 49 || admission.corpus.queries !== 80) fail("CORPUS_BINDING_MISMATCH", "frozen corpus binding changed")
  exactKeys(admission.model, ["model_id", "revision", "dimension", "backend", "manifest_sha256", "artifacts"], "admission.model")
  if (admission.model.model_id !== GRANITE_R2_CONTRACT.modelId || admission.model.revision !== GRANITE_R2_CONTRACT.revision
    || admission.model.dimension !== GRANITE_R2_CONTRACT.dimension || admission.model.backend !== GRANITE_R2_CONTRACT.backend) fail("MODEL_BINDING_MISMATCH", "Granite model identity changed")
  digest(admission.model.manifest_sha256, "admission.model.manifest_sha256"); validateArtifacts(admission.model.artifacts, "admission.model.artifacts")
  exactKeys(admission.runtime, ["runtime_id", "backend", "python_sha256", "git_sha256", "closure_manifest_sha256", "closure_file_count", "evaluator_sha256", "bakeoff_sha256", "embed_sha256", "metrics_sha256", "granite_r2_onnx_sha256", "canonical_json_sha256", "collector_sha256", "bounded_launcher_sha256", "adapter_sha256", "runner_sha256"], "admission.runtime")
  if (admission.runtime.runtime_id !== "williamos-sealed-embedding-runtime-v1" || admission.runtime.backend !== GRANITE_R2_CONTRACT.backend || admission.runtime.closure_file_count < 1) fail("RUNTIME_BINDING_MISMATCH", "machine runtime identity changed")
  for (const key of Object.keys(admission.runtime).filter((key) => key.endsWith("_sha256"))) digest(admission.runtime[key], `admission.runtime.${key}`)
  exactKeys(admission.placement, ["node_id", "machine_id_sha256", "inventory_snapshot_sha256", "host_manifest_sha256", "runtime_owner", "runtime_acl_sha256"], "admission.placement")
  if (admission.placement.node_id !== GRANITE_R2_CONTRACT.nodeId || typeof admission.placement.runtime_owner !== "string" || admission.placement.runtime_owner.length < 3) fail("PLACEMENT_BINDING_MISMATCH", "fixed HERMES placement changed")
  for (const key of ["machine_id_sha256", "inventory_snapshot_sha256", "host_manifest_sha256", "runtime_acl_sha256"]) digest(admission.placement[key], `admission.placement.${key}`)
  exactKeys(admission.limits, ["timeout_ms", "max_input_bytes", "max_result_bytes", "max_scratch_bytes", "max_cpu_threads", "max_memory_bytes", "minimum_memory_available_bytes", "active_process_limit", "network_scope"], "admission.limits")
  integer(admission.limits.timeout_ms, "admission.limits.timeout_ms", 1000, 900000); integer(admission.limits.max_input_bytes, "admission.limits.max_input_bytes", 1, 524288)
  integer(admission.limits.max_result_bytes, "admission.limits.max_result_bytes", 1, 16777216); integer(admission.limits.max_scratch_bytes, "admission.limits.max_scratch_bytes", 1, Number.MAX_SAFE_INTEGER)
  integer(admission.limits.max_cpu_threads, "admission.limits.max_cpu_threads", 1, 64); integer(admission.limits.max_memory_bytes, "admission.limits.max_memory_bytes", 67108864, 68719476736)
  integer(admission.limits.minimum_memory_available_bytes, "admission.limits.minimum_memory_available_bytes", 1, Number.MAX_SAFE_INTEGER)
  if (admission.limits.active_process_limit !== 1 || admission.limits.network_scope !== "NONE" || admission.limits.max_scratch_bytes < admission.limits.max_input_bytes + admission.limits.max_result_bytes) fail("LIMITS_INVALID", "limits do not enforce one no-network process and bounded retained files")
  digest(admission.permission_set_sha256, "admission.permission_set_sha256"); timestamp(admission.valid_from, "admission.valid_from"); timestamp(admission.expires_at, "admission.expires_at")
  if (Date.parse(admission.valid_from) >= Date.parse(admission.expires_at)) fail("ADMISSION_INVALID", "admission window is invalid")
}

function validateHostAttestation(value, admission, observedAt) {
  exactKeys(value, ["schema_version", "collector_id", "node_id", "machine_id_sha256", "inventory_snapshot_sha256", "host_manifest_sha256", "python_sha256", "closure_manifest_sha256", "closure_file_count", "runtime_owner", "runtime_acl_sha256", "model_manifest_sha256", "model_artifacts", "resources", "observed_at", "expires_at", "attestation_sha256", "verified"], "host attestation")
  if (value.schema_version !== "1.0-trusted-hermes-granite-r2-runtime-attestation" || value.collector_id !== "reviewed-resident-hermes-granite-r2-collector"
    || value.node_id !== GRANITE_R2_CONTRACT.nodeId || value.machine_id_sha256 !== admission.placement.machine_id_sha256
    || value.inventory_snapshot_sha256 !== admission.placement.inventory_snapshot_sha256 || value.host_manifest_sha256 !== admission.placement.host_manifest_sha256
    || value.python_sha256 !== admission.runtime.python_sha256 || value.closure_manifest_sha256 !== admission.runtime.closure_manifest_sha256
    || value.closure_file_count !== admission.runtime.closure_file_count || value.runtime_owner !== admission.placement.runtime_owner
    || value.runtime_acl_sha256 !== admission.placement.runtime_acl_sha256 || value.model_manifest_sha256 !== admission.model.manifest_sha256 || value.verified !== true) fail("HOST_ATTESTATION_MISMATCH", "live machine runtime does not match admission")
  validateArtifacts(value.model_artifacts, "host attestation.model_artifacts")
  if (canonicalizeJcs(value.model_artifacts) !== canonicalizeJcs(admission.model.artifacts)) fail("MODEL_DRIFT", "live model files changed")
  exactKeys(value.resources, ["cpu_threads", "memory_total_bytes", "memory_available_bytes"], "host attestation.resources")
  for (const key of Object.keys(value.resources)) integer(value.resources[key], `host attestation.resources.${key}`, 1, Number.MAX_SAFE_INTEGER)
  if (value.resources.cpu_threads < admission.limits.max_cpu_threads || value.resources.memory_total_bytes < admission.limits.max_memory_bytes || value.resources.memory_available_bytes < admission.limits.minimum_memory_available_bytes) fail("RESOURCE_CAPACITY_INSUFFICIENT", "live resources are below the admitted envelope")
  timestamp(value.observed_at, "host attestation.observed_at"); timestamp(value.expires_at, "host attestation.expires_at"); digest(value.attestation_sha256, "host attestation.attestation_sha256")
  const body = structuredClone(value); delete body.attestation_sha256
  if (value.attestation_sha256 !== canonicalDigest(body) || Date.parse(value.observed_at) < Date.parse(observedAt) || Date.parse(value.expires_at) <= Date.parse(value.observed_at)) fail("HOST_ATTESTATION_INVALID", "attestation digest or freshness is invalid")
}

function prepareOrThrow({ repositoryRoot, request, admission, evaluatedAt, proveTrustedAdmission }) {
  validateRequest(request); validateAdmission(admission); timestamp(evaluatedAt, "evaluatedAt")
  const admissionSha256 = canonicalDigest(admission)
  if (request.admission_sha256 !== admissionSha256) fail("ADMISSION_BINDING_MISMATCH", "request does not bind exact admission")
  if (Date.parse(admission.valid_from) > Date.parse(evaluatedAt) || Date.parse(admission.expires_at) <= Date.parse(evaluatedAt)) fail("ADMISSION_INACTIVE", "admission is inactive")
  const corpus = readConfined(repositoryRoot, GRANITE_R2_CONTRACT.corpusManifestPath, "frozen corpus manifest")
  if (corpus.sha256 !== GRANITE_R2_CONTRACT.corpusManifestSha256) fail("CORPUS_BINDING_MISMATCH", "frozen corpus changed")
  const sources = {}
  for (const [relativePath, admittedDigest] of Object.entries(sourceClosureFromAdmission(admission))) {
    const source = readConfined(repositoryRoot, relativePath, `reviewed source ${relativePath}`)
    if (source.sha256 !== admittedDigest) fail("SOURCE_CLOSURE_MISMATCH", `${relativePath} changed`)
    sources[relativePath] = source.sha256
  }
  const permission = readConfined(repositoryRoot, GRANITE_R2_CONTRACT.permissionPath, "Granite Forge permission")
  let permissionValue
  try { permissionValue = JSON.parse(permission.bytes.toString("utf8")) } catch { fail("FORGE_PERMISSION_MISMATCH", "permission is not JSON") }
  validatePermission(permissionValue)
  if (permission.sha256 !== admission.permission_set_sha256) fail("FORGE_PERMISSION_MISMATCH", "admission does not bind permission bytes")
  if (typeof proveTrustedAdmission !== "function") fail("ADMISSION_UNPROVEN", "trusted-main proof is required")
  const proof = proveTrustedAdmission({ admission: structuredClone(admission), admissionSha256, evaluatedAt })
  exactKeys(proof, ["schema_version", "admission_sha256", "execution_commit", "inventory_snapshot_sha256", "source_closure_sha256", "exact_entry_count", "verified"], "trusted admission proof")
  if (proof.schema_version !== "1.0-trusted-hermes-granite-r2-admission-proof" || proof.admission_sha256 !== admissionSha256 || proof.execution_commit !== admission.execution_commit
    || proof.inventory_snapshot_sha256 !== admission.placement.inventory_snapshot_sha256 || proof.source_closure_sha256 !== canonicalDigest(sources) || proof.exact_entry_count !== 1 || proof.verified !== true) fail("ADMISSION_UNPROVEN", "trusted-main proof is invalid")
  const preparation = { schema_version: "1.0-hermes-granite-r2-bakeoff-preparation", status: "READY_FOR_SINGLE_USE_CLAIM", request_id: request.request_id,
    work_order_id: GRANITE_R2_CONTRACT.workOrderId, admission_id: admission.admission_id, request_sha256: canonicalDigest(request), admission_sha256: admissionSha256,
    corpus_source_commit: admission.corpus_source_commit, execution_commit: admission.execution_commit, source_closure_sha256: canonicalDigest(sources), corpus_manifest_sha256: corpus.sha256,
    permission_set_sha256: permission.sha256, model_id: admission.model.model_id, revision: admission.model.revision, dimension: admission.model.dimension, backend: admission.model.backend,
    node_id: GRANITE_R2_CONTRACT.nodeId, prepared_at: evaluatedAt, valid_until: admission.expires_at, maximum_attempts: 1, maximum_concurrency: 1,
    execution_authorized: true, dispatch_allowed: false, scheduler_activated: false, autonomous_dispatch: false, fallback_allowed: false, external_provider_allowed: false,
    model_download_allowed: false, network_allowed: false, database_write_allowed: false, vector_write_allowed: false }
  preparation.preparation_sha256 = canonicalDigest(preparation)
  return { preparation, admission: structuredClone(admission) }
}

export function prepareResidentHermesGraniteR2Bakeoff(input) {
  try { return prepareOrThrow(input).preparation } catch (error) {
    if (!(error instanceof HermesGraniteR2BakeoffError)) throw error
    return { schema_version: "1.0-hermes-granite-r2-bakeoff-preparation", status: "BLOCKED", reasons: [{ code: error.code, detail: error.message.split(": ").slice(2).join(": ") }], execution_authorized: false, dispatch_allowed: false, scheduler_activated: false, autonomous_dispatch: false, fallback_allowed: false, external_provider_allowed: false, model_download_allowed: false, network_allowed: false, database_write_allowed: false, vector_write_allowed: false }
  }
}

function annotate(error, state) { const value = error instanceof Error ? error : new Error(String(error)); Object.assign(value, state); return value }

export async function executeResidentHermesGraniteR2Bakeoff(options) {
  for (const name of ["clock", "proveTrustedAdmission", "claimSingleUse", "acquireExclusiveLease", "releaseExclusiveLease", "collectTrustedHostAttestation", "invokeFixedEvaluator"]) if (typeof options[name] !== "function") fail("RUNTIME_DEPENDENCY_MISSING", `${name} is required`)
  const preparedAt = timestamp(options.clock(), "trusted preparation clock")
  const prepared = prepareOrThrow({ ...options, evaluatedAt: preparedAt })
  const claim = await options.claimSingleUse({ request_id: options.request.request_id, request_sha256: prepared.preparation.request_sha256, admission_sha256: prepared.preparation.admission_sha256, maximum_attempts: 1 })
  exactKeys(claim, ["claimed", "claim_id", "claimed_at"], "single-use claim")
  if (claim.claimed !== true) fail("REQUEST_ALREADY_CONSUMED", "replay rejected before dispatch")
  identifier(claim.claim_id, "claim.claim_id"); timestamp(claim.claimed_at, "claim.claimed_at")
  const lease = await options.acquireExclusiveLease({ claim_id: claim.claim_id, request_sha256: prepared.preparation.request_sha256, admission_sha256: prepared.preparation.admission_sha256, node_id: GRANITE_R2_CONTRACT.nodeId, valid_until: prepared.admission.expires_at })
  exactKeys(lease, ["acquired", "lease_id", "fencing_token", "acquired_at", "stale_lease_recovered", "stale_lease_sha256"], "exclusive lease")
  if (lease.acquired !== true) fail("CONCURRENCY_LIMIT_REACHED", "Granite R2 lease is occupied")
  identifier(lease.lease_id, "lease.lease_id"); integer(lease.fencing_token, "lease.fencing_token", 1, Number.MAX_SAFE_INTEGER); timestamp(lease.acquired_at, "lease.acquired_at")
  if (typeof lease.stale_lease_recovered !== "boolean" || (lease.stale_lease_sha256 !== null && !SHA256.test(lease.stale_lease_sha256))) fail("LEASE_RECOVERY_INVALID", "lease recovery evidence is malformed")
  let dispatchAttempted = false; let released = false; let executionError = null; let result
  try {
    const startedAt = timestamp(options.clock(), "trusted start clock")
    if (Date.parse(claim.claimed_at) < Date.parse(preparedAt) || Date.parse(claim.claimed_at) > Date.parse(lease.acquired_at) || Date.parse(lease.acquired_at) > Date.parse(startedAt)) fail("CLAIM_LEASE_CHRONOLOGY_INVALID", "claim and lease chronology is not monotonic")
    const rechecked = prepareOrThrow({ ...options, evaluatedAt: startedAt })
    if (startedAt === preparedAt || rechecked.preparation.request_sha256 !== prepared.preparation.request_sha256 || rechecked.preparation.admission_sha256 !== prepared.preparation.admission_sha256 || rechecked.preparation.source_closure_sha256 !== prepared.preparation.source_closure_sha256) fail("PREPARATION_RECHECK_INVALID", "reviewed closure changed or time did not advance")
    const hostAttestation = await options.collectTrustedHostAttestation({ admission: structuredClone(prepared.admission), observed_at: startedAt })
    validateHostAttestation(hostAttestation, prepared.admission, startedAt)
    dispatchAttempted = true
    const output = await options.invokeFixedEvaluator({ admission: structuredClone(prepared.admission), host_attestation: structuredClone(hostAttestation), evaluator_path: GRANITE_R2_CONTRACT.evaluatorPath })
    exactKeys(output, ["result_bytes", "result_sha256", "model_manifest_sha256", "closure_manifest_sha256", "host_manifest_sha256", "corpus_fingerprint", "model_id", "revision", "dimension", "backend", "node_id", "execution_receipt", "network_used", "container_used", "external_provider_used", "fallback_used", "database_write_performed", "vector_write_performed"], "evaluator result")
    if (!(output.result_bytes instanceof Uint8Array) || output.result_bytes.byteLength < 1 || output.result_bytes.byteLength > prepared.admission.limits.max_result_bytes || output.result_sha256 !== sha256(output.result_bytes)
      || output.model_manifest_sha256 !== prepared.admission.model.manifest_sha256 || output.closure_manifest_sha256 !== prepared.admission.runtime.closure_manifest_sha256 || output.host_manifest_sha256 !== prepared.admission.placement.host_manifest_sha256
      || output.corpus_fingerprint !== GRANITE_R2_CONTRACT.corpusFingerprint || output.model_id !== GRANITE_R2_CONTRACT.modelId || output.revision !== GRANITE_R2_CONTRACT.revision
      || output.dimension !== GRANITE_R2_CONTRACT.dimension || output.backend !== GRANITE_R2_CONTRACT.backend || output.node_id !== GRANITE_R2_CONTRACT.nodeId) fail("RESULT_BINDING_MISMATCH", "result does not bind exact Granite/runtime/host/corpus identity")
    if ([output.network_used, output.container_used, output.external_provider_used, output.fallback_used, output.database_write_performed, output.vector_write_performed].some((entry) => entry !== false)) fail("FORBIDDEN_SIDE_EFFECT", "result reported a prohibited side effect")
    const completedAt = timestamp(options.clock(), "trusted completion clock")
    if (Date.parse(completedAt) < Date.parse(startedAt) || Date.parse(completedAt) >= Date.parse(prepared.admission.expires_at) || Date.parse(completedAt) >= Date.parse(hostAttestation.expires_at) || Date.parse(completedAt) - Date.parse(startedAt) > prepared.admission.limits.timeout_ms) fail("COMPLETION_CHRONOLOGY_INVALID", "completion chronology is invalid")
    result = { schema_version: "1.0-hermes-granite-r2-bakeoff-result", status: "COMPLETED", result: "SUCCEEDED", execution_semantics: "AT_MOST_ONCE_ADMISSION_CONSUMPTION",
      request_id: options.request.request_id, work_order_id: GRANITE_R2_CONTRACT.workOrderId, admission_id: prepared.admission.admission_id, request_sha256: prepared.preparation.request_sha256,
      admission_sha256: prepared.preparation.admission_sha256, corpus_source_commit: GRANITE_R2_CONTRACT.corpusSourceCommit, execution_commit: prepared.admission.execution_commit,
      source_closure_sha256: prepared.preparation.source_closure_sha256, corpus_manifest_sha256: GRANITE_R2_CONTRACT.corpusManifestSha256, corpus_fingerprint: GRANITE_R2_CONTRACT.corpusFingerprint,
      model: structuredClone(prepared.admission.model), runtime: structuredClone(prepared.admission.runtime), host_attestation: structuredClone(hostAttestation), execution_receipt: structuredClone(output.execution_receipt),
      result_bundle: { sha256: output.result_sha256, byte_length: output.result_bytes.byteLength }, claim: { claim_id: claim.claim_id, claimed_at: claim.claimed_at, maximum_attempts: 1 },
      lease: { lease_id: lease.lease_id, fencing_token: lease.fencing_token, acquired_at: lease.acquired_at, stale_lease_recovered: lease.stale_lease_recovered, stale_lease_sha256: lease.stale_lease_sha256 },
      chronology: { prepared_at: preparedAt, started_at: startedAt, completed_at: completedAt }, scheduler_activated: false, autonomous_dispatch: false, network_used: false, container_used: false,
      external_provider_used: false, fallback_used: false, database_write_performed: false, vector_write_performed: false, lease_released: false }
  } catch (error) { executionError = annotate(error, { dispatchAttempted, claimId: claim.claim_id, leaseId: lease.lease_id, fencingToken: lease.fencing_token, leaseReleased: false }); throw executionError } finally {
    try { released = await options.releaseExclusiveLease({ lease_id: lease.lease_id, claim_id: claim.claim_id, fencing_token: lease.fencing_token }) === true } catch { released = false }
    if (executionError) executionError.leaseReleased = released
  }
  if (!released) throw annotate(new HermesGraniteR2BakeoffError("LEASE_RELEASE_FAILED", "exclusive lease release was not confirmed"), { dispatchAttempted, claimId: claim.claim_id, leaseId: lease.lease_id, fencingToken: lease.fencing_token, leaseReleased: false })
  result.lease_released = true; result.attestation_sha256 = canonicalDigest(result); return result
}
