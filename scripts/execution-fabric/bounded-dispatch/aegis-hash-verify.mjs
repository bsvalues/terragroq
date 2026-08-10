import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { validateShadowPlacementReceipt } from "../evaluate-shadow-placement.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/
const SAFE_PATH = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
const SECRET = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b)/i
const MAX_BYTES = 1048576
const STAGING_RELATIVE_ROOT = "docs/reports/bounded-dispatch/aegis-inputs"
const SAFETY = Object.freeze({
  scheduler_activated: false,
  autonomous_dispatch: false,
  dispatch_performed: false,
  remote_accessed: false,
  network_accessed: false,
  shell_executed: false,
  authority_mutated: false,
  registry_modified: false,
  workload_storage_modified: false,
  output_storage_modified: false,
  fallback_used: false,
})

export class AegisHashVerifyError extends Error {
  constructor(code, detail) {
    super(`FABRIC_AEGIS_HASH_VERIFY_INVALID: ${code}: ${detail}`)
    this.name = "AegisHashVerifyError"
    this.code = code
  }
}

const fail = (code, detail) => { throw new AegisHashVerifyError(code, detail) }
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalBytes = (value) => Buffer.from(`${canonicalizeJcs(value)}\n`, "utf8")

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INPUT_INVALID", `${label} must be an object`)
  return value
}
function exact(value, keys, label) {
  object(value, label)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail("INPUT_INVALID", `${label} fields do not match the contract`)
  }
}
function id(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("INPUT_INVALID", `${label} must be a safe identifier`)
  return value
}
function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("INPUT_INVALID", `${label} must be lowercase SHA-256`)
  return value
}
function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    fail("INPUT_INVALID", `${label} must be a canonical UTC timestamp`)
  }
  return Date.parse(value)
}
function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INPUT_INVALID", `${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function rejected(error) {
  const code = error instanceof AegisHashVerifyError ? error.code : "INTERNAL_ERROR"
  const state = code === "PROVIDER_UNAVAILABLE" ? "BLOCKED_NO_ELIGIBLE_PROVIDER"
    : code === "EVIDENCE_STALE" ? "BLOCKED_EVIDENCE_STALE"
      : code.startsWith("AUTHORITY_") || code.startsWith("WORK_ORDER_AUTHORITY_") ? "BLOCKED_AUTHORITY"
        : code.includes("PATH") || code.includes("INPUT") || code.includes("BYTE") ? "FAILED_INPUT_VALIDATION"
          : "BLOCKED_POLICY"
  return {
    schema_version: "0.1-aegis-hash-verify-preparation",
    status: "BLOCKED",
    operational_state: state,
    reasons: [{
      code,
      detail: String(error?.message ?? error).replace(/^FABRIC_AEGIS_HASH_VERIFY_INVALID:\s*[^:]+:\s*/, ""),
    }],
    execution_authorized: false,
    operation_allowed: false,
    safety: { ...SAFETY },
  }
}

function realRoot(root, label) {
  try { return fs.realpathSync(path.resolve(root)) } catch (error) { fail("PATH_INVALID", `${label}: ${error.message}`) }
}

function contained(root, target, label) {
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("PATH_ESCAPE", `${label} resolves outside its root`)
}

function readRepositoryJson(repositoryRoot, relativePath, label) {
  const root = realRoot(repositoryRoot, "repository root")
  const lexical = path.resolve(root, relativePath)
  contained(root, lexical, label)
  let real
  try {
    if (fs.lstatSync(lexical).isSymbolicLink()) fail("PATH_ESCAPE", `${label} must not be a symbolic link`)
    real = fs.realpathSync(lexical)
  } catch (error) {
    if (error instanceof AegisHashVerifyError) throw error
    fail("TRUST_ROOT_MISSING", `${label} is unavailable`)
  }
  contained(root, real, label)
  const diskBytes = fs.readFileSync(real)
  const text = diskBytes.toString("utf8")
  if (text.replace(/\r\n/g, "").includes("\r")) {
    fail("TRUST_ROOT_INVALID", `${label} contains a non-canonical carriage return`)
  }
  const bytes = Buffer.from(text.replace(/\r\n/g, "\n"), "utf8")
  let value
  try { value = JSON.parse(bytes.toString("utf8")) } catch { fail("TRUST_ROOT_INVALID", `${label} must contain JSON`) }
  return { bytes, sha256: sha256(bytes), value }
}

