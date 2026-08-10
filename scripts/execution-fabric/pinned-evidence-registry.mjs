import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import os from "node:os"

import { canonicalizeJcs } from "./canonical-json.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const OBSERVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

function fail(message) {
  throw new Error(`FABRIC_PINNED_EVIDENCE_INVALID: ${message}`)
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function strings(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    fail(`${label} must be an array of non-empty strings`)
  }
  if (new Set(value).size !== value.length) fail(`${label} contains duplicates`)
  return value
}

function exactKeys(value, expected, label) {
  if (!object(value)) fail(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} must contain exactly: ${wanted.join(", ")}`)
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`)
  return value
}

function stringValue(value, label) {
  if (typeof value !== "string") fail(`${label} must be a string`)
  return value
}

function finite(value, label, { integer = false, minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < minimum || value > maximum) {
    fail(`${label} must be ${integer ? "an integer" : "a number"} between ${minimum} and ${maximum}`)
  }
  return value
}

function numericText(value, label, options) {
  text(value, label)
  return finite(Number(value), label, options)
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} must be one of: ${allowed.join(", ")}`)
  return value
}

function validatePolicy(policy) {
  if (!object(policy)
    || policy.schema_version !== "0.2-pinned-evidence-policy"
    || policy.recommendation_only !== true
    || policy.canonicalization_contract !== "jcs-rfc8785/1"
    || !SHA256.test(policy.reference_verifier_sha256)
    || !object(policy.required_evidence)) {
    fail("pinned evidence policy contract is invalid")
  }
  exactKeys(policy, [
    "schema_version", "recommendation_only", "canonicalization_contract",
    "reference_verifier_sha256", "required_evidence",
  ], "pinned evidence policy")
  for (const [node, rule] of Object.entries(policy.required_evidence)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(node)) fail(`invalid policy node identity: ${node}`)
    exactKeys(rule, ["schema", "ttl_seconds"], `policy.required_evidence.${node}`)
    text(rule.schema, `policy.required_evidence.${node}.schema`)
    finite(rule.ttl_seconds, `policy.required_evidence.${node}.ttl_seconds`, { integer: true, minimum: 1 })
  }
  return policy
}

function verifyReferenceIdentity(verifier, expectedSha256) {
  let bytes
  try {
    bytes = fs.readFileSync(path.resolve(verifier))
  } catch (error) {
    fail(`unable to read reference verifier: ${error.message}`)
  }
  const actual = crypto.createHash("sha256").update(bytes).digest("hex")
  if (actual !== expectedSha256) fail(`reference verifier digest mismatch: expected ${expectedSha256}, received ${actual}`)
  return { sha256: actual, bytes }
}

function verifyWithReference({ python, verifier, snapshotRoot, references }) {
  if (!/^(?:py|python|python3)(?:\.exe)?$/i.test(python)) fail("Python interpreter must be py, python, or python3")
  const result = spawnSync(python, [verifier, snapshotRoot], {
    cwd: path.dirname(verifier),
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.error) fail(`reference verifier could not start: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    fail(`reference verifier rejected snapshot store${detail ? `: ${detail}` : ""}`)
  }
  if (result.stderr.trim() !== "") fail(`reference verifier wrote unexpected stderr: ${result.stderr.trim()}`)
  const lines = result.stdout.trim().split(/\r?\n/)
  const expectedLines = [...references].sort((left, right) => left.node < right.node ? -1 : 1).map((reference) =>
    `OK   ${reference.node} recomputed=${reference.snapshot_sha256.slice(0, 12)}.. filename=${reference.snapshot_sha256.slice(0, 12)}.. embedded=${reference.snapshot_sha256.slice(0, 12)}..`)
  expectedLines.push(`VERIFY snapshots=${references.length} fails=0`)
  if (JSON.stringify(lines) !== JSON.stringify(expectedLines)) fail("reference verifier output did not enumerate the exact staged snapshot set")
  return { verifier_stdout: result.stdout.trim(), verifier_stderr: "" }
}

function snapshotPath(root, node, sha256) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(node)) fail(`invalid node identity: ${node}`)
  if (!SHA256.test(sha256)) fail(`invalid snapshot SHA-256 for ${node}`)
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, node, `${sha256}.json`)
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(`snapshot path escapes root for ${node}`)
  return resolved
}

