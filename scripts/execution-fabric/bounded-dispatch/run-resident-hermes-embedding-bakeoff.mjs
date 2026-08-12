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
const HOST_ATTESTATION_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\trusted-host-attestation.json"
const MODEL_MANIFEST_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\model-manifest.json"
const RUNTIME_MANIFEST_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\runtime-manifest.json"
const HOST_MANIFEST_PATH = "C:\\HermesLab\\embedding-bakeoff-admission\\host-manifest.json"
const PYTHON_EXECUTABLE = "C:\\Python313\\python.exe"
const GIT_EXECUTABLE = "C:\\Program Files\\Git\\cmd\\git.exe"
const EVALUATOR_PATH = path.join(REPOSITORY_ROOT, EMBEDDING_CONTRACT.evaluatorPath)
const TRUSTED_MAIN_REF = "refs/heads/main"

const REVIEWED_SOURCE_BINDINGS = Object.freeze([
  [EMBEDDING_CONTRACT.evaluatorPath, "evaluator_sha256"],
  [EMBEDDING_CONTRACT.bakeoffPath, "bakeoff_sha256"],
  [EMBEDDING_CONTRACT.embedPath, "embed_sha256"],
  [EMBEDDING_CONTRACT.metricsPath, "metrics_sha256"],
  [EMBEDDING_CONTRACT.adapterPath, "adapter_sha256"],
  [EMBEDDING_CONTRACT.runnerPath, "runner_sha256"],
])

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex") }

function ensureExactRoot(root, expectedRelative) {
  const hermes = fs.realpathSync(HERMES_ROOT)
  fs.mkdirSync(root, { recursive: true })
  const real = fs.realpathSync(root)
  if (fs.lstatSync(root).isSymbolicLink() || path.relative(hermes, real).replace(/\\/g, "/") !== expectedRelative) {
    throw new Error("resident HERMES path confinement failed")
  }
  return real
}

function readFixedJson(filePath, root, label) {
  const realRoot = ensureExactRoot(root, path.basename(root))
  const real = fs.realpathSync(filePath)
  const relative = path.relative(realRoot, real)
  if (relative.startsWith("..") || path.isAbsolute(relative) || fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`${label} is outside the fixed resident HERMES packet root`)
  }
  return JSON.parse(fs.readFileSync(real, "utf8").replace(/^\uFEFF/, ""))
}

