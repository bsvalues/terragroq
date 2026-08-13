import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { GRANITE_R2_CONTRACT, executeResidentHermesGraniteR2Bakeoff } from "./resident-hermes-granite-r2-bakeoff.mjs"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const PACKET_ROOT = "C:\\ProgramData\\WilliamOS\\EmbeddingBakeoff\\granite-r2-admission"
const LEDGER_ROOT = "C:\\ProgramData\\WilliamOS\\EmbeddingBakeoff\\granite-r2-ledger"
const REQUEST_PATH = path.join(PACKET_ROOT, "request.json")
const ADMISSION_PATH = path.join(PACKET_ROOT, "admission.json")
const HOST_MANIFEST_PATH = path.join(PACKET_ROOT, "host-manifest.json")
const NODE_EXECUTABLE = "C:\\Program Files\\nodejs\\node.exe"
const POWERSHELL_EXECUTABLE = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
const GIT_EXECUTABLE = "C:\\Program Files\\Git\\cmd\\git.exe"
const COLLECTOR_PATH = path.join(REPOSITORY_ROOT, GRANITE_R2_CONTRACT.collectorPath)
const LAUNCHER_PATH = path.join(REPOSITORY_ROOT, GRANITE_R2_CONTRACT.boundedLauncherPath)
const TRUSTED_MAIN_REF = "refs/heads/main"

const REVIEWED_SOURCE_BINDINGS = Object.freeze([
  [GRANITE_R2_CONTRACT.evaluatorPath, "evaluator_sha256"],
  [GRANITE_R2_CONTRACT.bakeoffPath, "bakeoff_sha256"],
  [GRANITE_R2_CONTRACT.embedPath, "embed_sha256"],
  [GRANITE_R2_CONTRACT.metricsPath, "metrics_sha256"],
  [GRANITE_R2_CONTRACT.graniteModulePath, "granite_r2_onnx_sha256"],
  [GRANITE_R2_CONTRACT.canonicalJsonPath, "canonical_json_sha256"],
  [GRANITE_R2_CONTRACT.collectorPath, "collector_sha256"],
  [GRANITE_R2_CONTRACT.boundedLauncherPath, "bounded_launcher_sha256"],
  [GRANITE_R2_CONTRACT.adapterPath, "adapter_sha256"],
  [GRANITE_R2_CONTRACT.runnerPath, "runner_sha256"],
])

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex") }
function canonicalDigest(value) { return sha256(canonicalizeJcs(value)) }
function ensureRoot(root, expectedName) {
  fs.mkdirSync(root, { recursive: true })
  const real = fs.realpathSync(root)
  if (fs.lstatSync(root).isSymbolicLink() || path.basename(real).toLowerCase() !== expectedName.toLowerCase()) throw new Error("fixed Granite root confinement failed")
  return real
}
function readFixedBytes(filePath, root, label) {
  const realRoot = fs.realpathSync(root); const real = fs.realpathSync(filePath); const relative = path.relative(realRoot, real)
  if (relative.startsWith("..") || path.isAbsolute(relative) || fs.lstatSync(filePath).isSymbolicLink() || !fs.lstatSync(real).isFile()) throw new Error(`${label} escaped its fixed root`)
  return fs.readFileSync(real)
}
function readFixedJson(filePath, root, label) { return JSON.parse(readFixedBytes(filePath, root, label).toString("utf8").replace(/^\uFEFF/, "")) }
function writeExclusive(filePath, bytes) { let descriptor; try { descriptor = fs.openSync(filePath, "wx"); fs.writeFileSync(descriptor, bytes) } finally { if (descriptor !== undefined) fs.closeSync(descriptor) } }

export function verifyTrustedAuthorityRegistry({ registry, admission }) {
  const keys = registry && typeof registry === "object" && !Array.isArray(registry) ? Object.keys(registry).sort() : []
  if (JSON.stringify(keys) !== JSON.stringify(["entries", "registry_id", "schema_version"])
    || registry.schema_version !== "1.0-hermes-granite-r2-bakeoff-authority-registry"
    || registry.registry_id !== "hermes-granite-r2-bakeoff-authorities" || !Array.isArray(registry.entries)) {
    throw new Error("trusted-main Granite R2 authority registry is invalid")
  }
  const exactEntryCount = registry.entries.filter((entry) => canonicalizeJcs(entry) === canonicalizeJcs(admission)).length
  return { exact_entry_count: exactEntryCount, verified: exactEntryCount === 1 }
}