function validateHermes(snapshot) {
  exactKeys(snapshot, [
    "schema", "canonicalization", "node", "observed_at", "scheduler", "resources", "node_health",
    "compute_capability_health", "gpu_inference_capability_health", "gpu_reason",
    "local_llm_capability_health", "local_llm_reason", "limits", "model_inventory", "workload_classes",
    "snapshot_sha256",
  ], "hermes snapshot")
  exactKeys(snapshot.resources, [
    "cpu_cores", "cpu_threads", "cpu_load_pct", "ram_total_gb", "ram_free_gb", "c_free_gb",
    "d_free_gb", "workspace_free_gb", "docker", "gpus", "ollama", "running_workloads",
  ], "hermes.resources")
  finite(snapshot.resources.cpu_cores, "hermes.resources.cpu_cores", { integer: true, minimum: 1 })
  finite(snapshot.resources.cpu_threads, "hermes.resources.cpu_threads", { integer: true, minimum: 1 })
  finite(snapshot.resources.cpu_load_pct, "hermes.resources.cpu_load_pct", { maximum: 100 })
  for (const field of ["ram_total_gb", "ram_free_gb", "c_free_gb", "d_free_gb", "workspace_free_gb"]) {
    finite(snapshot.resources[field], `hermes.resources.${field}`)
  }
  text(snapshot.resources.docker, "hermes.resources.docker")
  oneOf(snapshot.resources.ollama, ["running", "stopped", "unavailable"], "hermes.resources.ollama")
  strings(snapshot.resources.running_workloads, "hermes.resources.running_workloads")
  if (!Array.isArray(snapshot.resources.gpus)) fail("hermes.resources.gpus must be an array")
  for (const [index, gpu] of snapshot.resources.gpus.entries()) {
    exactKeys(gpu, ["name", "vram_total_mb", "vram_free_mb", "vram_used_mb", "util_pct", "temp_c"], `hermes.resources.gpus[${index}]`)
    text(gpu.name, `hermes.resources.gpus[${index}].name`)
    for (const field of ["vram_total_mb", "vram_free_mb", "vram_used_mb"]) finite(gpu[field], `hermes.resources.gpus[${index}].${field}`, { integer: true })
    finite(gpu.util_pct, `hermes.resources.gpus[${index}].util_pct`, { maximum: 100 })
    finite(gpu.temp_c, `hermes.resources.gpus[${index}].temp_c`, { maximum: 150 })
  }
  oneOf(snapshot.node_health, ["OK", "WARN", "FAIL"], "hermes.node_health")
  for (const field of ["compute_capability_health", "gpu_inference_capability_health", "local_llm_capability_health"]) oneOf(snapshot[field], ["READY", "DEGRADED", "FAIL_CLOSED"], `hermes.${field}`)
  text(snapshot.gpu_reason, "hermes.gpu_reason")
  text(snapshot.local_llm_reason, "hermes.local_llm_reason")
  exactKeys(snapshot.limits, [
    "min_free_ram_gb", "min_free_disk_gb", "gpu_vram_headroom_mb", "max_concurrent_ai_jobs",
    "inference_fail_closed_when", "do_not_fail_node_when",
  ], "hermes.limits")
  for (const field of ["min_free_ram_gb", "min_free_disk_gb", "gpu_vram_headroom_mb", "max_concurrent_ai_jobs"]) finite(snapshot.limits[field], `hermes.limits.${field}`, { integer: true, minimum: 1 })
  strings(snapshot.limits.inference_fail_closed_when, "hermes.limits.inference_fail_closed_when")
  strings(snapshot.limits.do_not_fail_node_when, "hermes.limits.do_not_fail_node_when")
  if (!Array.isArray(snapshot.model_inventory)) fail("hermes.model_inventory must be an array")
  for (const [index, model] of snapshot.model_inventory.entries()) {
    exactKeys(model, ["name", "id", "size_gb", "params", "quantization", "est_vram_mb", "fits_gpu", "preferred_path", "latency_class", "task_class"], `hermes.model_inventory[${index}]`)
    for (const field of ["name", "id", "params", "quantization", "preferred_path", "latency_class", "task_class"]) text(model[field], `hermes.model_inventory[${index}].${field}`)
    finite(model.size_gb, `hermes.model_inventory[${index}].size_gb`)
    finite(model.est_vram_mb, `hermes.model_inventory[${index}].est_vram_mb`, { integer: true })
    if (typeof model.fits_gpu !== "boolean") fail(`hermes.model_inventory[${index}].fits_gpu must be boolean`)
  }
  exactKeys(snapshot.workload_classes, ["ready", "pending_or_reject"], "hermes.workload_classes")
  strings(snapshot.workload_classes.ready, "hermes.workload_classes.ready")
  strings(snapshot.workload_classes.pending_or_reject, "hermes.workload_classes.pending_or_reject")
  if (snapshot.resources.ram_free_gb > snapshot.resources.ram_total_gb) fail("hermes free RAM exceeds total RAM")
  if (snapshot.gpu_inference_capability_health === "READY") {
    if (snapshot.resources.gpus.length === 0) fail("hermes GPU inference READY requires a GPU")
    if (snapshot.resources.gpus.every((gpu) => gpu.vram_free_mb < snapshot.limits.gpu_vram_headroom_mb)) fail("hermes GPU inference READY lacks VRAM headroom")
  }
  if (snapshot.local_llm_capability_health === "READY") {
    if (snapshot.resources.ollama !== "running") fail("hermes local LLM READY requires Ollama running")
    if (snapshot.model_inventory.length === 0) fail("hermes local LLM READY requires a model")
    if (snapshot.resources.ram_free_gb < snapshot.limits.min_free_ram_gb) fail("hermes local LLM READY lacks RAM headroom")
  }
}

