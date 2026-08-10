import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { validateShadowPlacementReceipt } from "../evaluate-shadow-placement.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const GIT_SHA40 = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/
const SAFE_MARKER = /^[A-Z0-9][A-Z0-9_-]{2,63}$/
const PROHIBITED_FIELD = /(?:^|_)(?:command|commands|cmd|shell|script|argv|args|executable|exec|spawn|cwd|stdin|environment|env|endpoint|credential|credentials|password|passwd|private_key|secret|secrets|token|tokens|api_key|connection_string|authorization)(?:$|_)/i
const SECRET_VALUE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b|\bAKIA[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@)/i
const ALLOWED_RESOURCE_METRICS = new Set(["cpu_load_pct", "gpu_vram_used_bytes", "ram_used_bytes"])

class BoundedDispatchError extends Error {
  constructor(code, detail) {
    super(`FABRIC_BOUNDED_DISPATCH_INVALID: ${code}: ${detail}`)
    this.name = "BoundedDispatchError"
    this.code = code
  }
}

function fail(code, detail) {
  throw new BoundedDispatchError(code, detail)
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

function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
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

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function rejectUnsafe(value, label = "input") {
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

function readRepositoryArtifact(repositoryRoot, relativePath, label) {
  const root = fs.realpathSync(path.resolve(repositoryRoot))
  const lexical = path.resolve(root, relativePath)
  const relative = path.relative(root, lexical)
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("PATH_ESCAPE", `${label} escapes the repository`)
  const real = fs.realpathSync(lexical)
  const realRelative = path.relative(root, real)
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) fail("PATH_ESCAPE", `${label} resolves outside the repository`)
  if (fs.lstatSync(lexical).isSymbolicLink()) fail("PATH_ESCAPE", `${label} must not be a symbolic link`)
  const bytes = fs.readFileSync(real)
  let value
  try {
    value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  } catch {
    fail("INPUT_INVALID", `${label} must contain JSON`)
  }
  return { bytes, value, sha256: sha256(bytes) }
}

function validateTemplateRegistry(value) {
  exactKeys(value, ["schema_version", "registry_id", "templates"], "template registry")
  if (value.schema_version !== "0.1-bounded-dispatch-template-registry"
    || value.registry_id !== "execution-fabric-bounded-dispatch-templates"
    || !Array.isArray(value.templates)) fail("TRUST_ROOT_INVALID", "template registry contract is invalid")
  const ids = new Set()
  for (const [index, template] of value.templates.entries()) {
    exactKeys(template, [
      "template_id", "workload_id", "workload_class", "selected_node_id", "adapter_id", "allowed_models",
      "max_prompt_bytes", "max_response_bytes", "max_timeout_ms", "network_scope", "storage_semantics",
      "risk_class", "forge_permission_set_sha256", "status",
    ], `template ${index}`)
    identifier(template.template_id, `template ${index}.template_id`)
    identifier(template.workload_id, `template ${index}.workload_id`)
    identifier(template.workload_class, `template ${index}.workload_class`)
    identifier(template.selected_node_id, `template ${index}.selected_node_id`)
    identifier(template.adapter_id, `template ${index}.adapter_id`)
    if (!Array.isArray(template.allowed_models) || template.allowed_models.length === 0
      || template.allowed_models.some((model) => typeof model !== "string" || !SAFE_ID.test(model))) {
      fail("TRUST_ROOT_INVALID", `template ${index}.allowed_models is invalid`)
    }
    integer(template.max_prompt_bytes, `template ${index}.max_prompt_bytes`, 1, 4096)
    integer(template.max_response_bytes, `template ${index}.max_response_bytes`, 1, 65536)
    integer(template.max_timeout_ms, `template ${index}.max_timeout_ms`, 1000, 120000)
    digest(template.forge_permission_set_sha256, `template ${index}.forge_permission_set_sha256`)
    if (template.network_scope !== "loopback-only" || template.storage_semantics !== "none"
      || template.risk_class !== "R1" || template.status !== "IMPLEMENTED_NOT_AUTHORIZED") {
      fail("TRUST_ROOT_INVALID", `template ${index} safety contract is invalid`)
    }
    if (ids.has(template.template_id)) fail("TRUST_ROOT_INVALID", "template registry contains duplicate IDs")
    ids.add(template.template_id)
  }
}

function validateAuthorityRegistry(value) {
  exactKeys(value, ["schema_version", "registry_id", "entries"], "authority registry")
  if (value.schema_version !== "0.1-bounded-dispatch-authority-registry"
    || value.registry_id !== "execution-fabric-bounded-dispatch-authorities"
    || !Array.isArray(value.entries)) fail("TRUST_ROOT_INVALID", "authority registry contract is invalid")
  const references = new Set()
  for (const [index, entry] of value.entries.entries()) {
    exactKeys(entry, [
      "reference", "work_order_id", "template_id", "selected_node_id", "scope_sha256", "valid_from",
      "expires_at", "maximum_attempts", "scope_path", "scope_artifact_sha256", "reviewed_commit", "status",
    ], `authority ${index}`)
    identifier(entry.reference, `authority ${index}.reference`)
    identifier(entry.work_order_id, `authority ${index}.work_order_id`)
    identifier(entry.template_id, `authority ${index}.template_id`)
    identifier(entry.selected_node_id, `authority ${index}.selected_node_id`)
    digest(entry.scope_sha256, `authority ${index}.scope_sha256`)
    if (typeof entry.scope_path !== "string"
      || !/^config\/execution-fabric\/bounded-dispatch-authority-scopes\/[A-Za-z0-9][A-Za-z0-9._-]{2,200}\.json$/.test(entry.scope_path)) {
      fail("TRUST_ROOT_INVALID", `authority ${index}.scope_path is invalid`)
    }
    digest(entry.scope_artifact_sha256, `authority ${index}.scope_artifact_sha256`)
    timestamp(entry.valid_from, `authority ${index}.valid_from`)
    timestamp(entry.expires_at, `authority ${index}.expires_at`)
    integer(entry.maximum_attempts, `authority ${index}.maximum_attempts`, 1, 1)
    if (!GIT_SHA40.test(entry.reviewed_commit) || entry.status !== "ACTIVE") {
      fail("TRUST_ROOT_INVALID", `authority ${index} review binding is invalid`)
    }
    if (Date.parse(entry.valid_from) >= Date.parse(entry.expires_at)) fail("TRUST_ROOT_INVALID", `authority ${index} window is invalid`)
    if (references.has(entry.reference)) fail("TRUST_ROOT_INVALID", "authority registry contains duplicate references")
    references.add(entry.reference)
  }
}

function validateForgePermission(value) {
  exactKeys(value, [
    "schema_version", "permission_set_id", "agent_identity", "provider_identity", "allowed_actions",
    "prohibited_actions", "maximum_concurrency", "scheduler_activation_allowed",
    "autonomous_dispatch_allowed", "status",
  ], "Agent Forge permission set")
  const expectedAllowed = ["invoke-exact-loopback-model-template", "emit-bounded-result-evidence"]
  const expectedProhibited = [
    "arbitrary-shell", "autonomous-scheduling", "authority-mutation", "external-provider-access",
    "remote-node-access", "silent-replacement", "stateful-storage-write",
  ]
  if (value.schema_version !== "0.1-agent-forge-bounded-dispatch-permission"
    || value.permission_set_id !== "resident-hermes-bounded-local-inference-v1"
    || value.agent_identity !== "resident-hermes" || value.provider_identity !== "resident-hermes"
    || JSON.stringify(value.allowed_actions) !== JSON.stringify(expectedAllowed)
    || JSON.stringify(value.prohibited_actions) !== JSON.stringify(expectedProhibited)
    || value.maximum_concurrency !== 1 || value.scheduler_activation_allowed !== false
    || value.autonomous_dispatch_allowed !== false || value.status !== "SCOPE_ONLY_NOT_AUTHORITY") {
    fail("FORGE_PERMISSION_MISMATCH", "Agent Forge permission contract is invalid")
  }
}

function validateRequest(request) {
  exactKeys(request, [
    "schema_version", "request_id", "work_order_id", "template_id", "placement_receipt_sha256",
    "input", "limits", "forge", "authority_reference",
  ], "dispatch request")
  if (request.schema_version !== "0.1-bounded-dispatch-request") fail("INPUT_INVALID", "request schema is unsupported")
  identifier(request.request_id, "request.request_id")
  identifier(request.work_order_id, "request.work_order_id")
  identifier(request.template_id, "request.template_id")
  digest(request.placement_receipt_sha256, "request.placement_receipt_sha256")
  identifier(request.authority_reference, "request.authority_reference")
  exactKeys(request.input, ["model", "prompt", "expected_marker"], "request.input")
  identifier(request.input.model, "request.input.model")
  if (typeof request.input.prompt !== "string" || request.input.prompt.length === 0) fail("INPUT_INVALID", "request.input.prompt is required")
  if (typeof request.input.expected_marker !== "string" || !SAFE_MARKER.test(request.input.expected_marker)) {
    fail("INPUT_INVALID", "request.input.expected_marker is invalid")
  }
  exactKeys(request.limits, ["timeout_ms", "max_response_bytes"], "request.limits")
  integer(request.limits.timeout_ms, "request.limits.timeout_ms", 1000, 120000)
  integer(request.limits.max_response_bytes, "request.limits.max_response_bytes", 1, 65536)
  exactKeys(request.forge, ["producer_identity", "permission_set_sha256"], "request.forge")
  identifier(request.forge.producer_identity, "request.forge.producer_identity")
  digest(request.forge.permission_set_sha256, "request.forge.permission_set_sha256")
  rejectUnsafe(request)
}

function scopeBinding(request, selectedNodeId) {
  return {
    work_order_id: request.work_order_id,
    template_id: request.template_id,
    selected_node_id: selectedNodeId,
    input: request.input,
    limits: request.limits,
    forge: request.forge,
  }
}

function rejected(error) {
  const code = error instanceof BoundedDispatchError ? error.code : "INTERNAL_ERROR"
  const detail = String(error?.message ?? error).replace(/^FABRIC_BOUNDED_DISPATCH_INVALID:\s*[^:]+:\s*/, "")
  return {
    schema_version: "0.1-bounded-dispatch-preparation",
    status: "BLOCKED",
    reasons: [{ code, detail }],
    execution_authorized: false,
    dispatch_allowed: false,
    scheduler_activated: false,
    autonomous_dispatch: false,
    silent_replacement: false,
    external_provider_accessed: false,
  }
}

function annotateRuntimeError(error, { dispatchAttempted, claimId, runtimeLeaseId, runtimeLeaseReleased }) {
  const normalized = error instanceof Error ? error : new Error(String(error))
  normalized.dispatchAttempted = dispatchAttempted
  normalized.claimId = claimId
  normalized.runtimeLeaseId = runtimeLeaseId
  normalized.runtimeLeaseReleased = runtimeLeaseReleased
  return normalized
}

function prepareOrThrow({ repositoryRoot, receiptBytes, request, evaluatedAt, proveTrustedPlacement, proveTrustedAuthority }) {
  validateRequest(request)
  timestamp(evaluatedAt, "evaluatedAt")
  const receiptSha256 = sha256(receiptBytes)
  if (receiptSha256 !== request.placement_receipt_sha256) fail("RECEIPT_MISMATCH", "request does not bind the exact receipt bytes")
  let receipt
  try {
    receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8").replace(/^\uFEFF/, ""))
  } catch {
    fail("INPUT_INVALID", "placement receipt must contain JSON")
  }
  const receiptView = validateShadowPlacementReceipt(structuredClone(receipt), receiptSha256)
  if (receipt.status !== "RECOMMENDED" || receipt.recommendation?.node_id !== receiptView.selected_node_id) {
    fail("PLACEMENT_NOT_READY", "placement receipt does not contain a selected recommendation")
  }
  const selected = receipt.eligible_nodes.find((node) => node.node_id === receiptView.selected_node_id)
  if (!selected || selected.eligible !== true || selected.freshness?.state !== "fresh") {
    fail("PLACEMENT_NOT_READY", "selected node is not eligible and fresh")
  }
  if (Date.parse(receipt.evaluated_at) > Date.parse(evaluatedAt)
    || Date.parse(selected.freshness.expires_at) <= Date.parse(evaluatedAt)) {
    fail("PLACEMENT_STALE", "placement evidence is not fresh at preparation time")
  }
  if (typeof proveTrustedPlacement !== "function") fail("PLACEMENT_UNPROVEN", "pinned placement replay proof is required")
  const placementProof = proveTrustedPlacement({ receiptSha256, receipt: structuredClone(receipt) })
  exactKeys(placementProof, [
    "schema_version", "receipt_sha256", "semantic_replay_sha256", "evidence_count", "verified",
  ], "trusted placement proof")
  if (placementProof.schema_version !== "0.1-trusted-pinned-placement-proof"
    || placementProof.receipt_sha256 !== receiptSha256 || placementProof.semantic_replay_sha256 !== sha256(canonicalizeJcs(receipt))
    || placementProof.evidence_count !== receipt.evidence_snapshot.length || placementProof.verified !== true) {
    fail("PLACEMENT_UNPROVEN", "pinned placement replay proof is invalid")
  }

  const templateArtifact = readRepositoryArtifact(
    repositoryRoot,
    "config/execution-fabric/bounded-dispatch-templates.json",
    "bounded dispatch template registry",
  )
  validateTemplateRegistry(templateArtifact.value)
  const template = templateArtifact.value.templates.find((entry) => entry.template_id === request.template_id)
  if (!template) fail("TEMPLATE_NOT_ADMITTED", "requested template is absent")
  const permissionArtifact = readRepositoryArtifact(
    repositoryRoot,
    "config/execution-fabric/agent-forge-bounded-dispatch-permission.json",
    "Agent Forge bounded dispatch permission",
  )
  validateForgePermission(permissionArtifact.value)
  if (permissionArtifact.sha256 !== template.forge_permission_set_sha256
    || request.forge.permission_set_sha256 !== permissionArtifact.sha256
    || request.forge.producer_identity !== "resident-hermes") {
    fail("FORGE_PERMISSION_MISMATCH", "request does not bind the exact Agent Forge permission set")
  }
  if (template.workload_id !== receipt.workload.id || template.selected_node_id !== receiptView.selected_node_id
    || template.adapter_id !== "resident-hermes-loopback-ollama-v1") {
    fail("TEMPLATE_PLACEMENT_MISMATCH", "template does not match the placement receipt")
  }
  if (!template.allowed_models.includes(request.input.model)) fail("MODEL_NOT_ALLOWED", "requested model is not admitted by the template")
  if (Buffer.byteLength(request.input.prompt, "utf8") > template.max_prompt_bytes
    || request.limits.max_response_bytes > template.max_response_bytes
    || request.limits.timeout_ms > template.max_timeout_ms) {
    fail("RESOURCE_CEILING_EXCEEDED", "request exceeds template ceilings")
  }

  const scope = scopeBinding(request, receiptView.selected_node_id)
  const scopeSha256 = sha256(canonicalizeJcs(scope))
  const authorityArtifact = readRepositoryArtifact(
    repositoryRoot,
    "config/execution-fabric/bounded-dispatch-authority-registry.json",
    "bounded dispatch authority registry",
  )
  validateAuthorityRegistry(authorityArtifact.value)
  const authority = authorityArtifact.value.entries.find((entry) => entry.reference === request.authority_reference)
  if (!authority) fail("AUTHORITY_NOT_ADMITTED", "requested authority reference is absent")
  if (authority.work_order_id !== request.work_order_id || authority.template_id !== request.template_id
    || authority.selected_node_id !== receiptView.selected_node_id || authority.scope_sha256 !== scopeSha256) {
    fail("AUTHORITY_SCOPE_MISMATCH", "authority does not bind the exact request scope")
  }
  const scopeArtifact = readRepositoryArtifact(repositoryRoot, authority.scope_path, "bounded dispatch authority scope")
  if (scopeArtifact.sha256 !== authority.scope_artifact_sha256) {
    fail("AUTHORITY_SCOPE_MISMATCH", "authority scope artifact digest does not match")
  }
  exactKeys(scopeArtifact.value, [
    "schema_version", "reference", "work_order_id", "template_id", "selected_node_id", "scope_sha256",
    "maximum_attempts", "risk_class", "forge_permission_set_sha256", "prohibited_actions", "status",
  ], "bounded dispatch authority scope")
  const scopeContract = scopeArtifact.value
  if (scopeContract.schema_version !== "0.1-bounded-dispatch-authority-scope"
    || scopeContract.reference !== authority.reference || scopeContract.work_order_id !== authority.work_order_id
    || scopeContract.template_id !== authority.template_id || scopeContract.selected_node_id !== authority.selected_node_id
    || scopeContract.scope_sha256 !== authority.scope_sha256 || scopeContract.maximum_attempts !== 1
    || scopeContract.risk_class !== "R1" || scopeContract.forge_permission_set_sha256 !== permissionArtifact.sha256
    || scopeContract.status !== "REVIEWED_NON_ACTIVE_SCOPE"
    || JSON.stringify(scopeContract.prohibited_actions) !== JSON.stringify(permissionArtifact.value.prohibited_actions)) {
    fail("AUTHORITY_SCOPE_MISMATCH", "reviewed authority scope contract is invalid")
  }
  if (Date.parse(authority.valid_from) > Date.parse(evaluatedAt)
    || Date.parse(authority.expires_at) <= Date.parse(evaluatedAt)) {
    fail("AUTHORITY_INACTIVE", "authority is not active at preparation time")
  }
  if (typeof proveTrustedAuthority !== "function") fail("AUTHORITY_UNPROVEN", "trusted-main authority proof is required")
  const proof = proveTrustedAuthority({
    registrySha256: authorityArtifact.sha256,
    authority: structuredClone(authority),
    scope: { path: authority.scope_path, sha256: scopeArtifact.sha256 },
  })
  exactKeys(proof, [
    "schema_version", "trusted_ref", "registry_sha256", "authority_reference", "authority_reviewed_commit",
    "scope_artifact_sha256", "exact_entry_count",
  ], "trusted authority proof")
  if (proof.schema_version !== "0.1-trusted-bounded-dispatch-authority-proof"
    || proof.trusted_ref !== "refs/heads/main" || proof.registry_sha256 !== authorityArtifact.sha256
    || proof.authority_reference !== authority.reference || proof.authority_reviewed_commit !== authority.reviewed_commit
    || proof.scope_artifact_sha256 !== scopeArtifact.sha256
    || proof.exact_entry_count !== 1) fail("AUTHORITY_UNPROVEN", "trusted-main authority proof is invalid")

  const validUntil = new Date(Math.min(
    Date.parse(selected.freshness.expires_at),
    Date.parse(authority.expires_at),
  )).toISOString()
  const preparation = {
    schema_version: "0.1-bounded-dispatch-preparation",
    status: "READY_FOR_SINGLE_SHOT_CLAIM",
    request_id: request.request_id,
    work_order_id: request.work_order_id,
    template_id: request.template_id,
    adapter_id: template.adapter_id,
    selected_node_id: receiptView.selected_node_id,
    request_sha256: sha256(canonicalizeJcs(request)),
    scope_sha256: scopeSha256,
    placement_receipt_sha256: receiptSha256,
    placement_replay_sha256: placementProof.semantic_replay_sha256,
    template_registry_sha256: templateArtifact.sha256,
    authority_registry_sha256: authorityArtifact.sha256,
    authority_scope_sha256: scopeArtifact.sha256,
    forge_permission_set_sha256: permissionArtifact.sha256,
    authority_reference: authority.reference,
    authority_reviewed_commit: authority.reviewed_commit,
    prepared_at: evaluatedAt,
    valid_until: validUntil,
    execution_authorized: true,
    dispatch_allowed: false,
    scheduler_activated: false,
    autonomous_dispatch: false,
    silent_replacement: false,
    external_provider_accessed: false,
  }
  preparation.preparation_sha256 = sha256(canonicalizeJcs(preparation))
  return { preparation, request: structuredClone(request) }
}

export function prepareResidentHermesBoundedDispatch(input) {
  try {
    return prepareOrThrow(input).preparation
  } catch (error) {
    if (error instanceof BoundedDispatchError || String(error?.message ?? error).startsWith("FABRIC_SHADOW_PLACEMENT_INVALID:")) {
      return rejected(error)
    }
    throw error
  }
}

function validateResourceObservations(observations, startedAt, completedAt) {
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 16) {
    fail("RESOURCE_EVIDENCE_INVALID", "resource observations must contain between 1 and 16 entries")
  }
  return observations.map((entry, index) => {
    exactKeys(entry, ["metric", "unit", "value", "observed_at"], `resource observation ${index}`)
    if (!ALLOWED_RESOURCE_METRICS.has(entry.metric) || !new Set(["percent", "bytes"]).has(entry.unit)
      || typeof entry.value !== "number" || !Number.isFinite(entry.value) || entry.value < 0) {
      fail("RESOURCE_EVIDENCE_INVALID", `resource observation ${index} is invalid`)
    }
    timestamp(entry.observed_at, `resource observation ${index}.observed_at`)
    if (Date.parse(entry.observed_at) < Date.parse(startedAt)
      || Date.parse(entry.observed_at) > Date.parse(completedAt)) {
      fail("RESOURCE_EVIDENCE_INVALID", "resource observation is outside the execution window")
    }
    return structuredClone(entry)
  })
}