export function proveTrustedAdmission({ admission, admissionSha256 }) {
  if (sha256(fs.readFileSync(GIT_EXECUTABLE)) !== admission.runtime.git_sha256) throw new Error("trusted Git executable bytes changed")
  const git = (...args) => {
    const result = spawnSync(GIT_EXECUTABLE, args, { cwd: REPOSITORY_ROOT, encoding: "utf8", windowsHide: true, timeout: 10_000,
      env: { SystemRoot: "C:\\WINDOWS", WINDIR: "C:\\WINDOWS", PATH: "C:\\Program Files\\Git\\cmd;C:\\WINDOWS\\System32", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "NUL", GIT_OPTIONAL_LOCKS: "0" } })
    if (result.status !== 0 || result.error) throw new Error("trusted Git proof failed")
    return result.stdout.trim()
  }
  if (git("rev-parse", "--verify", TRUSTED_MAIN_REF) !== admission.execution_commit || git("status", "--porcelain", "--untracked-files=no") !== "") throw new Error("admission is not exact clean trusted main")
  git("merge-base", "--is-ancestor", admission.corpus_source_commit, admission.execution_commit)
  const closure = {}
  for (const [relativePath, key] of REVIEWED_SOURCE_BINDINGS) {
    const objectBytes = spawnSync(GIT_EXECUTABLE, ["show", `${admission.execution_commit}:${relativePath}`], { cwd: REPOSITORY_ROOT, encoding: null, windowsHide: true, timeout: 10_000,
      env: { SystemRoot: "C:\\WINDOWS", WINDIR: "C:\\WINDOWS", PATH: "C:\\Program Files\\Git\\cmd;C:\\WINDOWS\\System32", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "NUL", GIT_OPTIONAL_LOCKS: "0" } })
    if (objectBytes.status !== 0 || objectBytes.error || sha256(objectBytes.stdout) !== admission.runtime[key] || sha256(fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath))) !== admission.runtime[key]) throw new Error("trusted-main source closure differs from admission")
    closure[relativePath] = admission.runtime[key]
  }
  const registryBytes = spawnSync(GIT_EXECUTABLE, ["show", `${TRUSTED_MAIN_REF}:${GRANITE_R2_CONTRACT.authorityRegistryPath}`], { cwd: REPOSITORY_ROOT, encoding: null, windowsHide: true, timeout: 10_000,
    env: { SystemRoot: "C:\\WINDOWS", WINDIR: "C:\\WINDOWS", PATH: "C:\\Program Files\\Git\\cmd;C:\\WINDOWS\\System32", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "NUL", GIT_OPTIONAL_LOCKS: "0" } })
  if (registryBytes.status !== 0 || registryBytes.error) throw new Error("trusted-main Granite R2 authority registry is missing")
  let registry
  try { registry = JSON.parse(registryBytes.stdout.toString("utf8")) } catch { throw new Error("trusted-main Granite R2 authority registry is invalid") }
  const authority = verifyTrustedAuthorityRegistry({ registry, admission })
  return { schema_version: "1.0-trusted-hermes-granite-r2-admission-proof", admission_sha256: admissionSha256, execution_commit: admission.execution_commit,
    inventory_snapshot_sha256: admission.placement.inventory_snapshot_sha256, source_closure_sha256: canonicalDigest(closure), exact_entry_count: authority.exact_entry_count, verified: authority.verified }
}

export async function claimSingleUseAtRoot(root, { request_id, request_sha256, admission_sha256, maximum_attempts }) {
  if (maximum_attempts !== 1) throw new Error("single-use attempt contract changed")
  if (typeof admission_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(admission_sha256)) throw new Error("single-use admission identity is invalid")
  const claimId = `claim-${admission_sha256}`; const claimedAt = new Date().toISOString()
  try { writeExclusive(path.join(root, `${claimId}.json`), Buffer.from(`${canonicalizeJcs({ schema_version: "1.0-hermes-granite-r2-single-use-claim", claim_id: claimId, request_id, request_sha256, admission_sha256, claimed_at: claimedAt, maximum_attempts: 1 })}\n`)); return { claimed: true, claim_id: claimId, claimed_at: claimedAt } }
  catch (error) { if (error?.code === "EEXIST") return { claimed: false, claim_id: claimId, claimed_at: claimedAt }; throw error }
}

