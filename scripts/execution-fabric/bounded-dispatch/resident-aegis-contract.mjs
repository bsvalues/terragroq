import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalizeJcs } from "../canonical-json.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const GIT_SHA40 = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const AEGIS_PERMISSION_SHA256 = "9a9cb0584b23a11d00064f70e1ca8d8f126b00d5bae607396d68b925741a49c1"
const AEGIS_PROFILES_SHA256 = "83a96697443f316d236250e988be7d3a84b74146cd84894d7a0906033c509568"
const PROHIBITED_FIELD = /(?:^|_)(?:command|commands|cmd|shell|script|argv|args|executable|exec|spawn|cwd|stdin|environment|env|endpoint|credential|credentials|password|private_key|secret|token|api_key|connection_string|authorization)(?:$|_)/i
const SECRET_VALUE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b|\bAKIA[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@)/i

export class AegisBoundedContractError extends Error {
  constructor(code, detail) {
    super(`AEGIS_BOUNDED_CONTRACT_INVALID: ${code}: ${detail}`)
    this.name = "AegisBoundedContractError"
    this.code = code
  }
}

function fail(code, detail) {
  throw new AegisBoundedContractError(code, detail)
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INPUT_INVALID", `${label} must be an object`)
  return value
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("INPUT_INVALID", `${label} fields do not match the contract`)
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("INPUT_INVALID", `${label} must be a safe identifier`)
  return value
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("INPUT_INVALID", `${label} must be lowercase SHA-256`)
  return value
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INPUT_INVALID", `${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function rejectUnsafe(value, label = "request") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectUnsafe(entry, `${label}[${index}]`))
    return
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (PROHIBITED_FIELD.test(key.replace(/-/g, "_"))) fail("UNSAFE_FIELD", `${label}.${key} is prohibited`)
      rejectUnsafe(entry, `${label}.${key}`)
    }
    return
  }
  if (typeof value === "string" && SECRET_VALUE.test(value)) fail("SECRET_LIKE_VALUE", `${label} contains secret-like material`)
}

function readArtifact(repositoryRoot, relativePath, label) {
  const root = fs.realpathSync(path.resolve(repositoryRoot))
  const lexical = path.resolve(root, relativePath)
  const relative = path.relative(root, lexical)
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("PATH_ESCAPE", `${label} escapes the repository`)
  if (!fs.existsSync(lexical)) fail("TRUST_ROOT_INVALID", `${label} is unavailable`)
  let cursor = root
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component)
    if (fs.lstatSync(cursor).isSymbolicLink()) fail("PATH_ESCAPE", `${label} contains a symbolic-link component`)
  }
  const real = fs.realpathSync(lexical)
  const realRelative = path.relative(root, real)
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) fail("PATH_ESCAPE", `${label} resolves outside the repository`)
  const bytes = fs.readFileSync(real)
  try {
    return { bytes, sha256: sha256(bytes), value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) }
  } catch {
    fail("TRUST_ROOT_INVALID", `${label} is not JSON`)
  }
}

function validatePermission(value) {
  exactKeys(value, [
    "schema_version", "permission_set_id", "agent_identity", "provider_identity", "allowed_actions",
    "prohibited_actions", "maximum_concurrency", "scheduler_activation_allowed",
    "autonomous_dispatch_allowed", "storage_authority_allowed", "status",
  ], "Agent Forge permission")
  const expectedAllowed = [
    "prepare-exact-reviewed-compute-template", "write-job-scoped-scratch",
    "emit-bounded-result-evidence", "remove-owned-job-scratch",
  ]
  const expectedProhibited = [
    "arbitrary-shell", "autonomous-scheduling", "authority-mutation", "external-network-access",
    "remote-node-access", "silent-replacement", "authoritative-state-write",
    "backup-nas-archive-access", "destructive-disk-action", "privilege-escalation",
  ]
  if (value.schema_version !== "0.1-agent-forge-aegis-bounded-dispatch-permission"
    || value.permission_set_id !== "resident-aegis-bounded-compute-v1"
    || value.agent_identity !== "resident-aegis" || value.provider_identity !== "resident-aegis"
    || JSON.stringify(value.allowed_actions) !== JSON.stringify(expectedAllowed)
    || JSON.stringify(value.prohibited_actions) !== JSON.stringify(expectedProhibited)
    || value.maximum_concurrency !== 1 || value.scheduler_activation_allowed !== false
    || value.autonomous_dispatch_allowed !== false || value.storage_authority_allowed !== false
    || value.status !== "SCOPE_ONLY_NOT_AUTHORITY") {
    fail("FORGE_PERMISSION_MISMATCH", "Agent Forge permission is not the reviewed non-authority contract")
  }
}