function validateAtlas(snapshot) {
  exactKeys(snapshot, [
    "schema", "canonicalization", "node", "observed_at", "scheduler", "resources", "node_health",
    "state_capability_health", "state_reason", "retrieval_capability_health", "retrieval_reason",
    "storage_capability_health", "storage_reason", "thresholds", "placement_constraints", "workload_classes",
    "snapshot_sha256",
  ], "atlas snapshot")
  exactKeys(snapshot.resources, [
    "cores", "load1", "ram_total_mb", "ram_avail_pct", "root_free_gb", "forge", "forge_free_gb",
    "forge_smart", "io_pressure_avg10", "cpu_pressure_avg10", "nic", "postgres", "mongo", "redis",
  ], "atlas.resources")
  finite(snapshot.resources.cores, "atlas.resources.cores", { integer: true, minimum: 1 })
  finite(snapshot.resources.ram_total_mb, "atlas.resources.ram_total_mb", { integer: true, minimum: 1 })
  finite(snapshot.resources.ram_avail_pct, "atlas.resources.ram_avail_pct", { maximum: 100 })
  finite(snapshot.resources.root_free_gb, "atlas.resources.root_free_gb")
  finite(snapshot.resources.forge_free_gb, "atlas.resources.forge_free_gb")
  for (const field of ["load1", "io_pressure_avg10", "cpu_pressure_avg10"]) numericText(snapshot.resources[field], `atlas.resources.${field}`)
  oneOf(snapshot.resources.forge, ["mounted", "unmounted"], "atlas.resources.forge")
  oneOf(snapshot.resources.forge_smart, ["PASSED", "FAILED", "UNKNOWN"], "atlas.resources.forge_smart")
  text(snapshot.resources.nic, "atlas.resources.nic")
  for (const field of ["postgres", "mongo", "redis"]) oneOf(snapshot.resources[field], ["ready", "running", "unavailable", "stopped"], `atlas.resources.${field}`)
  oneOf(snapshot.node_health, ["OK", "WARN", "FAIL"], "atlas.node_health")
  for (const field of ["state_capability_health", "retrieval_capability_health", "storage_capability_health"]) oneOf(snapshot[field], ["READY", "DEGRADED", "FAIL_CLOSED"], `atlas.${field}`)
  for (const field of ["state_reason", "retrieval_reason", "storage_reason"]) text(snapshot[field], `atlas.${field}`)
  exactKeys(snapshot.thresholds, ["min_ram_headroom_pct", "min_forge_free_gb", "io_pressure_cutoff", "max_load_for_optional"], "atlas.thresholds")
  finite(snapshot.thresholds.min_ram_headroom_pct, "atlas.thresholds.min_ram_headroom_pct", { maximum: 100 })
  finite(snapshot.thresholds.min_forge_free_gb, "atlas.thresholds.min_forge_free_gb")
  finite(snapshot.thresholds.io_pressure_cutoff, "atlas.thresholds.io_pressure_cutoff")
  finite(snapshot.thresholds.max_load_for_optional, "atlas.thresholds.max_load_for_optional")
  strings(snapshot.placement_constraints, "atlas.placement_constraints")
  exactKeys(snapshot.workload_classes, ["ready_with_headroom", "disfavored", "reject"], "atlas.workload_classes")
  for (const field of ["ready_with_headroom", "disfavored", "reject"]) strings(snapshot.workload_classes[field], `atlas.workload_classes.${field}`)
  if (snapshot.state_capability_health === "READY" && ["postgres", "mongo", "redis"].some((field) => !["ready", "running"].includes(snapshot.resources[field]))) fail("atlas state READY requires healthy databases")
  if (snapshot.storage_capability_health === "READY") {
    if (snapshot.resources.forge !== "mounted" || snapshot.resources.forge_smart !== "PASSED") fail("atlas storage READY requires mounted healthy Forge")
    if (snapshot.resources.forge_free_gb < snapshot.thresholds.min_forge_free_gb) fail("atlas storage READY lacks Forge headroom")
  }
}