export async function claimSingleUse(binding) {
  return claimSingleUseAtRoot(ensureRoot(LEDGER_ROOT, "granite-r2-ledger"), binding)
}
function holderIsAlive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
function allocateFence(root, minimum) {
  const fencePath = path.join(root, "granite-r2-fence.txt"); let current = 0
  try { current = Number.parseInt(fs.readFileSync(fencePath, "utf8"), 10) } catch (error) { if (error?.code !== "ENOENT") throw error }
  const next = Math.max(Number.isSafeInteger(current) ? current + 1 : 1, minimum); fs.writeFileSync(fencePath, `${next}\n`, { flag: "w" }); return next
}
export async function acquireExclusiveLease(binding) {
  const root = ensureRoot(LEDGER_ROOT, "granite-r2-ledger"); const leasePath = path.join(root, "active-granite-r2-lease.json"); let minimumFence = 1; let staleLeaseSha256 = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const acquiredAt = new Date().toISOString(); const leaseId = sha256(canonicalizeJcs({ ...binding, acquired_at: acquiredAt, holder_pid: process.pid })); let descriptor
    try {
      descriptor = fs.openSync(leasePath, "wx"); const fence = allocateFence(root, minimumFence); fs.writeFileSync(descriptor, `${canonicalizeJcs({ schema_version: "1.0-hermes-granite-r2-exclusive-lease", lease_id: leaseId, ...binding, fencing_token: fence, holder_pid: process.pid, acquired_at: acquiredAt })}\n`)
      return { acquired: true, lease_id: leaseId, fencing_token: fence, acquired_at: acquiredAt, stale_lease_recovered: staleLeaseSha256 !== null, stale_lease_sha256: staleLeaseSha256 }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      if (attempt > 0 || fs.lstatSync(leasePath).isSymbolicLink()) return { acquired: false, lease_id: leaseId, fencing_token: minimumFence, acquired_at: acquiredAt, stale_lease_recovered: false, stale_lease_sha256: null }
      const bytes = fs.readFileSync(leasePath); let retained
      try { retained = JSON.parse(bytes.toString("utf8")) } catch { return { acquired: false, lease_id: leaseId, fencing_token: minimumFence, acquired_at: acquiredAt, stale_lease_recovered: false, stale_lease_sha256: null } }
      if (!Number.isSafeInteger(retained.fencing_token) || Date.parse(retained.valid_until) > Date.now() || holderIsAlive(retained.holder_pid)) return { acquired: false, lease_id: leaseId, fencing_token: minimumFence, acquired_at: acquiredAt, stale_lease_recovered: false, stale_lease_sha256: null }
      staleLeaseSha256 = sha256(bytes); minimumFence = retained.fencing_token + 1; fs.renameSync(leasePath, path.join(root, `stale-granite-r2-lease-${staleLeaseSha256}.json`))
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
  }
  throw new Error("Granite lease recovery did not converge")
}
export async function releaseExclusiveLease({ lease_id, claim_id, fencing_token }) {
  const leasePath = path.join(ensureRoot(LEDGER_ROOT, "granite-r2-ledger"), "active-granite-r2-lease.json"); const retained = JSON.parse(fs.readFileSync(leasePath, "utf8"))
  if (retained.lease_id !== lease_id || retained.claim_id !== claim_id || retained.fencing_token !== fencing_token || retained.holder_pid !== process.pid) return false
  fs.unlinkSync(leasePath); return true
}

