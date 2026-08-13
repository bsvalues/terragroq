import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { EMBEDDING_CONTRACT, executeResidentHermesEmbeddingBakeoff } from "./resident-hermes-embedding-bakeoff.mjs"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const HERMES_ROOT = "C:\\HermesLab"
const PACKET_ROOT = "C:\\HermesLab\\embedding-bakeoff-admission"
const LEDGER_ROOT = "C:\\HermesLab\\embedding-bakeoff-ledger"
const REQUEST_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\request.json"
const ADMISSION_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\admission.json"
const MODEL_MANIFEST_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\model-manifest.json"
const RUNTIME_MANIFEST_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\runtime-manifest.json"
const HOST_MANIFEST_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\host-manifest.json"
const PYTHON_EXECUTABLE = "C:\\Python313\\python.exe"
const NODE_EXECUTABLE = "C:\\Program Files\\nodejs\\node.exe"
const POWERSHELL_EXECUTABLE = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
const DOCKER_EXECUTABLE = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"
const NVIDIA_SMI_EXECUTABLE = "C:\\WINDOWS\\system32\\nvidia-smi.exe"
const GIT_EXECUTABLE = "C:\\Program Files\\Git\\cmd\\git.exe"
const EVALUATOR_PATH = path.join(REPOSITORY_ROOT, EMBEDDING_CONTRACT.evaluatorPath)
const COLLECTOR_PATH = path.join(REPOSITORY_ROOT, EMBEDDING_CONTRACT.collectorPath)
const BOUNDED_LAUNCHER_PATH = path.join(REPOSITORY_ROOT, EMBEDDING_CONTRACT.boundedLauncherPath)
const TRUSTED_MAIN_REF = "refs/heads/main"

const REVIEWED_SOURCE_BINDINGS = Object.freeze([
  [EMBEDDING_CONTRACT.evaluatorPath, "evaluator_sha256"],
  [EMBEDDING_CONTRACT.bakeoffPath, "bakeoff_sha256"],
  [EMBEDDING_CONTRACT.embedPath, "embed_sha256"],
  [EMBEDDING_CONTRACT.metricsPath, "metrics_sha256"],
  [EMBEDDING_CONTRACT.canonicalJsonPath, "canonical_json_sha256"],
  [EMBEDDING_CONTRACT.collectorPath, "collector_sha256"],
  [EMBEDDING_CONTRACT.boundedLauncherPath, "bounded_launcher_sha256"],
  [EMBEDDING_CONTRACT.adapterPath, "adapter_sha256"],
  [EMBEDDING_CONTRACT.runnerPath, "runner_sha256"],
])

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex") }
function canonicalDigest(value) { return sha256(canonicalizeJcs(value)) }

function ensureExactRoot(root, expectedRelative) {
  const hermes = fs.realpathSync(HERMES_ROOT)
  fs.mkdirSync(root, { recursive: true })
  const real = fs.realpathSync(root)
  if (fs.lstatSync(root).isSymbolicLink() || path.relative(hermes, real).replace(/\\/g, "/") !== expectedRelative) {
    throw new Error("resident HERMES path confinement failed")
  }
  return real
}

function readFixedBytes(filePath, root, label) {
  const realRoot = ensureExactRoot(root, path.basename(root))
  const real = fs.realpathSync(filePath)
  const relative = path.relative(realRoot, real)
  if (relative.startsWith("..") || path.isAbsolute(relative) || fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`${label} is outside the fixed resident HERMES packet root`)
  }
  return fs.readFileSync(real)
}

function readFixedJson(filePath, root, label) {
  return JSON.parse(readFixedBytes(filePath, root, label).toString("utf8").replace(/^\uFEFF/, ""))
}