function validateAegis(snapshot) {
  exactKeys(snapshot, [
    "schema", "canonicalization", "node", "observed_at", "timestamp", "status", "root_avail_gb",
    "root_use_pct", "docker_active", "docker_disk", "portainer_agent", "load1", "cores", "cpu_temp_c",
    "ram_total_mb", "ram_avail_pct", "smart", "nic", "storage_role", "node_health",
    "compute_capability_health", "backup_capability_health", "archive_capability_health", "backup_reason",
    "scheduler", "backup", "issues", "snapshot_sha256",
  ], "aegis snapshot")
  text(snapshot.timestamp, "aegis.timestamp")
  oneOf(snapshot.status, ["ok", "warn", "fail"], "aegis.status")
  finite(snapshot.root_avail_gb, "aegis.root_avail_gb")
  finite(snapshot.root_use_pct, "aegis.root_use_pct", { maximum: 100 })
  for (const field of ["docker_active", "docker_disk", "portainer_agent", "smart", "nic", "storage_role", "backup_reason"]) text(snapshot[field], `aegis.${field}`)
  stringValue(snapshot.issues, "aegis.issues")
  numericText(snapshot.load1, "aegis.load1")
  finite(snapshot.cores, "aegis.cores", { integer: true, minimum: 1 })
  numericText(snapshot.cpu_temp_c, "aegis.cpu_temp_c", { maximum: 150 })
  finite(snapshot.ram_total_mb, "aegis.ram_total_mb", { integer: true, minimum: 1 })
  finite(snapshot.ram_avail_pct, "aegis.ram_avail_pct", { maximum: 100 })
  oneOf(snapshot.node_health, ["OK", "WARN", "FAIL"], "aegis.node_health")
  for (const field of ["compute_capability_health", "backup_capability_health", "archive_capability_health"]) oneOf(snapshot[field], ["READY", "DEGRADED", "FAIL_CLOSED"], `aegis.${field}`)
  exactKeys(snapshot.backup, ["last_backup", "last_restore_verify", "age_hours", "capability", "reason", "threshold_hours"], "aegis.backup")
  for (const field of ["last_backup", "last_restore_verify", "reason"]) text(snapshot.backup[field], `aegis.backup.${field}`)
  numericText(snapshot.backup.age_hours, "aegis.backup.age_hours")
  oneOf(snapshot.backup.capability, ["READY", "DEGRADED", "FAIL_CLOSED"], "aegis.backup.capability")
  finite(snapshot.backup.threshold_hours, "aegis.backup.threshold_hours", { integer: true, minimum: 1 })
}

const VALIDATORS = {
  "hermes-placement-readiness/1": validateHermes,
  "atlas-placement-readiness/1": validateAtlas,
  "aegis-capability/1": validateAegis,
}