export async function executeResidentHermesBoundedDispatch({
  repositoryRoot,
  receiptBytes,
  request,
  clock,
  proveTrustedAuthority,
  proveTrustedPlacement,
  claimSingleUse,
  acquireExclusiveRuntimeLease,
  releaseExclusiveRuntimeLease,
  invokeLoopbackModel,
  captureResourceObservations,
}) {
  if (typeof clock !== "function" || typeof claimSingleUse !== "function"
    || typeof acquireExclusiveRuntimeLease !== "function" || typeof releaseExclusiveRuntimeLease !== "function"
    || typeof invokeLoopbackModel !== "function" || typeof captureResourceObservations !== "function") {
    fail("RUNTIME_DEPENDENCY_MISSING", "trusted runtime dependencies are required")
  }
  const firstAt = timestamp(clock(), "trusted clock")
  const prepared = prepareOrThrow({
    repositoryRoot, receiptBytes, request, evaluatedAt: firstAt, proveTrustedPlacement, proveTrustedAuthority,
  })
  const claim = await claimSingleUse({
    request_id: request.request_id,
    request_sha256: prepared.preparation.request_sha256,
    scope_sha256: prepared.preparation.scope_sha256,
    authority_reference: prepared.preparation.authority_reference,
    maximum_attempts: 1,
  })
  exactKeys(claim, ["claimed", "claim_id", "claimed_at"], "single-use claim")
  if (claim.claimed !== true) fail("REQUEST_ALREADY_CONSUMED", "single-use request claim was not acquired")
  identifier(claim.claim_id, "single-use claim.claim_id")
  timestamp(claim.claimed_at, "single-use claim.claimed_at")
  const lease = await acquireExclusiveRuntimeLease({
    claim_id: claim.claim_id,
    request_sha256: prepared.preparation.request_sha256,
    authority_reference: prepared.preparation.authority_reference,
  })
  exactKeys(lease, ["acquired", "lease_id", "acquired_at"], "exclusive runtime lease")
  if (lease.acquired !== true) fail("CONCURRENCY_LIMIT_REACHED", "resident HERMES runtime lease is already held")
  identifier(lease.lease_id, "exclusive runtime lease.lease_id")
  timestamp(lease.acquired_at, "exclusive runtime lease.acquired_at")
  let result
  let releaseError = null
  let executionError = null
  let dispatchAttempted = false
  let runtimeLeaseReleased = false
  try {
    const startedAt = timestamp(clock(), "trusted start clock")
    if (Date.parse(claim.claimed_at) < Date.parse(firstAt)
      || Date.parse(claim.claimed_at) > Date.parse(lease.acquired_at)
      || Date.parse(lease.acquired_at) > Date.parse(startedAt)) {
      fail("CLAIM_CHRONOLOGY_INVALID", "claim/lease is outside the preparation/start window")
    }
    const rechecked = prepareOrThrow({
      repositoryRoot, receiptBytes, request, evaluatedAt: startedAt, proveTrustedPlacement, proveTrustedAuthority,
    })
    if (Date.parse(startedAt) < Date.parse(firstAt)
      || rechecked.preparation.request_sha256 !== prepared.preparation.request_sha256
      || rechecked.preparation.scope_sha256 !== prepared.preparation.scope_sha256
      || rechecked.preparation.placement_receipt_sha256 !== prepared.preparation.placement_receipt_sha256
      || rechecked.preparation.template_registry_sha256 !== prepared.preparation.template_registry_sha256
      || rechecked.preparation.authority_registry_sha256 !== prepared.preparation.authority_registry_sha256) {
      fail("PREPARATION_RECHECK_INVALID", "trusted preparation bindings changed before invocation")
    }
    if (Date.parse(startedAt) >= Date.parse(rechecked.preparation.valid_until)) {
      fail("PREPARATION_EXPIRED", "dispatch validity expired before invocation")
    }

    dispatchAttempted = true
    const response = await invokeLoopbackModel({
      adapter_id: rechecked.preparation.adapter_id,
      model: request.input.model,
      prompt: request.input.prompt,
      timeout_ms: request.limits.timeout_ms,
      max_response_bytes: request.limits.max_response_bytes,
    })
    if (typeof response !== "string" || Buffer.byteLength(response, "utf8") > request.limits.max_response_bytes) {
      fail("RESULT_INVALID", "loopback model result is missing or exceeds the response ceiling")
    }
    if (!response.includes(request.input.expected_marker)) {
      const markerError = new BoundedDispatchError("EXPECTED_MARKER_MISSING", "result does not contain the exact expected marker")
      markerError.outputEvidence = {
        sha256: sha256(Buffer.from(response, "utf8")),
        byte_length: Buffer.byteLength(response, "utf8"),
        expected_marker: request.input.expected_marker,
        expected_marker_observed: false,
      }
      throw markerError
    }
    const completedAt = timestamp(clock(), "trusted completion clock")
    if (Date.parse(completedAt) < Date.parse(startedAt)
      || Date.parse(completedAt) >= Date.parse(rechecked.preparation.valid_until)) {
      fail("COMPLETION_CHRONOLOGY_INVALID", "completion is outside the authorized fresh window")
    }
    const resourceObservations = validateResourceObservations(
      await captureResourceObservations({ completed_at: completedAt }),
      startedAt,
      completedAt,
    )
    result = {
    schema_version: "0.1-bounded-dispatch-result",
    status: "COMPLETED",
    result: "SUCCEEDED",
    request_id: request.request_id,
    work_order_id: request.work_order_id,
    template_id: request.template_id,
    adapter_id: rechecked.preparation.adapter_id,
    actual_target_node: "hermes-node",
    request_sha256: rechecked.preparation.request_sha256,
    scope_sha256: rechecked.preparation.scope_sha256,
    placement_receipt_sha256: rechecked.preparation.placement_receipt_sha256,
    preparation_sha256: rechecked.preparation.preparation_sha256,
    authority_reference: rechecked.preparation.authority_reference,
    claim_id: claim.claim_id,
    runtime_lease_id: lease.lease_id,
    chronology: {
      claimed_at: claim.claimed_at,
      lease_acquired_at: lease.acquired_at,
      started_at: startedAt,
      completed_at: completedAt,
    },
    output: {
      sha256: sha256(Buffer.from(response, "utf8")),
      byte_length: Buffer.byteLength(response, "utf8"),
      expected_marker: request.input.expected_marker,
      expected_marker_observed: true,
    },
    resource_observations: resourceObservations,
    execution_authorized: true,
    dispatch_performed: true,
    scheduler_activated: false,
    autonomous_dispatch: false,
    silent_replacement: false,
    external_provider_accessed: false,
    remote_systems_modified: false,
    shell_executed: false,
    runtime_lease_released: false,
  }
  } catch (error) {
    executionError = annotateRuntimeError(error, {
      dispatchAttempted,
      claimId: claim.claim_id,
      runtimeLeaseId: lease.lease_id,
      runtimeLeaseReleased: false,
    })
    throw executionError
  } finally {
    try {
      const released = await releaseExclusiveRuntimeLease({
        lease_id: lease.lease_id,
        claim_id: claim.claim_id,
      })
      runtimeLeaseReleased = released === true
      if (!runtimeLeaseReleased) releaseError = new BoundedDispatchError("LEASE_RELEASE_FAILED", "runtime lease release was not confirmed")
    } catch (error) {
      releaseError = error
    }
    if (executionError) executionError.runtimeLeaseReleased = runtimeLeaseReleased
  }
  if (releaseError) {
    throw annotateRuntimeError(releaseError, {
      dispatchAttempted,
      claimId: claim.claim_id,
      runtimeLeaseId: lease.lease_id,
      runtimeLeaseReleased: false,
    })
  }
  result.runtime_lease_released = true
  result.result_sha256 = sha256(canonicalizeJcs(result))
  return result
}