function validateRequest(request) {
  exact(request, [
    "schema_version", "request_id", "work_order_id", "template_id", "placement_receipt_sha256",
    "input", "limits", "forge", "authority_reference",
  ], "request")
  if (request.schema_version !== "0.1-aegis-hash-verify-request") fail("INPUT_INVALID", "request schema is unsupported")
  id(request.request_id, "request_id")
  id(request.work_order_id, "work_order_id")
  id(request.template_id, "template_id")
  id(request.authority_reference, "authority_reference")
  digest(request.placement_receipt_sha256, "placement_receipt_sha256")
  exact(request.input, ["relative_path", "expected_sha256", "expected_byte_length"], "request.input")
  if (typeof request.input.relative_path !== "string" || !SAFE_PATH.test(request.input.relative_path)
    || path.isAbsolute(request.input.relative_path) || /^(?:[A-Za-z]:|\\\\|\/)/.test(request.input.relative_path)
    || request.input.relative_path.includes("\\") || request.input.relative_path.split("/").some((part) => part === "." || part === "..")) {
    fail("PATH_ESCAPE", "input relative_path must be one canonical confined POSIX path")
  }
  digest(request.input.expected_sha256, "input.expected_sha256")
  integer(request.input.expected_byte_length, "input.expected_byte_length", 0, MAX_BYTES)
  exact(request.limits, ["max_input_bytes", "timeout_ms"], "request.limits")
  integer(request.limits.max_input_bytes, "limits.max_input_bytes", 1, MAX_BYTES)
  integer(request.limits.timeout_ms, "limits.timeout_ms", 1, 30000)
  exact(request.forge, ["permission_set_sha256", "template_registry_sha256"], "request.forge")
  digest(request.forge.permission_set_sha256, "forge.permission_set_sha256")
  digest(request.forge.template_registry_sha256, "forge.template_registry_sha256")
  if (SECRET.test(JSON.stringify(request))) fail("SECRET_LIKE_VALUE", "request contains secret-like material")
}

function validateTemplateRegistry(registry, permissionSha256) {
  exact(registry, ["schema_version", "registry_id", "templates"], "template registry")
  if (registry.schema_version !== "0.1-aegis-bounded-dispatch-template-registry"
    || registry.registry_id !== "execution-fabric-aegis-bounded-dispatch-templates"
    || !Array.isArray(registry.templates) || registry.templates.length !== 1) fail("FORGE_INVALID", "template registry is invalid")
  const template = registry.templates[0]
  exact(template, [
    "template_id", "workload_id", "workload_class", "selected_node_id", "adapter_id",
    "input_root", "digest_algorithm", "max_input_bytes", "max_timeout_ms", "network_scope", "storage_semantics",
    "risk_class", "forge_permission_set_sha256", "status",
  ], "AEGIS template")
  if (template.template_id !== "aegis.hash-verify.v1" || template.workload_id !== "cpu-heavy-build"
    || template.workload_class !== "HASH_VERIFY" || template.selected_node_id !== "aegis"
    || template.adapter_id !== "resident-aegis-hash-verify-v1" || template.digest_algorithm !== "sha256"
    || template.input_root !== STAGING_RELATIVE_ROOT
    || template.max_input_bytes !== MAX_BYTES || template.max_timeout_ms !== 30000
    || template.network_scope !== "none" || template.storage_semantics !== "read-only-input"
    || template.risk_class !== "R1" || template.forge_permission_set_sha256 !== permissionSha256
    || template.status !== "ADAPTER_PACKET_NOT_ACTIVE") fail("FORGE_INVALID", "AEGIS template contract is invalid")
  return template
}

function validateForgePermission(permission) {
  exact(permission, [
    "schema_version", "permission_set_id", "agent_identity", "provider_identity", "allowed_actions",
    "prohibited_actions", "maximum_concurrency", "maximum_input_bytes", "scheduler_activation_allowed",
    "autonomous_dispatch_allowed", "status",
  ], "Agent Forge permission")
  const allowed = [
    "acquire-fixed-local-runtime-claim-lease", "read-exact-bounded-input",
    "compute-sha256", "emit-bounded-result-evidence",
  ]
  const prohibited = [
    "arbitrary-shell", "autonomous-scheduling", "authority-mutation", "external-provider-access",
    "network-access", "remote-node-access", "silent-replacement", "workload-storage-write",
  ]
  if (permission.schema_version !== "0.1-agent-forge-aegis-bounded-dispatch-permission"
    || permission.permission_set_id !== "resident-aegis-bounded-hash-verify-v1"
    || permission.agent_identity !== "resident-aegis" || permission.provider_identity !== "resident-aegis"
    || JSON.stringify(permission.allowed_actions) !== JSON.stringify(allowed)
    || JSON.stringify(permission.prohibited_actions) !== JSON.stringify(prohibited)
    || permission.maximum_concurrency !== 1 || permission.maximum_input_bytes !== MAX_BYTES
    || permission.scheduler_activation_allowed !== false || permission.autonomous_dispatch_allowed !== false
    || permission.status !== "SCOPE_ONLY_NOT_AUTHORITY") fail("FORGE_INVALID", "Agent Forge permission contract is invalid")
}

function validateIdentity(identity) {
  exact(identity, [
    "schema_version", "node_id", "hostname", "machine_id_sha256", "machine_id_source",
    "network_address_is_identity", "status",
  ], "identity registry")
  if (identity.schema_version !== "0.1-aegis-resident-identity" || identity.node_id !== "aegis"
    || identity.hostname !== "aegis" || identity.machine_id_source !== "/etc/machine-id"
    || identity.network_address_is_identity !== false || identity.status !== "REVIEWED_IDENTITY_NOT_AUTHORITY") {
    fail("IDENTITY_INVALID", "reviewed AEGIS identity contract is invalid")
  }
  digest(identity.machine_id_sha256, "identity machine_id_sha256")
}