function parseVerifiedSnapshot(bytes, reference, policy) {
  let snapshot
  try {
    snapshot = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  } catch (error) {
    fail(`unable to parse ${reference.node} snapshot: ${error.message}`)
  }
  if (!object(snapshot)) fail(`${reference.node} snapshot must be an object`)
  if (snapshot.node !== reference.node) fail(`${reference.node} snapshot embeds node ${String(snapshot.node)}`)
  if (snapshot.snapshot_sha256 !== reference.snapshot_sha256) fail(`${reference.node} embedded hash mismatch`)
  if (snapshot.canonicalization !== policy.canonicalization_contract) fail(`${reference.node} canonicalization mismatch`)
  const rule = policy.required_evidence[reference.node]
  if (snapshot.schema !== rule.schema) fail(`${reference.node} schema must be ${rule.schema}`)
  if (typeof snapshot.observed_at !== "string" || !OBSERVED_AT.test(snapshot.observed_at)
    || !Number.isFinite(Date.parse(snapshot.observed_at))) {
    fail(`${reference.node} observed_at must be UTC RFC 3339`)
  }
  if (snapshot.scheduler !== "OFF") fail(`${reference.node} snapshot does not preserve scheduler OFF`)
  const validator = VALIDATORS[snapshot.schema]
  if (!validator) fail(`unsupported snapshot schema: ${snapshot.schema}`)
  validator(snapshot)
  return { reference, snapshot, ttl_seconds: rule.ttl_seconds }
}

function stageReferencedBytes(snapshotRoot, references) {
  const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-pinned-evidence-"))
  const items = []
  try {
    for (const reference of references) {
      const sourcePath = snapshotPath(snapshotRoot, reference.node, reference.snapshot_sha256)
      let bytes
      try {
        bytes = fs.readFileSync(sourcePath)
      } catch (error) {
        fail(`unable to read ${reference.node} snapshot: ${error.message}`)
      }
      const directory = path.join(stagedRoot, reference.node)
      fs.mkdirSync(directory, { recursive: true })
      const stagedPath = path.join(directory, `${reference.snapshot_sha256}.json`)
      fs.writeFileSync(stagedPath, bytes, { flag: "wx" })
      fs.chmodSync(stagedPath, 0o444)
      items.push({ reference, bytes, stagedPath })
    }
    return { stagedRoot, items }
  } catch (error) {
    fs.rmSync(stagedRoot, { recursive: true, force: true })
    throw error
  }
}

export function loadPinnedEvidence({ snapshotRoot, references, policy, verifier, python = "python3" }) {
  validatePolicy(policy)
  if (!Array.isArray(references)) fail("evidence references must be an array")
  const normalized = references.map((reference) => {
    if (!object(reference) || Object.keys(reference).sort().join(",") !== "node,snapshot_sha256") {
      fail("each evidence reference must contain exactly node and snapshot_sha256")
    }
    return { node: reference.node, snapshot_sha256: reference.snapshot_sha256 }
  }).sort((left, right) => left.node < right.node ? -1 : left.node > right.node ? 1 : 0)
  const identities = normalized.map((entry) => entry.node)
  if (new Set(identities).size !== identities.length) fail("duplicate evidence node reference")
  const expected = Object.keys(policy.required_evidence).sort()
  if (JSON.stringify([...identities].sort()) !== JSON.stringify(expected)) {
    fail(`evidence node set must be exactly: ${expected.join(", ")}`)
  }
  const verifierIdentity = verifyReferenceIdentity(verifier, policy.reference_verifier_sha256)
  const staged = stageReferencedBytes(snapshotRoot, normalized)
  try {
    const stagedVerifier = path.join(staged.stagedRoot, "verify_snapshot.py")
    fs.writeFileSync(stagedVerifier, verifierIdentity.bytes, { flag: "wx" })
    fs.chmodSync(stagedVerifier, 0o444)
    const verification = verifyWithReference({
      python,
      verifier: stagedVerifier,
      snapshotRoot: staged.stagedRoot,
      references: normalized,
    })
    for (const item of staged.items) {
      const afterVerification = fs.readFileSync(item.stagedPath)
      if (!afterVerification.equals(item.bytes)) fail(`${item.reference.node} staged snapshot bytes changed during verification`)
    }
    const loaded = staged.items.map((item) => parseVerifiedSnapshot(item.bytes, item.reference, policy))
    return { loaded, verification, verifier_sha256: verifierIdentity.sha256 }
  } finally {
    for (const item of staged.items) {
      try { fs.chmodSync(item.stagedPath, 0o644) } catch {}
    }
    try { fs.chmodSync(path.join(staged.stagedRoot, "verify_snapshot.py"), 0o644) } catch {}
    fs.rmSync(staged.stagedRoot, { recursive: true, force: true })
  }
}