function validateContract(value) {
  exactKeys(value, [
    "schema_version", "contract_id", "selected_node_id", "machine_identity_sha256",
    "forge_permission_path", "forge_permission_sha256", "operation_profiles_path", "operation_profiles_sha256",
    "required_execution_identity", "workspace",
    "resource_ceilings", "templates", "required_evidence", "prohibited_paths", "future_activation_prerequisites",
    "execution_authorized", "scheduler_activation_allowed",
    "autonomous_dispatch_allowed", "storage_nas_backup_authority_allowed", "status",
  ], "AEGIS contract")
  if (value.schema_version !== "0.1-aegis-bounded-dispatch-contract"
    || value.contract_id !== "resident-aegis-bounded-compute-v1" || value.selected_node_id !== "aegis"
    || value.machine_identity_sha256 !== "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b"
    || value.execution_authorized !== false || value.scheduler_activation_allowed !== false
    || value.autonomous_dispatch_allowed !== false || value.storage_nas_backup_authority_allowed !== false
    || value.status !== "NON_ACTIVE_CONTRACT") fail("TRUST_ROOT_INVALID", "AEGIS authority boundary changed")
  if (value.forge_permission_sha256 !== AEGIS_PERMISSION_SHA256) fail("TRUST_ROOT_INVALID", "AEGIS permission digest changed")
  if (value.forge_permission_path !== "config/execution-fabric/agent-forge-aegis-bounded-dispatch-permission.json") {
    fail("TRUST_ROOT_INVALID", "AEGIS permission path changed")
  }
  if (value.operation_profiles_sha256 !== AEGIS_PROFILES_SHA256) fail("TRUST_ROOT_INVALID", "AEGIS profile digest changed")
  if (value.operation_profiles_path !== "config/execution-fabric/aegis-bounded-operation-profiles.json") {
    fail("TRUST_ROOT_INVALID", "AEGIS operation profile path changed")
  }
  exactKeys(value.required_execution_identity, ["account", "privilege", "status"], "required execution identity")
  if (value.required_execution_identity.account !== "williamos-fabric"
    || value.required_execution_identity.privilege !== "non-root-no-sudo"
    || value.required_execution_identity.status !== "REQUIRED_NOT_PROVISIONED") {
    fail("TRUST_ROOT_INVALID", "dedicated execution identity requirement changed")
  }
  exactKeys(value.workspace, [
    "root", "storage_semantics", "source_mode", "symlink_policy", "hardlink_policy", "cross_device_policy",
    "minimum_free_bytes", "maximum_written_bytes",
  ], "workspace")
  if (value.workspace.root !== "/var/lib/williamos/fabric/workspaces"
    || value.workspace.storage_semantics !== "job-scoped-nvme-scratch-only"
    || value.workspace.source_mode !== "detached-reviewed-commit" || value.workspace.symlink_policy !== "reject"
    || value.workspace.hardlink_policy !== "reject" || value.workspace.cross_device_policy !== "reject") {
    fail("TRUST_ROOT_INVALID", "workspace containment changed")
  }
  integer(value.workspace.minimum_free_bytes, "workspace.minimum_free_bytes", 107374182400, 107374182400)
  integer(value.workspace.maximum_written_bytes, "workspace.maximum_written_bytes", 1, 5368709120)
  exactKeys(value.resource_ceilings, [
    "maximum_concurrency", "maximum_cpu_threads", "maximum_memory_bytes", "maximum_runtime_ms", "maximum_output_bytes",
    "maximum_processes", "maximum_file_descriptors", "maximum_stdout_bytes", "maximum_stderr_bytes",
  ], "resource ceilings")
  integer(value.resource_ceilings.maximum_concurrency, "maximum_concurrency", 1, 1)
  integer(value.resource_ceilings.maximum_cpu_threads, "maximum_cpu_threads", 1, 12)
  integer(value.resource_ceilings.maximum_memory_bytes, "maximum_memory_bytes", 1, 8589934592)
  integer(value.resource_ceilings.maximum_runtime_ms, "maximum_runtime_ms", 1000, 1800000)
  integer(value.resource_ceilings.maximum_output_bytes, "maximum_output_bytes", 1, 536870912)
  integer(value.resource_ceilings.maximum_processes, "maximum_processes", 1, 64)
  integer(value.resource_ceilings.maximum_file_descriptors, "maximum_file_descriptors", 1, 256)
  integer(value.resource_ceilings.maximum_stdout_bytes, "maximum_stdout_bytes", 1, 16777216)
  integer(value.resource_ceilings.maximum_stderr_bytes, "maximum_stderr_bytes", 1, 16777216)
  const expectedTemplates = [
    ["aegis.ci-build-test.v1", "CI_BUILD_TEST", "reviewed-repository-validation-plan", "validation-summary-and-artifact-manifest", "fixed-digest-pinned-container-profile", "job-scoped-nvme-scratch-only"],
    ["aegis.hash-verify.v1", "HASH_VERIFY", "sha256-file-manifest", "sha256-verification-receipt", "in-process-digest-pinned-module", "read-input-write-job-receipt"],
    ["aegis.compression.v1", "COMPRESSION", "reviewed-file-manifest", "tar-zstd-artifact-and-manifest", "in-process-digest-pinned-module", "job-scoped-nvme-scratch-only"],
  ]
  if (!Array.isArray(value.templates) || value.templates.length !== expectedTemplates.length) fail("TRUST_ROOT_INVALID", "template set changed")
  value.templates.forEach((template, index) => {
    exactKeys(template, ["template_id", "workload_class", "input_contract", "output_contract", "implementation_contract", "network_scope", "storage_semantics"], `template ${index}`)
    const [templateId, workloadClass, inputContract, outputContract, implementationContract, storageSemantics] = expectedTemplates[index]
    if (template.template_id !== templateId || template.workload_class !== workloadClass
      || template.input_contract !== inputContract || template.output_contract !== outputContract
      || template.implementation_contract !== implementationContract
      || template.network_scope !== "none" || template.storage_semantics !== storageSemantics) {
      fail("TRUST_ROOT_INVALID", `template ${index} changed`)
    }
  })
  const expectedEvidence = [
    "exact-request-bytes", "exact-operation-profile-bytes", "exact-input-manifest-bytes",
    "trusted-origin-main-source-proof", "reviewed-scope-bytes", "fresh-placement-receipt",
    "aegis-machine-identity-proof",
    "workspace-preflight", "lease-and-fencing-history", "resource-observations",
    "result-and-output-digests", "owned-scratch-cleanup-receipt",
  ]
  if (JSON.stringify(value.required_evidence) !== JSON.stringify(expectedEvidence)
    || JSON.stringify(value.prohibited_paths) !== JSON.stringify(["/backup-primary", "/backup-secondary", "/mnt", "/media"])) {
    fail("TRUST_ROOT_INVALID", "evidence or prohibited-path boundary changed")
  }
  const expectedPrerequisites = [
    "dedicated-non-root-no-sudo-identity-proven", "fresh-aegis-compute-capability-proven",
    "trusted-origin-main-source-proof",
    "exact-adapter-and-operation-profile-digests-reviewed", "durable-single-shot-ledger-proven",
    "separate-non-active-scope-reviewed", "future-dated-single-use-activation-reviewed",
  ]
  if (JSON.stringify(value.future_activation_prerequisites) !== JSON.stringify(expectedPrerequisites)) {
    fail("TRUST_ROOT_INVALID", "future activation prerequisites changed")
  }
}