function validateWorkOrder(packet, request) {
  if (packet?.schemaVersion !== 2 || packet?.workOrderId !== "WO-EF-DISPATCH-AEGIS-001"
    || packet?.workOrderId !== request.work_order_id
    || packet?.laneId !== "resident-aegis" || packet?.riskClass !== "R1"
    || packet?.authorityStatus !== "GRANTED" || packet?.operationalState !== "AUTHORITY_MATCHED"
    || packet?.reasonCode !== null
    || JSON.stringify(packet?.authorityGrantRefs) !== JSON.stringify([request.authority_reference])
    || packet?.schedulerActivated !== false
    || packet?.autonomousDispatch !== false || packet?.ownerOperationsAllowed !== false) {
    fail("WORK_ORDER_AUTHORITY_INACTIVE", "AEGIS execution Work Order is not bound to the exact granted authority")
  }
  exact(packet.teamRoles, ["coordinator", "builder", "reviewer"], "work-order teamRoles")
  if (packet.teamRoles.builder !== "resident-aegis" || packet.teamRoles.reviewer !== "independent-assurance") {
    fail("WORK_ORDER_INVALID", "work-order producer and reviewer roles are invalid")
  }
}

function validatePlacement(receiptBytes, request, evaluatedAt, proveTrustedPlacement) {
  const receiptSha256 = sha256(receiptBytes)
  if (receiptSha256 !== request.placement_receipt_sha256) fail("RECEIPT_MISMATCH", "request does not bind exact receipt bytes")
  let receipt
  try { receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8")) } catch { fail("PLACEMENT_INVALID", "receipt is not JSON") }
  let view
  try { view = validateShadowPlacementReceipt(receipt, receiptSha256) } catch (error) {
    fail("PLACEMENT_INVALID", String(error?.message ?? error))
  }
  if (receipt.status !== "RECOMMENDED" || view.selected_node_id !== "aegis" || receipt.recommendation?.node_id !== "aegis") {
    fail("PLACEMENT_MISMATCH", "exact receipt does not select canonical AEGIS")
  }
  const selected = receipt.eligible_nodes.find((entry) => entry.node_id === "aegis" && entry.eligible === true)
  if (!selected || selected.freshness?.state !== "fresh") fail("PLACEMENT_MISMATCH", "AEGIS is not eligible and fresh")
  const at = timestamp(evaluatedAt, "evaluatedAt")
  if (Date.parse(receipt.evaluated_at) > at || Date.parse(selected.freshness.expires_at) <= at) {
    fail("EVIDENCE_STALE", "AEGIS placement evidence is stale")
  }
  if (typeof proveTrustedPlacement !== "function") fail("PLACEMENT_UNPROVEN", "trusted pinned-placement proof is required")
  const proof = proveTrustedPlacement({ receiptSha256, receipt: structuredClone(receipt) })
  exact(proof, ["schema_version", "receipt_sha256", "semantic_replay_sha256", "evidence_count", "verified"], "placement proof")
  if (proof.schema_version !== "0.1-trusted-pinned-placement-proof" || proof.receipt_sha256 !== receiptSha256
    || proof.semantic_replay_sha256 !== sha256(Buffer.from(canonicalizeJcs(receipt)))
    || proof.evidence_count !== receipt.evidence_snapshot.length || proof.verified !== true) {
    fail("PLACEMENT_UNPROVEN", "trusted pinned-placement proof is invalid")
  }
  return { receipt, receiptSha256, freshUntil: selected.freshness.expires_at }
}

function validateResidentIdentity(reviewedIdentity, trustedResidentIdentity) {
  if (typeof trustedResidentIdentity !== "function") fail("PROVIDER_UNAVAILABLE", "trusted resident AEGIS identity is unavailable")
  const actual = trustedResidentIdentity()
  exact(actual, ["node_id", "hostname", "machine_id_sha256", "agent_identity", "provider_identity"], "resident identity")
  if (actual.node_id !== "aegis" || actual.hostname !== reviewedIdentity.hostname
    || actual.machine_id_sha256 !== reviewedIdentity.machine_id_sha256
    || actual.agent_identity !== "resident-aegis" || actual.provider_identity !== "resident-aegis") {
    fail("IDENTITY_MISMATCH", "runtime identity does not match canonical resident AEGIS")
  }
  return actual
}

function validateForgeProof(proveTrustedForge, artifacts) {
  if (typeof proveTrustedForge !== "function") fail("FORGE_UNPROVEN", "trusted-main Forge proof is required")
  const proof = proveTrustedForge({
    permissionSha256: artifacts.permission.sha256,
    templateRegistrySha256: artifacts.templates.sha256,
    identityRegistrySha256: artifacts.identity.sha256,
    workOrderSha256: artifacts.workOrder.sha256,
  })
  exact(proof, [
    "schema_version", "trusted_ref", "permission_sha256", "template_registry_sha256",
    "identity_registry_sha256", "work_order_sha256", "exact_template_count", "verified",
  ], "Forge proof")
  if (proof.schema_version !== "0.1-trusted-aegis-forge-proof" || proof.trusted_ref !== "refs/heads/main"
    || proof.permission_sha256 !== artifacts.permission.sha256
    || proof.template_registry_sha256 !== artifacts.templates.sha256
    || proof.identity_registry_sha256 !== artifacts.identity.sha256
    || proof.work_order_sha256 !== artifacts.workOrder.sha256
    || proof.exact_template_count !== 1 || proof.verified !== true) fail("FORGE_UNPROVEN", "trusted-main Forge proof is invalid")
  return proof
}

function scopeFor(request, identityRegistrySha256, machineIdSha256) {
  return {
    work_order_id: request.work_order_id,
    template_id: request.template_id,
    selected_node_id: "aegis",
    input: { ...request.input },
    limits: { ...request.limits },
    forge: { ...request.forge },
    identity_registry_sha256: identityRegistrySha256,
    machine_id_sha256: machineIdSha256,
    staging_root_id: STAGING_RELATIVE_ROOT,
    producer_identity: "resident-aegis",
    reviewer_identity: "independent-assurance",
    maximum_attempts: 1,
  }
}

function validateAuthority(repositoryRoot, request, expectedScope, scopeSha256, evaluatedAt, proveTrustedAuthority) {
  const registry = readRepositoryJson(
    repositoryRoot, "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json", "AEGIS authority registry",
  )
  exact(registry.value, ["schema_version", "registry_id", "entries"], "authority registry")
  if (registry.value.schema_version !== "0.1-aegis-bounded-dispatch-authority-registry"
    || registry.value.registry_id !== "execution-fabric-aegis-bounded-dispatch-authorities"
    || !Array.isArray(registry.value.entries)) fail("AUTHORITY_INVALID", "AEGIS authority registry is invalid")
  const matches = registry.value.entries.filter((entry) => entry?.reference === request.authority_reference)
  if (matches.length !== 1) fail("AUTHORITY_NOT_ADMITTED", "exact AEGIS authority is absent or non-unique")
  const authority = matches[0]
  exact(authority, [
    "reference", "work_order_id", "template_id", "selected_node_id", "scope_sha256", "valid_from",
    "expires_at", "maximum_attempts", "scope_path", "scope_artifact_sha256", "producer_identity",
    "reviewer_identity", "execution_commit", "reviewed_commit", "status",
  ], "authority entry")
  if (authority.work_order_id !== request.work_order_id || authority.template_id !== request.template_id
    || authority.selected_node_id !== "aegis" || authority.scope_sha256 !== scopeSha256
    || authority.maximum_attempts !== 1 || authority.producer_identity !== "resident-aegis"
    || authority.reviewer_identity !== "independent-assurance" || authority.reviewer_identity === authority.producer_identity
    || !COMMIT.test(authority.execution_commit) || !COMMIT.test(authority.reviewed_commit)
    || authority.execution_commit === authority.reviewed_commit || authority.status !== "ACTIVE") {
    fail("AUTHORITY_SCOPE_MISMATCH", "authority does not bind the exact AEGIS hash scope")
  }
  if (typeof authority.scope_path !== "string"
    || !/^config\/execution-fabric\/aegis-bounded-dispatch-authority-scopes\/[A-Za-z0-9][A-Za-z0-9._-]{2,200}\.json$/.test(authority.scope_path)) {
    fail("AUTHORITY_SCOPE_MISMATCH", "authority scope path is invalid")
  }
  digest(authority.scope_artifact_sha256, "authority scope_artifact_sha256")
  const retainedScope = readRepositoryJson(repositoryRoot, authority.scope_path, "reviewed AEGIS authority scope")
  if (retainedScope.sha256 !== authority.scope_artifact_sha256) fail("AUTHORITY_SCOPE_MISMATCH", "reviewed scope bytes do not match authority")
  exact(retainedScope.value, [
    "schema_version", "reference", "work_order_id", "template_id", "selected_node_id", "scope_sha256",
    "staging_root_id", "relative_path", "expected_sha256", "expected_byte_length", "max_input_bytes", "timeout_ms",
    "permission_set_sha256", "template_registry_sha256", "identity_registry_sha256", "machine_id_sha256",
    "producer_identity", "reviewer_identity", "execution_commit", "review_commit",
    "maximum_attempts", "risk_class", "authority_status", "prohibited_actions", "status",
  ], "reviewed authority scope")
  const expectedProhibited = [
    "arbitrary-shell", "autonomous-scheduling", "authority-mutation", "external-provider-access",
    "network-access", "remote-node-access", "silent-replacement", "workload-storage-write",
  ]
  const scope = retainedScope.value
  if (scope.schema_version !== "0.1-aegis-bounded-dispatch-authority-scope"
    || scope.reference !== authority.reference || scope.work_order_id !== request.work_order_id
    || scope.template_id !== request.template_id || scope.selected_node_id !== "aegis"
    || scope.scope_sha256 !== scopeSha256 || scope.staging_root_id !== STAGING_RELATIVE_ROOT
    || scope.relative_path !== request.input.relative_path
    || scope.expected_sha256 !== request.input.expected_sha256
    || scope.expected_byte_length !== request.input.expected_byte_length
    || scope.max_input_bytes !== request.limits.max_input_bytes || scope.timeout_ms !== request.limits.timeout_ms
    || scope.permission_set_sha256 !== request.forge.permission_set_sha256
    || scope.template_registry_sha256 !== request.forge.template_registry_sha256
    || scope.identity_registry_sha256 !== expectedScope.identity_registry_sha256
    || scope.machine_id_sha256 !== expectedScope.machine_id_sha256
    || scope.producer_identity !== authority.producer_identity || scope.reviewer_identity !== authority.reviewer_identity
    || scope.execution_commit !== authority.execution_commit || scope.review_commit !== authority.reviewed_commit
    || scope.maximum_attempts !== 1 || scope.risk_class !== "R1" || scope.authority_status !== "GRANTED"
    || JSON.stringify(scope.prohibited_actions) !== JSON.stringify(expectedProhibited)
    || scope.status !== "REVIEWED_ACTIVE_SINGLE_USE_SCOPE") {
    fail("AUTHORITY_SCOPE_MISMATCH", "reviewed scope does not bind the exact request")
  }
  const at = timestamp(evaluatedAt, "authority evaluatedAt")
  if (timestamp(authority.valid_from, "authority valid_from") > at || timestamp(authority.expires_at, "authority expires_at") <= at) {
    fail("AUTHORITY_INACTIVE", "AEGIS authority is outside its reviewed window")
  }
  if (typeof proveTrustedAuthority !== "function") fail("AUTHORITY_UNPROVEN", "trusted-main authority proof is required")
  const proof = proveTrustedAuthority({
    registrySha256: registry.sha256,
    authority: structuredClone(authority),
    scopeSha256,
    scopeArtifactSha256: retainedScope.sha256,
  })
  exact(proof, [
    "schema_version", "trusted_ref", "registry_sha256", "authority_reference",
    "producer_identity", "reviewer_identity", "execution_commit", "authority_reviewed_commit",
    "strict_after_commit", "review_commit_is_strict_descendant", "scope_sha256", "scope_artifact_sha256", "exact_entry_count",
  ], "authority proof")
  if (proof.schema_version !== "0.1-trusted-aegis-authority-proof" || proof.trusted_ref !== "refs/heads/main"
    || proof.registry_sha256 !== registry.sha256 || proof.authority_reference !== authority.reference
    || proof.producer_identity !== authority.producer_identity || proof.reviewer_identity !== authority.reviewer_identity
    || proof.producer_identity === proof.reviewer_identity || proof.execution_commit !== authority.execution_commit
    || proof.authority_reviewed_commit !== authority.reviewed_commit
    || proof.strict_after_commit !== authority.execution_commit || proof.review_commit_is_strict_descendant !== true
    || proof.scope_sha256 !== scopeSha256
    || proof.scope_artifact_sha256 !== retainedScope.sha256
    || proof.exact_entry_count !== 1) fail("AUTHORITY_UNPROVEN", "trusted-main authority proof is invalid")
  return { authority, authorityRegistrySha256: registry.sha256, scopeArtifactSha256: retainedScope.sha256, proof }
}

function verifyStagingRoot(binding) {
  let currentReal
  let stats
  try {
    if (fs.lstatSync(binding.lexical).isSymbolicLink()) fail("PATH_ESCAPE", "fixed Forge staging root must not become a symbolic link")
    currentReal = fs.realpathSync(binding.lexical)
    stats = fs.statSync(currentReal)
  } catch (error) {
    if (error instanceof AegisHashVerifyError) throw error
    fail("INPUT_CHANGED", "fixed Forge staging root changed or became unavailable")
  }
  contained(binding.repository, currentReal, "fixed Forge staging root")
  if (currentReal !== binding.real || !stats.isDirectory()
    || stats.dev !== binding.identity.dev || stats.ino !== binding.identity.ino) {
    fail("INPUT_CHANGED", "fixed Forge staging root identity changed")
  }
  return currentReal
}

function resolveStagedFile(binding, relativePath) {
  const root = verifyStagingRoot(binding)
  const lexical = path.resolve(root, relativePath)
  contained(root, lexical, "staged input")
  const relative = path.relative(root, lexical)
  let cursor = root
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment)
    let stats
    try { stats = fs.lstatSync(cursor) } catch { fail("INPUT_UNAVAILABLE", "staged input does not exist") }
    if (stats.isSymbolicLink()) fail("PATH_ESCAPE", "staged input path must not contain symbolic links or junctions")
  }
  const real = fs.realpathSync(lexical)
  contained(root, real, "staged input")
  const stats = fs.lstatSync(lexical)
  if (!stats.isFile()) fail("INPUT_INVALID", "staged input must be a regular file")
  return {
    root, lexical, real, size: stats.size,
    identity: { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs },
  }
}