export function proveTrustedAdmission({ admission, admissionSha256 }) {
  if (sha256(fs.readFileSync(GIT_EXECUTABLE)) !== admission.runtime.git_executable_sha256) {
    throw new Error("trusted Git executable bytes do not match admission")
  }
  const git = (...args) => {
    const result = spawnSync(GIT_EXECUTABLE, args, {
      cwd: REPOSITORY_ROOT,
      encoding: null,
      windowsHide: true,
      env: {
        SystemRoot: "C:\\WINDOWS",
        WINDIR: "C:\\WINDOWS",
        TEMP: "C:\\HermesLab\\work",
        TMP: "C:\\HermesLab\\work",
        PATH: "C:\\Program Files\\Git\\cmd;C:\\WINDOWS\\System32",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "NUL",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    })
    if (result.status !== 0) throw new Error("trusted-main embedding admission proof failed")
    return Buffer.from(result.stdout)
  }
  const gitText = (...args) => git(...args).toString("utf8").trim()
  git("merge-base", "--is-ancestor", admission.execution_commit, TRUSTED_MAIN_REF)
  if (gitText("rev-parse", "HEAD") !== admission.execution_commit) {
    throw new Error("resident checkout is not the exact admitted execution commit")
  }
  const closure = {}
  for (const [relativePath, digestField] of REVIEWED_SOURCE_BINDINGS) {
    const reviewed = git("show", `${admission.execution_commit}:${relativePath}`)
    const live = fs.readFileSync(path.resolve(REPOSITORY_ROOT, relativePath))
    const expected = admission.runtime[digestField]
    if (sha256(reviewed) !== expected || sha256(live) !== expected || !reviewed.equals(live)) {
      throw new Error("resident executable source closure differs from the admitted commit")
    }
    closure[relativePath] = expected
  }
  const retained = git("show", `${TRUSTED_MAIN_REF}:${EMBEDDING_CONTRACT.authorityRegistryPath}`)
  const registry = JSON.parse(retained.toString("utf8"))
  if (registry.schema_version !== "1.0-hermes-embedding-bakeoff-authority-registry"
    || registry.registry_id !== "hermes-embedding-bakeoff-authorities" || !Array.isArray(registry.entries)) {
    throw new Error("trusted-main embedding authority registry is invalid")
  }
  const exactEntryCount = registry.entries.filter((entry) => canonicalizeJcs(entry) === canonicalizeJcs(admission)).length
  return {
    schema_version: "1.0-trusted-hermes-embedding-admission-proof",
    admission_sha256: admissionSha256,
    execution_commit: admission.execution_commit,
    inventory_snapshot_sha256: admission.placement.inventory_snapshot_sha256,
    source_closure_sha256: sha256(canonicalizeJcs(closure)),
    exact_entry_count: exactEntryCount,
    verified: exactEntryCount === 1,
  }
}

export async function claimSingleUse({ request_id, request_sha256, admission_sha256, maximum_attempts }) {
  if (process.platform !== "win32") throw new Error("resident HERMES embedding execution requires Windows")
  const root = ensureExactRoot(LEDGER_ROOT, "embedding-bakeoff-ledger")
  const key = admission_sha256
  const claimPath = path.join(root, `claim-${key}.json`)
  const claimedAt = new Date().toISOString()
  let descriptor
  try {
    descriptor = fs.openSync(claimPath, "wx")
    fs.writeFileSync(descriptor, `${JSON.stringify({ schema_version: "1.0-hermes-embedding-single-use-claim", request_id, request_sha256, admission_sha256, maximum_attempts, claimed_at: claimedAt })}\n`, "utf8")
  } catch (error) {
    if (error?.code === "EEXIST") return { claimed: false, claim_id: `claim-${key.slice(0, 24)}`, claimed_at: claimedAt }
    throw error
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
  return { claimed: true, claim_id: `claim-${key.slice(0, 24)}`, claimed_at: claimedAt }
}

function holderIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true
  try { process.kill(pid, 0); return true } catch (error) { return error?.code !== "ESRCH" }
}

function allocateFencingToken(root, minimum = 1) {
  let floor = minimum - 1
  for (const name of fs.readdirSync(root)) {
    const match = /^embedding-fence-(\d+)\.json$/.exec(name)
    if (!match) continue
    const token = Number(match[1])
    if (!Number.isSafeInteger(token) || token < 1) throw new Error("embedding fence ledger is malformed")
    const fencePath = path.join(root, name)
    if (fs.lstatSync(fencePath).isSymbolicLink()) throw new Error("embedding fence ledger contains a symbolic link")
    const retained = JSON.parse(fs.readFileSync(fencePath, "utf8"))
    if (retained.schema_version !== "1.0-hermes-embedding-fence" || retained.fencing_token !== token) {
      throw new Error("embedding fence ledger content is malformed")
    }
    floor = Math.max(floor, token)
  }
  for (let candidate = floor + 1; candidate <= Number.MAX_SAFE_INTEGER; candidate += 1) {
    const fencePath = path.join(root, `embedding-fence-${candidate}.json`)
    let descriptor
    try {
      descriptor = fs.openSync(fencePath, "wx")
      fs.writeFileSync(descriptor, `${JSON.stringify({ schema_version: "1.0-hermes-embedding-fence", fencing_token: candidate, allocated_at: new Date().toISOString() })}\n`, "utf8")
      return candidate
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
  }
  throw new Error("embedding fence token space exhausted")
}

export async function acquireExclusiveLease(binding) {
  const root = ensureExactRoot(LEDGER_ROOT, "embedding-bakeoff-ledger")
  const leasePath = path.join(root, "active-embedding-lease.json")
  const acquiredAt = new Date().toISOString()
  const leaseId = `lease-${sha256(canonicalizeJcs({ ...binding, acquired_at: acquiredAt })).slice(0, 24)}`
  let staleLeaseSha256 = null
  let minimumFence = 1
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor
    try {
      const fencingToken = allocateFencingToken(root, minimumFence)
      descriptor = fs.openSync(leasePath, "wx")
      fs.writeFileSync(descriptor, `${JSON.stringify({ schema_version: "1.0-hermes-embedding-exclusive-lease", lease_id: leaseId, ...binding, fencing_token: fencingToken, holder_pid: process.pid, acquired_at: acquiredAt })}\n`, "utf8")
      return { acquired: true, lease_id: leaseId, fencing_token: fencingToken, acquired_at: acquiredAt, stale_lease_recovered: staleLeaseSha256 !== null, stale_lease_sha256: staleLeaseSha256 }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      if (attempt > 0 || fs.lstatSync(leasePath).isSymbolicLink()) {
        return { acquired: false, lease_id: leaseId, fencing_token: minimumFence, acquired_at: acquiredAt, stale_lease_recovered: false, stale_lease_sha256: null }
      }
      const retainedBytes = fs.readFileSync(leasePath)
      let retained
      try { retained = JSON.parse(retainedBytes.toString("utf8")) } catch {
        return { acquired: false, lease_id: leaseId, fencing_token: minimumFence, acquired_at: acquiredAt, stale_lease_recovered: false, stale_lease_sha256: null }
      }
      const retainedFields = ["schema_version", "lease_id", "claim_id", "request_sha256", "admission_sha256", "node_id", "fencing_token", "valid_until", "holder_pid", "acquired_at"]
      const exactRetainedFields = retained && typeof retained === "object" && !Array.isArray(retained)
        && JSON.stringify(Object.keys(retained).sort()) === JSON.stringify(retainedFields.sort())
      const canonicalExpiry = typeof retained?.valid_until === "string" && !Number.isNaN(Date.parse(retained.valid_until))
        && new Date(retained.valid_until).toISOString() === retained.valid_until
      if (!exactRetainedFields || retained.schema_version !== "1.0-hermes-embedding-exclusive-lease" || !canonicalExpiry
        || Date.parse(retained.valid_until) > Date.now() || holderIsAlive(retained.holder_pid)) {
        return { acquired: false, lease_id: leaseId, fencing_token: minimumFence, acquired_at: acquiredAt, stale_lease_recovered: false, stale_lease_sha256: null }
      }
      staleLeaseSha256 = sha256(retainedBytes)
      minimumFence = retained.fencing_token + 1
      let stalePath = path.join(path.dirname(leasePath), `stale-embedding-lease-${staleLeaseSha256}.json`)
      for (let suffix = 1; fs.existsSync(stalePath); suffix += 1) {
        if (!Number.isSafeInteger(suffix)) throw new Error("stale lease archive namespace exhausted")
        stalePath = path.join(path.dirname(leasePath), `stale-embedding-lease-${staleLeaseSha256}-${suffix}.json`)
      }
      fs.renameSync(leasePath, stalePath)
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
  }
  throw new Error("exclusive lease recovery did not converge")
}

export async function releaseExclusiveLease({ lease_id, claim_id, fencing_token }) {
  const leasePath = path.join(ensureExactRoot(LEDGER_ROOT, "embedding-bakeoff-ledger"), "active-embedding-lease.json")
  const retained = JSON.parse(fs.readFileSync(leasePath, "utf8"))
  if (retained.lease_id !== lease_id || retained.claim_id !== claim_id || retained.fencing_token !== fencing_token || retained.holder_pid !== process.pid) return false
  fs.unlinkSync(leasePath)
  return true
}

export async function collectTrustedHostAttestation({ admission }) {
  const modelManifestBytes = readFixedBytes(MODEL_MANIFEST_PATH, PACKET_ROOT, "model manifest")
  const runtimeManifestBytes = readFixedBytes(RUNTIME_MANIFEST_PATH, PACKET_ROOT, "runtime manifest")
  const hostManifestBytes = readFixedBytes(HOST_MANIFEST_PATH, PACKET_ROOT, "host manifest")
  if (sha256(modelManifestBytes) !== admission.model.manifest_sha256
    || sha256(runtimeManifestBytes) !== admission.runtime.manifest_sha256
    || sha256(hostManifestBytes) !== admission.placement.host_manifest_sha256) {
    throw new Error("fixed model, runtime, or host manifest bytes do not match admission")
  }
  if (path.resolve(process.execPath).toLowerCase() !== NODE_EXECUTABLE.toLowerCase()
    || sha256(fs.readFileSync(NODE_EXECUTABLE)) !== admission.runtime.node_executable_sha256
    || sha256(fs.readFileSync(PYTHON_EXECUTABLE)) !== admission.runtime.python_executable_sha256
    || sha256(fs.readFileSync(POWERSHELL_EXECUTABLE)) !== admission.runtime.powershell_executable_sha256
    || sha256(fs.readFileSync(DOCKER_EXECUTABLE)) !== admission.runtime.docker_executable_sha256
    || sha256(fs.readFileSync(NVIDIA_SMI_EXECUTABLE)) !== admission.runtime.nvidia_smi_executable_sha256) {
    throw new Error("resident interpreter bytes do not match admission")
  }
  const observed = spawnSync(POWERSHELL_EXECUTABLE, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", COLLECTOR_PATH], {
    cwd: path.dirname(COLLECTOR_PATH), encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1_048_576,
    env: {
      SystemRoot: "C:\\WINDOWS",
      WINDIR: "C:\\WINDOWS",
      PATH: "C:\\WINDOWS\\System32",
      WILLIAMOS_EMBEDDING_MODEL_ID: admission.model.model_id,
    },
  })
  if (observed.status !== 0 || observed.error || !observed.stdout) throw new Error("reviewed resident HERMES live collector failed")
  const live = JSON.parse(observed.stdout.replace(/^\uFEFF/, ""))
  const expectedFields = ["schema_version", "collector_id", "node_id", "machine_id_sha256", "model_id", "weights_sha256", "model_manifest_sha256", "runtime_id", "runtime_version", "runtime_executable_sha256", "container_image_sha256", "docker_executable_sha256", "git_executable_sha256", "nvidia_smi_executable_sha256", "python_executable_sha256", "node_executable_sha256", "powershell_executable_sha256", "inventory", "resources", "observed_at", "expires_at"]
  if (!live || typeof live !== "object" || Array.isArray(live)
    || JSON.stringify(Object.keys(live).sort()) !== JSON.stringify(expectedFields.sort())
    || live.schema_version !== "1.0-resident-hermes-live-embedding-observation") {
    throw new Error("reviewed resident HERMES live collector returned an invalid observation")
  }
  const attestation = {
    schema_version: "1.0-trusted-hermes-live-embedding-attestation",
    collector_id: live.collector_id,
    node_id: live.node_id,
    machine_id_sha256: live.machine_id_sha256,
    inventory_snapshot_sha256: canonicalDigest(live.inventory),
    host_manifest_sha256: sha256(hostManifestBytes),
    model_id: live.model_id,
    weights_sha256: live.weights_sha256,
    model_manifest_sha256: live.model_manifest_sha256,
    runtime_id: live.runtime_id,
    runtime_version: live.runtime_version,
    runtime_executable_sha256: live.runtime_executable_sha256,
    container_image_sha256: live.container_image_sha256,
    docker_executable_sha256: live.docker_executable_sha256,
    git_executable_sha256: live.git_executable_sha256,
    nvidia_smi_executable_sha256: live.nvidia_smi_executable_sha256,
    python_executable_sha256: live.python_executable_sha256,
    node_executable_sha256: live.node_executable_sha256,
    powershell_executable_sha256: live.powershell_executable_sha256,
    inventory: live.inventory,
    resources: live.resources,
    endpoint: EMBEDDING_CONTRACT.endpoint,
    observed_at: live.observed_at,
    expires_at: live.expires_at,
    verified: true,
  }
  attestation.attestation_sha256 = canonicalDigest(attestation)
  return attestation
}

function writeExclusive(filePath, bytes) {
  let descriptor
  try {
    descriptor = fs.openSync(filePath, "wx")
    fs.writeFileSync(descriptor, bytes)
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
}

function recoverLauncherDockerResources(executionKey) {
  const names = {
    container: `williamos-r1b-${executionKey}`,
    network: `williamos-r1b-${executionKey.slice(0, 24)}`,
  }
  const environment = {
    SystemRoot: "C:\\WINDOWS",
    WINDIR: "C:\\WINDOWS",
    PATH: "C:\\Program Files\\Docker\\Docker\\resources\\bin;C:\\WINDOWS\\System32",
  }
  const docker = (args) => spawnSync(DOCKER_EXECUTABLE, args, {
    encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 1_048_576, env: environment,
  })
  const removeOwned = (kind, name) => {
    const inspectArgs = kind === "container" ? ["container", "inspect", name] : ["network", "inspect", name]
    const inspected = docker(inspectArgs)
    if (inspected.status !== 0 || inspected.error) {
      const listArgs = kind === "container"
        ? ["container", "ls", "--all", "--quiet", "--no-trunc", "--filter", `name=^/${name}$`]
        : ["network", "ls", "--quiet", "--no-trunc", "--filter", `name=^${name}$`]
      const listed = docker(listArgs)
      if (listed.status !== 0 || listed.error) throw new Error(`bounded launcher ${kind} cleanup state is unknown`)
      return listed.stdout.trim().length === 0
    }
    const values = JSON.parse(inspected.stdout)
    if (!Array.isArray(values) || values.length !== 1) throw new Error(`bounded launcher ${kind} cleanup inspection is invalid`)
    const value = values[0]
    const label = kind === "container" ? value?.Config?.Labels?.["williamos.execution-hash"] : value?.Labels?.["williamos.execution-hash"]
    const id = value?.Id
    if (label !== executionKey || typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) {
      throw new Error(`bounded launcher ${kind} cleanup ownership drift`)
    }
    const removed = docker(kind === "container" ? ["rm", "--force", id] : ["network", "rm", id])
    if (removed.status !== 0 || removed.error) throw new Error(`bounded launcher ${kind} cleanup failed`)
    return false
  }
  let finalAbsenceCount = 0
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const containerAbsent = removeOwned("container", names.container)
    const networkAbsent = removeOwned("network", names.network)
    finalAbsenceCount = containerAbsent && networkAbsent ? finalAbsenceCount + 1 : 0
    if (attempt >= 15 && finalAbsenceCount >= 4) return true
    Atomics.wait(sleeper, 0, 0, 250)
  }
  throw new Error("bounded launcher Docker cleanup did not converge")
}

export async function invokeFixedEvaluator({ admission, host_attestation, endpoint, evaluator_path }) {
  if (endpoint !== "http://127.0.0.1:11435/api/embed" || evaluator_path !== EMBEDDING_CONTRACT.evaluatorPath
    || path.resolve(EVALUATOR_PATH) !== path.resolve(REPOSITORY_ROOT, "scripts/embedding-bakeoff/fabric_measure.py")) {
    throw new Error("fixed evaluator or loopback endpoint binding changed")
  }
  const ledgerRoot = ensureExactRoot(LEDGER_ROOT, "embedding-bakeoff-ledger")
  const modelManifest = readFixedJson(MODEL_MANIFEST_PATH, PACKET_ROOT, "model manifest")
  const runtimeManifest = readFixedJson(RUNTIME_MANIFEST_PATH, PACKET_ROOT, "runtime manifest")
  const hostManifest = readFixedJson(HOST_MANIFEST_PATH, PACKET_ROOT, "host manifest")
  const modelBinding = modelManifest?.model_id === admission.model.model_id
    && modelManifest?.revision === admission.model.revision
    && modelManifest?.weights_sha256 === admission.model.weights_sha256
    && modelManifest?.license === admission.model.license
    && modelManifest?.source === admission.model.source
    && modelManifest?.dimension === admission.model.dimension
  const runtimeBinding = runtimeManifest?.runtime_id === admission.runtime.runtime_id
    && runtimeManifest?.version === admission.runtime.version
    && runtimeManifest?.executable_sha256 === admission.runtime.executable_sha256
    && runtimeManifest?.endpoint_contract === "ollama-embed-v1"
  const hostBinding = hostManifest?.node_id === admission.placement.node_id
    && hostManifest?.machine_id_sha256 === admission.placement.machine_id_sha256
    && hostManifest?.inventory_snapshot_sha256 === admission.placement.inventory_snapshot_sha256
    && Array.isArray(hostManifest?.endpoint_hosts)
    && hostManifest.endpoint_hosts.length === 1
    && hostManifest.endpoint_hosts[0] === "127.0.0.1"
  if (!modelBinding || !runtimeBinding || !hostBinding) throw new Error("fixed manifests contradict the admitted execution identity")
  const evaluatorInput = Buffer.from(`${canonicalizeJcs({
    schema_version: "1.0-r1b-fabric-measurement-envelope",
    model: admission.model.model_id,
    model_manifest: modelManifest,
    runtime_manifest: runtimeManifest,
    host_manifest: hostManifest,
    execution_limits: { max_cpu_threads: admission.limits.max_inference_cpu_threads, gpu_execution: admission.limits.gpu_execution },
  })}\n`, "utf8")
  if (evaluatorInput.byteLength > admission.limits.max_input_bytes) throw new Error("fixed evaluator input exceeds admitted ceiling")
  const executionKey = sha256(canonicalizeJcs({ admission, host_attestation }))
  const sealedInputPath = path.join(ledgerRoot, `sealed-${executionKey}.json`)
  const resultPath = path.join(ledgerRoot, `result-${executionKey}.json`)
  if (evaluatorInput.byteLength > admission.limits.max_scratch_bytes) throw new Error("sealed input exceeds admitted scratch ceiling")
  writeExclusive(sealedInputPath, evaluatorInput)
  const affinityMask = admission.limits.max_evaluator_cpu_threads === 64
    ? "0xffffffffffffffff"
    : `0x${((1n << BigInt(admission.limits.max_evaluator_cpu_threads)) - 1n).toString(16)}`
  const run = spawnSync(POWERSHELL_EXECUTABLE, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", BOUNDED_LAUNCHER_PATH], {
    cwd: path.dirname(BOUNDED_LAUNCHER_PATH), windowsHide: true, timeout: admission.limits.timeout_ms + 30_000,
    maxBuffer: 1_048_576,
    env: {
      SystemRoot: "C:\\WINDOWS", WINDIR: "C:\\WINDOWS",
      HERMES_EMBEDDING_SEALED_INPUT_PATH: sealedInputPath,
      HERMES_EMBEDDING_RESULT_PATH: resultPath,
      HERMES_EMBEDDING_TIMEOUT_MS: String(admission.limits.timeout_ms),
      HERMES_EMBEDDING_MAX_INPUT_BYTES: String(admission.limits.max_input_bytes),
      HERMES_EMBEDDING_MAX_RESULT_BYTES: String(admission.limits.max_result_bytes),
      HERMES_EMBEDDING_MAX_SCRATCH_BYTES: String(admission.limits.max_scratch_bytes),
      HERMES_EMBEDDING_MAX_CPU_THREADS: String(admission.limits.max_inference_cpu_threads),
      HERMES_EMBEDDING_PROCESS_MEMORY_BYTES: String(admission.limits.max_evaluator_memory_bytes),
      HERMES_EMBEDDING_JOB_MEMORY_BYTES: String(admission.limits.max_evaluator_memory_bytes),
      HERMES_EMBEDDING_INFERENCE_MEMORY_BYTES: String(admission.limits.max_inference_memory_bytes),
      HERMES_EMBEDDING_CPU_RATE_PERCENT: "100",
      HERMES_EMBEDDING_CPU_AFFINITY_MASK: affinityMask,
      HERMES_EMBEDDING_ACTIVE_PROCESS_LIMIT: "1",
      HERMES_EMBEDDING_CONTAINER_IMAGE_SHA256: admission.runtime.container_image_sha256,
      HERMES_EMBEDDING_RUNTIME_EXECUTABLE_SHA256: admission.runtime.executable_sha256,
      HERMES_EMBEDDING_MODEL_ID: admission.model.model_id,
      HERMES_EMBEDDING_MODEL_MANIFEST_SHA256: admission.model.ollama_manifest_sha256,
      HERMES_EMBEDDING_WEIGHTS_SHA256: admission.model.weights_sha256,
      HERMES_EMBEDDING_EVALUATOR_SHA256: admission.runtime.evaluator_sha256,
      HERMES_EMBEDDING_BAKEOFF_SHA256: admission.runtime.bakeoff_sha256,
      HERMES_EMBEDDING_EMBED_SHA256: admission.runtime.embed_sha256,
      HERMES_EMBEDDING_METRICS_SHA256: admission.runtime.metrics_sha256,
      HERMES_EMBEDDING_CORPUS_MANIFEST_SHA256: admission.corpus.manifest_sha256,
    },
  })
  if (run.error || run.status === null) {
    recoverLauncherDockerResources(executionKey)
    throw new Error("bounded embedding launcher exceeded its parent deadline after verified cleanup")
  }
  let receipt
  try { receipt = JSON.parse(Buffer.from(run.stdout ?? []).toString("utf8").replace(/^\uFEFF/, "").trim()) } catch {
    recoverLauncherDockerResources(executionKey)
    throw new Error("bounded embedding launcher returned an invalid receipt after verified cleanup")
  }
  if (run.status !== 0 || receipt.status !== "COMPLETED" || receipt.evaluator_exit_code !== 0
    || receipt.job_assigned_before_resume !== true || receipt.external_provider_used !== false || receipt.fallback_used !== false
    || receipt.active_process_limit !== 1 || receipt.cpu_rate_percent !== 100 || receipt.cpu_affinity_mask !== affinityMask
    || receipt.process_memory_bytes !== admission.limits.max_evaluator_memory_bytes || receipt.job_memory_bytes !== admission.limits.max_evaluator_memory_bytes
    || receipt.isolated_ollama_container !== true || receipt.internal_network !== true || receipt.gpu_execution !== "CPU_ONLY"
    || receipt.container_cpu_threads !== admission.limits.max_inference_cpu_threads || receipt.container_memory_bytes !== admission.limits.max_inference_memory_bytes
    || receipt.aggregate_cpu_threads !== admission.limits.max_evaluator_cpu_threads + admission.limits.max_inference_cpu_threads
    || receipt.aggregate_memory_bytes !== admission.limits.max_evaluator_memory_bytes + admission.limits.max_inference_memory_bytes
    || receipt.runtime_reverified !== true || receipt.model_manifest_reverified !== true || receipt.model_weights_reverified !== true
    || receipt.container_pids_limit !== 64 || receipt.container_cleaned !== true || receipt.network_cleaned !== true) {
    recoverLauncherDockerResources(executionKey)
    throw new Error(`bounded embedding evaluator failed closed after verified cleanup: ${receipt.reason_code ?? "UNKNOWN"}`)
  }
  const resultBytes = readFixedBytes(resultPath, LEDGER_ROOT, "bounded evaluator result")
  if (resultBytes.byteLength > admission.limits.max_result_bytes) throw new Error("fixed evaluator result exceeds admitted ceiling")
  if (evaluatorInput.byteLength + resultBytes.byteLength > admission.limits.max_scratch_bytes) throw new Error("fixed evaluator artifacts exceed admitted scratch ceiling")
  if (receipt.result_bytes !== resultBytes.byteLength || receipt.result_sha256 !== sha256(resultBytes)) throw new Error("bounded launcher receipt does not match evaluator result")
  const result = JSON.parse(resultBytes.toString("utf8"))
  const provenance = result?.manifest?.provenance
  return {
    result_bytes: resultBytes, result_sha256: sha256(resultBytes),
    model_manifest_sha256: provenance?.model_manifest_sha256,
    runtime_manifest_sha256: provenance?.runtime_manifest_sha256,
    host_manifest_sha256: provenance?.host_manifest_sha256,
    corpus_fingerprint: result?.manifest?.corpus_fingerprint,
    model_id: result?.manifest?.model, runtime_id: provenance?.runtime?.runtime_id,
    node_id: provenance?.host?.node_id, endpoint: EMBEDDING_CONTRACT.endpoint,
    execution_receipt: receipt,
    external_provider_used: false, fallback_used: false,
  }
}

async function main() {
  if (process.platform !== "win32") throw new Error("resident HERMES embedding execution requires Windows")
  if (process.argv.length !== 2) throw new Error("resident HERMES embedding runner accepts no arguments")
  const request = readFixedJson(REQUEST_PATH, PACKET_ROOT, "embedding request")
  const admission = readFixedJson(ADMISSION_PATH, PACKET_ROOT, "embedding admission")
  const result = await executeResidentHermesEmbeddingBakeoff({ repositoryRoot: REPOSITORY_ROOT, request, admission, clock: () => new Date().toISOString(), proveTrustedAdmission, claimSingleUse, acquireExclusiveLease, releaseExclusiveLease, collectTrustedHostAttestation, invokeFixedEvaluator })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ schema_version: "1.0-hermes-embedding-runtime-error", status: "FAILED_CLOSED", detail: String(error?.message ?? error), claim_id: error?.claimId ?? null, lease_id: error?.leaseId ?? null, fencing_token: error?.fencingToken ?? null, dispatch_attempted: error?.dispatchAttempted === true, lease_released: error?.leaseReleased === true, scheduler_activated: false, autonomous_dispatch: false, fallback_used: false, external_provider_used: false }, null, 2)}\n`)
    process.exitCode = 2
  })
}