function validateOperationProfiles(value) {
  exactKeys(value, ["schema_version", "registry_id", "profiles", "status"], "operation profile registry")
  if (value.schema_version !== "0.1-aegis-bounded-operation-profiles"
    || value.registry_id !== "resident-aegis-bounded-operation-profiles"
    || value.status !== "NON_ACTIVE_PROFILES" || !Array.isArray(value.profiles) || value.profiles.length !== 3) {
    fail("TRUST_ROOT_INVALID", "operation profile registry changed")
  }
  const expected = [
    {
      profile_id: "williamos.standard-validation.v1",
      template_id: "aegis.ci-build-test.v1",
      runner_kind: "digest-pinned-rootless-container",
      network_scope: "none",
      dependency_policy: "preprovisioned-lockfile-only",
      stages: ["lockfile-integrity", "focused-tests", "full-suite", "production-build"],
    },
    {
      profile_id: "sha256.verify.v1",
      template_id: "aegis.hash-verify.v1",
      runner_kind: "in-process-digest-pinned-module",
      network_scope: "none",
      algorithm: "sha256",
      stages: ["manifest-verify", "aggregate-verify"],
    },
    {
      profile_id: "tar-zstd.deterministic.v1",
      template_id: "aegis.compression.v1",
      runner_kind: "in-process-digest-pinned-module",
      network_scope: "none",
      format: "tar.zst",
      deterministic: true,
      stages: ["manifest-verify", "archive-create", "archive-manifest"],
    },
  ]
  if (canonicalizeJcs(value.profiles) !== canonicalizeJcs(expected)) fail("TRUST_ROOT_INVALID", "operation profiles changed")
}