function fixedStagingRoot(repositoryRoot, inputRoot) {
  if (inputRoot !== STAGING_RELATIVE_ROOT) fail("FORGE_INVALID", "template input root is not the reviewed AEGIS root")
  const repository = realRoot(repositoryRoot, "repository root")
  const lexical = path.join(repository, ...inputRoot.split("/"))
  let real
  try {
    if (fs.lstatSync(lexical).isSymbolicLink()) fail("PATH_ESCAPE", "fixed Forge staging root must not be a symbolic link")
    real = fs.realpathSync(lexical)
  } catch (error) {
    if (error instanceof AegisHashVerifyError) throw error
    fail("INPUT_UNAVAILABLE", "fixed Forge staging root is unavailable")
  }
  contained(repository, real, "fixed Forge staging root")
  const stats = fs.statSync(real)
  if (!stats.isDirectory()) fail("INPUT_INVALID", "fixed Forge staging root must be a directory")
  return {
    repository,
    lexical,
    real,
    identity: { dev: stats.dev, ino: stats.ino },
  }
}

function prepareOrThrow(input) {
  validateRequest(input.request)
  const placement = validatePlacement(
    input.receiptBytes, input.request, input.evaluatedAt, input.proveTrustedPlacement,
  )
  const artifacts = {
    templates: readRepositoryJson(input.repositoryRoot, "config/execution-fabric/aegis-bounded-dispatch-templates.json", "AEGIS template registry"),
    permission: readRepositoryJson(input.repositoryRoot, "config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json", "AEGIS Forge permission"),
    identity: readRepositoryJson(input.repositoryRoot, "config/execution-fabric/aegis-resident-identity.json", "AEGIS identity registry"),
    workOrder: readRepositoryJson(input.repositoryRoot, "config/execution-fabric/aegis-bounded-dispatch-work-order.json", "AEGIS work-order packet"),
  }
  validateForgePermission(artifacts.permission.value)
  const template = validateTemplateRegistry(artifacts.templates.value, artifacts.permission.sha256)
  validateIdentity(artifacts.identity.value)
  validateWorkOrder(artifacts.workOrder.value, input.request)
  const forgeProof = validateForgeProof(input.proveTrustedForge, artifacts)
  const identity = validateResidentIdentity(artifacts.identity.value, input.trustedResidentIdentity)
  if (input.request.template_id !== template.template_id || placement.receipt.workload.id !== template.workload_id
    || input.request.forge.permission_set_sha256 !== artifacts.permission.sha256
    || input.request.forge.template_registry_sha256 !== artifacts.templates.sha256
    || input.request.limits.max_input_bytes > template.max_input_bytes
    || input.request.limits.timeout_ms > template.max_timeout_ms) fail("SCOPE_MISMATCH", "request does not bind exact Forge template limits")
  const staged = resolveStagedFile(fixedStagingRoot(input.repositoryRoot, template.input_root), input.request.input.relative_path)
  if (staged.size !== input.request.input.expected_byte_length
    || staged.size > input.request.limits.max_input_bytes || staged.size > template.max_input_bytes) {
    fail("BYTE_CEILING_EXCEEDED", "staged input size does not match the bounded request")
  }
  const scope = scopeFor(input.request, artifacts.identity.sha256, identity.machine_id_sha256)
  const scopeSha256 = sha256(Buffer.from(canonicalizeJcs(scope)))
  const authority = validateAuthority(
    input.repositoryRoot, input.request, scope, scopeSha256, input.evaluatedAt, input.proveTrustedAuthority,
  )
  const trustBinding = {
    request_sha256: sha256(Buffer.from(canonicalizeJcs(input.request))),
    receipt_sha256: placement.receiptSha256,
    scope_sha256: scopeSha256,
    authority_reference: authority.authority.reference,
    template_registry_sha256: artifacts.templates.sha256,
    permission_set_sha256: artifacts.permission.sha256,
    identity_registry_sha256: artifacts.identity.sha256,
    work_order_sha256: artifacts.workOrder.sha256,
    authority_registry_sha256: authority.authorityRegistrySha256,
    authority_scope_artifact_sha256: authority.scopeArtifactSha256,
    machine_id_sha256: identity.machine_id_sha256,
  }
  const preparation = {
    schema_version: "0.1-aegis-hash-verify-preparation",
    status: "READY_FOR_SINGLE_USE_LOCAL_HASH",
    operational_state: "NON_ACTIVE_TEST_AUTHORITY_PROVED",
    prepared_at: input.evaluatedAt,
    request_sha256: trustBinding.request_sha256,
    receipt_sha256: placement.receiptSha256,
    fresh_until: placement.freshUntil,
    selected_node_id: "aegis",
    template_id: template.template_id,
    scope_sha256: scopeSha256,
    authority_reference: authority.authority.reference,
    authority_valid_from: authority.authority.valid_from,
    authority_expires_at: authority.authority.expires_at,
    timeout_ms: input.request.limits.timeout_ms,
    trust_binding_sha256: sha256(Buffer.from(canonicalizeJcs(trustBinding))),
    trust_roots: {
      template_registry_sha256: artifacts.templates.sha256,
      permission_set_sha256: artifacts.permission.sha256,
      identity_registry_sha256: artifacts.identity.sha256,
      work_order_sha256: artifacts.workOrder.sha256,
      authority_registry_sha256: authority.authorityRegistrySha256,
      authority_scope_artifact_sha256: authority.scopeArtifactSha256,
    },
    identity: { ...identity },
    forge_proof: forgeProof,
    authority_proof: authority.proof,
    input: {
      staging_root_id: STAGING_RELATIVE_ROOT,
      relative_path: input.request.input.relative_path,
      expected_byte_length: staged.size,
    },
    maximum_attempts: 1,
    execution_authorized: true,
    operation_allowed: true,
    safety: { ...SAFETY },
  }
  return { ...preparation, preparation_sha256: sha256(canonicalBytes(preparation)) }
}