export async function collectTrustedHostAttestation({ admission }) {
  const hostManifestBytes = readFixedBytes(HOST_MANIFEST_PATH, PACKET_ROOT, "host manifest")
  if (sha256(hostManifestBytes) !== admission.placement.host_manifest_sha256 || path.resolve(process.execPath).toLowerCase() !== NODE_EXECUTABLE.toLowerCase()) throw new Error("fixed host or Node identity changed")
  const observed = spawnSync(POWERSHELL_EXECUTABLE, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", COLLECTOR_PATH], { cwd: path.dirname(COLLECTOR_PATH), encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1_048_576, env: { SystemRoot: "C:\\WINDOWS", WINDIR: "C:\\WINDOWS", PATH: "C:\\WINDOWS\\System32;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0" } })
  if (observed.status !== 0 || observed.error || !observed.stdout) throw new Error("reviewed Granite collector failed")
  const live = JSON.parse(observed.stdout.replace(/^\uFEFF/, "")); const attestation = { schema_version: "1.0-trusted-hermes-granite-r2-runtime-attestation", collector_id: live.collector_id, node_id: live.node_id,
    machine_id_sha256: live.machine_id_sha256, inventory_snapshot_sha256: live.inventory_snapshot_sha256, host_manifest_sha256: sha256(hostManifestBytes), python_sha256: live.python_sha256,
    closure_manifest_sha256: live.closure_manifest_sha256, closure_file_count: live.closure_file_count, runtime_owner: live.runtime_owner, runtime_acl_sha256: live.runtime_acl_sha256,
    model_manifest_sha256: live.model_manifest_sha256, model_artifacts: live.model_artifacts, resources: live.resources, observed_at: live.observed_at, expires_at: live.expires_at, verified: true }
  attestation.attestation_sha256 = canonicalDigest(attestation); return attestation
}

export async function invokeFixedEvaluator({ admission, host_attestation, evaluator_path }) {
  if (evaluator_path !== GRANITE_R2_CONTRACT.evaluatorPath) throw new Error("fixed Granite evaluator path changed")
  const ledger = ensureRoot(LEDGER_ROOT, "granite-r2-ledger"); const hostManifest = readFixedJson(HOST_MANIFEST_PATH, PACKET_ROOT, "host manifest")
  const envelope = { schema_version: "1.0-r1b-granite-r2-measurement-envelope", model: GRANITE_R2_CONTRACT.modelId, revision: GRANITE_R2_CONTRACT.revision, dimension: 768, backend: GRANITE_R2_CONTRACT.backend,
    model_manifest: { schema_version: "1.0-granite-r2-model-manifest", model_id: admission.model.model_id, revision: admission.model.revision, dimension: admission.model.dimension, backend: admission.model.backend, manifest_sha256: admission.model.manifest_sha256 },
    runtime_manifest: { schema_version: "1.0-granite-r2-runtime-manifest", runtime_id: admission.runtime.runtime_id, backend: admission.runtime.backend, closure_manifest_sha256: admission.runtime.closure_manifest_sha256, python_sha256: admission.runtime.python_sha256 },
    host_manifest: hostManifest, execution_limits: { max_cpu_threads: admission.limits.max_cpu_threads, network_scope: "NONE" } }
  const input = Buffer.from(`${canonicalizeJcs(envelope)}\n`); const executionKey = sha256(canonicalizeJcs({ admission, host_attestation })); const sealedPath = path.join(ledger, `sealed-${executionKey}.json`); const resultPath = path.join(ledger, `result-${executionKey}.json`)
  writeExclusive(sealedPath, input)
  const corpusRoot = path.join(REPOSITORY_ROOT, "scripts/embedding-bakeoff/corpus")
  const run = spawnSync(POWERSHELL_EXECUTABLE, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER_PATH], { cwd: path.dirname(LAUNCHER_PATH), encoding: "utf8", windowsHide: true, timeout: admission.limits.timeout_ms + 60_000, maxBuffer: 1_048_576,
    env: { SystemRoot: "C:\\WINDOWS", WINDIR: "C:\\WINDOWS", HERMES_GRANITE_R2_SEALED_INPUT_PATH: sealedPath, HERMES_GRANITE_R2_SEALED_INPUT_SHA256: sha256(input), HERMES_GRANITE_R2_RESULT_PATH: resultPath,
      HERMES_GRANITE_R2_TIMEOUT_MS: String(admission.limits.timeout_ms), HERMES_GRANITE_R2_MAX_RESULT_BYTES: String(admission.limits.max_result_bytes), HERMES_GRANITE_R2_MAX_SCRATCH_BYTES: String(admission.limits.max_scratch_bytes), HERMES_GRANITE_R2_MAX_CPU_THREADS: String(admission.limits.max_cpu_threads),
      HERMES_GRANITE_R2_PROCESS_MEMORY_BYTES: String(admission.limits.max_memory_bytes), HERMES_GRANITE_R2_JOB_MEMORY_BYTES: String(admission.limits.max_memory_bytes), HERMES_GRANITE_R2_CPU_RATE_PERCENT: "100", HERMES_GRANITE_R2_ACTIVE_PROCESS_LIMIT: "1",
      HERMES_GRANITE_R2_CLOSURE_MANIFEST_SHA256: admission.runtime.closure_manifest_sha256, HERMES_GRANITE_R2_PYTHON_SHA256: admission.runtime.python_sha256, HERMES_GRANITE_R2_MODEL_ID: admission.model.model_id, HERMES_GRANITE_R2_REVISION: admission.model.revision, HERMES_GRANITE_R2_DIMENSION: "768", HERMES_GRANITE_R2_BACKEND: admission.model.backend,
      HERMES_GRANITE_R2_EVALUATOR_SHA256: admission.runtime.evaluator_sha256, HERMES_GRANITE_R2_BAKEOFF_SHA256: admission.runtime.bakeoff_sha256, HERMES_GRANITE_R2_EMBED_SHA256: admission.runtime.embed_sha256, HERMES_GRANITE_R2_METRICS_SHA256: admission.runtime.metrics_sha256, HERMES_GRANITE_R2_MODULE_SHA256: admission.runtime.granite_r2_onnx_sha256,
      HERMES_GRANITE_R2_DOCUMENTS_SHA256: sha256(fs.readFileSync(path.join(corpusRoot, "documents.jsonl"))), HERMES_GRANITE_R2_QUERIES_SHA256: sha256(fs.readFileSync(path.join(corpusRoot, "queries.jsonl"))), HERMES_GRANITE_R2_CORPUS_MANIFEST_SHA256: admission.corpus.manifest_sha256 } })
  let receipt; try { receipt = JSON.parse(run.stdout.trim()) } catch { throw new Error("Granite launcher returned invalid receipt") }
  if (run.status !== 0 || receipt.status !== "COMPLETED" || receipt.job_assigned_before_resume !== true || receipt.runtime_closure_reverified !== true || receipt.model_reverified !== true || receipt.scratch_cleaned !== true || receipt.network_used !== false || receipt.container_used !== false) throw new Error(`Granite launcher failed closed: ${receipt.reason_code ?? "UNKNOWN"}`)
  const resultBytes = readFixedBytes(resultPath, LEDGER_ROOT, "Granite result"); if (receipt.result_sha256 !== sha256(resultBytes) || receipt.result_bytes !== resultBytes.byteLength) throw new Error("Granite receipt/result mismatch")
  const result = JSON.parse(resultBytes.toString("utf8")); const provenance = result?.manifest?.provenance
  return { result_bytes: resultBytes, result_sha256: sha256(resultBytes), model_manifest_sha256: admission.model.manifest_sha256, closure_manifest_sha256: admission.runtime.closure_manifest_sha256,
    host_manifest_sha256: admission.placement.host_manifest_sha256, corpus_fingerprint: result?.manifest?.corpus_fingerprint, model_id: result?.manifest?.model, revision: admission.model.revision, dimension: admission.model.dimension,
    backend: admission.model.backend, node_id: admission.placement.node_id, execution_receipt: receipt, network_used: false, container_used: false, external_provider_used: false, fallback_used: false, database_write_performed: false, vector_write_performed: false }
}