function validateInputManifest(value, request) {
  exactKeys(value, ["schema_version", "manifest_id", "repository", "source_commit", "entries"], "input manifest")
  if (value.schema_version !== "0.1-aegis-input-manifest" || value.repository !== "bsvalues/terragroq"
    || value.source_commit !== request.declared_source.commit_sha || !Array.isArray(value.entries)
    || value.entries.length < 1 || value.entries.length > 10000) {
    fail("INPUT_MANIFEST_INVALID", "input manifest header or size is invalid")
  }
  identifier(value.manifest_id, "input manifest.manifest_id")
  const paths = new Set()
  let totalBytes = 0
  for (const [index, entry] of value.entries.entries()) {
    exactKeys(entry, ["path", "sha256", "size_bytes"], `input manifest entry ${index}`)
    if (typeof entry.path !== "string" || entry.path.length > 240 || entry.path.includes("\\")
      || entry.path.startsWith("/") || entry.path.split("/").some((part) => part === "" || part === "." || part === "..")
      || entry.path === ".git" || entry.path.startsWith(".git/") || paths.has(entry.path)) {
      fail("INPUT_MANIFEST_INVALID", `input manifest entry ${index} path is unsafe`)
    }
    digest(entry.sha256, `input manifest entry ${index}.sha256`)
    integer(entry.size_bytes, `input manifest entry ${index}.size_bytes`, 0, 5368709120)
    totalBytes += entry.size_bytes
    if (!Number.isSafeInteger(totalBytes) || totalBytes > request.limits.written_bytes) {
      fail("INPUT_MANIFEST_INVALID", "input manifest exceeds the request write ceiling")
    }
    paths.add(entry.path)
  }
}

function validateRequest(request, contract) {
  exactKeys(request, [
    "schema_version", "request_id", "work_order_id", "template_id", "selected_node_id",
    "placement_receipt_sha256", "declared_source", "input_manifest", "input", "limits", "forge",
  ], "request")
  if (request.schema_version !== "0.1-aegis-bounded-dispatch-request" || request.selected_node_id !== "aegis") {
    fail("INPUT_INVALID", "request schema or node is invalid")
  }
  identifier(request.request_id, "request_id")
  identifier(request.work_order_id, "work_order_id")
  identifier(request.template_id, "template_id")
  digest(request.placement_receipt_sha256, "placement_receipt_sha256")
  exactKeys(request.declared_source, ["repository", "commit_sha", "source_tree_sha256"], "declared_source")
  if (request.declared_source.repository !== "bsvalues/terragroq" || !GIT_SHA40.test(request.declared_source.commit_sha)) {
    fail("INPUT_INVALID", "declared source is invalid")
  }
  digest(request.declared_source.source_tree_sha256, "source_tree_sha256")
  exactKeys(request.input_manifest, ["path", "sha256"], "input_manifest")
  if (typeof request.input_manifest.path !== "string"
    || !/^docs\/reports\/bounded-dispatch\/aegis-inputs\/[A-Za-z0-9][A-Za-z0-9._-]{2,160}\.json$/.test(request.input_manifest.path)) {
    fail("INPUT_MANIFEST_INVALID", "input manifest path is outside the reviewed evidence namespace")
  }
  digest(request.input_manifest.sha256, "input_manifest.sha256")
  exactKeys(request.limits, ["cpu_threads", "memory_bytes", "timeout_ms", "output_bytes", "written_bytes"], "limits")
  integer(request.limits.cpu_threads, "limits.cpu_threads", 1, contract.resource_ceilings.maximum_cpu_threads)
  integer(request.limits.memory_bytes, "limits.memory_bytes", 1, contract.resource_ceilings.maximum_memory_bytes)
  integer(request.limits.timeout_ms, "limits.timeout_ms", 1000, contract.resource_ceilings.maximum_runtime_ms)
  integer(request.limits.output_bytes, "limits.output_bytes", 1, contract.resource_ceilings.maximum_output_bytes)
  integer(request.limits.written_bytes, "limits.written_bytes", 1, contract.workspace.maximum_written_bytes)
  exactKeys(request.forge, ["producer_identity", "permission_set_sha256"], "forge")
  if (request.forge.producer_identity !== "resident-aegis") fail("FORGE_PERMISSION_MISMATCH", "producer is not resident-aegis")
  digest(request.forge.permission_set_sha256, "forge.permission_set_sha256")
  const template = contract.templates.find((entry) => entry.template_id === request.template_id)
  if (!template) fail("TEMPLATE_NOT_REVIEWED", "template is outside the reviewed set")
  if (template.workload_class === "CI_BUILD_TEST") {
    exactKeys(request.input, ["profile_id"], "request.input")
    if (request.input.profile_id !== "williamos.standard-validation.v1") fail("INPUT_INVALID", "validation profile is not reviewed")
  } else if (template.workload_class === "HASH_VERIFY") {
    exactKeys(request.input, ["profile_id", "expected_aggregate_sha256"], "request.input")
    digest(request.input.expected_aggregate_sha256, "expected_aggregate_sha256")
    if (request.input.profile_id !== "sha256.verify.v1") fail("INPUT_INVALID", "hash profile is not reviewed")
  } else {
    exactKeys(request.input, ["profile_id"], "request.input")
    if (request.input.profile_id !== "tar-zstd.deterministic.v1") fail("INPUT_INVALID", "compression profile is not reviewed")
  }
  rejectUnsafe(request)
  return template
}