export function prepareAegisHashVerify(input) {
  try { return prepareOrThrow(input) } catch (error) { return rejected(error) }
}

function requireSuccessfulCallback(value, keys, label) {
  exact(value, keys, label)
  return value
}

function readExactStagedBytes(repositoryRoot, stagingRootId, request) {
  const stagingRoot = fixedStagingRoot(repositoryRoot, stagingRootId)
  const staged = resolveStagedFile(stagingRoot, request.input.relative_path)
  let descriptor
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0
    descriptor = fs.openSync(staged.lexical, fs.constants.O_RDONLY | noFollow)
    const before = fs.fstatSync(descriptor)
    verifyStagingRoot(stagingRoot)
    if (!before.isFile() || before.size !== request.input.expected_byte_length
      || before.size > request.limits.max_input_bytes || before.size > MAX_BYTES) {
      fail("BYTE_CEILING_EXCEEDED", "open staged input violates exact byte ceiling")
    }
    if (before.dev !== staged.identity.dev || before.ino !== staged.identity.ino
      || before.size !== staged.identity.size || before.mtimeMs !== staged.identity.mtimeMs
      || before.ctimeMs !== staged.identity.ctimeMs) fail("INPUT_CHANGED", "staged input changed before descriptor acquisition")
    const bytes = Buffer.alloc(before.size)
    const read = fs.readSync(descriptor, bytes, 0, before.size, 0)
    const after = fs.fstatSync(descriptor)
    if (read !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      fail("INPUT_CHANGED", "staged input changed during exact read")
    }
    const rechecked = resolveStagedFile(stagingRoot, request.input.relative_path)
    if (rechecked.real !== staged.real || rechecked.identity.dev !== before.dev
      || rechecked.identity.ino !== before.ino || rechecked.size !== before.size) fail("INPUT_CHANGED", "staged input identity changed")
    return bytes
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

export async function executeAegisHashVerify(input) {
  let prepared = null
  let claim = null
  let lease = null
  let rawLease = null
  let operationAttempted = false
  let releaseAttempted = false
  let released = false
  try {
    if (typeof input.clock !== "function") fail("CLOCK_UNAVAILABLE", "trusted resident clock is required")
    const requestSha256 = sha256(Buffer.from(canonicalizeJcs(input.request)))
    const request = structuredClone(input.request)
    const receiptBytes = Buffer.from(input.receiptBytes)
    const preparedAt = input.clock()
    timestamp(preparedAt, "prepared_at")
    prepared = prepareOrThrow({ ...input, request, receiptBytes, evaluatedAt: preparedAt })
    if (typeof input.claimSingleUse !== "function") fail("CLAIM_UNAVAILABLE", "single-use claim provider is required")
    claim = requireSuccessfulCallback(await input.claimSingleUse({
      request_sha256: prepared.request_sha256,
      scope_sha256: prepared.scope_sha256,
      authority_reference: prepared.authority_reference,
      maximum_attempts: 1,
    }), ["claimed", "claim_id", "claimed_at"], "single-use claim")
    if (claim.claimed !== true) fail("REQUEST_ALREADY_CONSUMED", "single-use request is already consumed")
    id(claim.claim_id, "claim_id")
    const claimedAt = timestamp(claim.claimed_at, "claimed_at")
    if (claimedAt < timestamp(prepared.prepared_at, "prepared_at")
      || claimedAt >= timestamp(prepared.fresh_until, "fresh_until")
      || claimedAt >= timestamp(prepared.authority_expires_at, "authority_expires_at")) {
      fail("CLAIM_CHRONOLOGY_INVALID", "claim is outside the prepared evidence and authority interval")
    }
    if (typeof input.acquireExclusiveLease !== "function" || typeof input.releaseExclusiveLease !== "function") {
      fail("LEASE_UNAVAILABLE", "exclusive resident AEGIS lease providers are required")
    }
    rawLease = await input.acquireExclusiveLease({ claim_id: claim.claim_id })
    lease = requireSuccessfulCallback(rawLease, ["acquired", "lease_id", "acquired_at"], "exclusive lease")
    if (lease.acquired !== true) fail("CONCURRENCY_LIMIT_REACHED", "resident AEGIS concurrency is occupied")
    id(lease.lease_id, "lease_id")
    const leaseAt = timestamp(lease.acquired_at, "lease acquired_at")
    if (leaseAt < claimedAt) fail("LEASE_CHRONOLOGY_INVALID", "lease predates the consumed claim")

    const recheckedAt = input.clock()
    const recheckedAtMs = timestamp(recheckedAt, "rechecked_at")
    if (recheckedAtMs < leaseAt) fail("PREFLIGHT_CHRONOLOGY_INVALID", "post-claim preflight predates lease")
    const rechecked = prepareOrThrow({ ...input, request, receiptBytes, evaluatedAt: recheckedAt })
    if (rechecked.trust_binding_sha256 !== prepared.trust_binding_sha256
      || rechecked.scope_sha256 !== prepared.scope_sha256 || rechecked.receipt_sha256 !== prepared.receipt_sha256) {
      fail("PREFLIGHT_CHANGED", "trust inputs changed after claim")
    }
    const startedAt = input.clock()
    const startedAtMs = timestamp(startedAt, "started_at")
    if (startedAtMs < recheckedAtMs) fail("OPERATION_CHRONOLOGY_INVALID", "operation start predates post-claim preflight")
    if (requestSha256 !== sha256(Buffer.from(canonicalizeJcs(input.request)))) {
      fail("REQUEST_CHANGED", "request changed after the post-claim preflight")
    }
    operationAttempted = true
    const bytes = readExactStagedBytes(input.repositoryRoot, prepared.input.staging_root_id, request)
    const observedSha256 = sha256(bytes)
    const completedAt = input.clock()
    const completedAtMs = timestamp(completedAt, "completed_at")
    if (completedAtMs < startedAtMs || completedAtMs - startedAtMs > prepared.timeout_ms
      || completedAtMs >= timestamp(prepared.fresh_until, "fresh_until")
      || completedAtMs >= timestamp(prepared.authority_expires_at, "authority_expires_at")) {
      fail("OPERATION_CHRONOLOGY_INVALID", "completion exceeds chronology, freshness, authority, or timeout")
    }
    const matched = observedSha256 === request.input.expected_sha256
    const result = {
      schema_version: "0.1-aegis-hash-verify-evidence",
      status: matched ? "COMPLETED" : "FAILED_CLOSED",
      result: matched ? "VERIFIED" : "HASH_MISMATCH",
      request_sha256: prepared.request_sha256,
      receipt_sha256: prepared.receipt_sha256,
      preparation_sha256: prepared.preparation_sha256,
      scope_sha256: prepared.scope_sha256,
      authority_reference: prepared.authority_reference,
      claim: { claim_id: claim.claim_id, claimed_at: claim.claimed_at },
      lease: { lease_id: lease.lease_id, acquired_at: lease.acquired_at },
      actual_target_node: "aegis",
      adapter_id: "resident-aegis-hash-verify-v1",
      operation: {
        kind: "HASH_VERIFY",
        relative_path: request.input.relative_path,
        byte_length: bytes.length,
        digest_algorithm: "sha256",
        expected_sha256: request.input.expected_sha256,
        observed_sha256: observedSha256,
        matched,
      },
      chronology: { started_at: startedAt, completed_at: completedAt },
      resource_observation: {
        metric: "input_bytes_hashed", unit: "bytes", value: bytes.length, observed_at: completedAt,
      },
      operation_performed: true,
      execution_authorized: true,
      runtime_lease_released: false,
      safety: { ...SAFETY, dispatch_performed: true },
    }
    releaseAttempted = true
    released = await input.releaseExclusiveLease({ lease_id: lease.lease_id, claim_id: claim.claim_id })
    if (released !== true) fail("LEASE_RELEASE_FAILED", "exclusive resident AEGIS lease was not released")
    result.runtime_lease_released = true
    return { ...result, evidence_sha256: sha256(canonicalBytes(result)) }
  } catch (error) {
    const acquiredLease = lease?.acquired === true ? lease : rawLease?.acquired === true ? rawLease : null
    if (acquiredLease && !releaseAttempted && typeof input.releaseExclusiveLease === "function") {
      releaseAttempted = true
      try { released = await input.releaseExclusiveLease({ lease_id: acquiredLease.lease_id ?? null, claim_id: claim?.claim_id ?? null }) === true } catch { released = false }
    }
    const normalized = error instanceof Error ? error : new Error(String(error))
    normalized.claimConsumed = claim?.claimed === true
    normalized.claimId = claim?.claim_id ?? null
    normalized.claimedAt = claim?.claimed_at ?? null
    normalized.leaseId = lease?.lease_id ?? rawLease?.lease_id ?? null
    normalized.leaseAcquired = lease?.acquired === true || rawLease?.acquired === true
    normalized.operationAttempted = operationAttempted
    normalized.releaseAttempted = releaseAttempted
    normalized.runtimeLeaseReleased = released
    throw normalized
  }
}