export function proveTrustedAdmission({ admission, admissionSha256 }) {
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
  const key = sha256(canonicalizeJcs({ request_id, request_sha256, admission_sha256 }))
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

export async function acquireExclusiveLease(binding) {
  const leasePath = path.join(ensureExactRoot(LEDGER_ROOT, "embedding-bakeoff-ledger"), "active-embedding-lease.json")
  const acquiredAt = new Date().toISOString()
  const leaseId = `lease-${sha256(canonicalizeJcs({ ...binding, acquired_at: acquiredAt })).slice(0, 24)}`
  let descriptor
  try {
    descriptor = fs.openSync(leasePath, "wx")
    fs.writeFileSync(descriptor, `${JSON.stringify({ schema_version: "1.0-hermes-embedding-exclusive-lease", lease_id: leaseId, ...binding, acquired_at: acquiredAt })}\n`, "utf8")
  } catch (error) {
    if (error?.code === "EEXIST") return { acquired: false, lease_id: leaseId, fencing_token: binding.fencing_token, acquired_at: acquiredAt }
    throw error
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
  return { acquired: true, lease_id: leaseId, fencing_token: binding.fencing_token, acquired_at: acquiredAt }
}

export async function releaseExclusiveLease({ lease_id, claim_id, fencing_token }) {
  const leasePath = path.join(ensureExactRoot(LEDGER_ROOT, "embedding-bakeoff-ledger"), "active-embedding-lease.json")
  const retained = JSON.parse(fs.readFileSync(leasePath, "utf8"))
  if (retained.lease_id !== lease_id || retained.claim_id !== claim_id || retained.fencing_token !== fencing_token) return false
  fs.unlinkSync(leasePath)
  return true
}

export async function collectTrustedHostAttestation({ admission }) {
  const attestation = readFixedJson(HOST_ATTESTATION_PATH, PACKET_ROOT, "trusted host attestation")
  if (sha256(fs.readFileSync(MODEL_MANIFEST_PATH)) !== admission.model.manifest_sha256
    || sha256(fs.readFileSync(RUNTIME_MANIFEST_PATH)) !== admission.runtime.manifest_sha256
    || sha256(fs.readFileSync(HOST_MANIFEST_PATH)) !== admission.placement.host_manifest_sha256) {
    throw new Error("fixed model, runtime, or host manifest bytes do not match admission")
  }
  return attestation
}

function writeExclusive(filePath, bytes) {
  let descriptor
  try {
    descriptor = fs.openSync(filePath, "wx")
    fs.writeFileSync(descriptor, bytes)
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
}

export async function invokeFixedEvaluator({ admission, host_attestation, endpoint, evaluator_path }) {
  if (endpoint !== "http://127.0.0.1:11434/api/embed" || evaluator_path !== EMBEDDING_CONTRACT.evaluatorPath
    || path.resolve(EVALUATOR_PATH) !== path.resolve(REPOSITORY_ROOT, "scripts/embedding-bakeoff/fabric_measure.py")) {
    throw new Error("fixed evaluator or loopback endpoint binding changed")
  }
  const ledgerRoot = ensureExactRoot(LEDGER_ROOT, "embedding-bakeoff-ledger")
  const modelManifest = readFixedJson(MODEL_MANIFEST_PATH, PACKET_ROOT, "model manifest")
  const runtimeManifest = readFixedJson(RUNTIME_MANIFEST_PATH, PACKET_ROOT, "runtime manifest")
  const hostManifest = readFixedJson(HOST_MANIFEST_PATH, PACKET_ROOT, "host manifest")
  const evaluatorInput = Buffer.from(`${canonicalizeJcs({
    schema_version: "1.0-r1b-fabric-measurement-envelope",
    model: admission.model.model_id,
    model_manifest: modelManifest,
    runtime_manifest: runtimeManifest,
    host_manifest: hostManifest,
  })}\n`, "utf8")
  if (evaluatorInput.byteLength > admission.limits.max_input_bytes) throw new Error("fixed evaluator input exceeds admitted ceiling")
  const executionKey = sha256(canonicalizeJcs({ admission, host_attestation }))
  const sealedInputPath = path.join(ledgerRoot, `sealed-${executionKey}.json`)
  const resultPath = path.join(ledgerRoot, `result-${executionKey}.json`)
  if (evaluatorInput.byteLength > admission.limits.max_scratch_bytes) throw new Error("sealed input exceeds admitted scratch ceiling")
  writeExclusive(sealedInputPath, evaluatorInput)
  const run = spawnSync(PYTHON_EXECUTABLE, [EVALUATOR_PATH], {
    cwd: path.dirname(EVALUATOR_PATH), windowsHide: true, timeout: admission.limits.timeout_ms,
    maxBuffer: admission.limits.max_result_bytes, input: evaluatorInput,
    env: {
      PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1",
      SystemRoot: "C:\\WINDOWS", WINDIR: "C:\\WINDOWS",
      TEMP: "C:\\HermesLab\\work", TMP: "C:\\HermesLab\\work",
    },
  })
  if (run.status !== 0) throw new Error(`fixed embedding evaluator failed with status ${run.status ?? "none"}`)
  const resultBytes = Buffer.from(run.stdout)
  if (resultBytes.byteLength > admission.limits.max_result_bytes) throw new Error("fixed evaluator result exceeds admitted ceiling")
  if (evaluatorInput.byteLength + resultBytes.byteLength > admission.limits.max_scratch_bytes) throw new Error("fixed evaluator artifacts exceed admitted scratch ceiling")
  writeExclusive(resultPath, resultBytes)
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
    external_provider_used: false, fallback_used: false,
  }
}

async function main() {
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