async function main() {
  if (process.platform !== "win32" || process.argv.length !== 2) throw new Error("resident HERMES Granite R2 runner is Windows-only and accepts zero arguments")
  ensureRoot(PACKET_ROOT, "granite-r2-admission"); ensureRoot(LEDGER_ROOT, "granite-r2-ledger")
  const request = readFixedJson(REQUEST_PATH, PACKET_ROOT, "Granite request"); const admission = readFixedJson(ADMISSION_PATH, PACKET_ROOT, "Granite admission")
  const result = await executeResidentHermesGraniteR2Bakeoff({ repositoryRoot: REPOSITORY_ROOT, request, admission, clock: () => new Date().toISOString(), proveTrustedAdmission, claimSingleUse, acquireExclusiveLease, releaseExclusiveLease, collectTrustedHostAttestation, invokeFixedEvaluator })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { process.stderr.write(`${JSON.stringify({ schema_version: "1.0-hermes-granite-r2-runtime-error", status: "FAILED_CLOSED", detail: String(error?.message ?? error), claim_id: error?.claimId ?? null, lease_id: error?.leaseId ?? null, fencing_token: error?.fencingToken ?? null, dispatch_attempted: error?.dispatchAttempted === true, lease_released: error?.leaseReleased === true, scheduler_activated: false, autonomous_dispatch: false, network_used: false, container_used: false, external_provider_used: false, fallback_used: false, database_write_performed: false, vector_write_performed: false }, null, 2)}\n`); process.exitCode = 2 })