export function loadPinnedEvidenceInProcess({ snapshotRoot, references, policy, verifier }) {
  validatePolicy(policy)
  if (!Array.isArray(references)) fail("evidence references must be an array")
  const normalized = references.map((reference) => {
    if (!object(reference) || Object.keys(reference).sort().join(",") !== "node,snapshot_sha256") {
      fail("each evidence reference must contain exactly node and snapshot_sha256")
    }
    return { node: reference.node, snapshot_sha256: reference.snapshot_sha256 }
  }).sort((left, right) => left.node < right.node ? -1 : left.node > right.node ? 1 : 0)
  const identities = normalized.map((entry) => entry.node)
  if (new Set(identities).size !== identities.length) fail("duplicate evidence node reference")
  const expected = Object.keys(policy.required_evidence).sort()
  if (JSON.stringify([...identities].sort()) !== JSON.stringify(expected)) {
    fail(`evidence node set must be exactly: ${expected.join(", ")}`)
  }
  const verifierIdentity = verifyReferenceIdentity(verifier, policy.reference_verifier_sha256)
  const staged = stageReferencedBytes(snapshotRoot, normalized)
  try {
    const stagedVerifier = path.join(staged.stagedRoot, "verify_snapshot.py")
    fs.writeFileSync(stagedVerifier, verifierIdentity.bytes, { flag: "wx" })
    fs.chmodSync(stagedVerifier, 0o444)
    const output = []
    for (const item of staged.items) {
      let snapshot
      try {
        snapshot = JSON.parse(item.bytes.toString("utf8").replace(/^\uFEFF/, ""))
      } catch (error) {
        fail(`unable to parse ${item.reference.node} snapshot during in-process verification: ${error.message}`)
      }
      const embedded = snapshot?.snapshot_sha256
      const canonicalValue = structuredClone(snapshot)
      if (object(canonicalValue)) delete canonicalValue.snapshot_sha256
      const recomputed = crypto.createHash("sha256").update(canonicalizeJcs(canonicalValue)).digest("hex")
      if (recomputed !== item.reference.snapshot_sha256 || embedded !== item.reference.snapshot_sha256) {
        fail(`${item.reference.node} in-process canonical snapshot verification failed`)
      }
      output.push(`OK   ${item.reference.node} recomputed=${recomputed.slice(0, 12)}.. filename=${recomputed.slice(0, 12)}.. embedded=${recomputed.slice(0, 12)}..`)
    }
    output.push(`VERIFY snapshots=${normalized.length} fails=0`)
    for (const item of staged.items) {
      const afterVerification = fs.readFileSync(item.stagedPath)
      if (!afterVerification.equals(item.bytes)) fail(`${item.reference.node} staged snapshot bytes changed during verification`)
    }
    const loaded = staged.items.map((item) => parseVerifiedSnapshot(item.bytes, item.reference, policy))
    return {
      loaded,
      verification: { verifier_stdout: output.join("\n"), verifier_stderr: "" },
      verifier_sha256: verifierIdentity.sha256,
    }
  } finally {
    for (const item of staged.items) {
      try { fs.chmodSync(item.stagedPath, 0o644) } catch {}
    }
    try { fs.chmodSync(path.join(staged.stagedRoot, "verify_snapshot.py"), 0o644) } catch {}
    fs.rmSync(staged.stagedRoot, { recursive: true, force: true })
  }
}

function capabilitySet(node) {
  return new Set(node.capabilities)
}

function retainCapabilities(node, health, names) {
  if (health === "READY") return
  const removed = new Set(names)
  node.capabilities = node.capabilities.filter((capability) => !removed.has(capability))
}

function runtime(node, id) {
  return node.runtimes.find((candidate) => candidate.id === id)
}

function pinnedCapabilityAxis(item, state, reason) {
  const observedAt = item.snapshot.observed_at
  const observedMs = Date.parse(observedAt)
  const expiresAt = new Date(observedMs + item.ttl_seconds * 1000).toISOString()
  return {
    state,
    reason,
    observed_at: observedAt,
    expires_at: expiresAt,
    snapshot_sha256: item.reference.snapshot_sha256,
    evidence_ref: `snapshots/${item.reference.node}/${item.reference.snapshot_sha256}.json`,
  }
}

function capabilityReason(name, state) {
  return state === "READY" ? `${name}_CAPABILITY_READY` : `${name}_CAPABILITY_${state}`
}