export function evaluateResidentAegisContract({ repositoryRoot, request }) {
  try {
    const contractArtifact = readArtifact(
      repositoryRoot,
      "config/execution-fabric/aegis-bounded-dispatch-contract.json",
      "AEGIS contract",
    )
    validateContract(contractArtifact.value)
    const permissionArtifact = readArtifact(
      repositoryRoot,
      contractArtifact.value.forge_permission_path,
      "AEGIS Agent Forge permission",
    )
    validatePermission(permissionArtifact.value)
    if (permissionArtifact.sha256 !== contractArtifact.value.forge_permission_sha256
      || request?.forge?.permission_set_sha256 !== permissionArtifact.sha256) {
      fail("FORGE_PERMISSION_MISMATCH", "permission bytes do not match the reviewed contract")
    }
    const profilesArtifact = readArtifact(
      repositoryRoot,
      contractArtifact.value.operation_profiles_path,
      "AEGIS operation profiles",
    )
    validateOperationProfiles(profilesArtifact.value)
    if (profilesArtifact.sha256 !== contractArtifact.value.operation_profiles_sha256) {
      fail("TRUST_ROOT_INVALID", "operation profile bytes do not match the reviewed contract")
    }
    const template = validateRequest(request, contractArtifact.value)
    const manifestArtifact = readArtifact(repositoryRoot, request.input_manifest.path, "AEGIS input manifest")
    if (manifestArtifact.sha256 !== request.input_manifest.sha256) fail("INPUT_MANIFEST_INVALID", "input manifest bytes changed")
    validateInputManifest(manifestArtifact.value, request)
    return {
      schema_version: "0.1-aegis-bounded-contract-evaluation",
      status: "NON_ACTIVE_REQUEST_SHAPE_VALID",
      contract_id: contractArtifact.value.contract_id,
      contract_sha256: contractArtifact.sha256,
      request_sha256: sha256(Buffer.from(canonicalizeJcs(request), "utf8")),
      operation_profiles_sha256: profilesArtifact.sha256,
      input_manifest_sha256: manifestArtifact.sha256,
      template_id: template.template_id,
      workload_class: template.workload_class,
      selected_node_id: "aegis",
      machine_identity_sha256: contractArtifact.value.machine_identity_sha256,
      required_evidence: contractArtifact.value.required_evidence,
      source_proven: false,
      placement_proven: false,
      execution_authorized: false,
      dispatch_allowed: false,
      scheduler_activated: false,
      autonomous_dispatch: false,
      storage_nas_backup_authority_granted: false,
      remote_systems_modified: false,
    }
  } catch (error) {
    return {
      schema_version: "0.1-aegis-bounded-contract-evaluation",
      status: "INPUT_REJECTED",
      reasons: [{
        code: error instanceof AegisBoundedContractError ? error.code : "INTERNAL_ERROR",
        detail: String(error?.message ?? error).replace(/^AEGIS_BOUNDED_CONTRACT_INVALID: [^:]+: /, ""),
      }],
      execution_authorized: false,
      dispatch_allowed: false,
      scheduler_activated: false,
      autonomous_dispatch: false,
      storage_nas_backup_authority_granted: false,
      remote_systems_modified: false,
    }
  }
}