function adaptHermes(node, snapshot, item) {
  retainCapabilities(node, snapshot.compute_capability_health, ["agent-runtime"])
  retainCapabilities(node, snapshot.gpu_inference_capability_health, ["gpu-batch", "cuda"])
  retainCapabilities(node, snapshot.local_llm_capability_health, ["local-llm-inference"])
  node.capability_health.compute = pinnedCapabilityAxis(
    item,
    snapshot.compute_capability_health,
    capabilityReason("COMPUTE", snapshot.compute_capability_health),
  )
  if (snapshot.compute_capability_health === "READY" && node.cpus[0]) node.cpus[0].threads = snapshot.resources.cpu_threads
  else node.cpus = []
  node.gpus = snapshot.resources.gpus.map((gpu, index) => ({
    id: `gpu${index}`,
    vendor: gpu.name.toLowerCase().includes("nvidia") ? "NVIDIA" : null,
    model: gpu.name,
    pci_bus_id: null,
    uuid: null,
    vram_bytes: gpu.vram_total_mb * 1024 * 1024,
    driver_version: null,
    cuda_version: null,
    compute_capability: null,
    temperature_c: gpu.temp_c,
    utilization_percent: gpu.util_pct,
  }))
  const ollama = runtime(node, "ollama")
  if (ollama) ollama.state = snapshot.resources?.ollama === "running" && snapshot.local_llm_capability_health === "READY" ? "running" : "degraded"
}

function adaptAtlas(node, snapshot) {
  retainCapabilities(node, snapshot.state_capability_health, ["database-state"])
  retainCapabilities(node, snapshot.retrieval_capability_health, ["retrieval-index"])
  retainCapabilities(node, snapshot.storage_capability_health, ["forge-storage", "backup-archive"])
  if (node.cpus[0]) node.cpus[0].threads = snapshot.resources.cores
  for (const id of ["postgres", "redis", "mongo"]) {
    const candidate = runtime(node, id)
    if (candidate) candidate.state = snapshot.resources?.[id] === "ready" || snapshot.resources?.[id] === "running" ? "running" : "degraded"
  }
  const forge = runtime(node, "forge")
  if (forge) forge.state = snapshot.resources?.forge === "mounted" && snapshot.storage_capability_health === "READY" ? "running" : "degraded"
}

function adaptAegis(node, snapshot, item) {
  retainCapabilities(node, snapshot.compute_capability_health, [...capabilitySet(node)])
  node.capability_health.compute = pinnedCapabilityAxis(
    item,
    snapshot.compute_capability_health,
    capabilityReason("COMPUTE", snapshot.compute_capability_health),
  )
  node.capability_health.backup_target = pinnedCapabilityAxis(
    item,
    snapshot.backup_capability_health,
    snapshot.backup_reason,
  )
  node.capability_health.archive_storage = pinnedCapabilityAxis(
    item,
    snapshot.archive_capability_health,
    snapshot.backup_reason,
  )
  if (snapshot.compute_capability_health === "READY" && node.cpus[0]) node.cpus[0].threads = snapshot.cores
  else node.cpus = []
}

const ADAPTERS = {
  "hermes-placement-readiness/1": adaptHermes,
  "atlas-placement-readiness/1": adaptAtlas,
  "aegis-capability/1": adaptAegis,
}

export function applyPinnedEvidence(registryInput, loaded) {
  const registry = structuredClone(registryInput)
  const authorityBefore = JSON.stringify(registry.nodes.map((node) => [node.id, node.authority]))
  const nodes = new Map(registry.nodes.map((node) => [node.id, node]))
  for (const item of loaded) {
    const node = nodes.get(item.reference.node)
    if (!node) fail(`snapshot node is absent from registry: ${item.reference.node}`)
    const adapter = ADAPTERS[item.snapshot.schema]
    if (!adapter) fail(`unsupported snapshot schema: ${item.snapshot.schema}`)
    adapter(node, item.snapshot, item)
    node.evidence = {
      confidence: "observed",
      observed_at: item.snapshot.observed_at,
      probe: `pinned snapshot ${item.reference.snapshot_sha256}`,
      probe_version: item.snapshot.schema,
      ttl_seconds: item.ttl_seconds,
      notes: `Verified ${item.snapshot.canonicalization} evidence; scheduler ${item.snapshot.scheduler}.`,
    }
  }
  if (JSON.stringify(registry.nodes.map((node) => [node.id, node.authority])) !== authorityBefore) {
    fail("pinned evidence adapter mutated authority")
  }
  return registry
}
