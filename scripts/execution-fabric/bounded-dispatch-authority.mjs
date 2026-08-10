import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "./canonical-json.mjs"

const CATALOG_SCHEMA = "0.1-bounded-dispatch-task-template-catalog"
const REGISTRY_SCHEMA = "0.1-bounded-dispatch-authority-registry"
const CATALOG_ID = "execution-fabric-bounded-dispatch-task-templates"
const REGISTRY_ID = "execution-fabric-bounded-dispatch-authorities"
const TEMPLATE_ID = "hermes-loopback-local-inference-v1"
const TEMPLATE_VERSION = "1.0.0"
const SHA256 = /^[a-f0-9]{64}$/
const GIT_SHA = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const NONCE = /^[A-Za-z0-9_-]{16,128}$/
const MAX_REGISTRY_ENTRIES = 64
const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000
const TEMPLATE_EXACT = Object.freeze({
  id: TEMPLATE_ID,
  version: TEMPLATE_VERSION,
  canonical_node: "hermes-node",
  workload_id: "local-llm-inference",
  model: "llama3.2:3b",
  prompt_sha256: "ab5bcd896d9617473a3cb8c84c04e2a247f68fb36a257717856acbae4e88a692",
  expected_marker: "HERMES_DISPATCH_001_OK",
  endpoint: "http://127.0.0.1:11434/api/generate",
  endpoint_scope: "loopback-only",
  maximum_calls: 1,
  timeout_seconds: 60,
  redirect_policy: "error",
  stream: false,
  resource_ceilings: Object.freeze({
    maximum_gpu_vram_bytes: 6442450944,
    prompt_limit_bytes: 1024,
    response_limit_bytes: 65536,
  }),
  data_classification: "non-sensitive-only",
  protected_data_allowed: false,
  execution_mode: "FIXED_TEMPLATE_ONLY",
  scheduler_state: "OFF",
  autonomous_dispatch: false,
})
const EXECUTABLE_FIELD = /^(?:command|commands|cmd|args|argv|shell|script|executable|exec|spawn|cwd|stdin|environment|env|headers|body)$/i
const SECRET_FIELD = /(?:^|[_-])(?:secret|secrets|password|passwd|token|tokens|api[_-]?key|credential|credentials|private[_-]?key|connection[_-]?string)(?:$|[_-])/i
const EXECUTABLE_VALUES = [
  /^#!\s*\//,
  /(?:^|\s)(?:bash|sh|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|python(?:3|\.exe)?|node(?:\.exe)?)\s+[-/.\\\w]/i,
  /(?:&&|\|\||[|;`]|\$\(|>\s*[^=])/,
]
const SECRET_VALUES = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@/i,
]

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_BOUNDED_DISPATCH_TEMPLATE_CATALOG = path.resolve(
  moduleDirectory,
  "../../config/execution-fabric/bounded-dispatch-task-templates.json",
)
export const DEFAULT_BOUNDED_DISPATCH_AUTHORITY_REGISTRY = path.resolve(
  moduleDirectory,
  "../../config/execution-fabric/bounded-dispatch-authority-registry.json",
)

export class BoundedDispatchAuthorityError extends Error {
  constructor(detail) {
    super(`FABRIC_BOUNDED_DISPATCH_AUTHORITY_INVALID: ${detail}`)
    this.name = "BoundedDispatchAuthorityError"
  }
}

function fail(detail) {
  throw new BoundedDispatchAuthorityError(detail)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value, expected, label) {
  if (!isObject(value)) fail(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}`)
  }
}

function scanForProhibitedMaterial(value, label, seen = new WeakSet()) {
  if (typeof value === "string") {
    if (SECRET_VALUES.some((pattern) => pattern.test(value))) fail(`${label} contains secret-like material`)
    if (EXECUTABLE_VALUES.some((pattern) => pattern.test(value))) fail(`${label} contains executable-like material`)
    return
  }
  if (value === null || typeof value !== "object") return
  if (seen.has(value)) fail(`${label} must not contain cyclic data`)
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_FIELD.test(key)) fail(`${label}.${key} is an executable-like field`)
    if (SECRET_FIELD.test(key)) fail(`${label}.${key} is a secret-like field`)
    scanForProhibitedMaterial(child, `${label}.${key}`, seen)
  }
  seen.delete(value)
}

function safeString(value, label, maximumLength = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    fail(`${label} must be a non-empty string no longer than ${maximumLength} characters`)
  }
  if (value !== value.normalize("NFC") || value !== value.trim()) fail(`${label} must be NFC-normalized and trimmed`)
  if (/\p{Cc}|\p{Cf}/u.test(value)) fail(`${label} must not contain control or format characters`)
  return value
}

function identifier(value, label) {
  safeString(value, label, 128)
  if (!SAFE_ID.test(value)) fail(`${label} must be a safe identifier`)
  return value
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be lowercase SHA-256 hex`)
  return value
}

function gitCommit(value, label) {
  if (typeof value !== "string" || !GIT_SHA.test(value)) fail(`${label} must be a lowercase 40-character Git commit`)
  return value
}

function nonce(value, label) {
  if (typeof value !== "string" || !NONCE.test(value)) fail(`${label} must be a 16-128 character safe nonce`)
  return value
}

function timestamp(value, label) {
  if (typeof value !== "string") fail(`${label} must be an explicit UTC timestamp`)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/.exec(value)
  if (!match) fail(`${label} must be an explicit millisecond UTC timestamp`)
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) {
    fail(`${label} is not a valid UTC timestamp`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(`${label} is not a canonical UTC timestamp`)
  }
  return milliseconds
}

function exactValue(actual, expected, label) {
  if (actual !== expected) fail(`${label} must be exactly ${JSON.stringify(expected)}`)
  return actual
}

function validateResourceCeilings(value, label) {
  exactKeys(value, ["maximum_gpu_vram_bytes", "prompt_limit_bytes", "response_limit_bytes"], label)
  for (const [field, expected] of Object.entries(TEMPLATE_EXACT.resource_ceilings)) {
    exactValue(value[field], expected, `${label}.${field}`)
  }
  return { ...TEMPLATE_EXACT.resource_ceilings }
}

function validateTemplate(value, label) {
  exactKeys(value, [
    "autonomous_dispatch",
    "canonical_node",
    "data_classification",
    "endpoint",
    "endpoint_scope",
    "execution_mode",
    "expected_marker",
    "id",
    "maximum_calls",
    "model",
    "prompt_sha256",
    "protected_data_allowed",
    "redirect_policy",
    "resource_ceilings",
    "scheduler_state",
    "stream",
    "timeout_seconds",
    "version",
    "workload_id",
  ], label)
  identifier(value.id, `${label}.id`)
  identifier(value.version, `${label}.version`)
  identifier(value.canonical_node, `${label}.canonical_node`)
  identifier(value.workload_id, `${label}.workload_id`)
  safeString(value.model, `${label}.model`, 64)
  sha256(value.prompt_sha256, `${label}.prompt_sha256`)
  identifier(value.expected_marker, `${label}.expected_marker`)
  safeString(value.endpoint, `${label}.endpoint`, 128)
  identifier(value.endpoint_scope, `${label}.endpoint_scope`)
  identifier(value.data_classification, `${label}.data_classification`)
  identifier(value.execution_mode, `${label}.execution_mode`)
  for (const [field, expected] of Object.entries(TEMPLATE_EXACT)) {
    if (field !== "resource_ceilings") exactValue(value[field], expected, `${label}.${field}`)
  }
  return {
    ...TEMPLATE_EXACT,
    resource_ceilings: validateResourceCeilings(value.resource_ceilings, `${label}.resource_ceilings`),
  }
}

export function validateBoundedDispatchScopeArtifact(scopeInput) {
  scanForProhibitedMaterial(scopeInput, "scope")
  exactKeys(scopeInput, [
    "activation_state", "allowed_actions", "autonomous_dispatch", "data_classification",
    "forbidden_actions", "maximum_calls", "network_scope", "protected_data_allowed",
    "risk_class", "scheduler_state", "schema_version", "scope_id", "selected_node",
    "storage_semantics", "template_id", "template_sha256", "template_version",
    "timeout_seconds", "work_order_id", "workload_id",
  ], "scope")
  const expected = {
    schema_version: "0.1-bounded-dispatch-scope",
    risk_class: "R0_LOCAL_PROOF",
    template_id: TEMPLATE_ID,
    template_version: TEMPLATE_VERSION,
    selected_node: "hermes-node",
    workload_id: "gpu-local-inference",
    maximum_calls: 1,
    timeout_seconds: 60,
    data_classification: "non-sensitive-only",
    protected_data_allowed: false,
    storage_semantics: "none",
    network_scope: "loopback-only",
    scheduler_state: "OFF",
    autonomous_dispatch: false,
    activation_state: "REVIEWED_SCOPE_ONLY_NOT_ACTIVE",
  }
  for (const [field, value] of Object.entries(expected)) exactValue(scopeInput[field], value, `scope.${field}`)
  identifier(scopeInput.scope_id, "scope.scope_id")
  identifier(scopeInput.work_order_id, "scope.work_order_id")
  sha256(scopeInput.template_sha256, "scope.template_sha256")
  const allowed = ["invoke-fixed-hermes-loopback-inference", "retain-sanitized-completion-evidence"]
  const forbidden = [
    "aegis-execution", "arbitrary-shell", "autonomous-scheduling", "external-provider-access",
    "protected-data-access", "remote-system-mutation", "silent-replacement", "state-write",
  ]
  if (JSON.stringify(scopeInput.allowed_actions) !== JSON.stringify(allowed)) fail("scope.allowed_actions is not exact")
  if (JSON.stringify(scopeInput.forbidden_actions) !== JSON.stringify(forbidden)) fail("scope.forbidden_actions is not exact")
  return structuredClone(scopeInput)
}

export function validateBoundedDispatchActivationEvidence(activationInput) {
  scanForProhibitedMaterial(activationInput, "activation")
  exactKeys(activationInput, [
    "authority_reference", "autonomous_dispatch", "expires_at", "maximum_uses", "nonce",
    "reviewed_scope_commit", "scheduler_state", "schema_version", "scope_id", "scope_sha256",
    "selected_node", "status", "template_sha256", "valid_from", "work_order_id",
  ], "activation")
  exactValue(activationInput.schema_version, "0.1-bounded-dispatch-activation-evidence", "activation.schema_version")
  exactValue(activationInput.selected_node, "hermes-node", "activation.selected_node")
  exactValue(activationInput.maximum_uses, 1, "activation.maximum_uses")
  exactValue(activationInput.status, "REVIEWED_ACTIVATION_EVIDENCE", "activation.status")
  exactValue(activationInput.scheduler_state, "OFF", "activation.scheduler_state")
  exactValue(activationInput.autonomous_dispatch, false, "activation.autonomous_dispatch")
  for (const field of ["authority_reference", "work_order_id", "scope_id"]) identifier(activationInput[field], `activation.${field}`)
  for (const field of ["scope_sha256", "template_sha256"]) sha256(activationInput[field], `activation.${field}`)
  gitCommit(activationInput.reviewed_scope_commit, "activation.reviewed_scope_commit")
  nonce(activationInput.nonce, "activation.nonce")
  const start = timestamp(activationInput.valid_from, "activation.valid_from")
  const end = timestamp(activationInput.expires_at, "activation.expires_at")
  if (end <= start || end - start > MAX_VALIDITY_MS) fail("activation validity window is invalid")
  return structuredClone(activationInput)
}

export function validateBoundedDispatchTaskTemplateCatalog(catalogInput) {
  scanForProhibitedMaterial(catalogInput, "template_catalog")
  exactKeys(catalogInput, ["catalog_id", "schema_version", "scheduler_state", "templates"], "template_catalog")
  exactValue(catalogInput.schema_version, CATALOG_SCHEMA, "template_catalog.schema_version")
  exactValue(catalogInput.catalog_id, CATALOG_ID, "template_catalog.catalog_id")
  exactValue(catalogInput.scheduler_state, "OFF", "template_catalog.scheduler_state")
  if (!Array.isArray(catalogInput.templates) || catalogInput.templates.length === 0) {
    fail("template_catalog.templates must be a non-empty array")
  }
  const keys = catalogInput.templates.map((template, index) => {
    if (!isObject(template)) fail(`template_catalog.templates[${index}] must be an object`)
    return `${template.id ?? ""}@${template.version ?? ""}`
  })
  if (new Set(keys).size !== keys.length) fail("template_catalog.templates contains duplicate ID/version entries")
  if (JSON.stringify(keys) !== JSON.stringify([...keys].sort())) fail("template_catalog.templates must be sorted by ID/version")
  if (catalogInput.templates.length !== 1 || keys[0] !== `${TEMPLATE_ID}@${TEMPLATE_VERSION}`) {
    fail(`template_catalog must contain only the reviewed ${TEMPLATE_ID}@${TEMPLATE_VERSION} template`)
  }
  const templates = catalogInput.templates.map((template, index) => validateTemplate(
    template,
    `template_catalog.templates[${index}]`,
  ))
  return {
    schema_version: CATALOG_SCHEMA,
    catalog_id: CATALOG_ID,
    scheduler_state: "OFF",
    status: "VALID",
    templates,
  }
}

export function digestBoundedDispatchTaskTemplate(templateInput) {
  const template = validateTemplate(templateInput, "template")
  return crypto.createHash("sha256").update(`${canonicalizeJcs(template)}\n`, "utf8").digest("hex")
}

function validateRegistryEntry(entry, index) {
  const label = `authority_registry.entries[${index}]`
  exactKeys(entry, [
    "activation_commit",
    "activation_evidence_path",
    "activation_evidence_sha256",
    "authority_reference",
    "expires_at",
    "maximum_uses",
    "nonce",
    "reviewed_scope_commit",
    "scope_id",
    "scope_path",
    "scope_sha256",
    "selected_node",
    "status",
    "template_id",
    "template_sha256",
    "template_version",
    "uses_consumed",
    "valid_from",
    "work_order_id",
  ], label)
  const status = entry.status
  if (!new Set(["ACTIVE", "CONSUMED", "REVOKED"]).has(status)) fail(`${label}.status is unsupported`)
  exactValue(entry.maximum_uses, 1, `${label}.maximum_uses`)
  if (!Number.isInteger(entry.uses_consumed) || !new Set([0, 1]).has(entry.uses_consumed)) {
    fail(`${label}.uses_consumed must be 0 or 1`)
  }
  if (status === "ACTIVE" && entry.uses_consumed !== 0) fail(`${label} ACTIVE authority must be unused`)
  if (status === "CONSUMED" && entry.uses_consumed !== 1) fail(`${label} CONSUMED authority must have one use`)
  const validFrom = timestamp(entry.valid_from, `${label}.valid_from`)
  const expiresAt = timestamp(entry.expires_at, `${label}.expires_at`)
  if (expiresAt <= validFrom) fail(`${label}.expires_at must be after valid_from`)
  if (expiresAt - validFrom > MAX_VALIDITY_MS) fail(`${label} validity window exceeds 24 hours`)
  const reviewedScopeCommit = gitCommit(entry.reviewed_scope_commit, `${label}.reviewed_scope_commit`)
  const activationCommit = gitCommit(entry.activation_commit, `${label}.activation_commit`)
  if (activationCommit === reviewedScopeCommit) fail(`${label} activation_commit must be separate from reviewed_scope_commit`)
  exactValue(entry.template_id, TEMPLATE_ID, `${label}.template_id`)
  exactValue(entry.template_version, TEMPLATE_VERSION, `${label}.template_version`)
  exactValue(entry.selected_node, "hermes-node", `${label}.selected_node`)
  return {
    authority_reference: identifier(entry.authority_reference, `${label}.authority_reference`),
    work_order_id: identifier(entry.work_order_id, `${label}.work_order_id`),
    scope_id: identifier(entry.scope_id, `${label}.scope_id`),
    scope_path: safeString(entry.scope_path, `${label}.scope_path`, 256),
    scope_sha256: sha256(entry.scope_sha256, `${label}.scope_sha256`),
    template_id: identifier(entry.template_id, `${label}.template_id`),
    template_version: identifier(entry.template_version, `${label}.template_version`),
    template_sha256: sha256(entry.template_sha256, `${label}.template_sha256`),
    selected_node: identifier(entry.selected_node, `${label}.selected_node`),
    valid_from: entry.valid_from,
    expires_at: entry.expires_at,
    reviewed_scope_commit: reviewedScopeCommit,
    activation_commit: activationCommit,
    activation_evidence_path: safeString(entry.activation_evidence_path, `${label}.activation_evidence_path`, 256),
    activation_evidence_sha256: sha256(entry.activation_evidence_sha256, `${label}.activation_evidence_sha256`),
    nonce: nonce(entry.nonce, `${label}.nonce`),
    maximum_uses: 1,
    uses_consumed: entry.uses_consumed,
    status,
  }
}

export function validateBoundedDispatchAuthorityRegistry(registryInput) {
  scanForProhibitedMaterial(registryInput, "authority_registry")
  exactKeys(registryInput, ["entries", "registry_id", "schema_version"], "authority_registry")
  exactValue(registryInput.schema_version, REGISTRY_SCHEMA, "authority_registry.schema_version")
  exactValue(registryInput.registry_id, REGISTRY_ID, "authority_registry.registry_id")
  if (!Array.isArray(registryInput.entries)) fail("authority_registry.entries must be an array")
  if (registryInput.entries.length > MAX_REGISTRY_ENTRIES) {
    fail(`authority_registry.entries exceeds the ${MAX_REGISTRY_ENTRIES}-entry bound`)
  }
  const entries = registryInput.entries.map(validateRegistryEntry)
  const references = entries.map((entry) => entry.authority_reference)
  const nonces = entries.map((entry) => entry.nonce)
  if (new Set(references).size !== references.length) fail("authority_registry.entries contains duplicate authority references")
  if (new Set(nonces).size !== nonces.length) fail("authority_registry.entries contains duplicate nonces")
  if (JSON.stringify(references) !== JSON.stringify([...references].sort())) {
    fail("authority_registry.entries must be sorted by authority_reference")
  }
  return {
    schema_version: REGISTRY_SCHEMA,
    registry_id: REGISTRY_ID,
    status: entries.length === 0 ? "EMPTY_FAIL_CLOSED" : "VALID",
    entries,
  }
}

function normalizeCatalog(catalog) {
  if (!isObject(catalog) || !Object.hasOwn(catalog, "status")) {
    return validateBoundedDispatchTaskTemplateCatalog(catalog)
  }
  exactKeys(catalog, ["catalog_id", "schema_version", "scheduler_state", "status", "templates"], "template_catalog")
  if (catalog.status !== "VALID") fail("template_catalog normalized status is inconsistent")
  return validateBoundedDispatchTaskTemplateCatalog({
    schema_version: catalog.schema_version,
    catalog_id: catalog.catalog_id,
    scheduler_state: catalog.scheduler_state,
    templates: catalog.templates,
  })
}

function normalizeRegistry(registry) {
  if (!isObject(registry) || !Object.hasOwn(registry, "status")) {
    return validateBoundedDispatchAuthorityRegistry(registry)
  }
  exactKeys(registry, ["entries", "registry_id", "schema_version", "status"], "authority_registry")
  const validated = validateBoundedDispatchAuthorityRegistry({
    schema_version: registry.schema_version,
    registry_id: registry.registry_id,
    entries: registry.entries,
  })
  if (registry.status !== validated.status) fail("authority_registry normalized status is inconsistent")
  return validated
}

function blockedEmptyRegistry() {
  return {
    schema_version: "0.1-bounded-dispatch-authority-settlement",
    status: "BLOCKED_EMPTY_REGISTRY",
    reason: "no reviewed bounded-dispatch activation exists",
    authority_settled: false,
    eligible_for_single_shot_dispatch: false,
    maximum_calls: 0,
    scheduler_state: "OFF",
    network_called: false,
    execution_performed: false,
  }
}

export function settleBoundedDispatchAuthority({ catalog, registry, request, at }) {
  const templates = normalizeCatalog(catalog)
  const authorities = normalizeRegistry(registry)
  if (authorities.status === "EMPTY_FAIL_CLOSED") return blockedEmptyRegistry()
  scanForProhibitedMaterial(request, "request")
  exactKeys(request, [
    "authority_reference",
    "nonce",
    "scope_id",
    "scope_sha256",
    "selected_node",
    "template_id",
    "template_sha256",
    "template_version",
    "work_order_id",
  ], "request")
  const evaluatedAt = timestamp(at, "at")
  const authorityReference = identifier(request.authority_reference, "request.authority_reference")
  const authority = authorities.entries.find((entry) => entry.authority_reference === authorityReference)
  if (!authority) fail("request authority_reference is not present in the reviewed activation registry")
  if (authority.status !== "ACTIVE") fail(`authority is not active: ${authority.status}`)
  if (authority.maximum_uses !== 1 || authority.uses_consumed !== 0) fail("authority is not an unused single-use activation")
  const validFrom = timestamp(authority.valid_from, "authority.valid_from")
  const expiresAt = timestamp(authority.expires_at, "authority.expires_at")
  if (evaluatedAt < validFrom) fail("authority is not yet valid")
  if (evaluatedAt >= expiresAt) fail("authority is expired")

  const template = templates.templates.find((candidate) => (
    candidate.id === request.template_id && candidate.version === request.template_version
  ))
  if (!template) fail("request template ID/version is not present in the reviewed catalog")
  const templateSha256 = digestBoundedDispatchTaskTemplate(template)
  const bindings = [
    ["work_order_id", request.work_order_id, authority.work_order_id],
    ["scope_id", request.scope_id, authority.scope_id],
    ["scope_sha256", request.scope_sha256, authority.scope_sha256],
    ["template_id", request.template_id, authority.template_id],
    ["template_version", request.template_version, authority.template_version],
    ["template_sha256", request.template_sha256, authority.template_sha256],
    ["selected_node", request.selected_node, authority.selected_node],
    ["nonce", request.nonce, authority.nonce],
  ]
  for (const [field, requested, activated] of bindings) {
    if (requested !== activated) fail(`${field} does not match the reviewed activation`)
  }
  if (request.template_sha256 !== templateSha256) fail("template_sha256 does not match the reviewed catalog template")
  if (request.selected_node !== template.canonical_node || request.selected_node !== "hermes-node") {
    fail("selected_node does not match the template canonical HERMES node")
  }
  return {
    schema_version: "0.1-bounded-dispatch-authority-settlement",
    status: "SINGLE_USE_AUTHORITY_SETTLED",
    authority_settled: true,
    eligible_for_single_shot_dispatch: true,
    authority_reference: authority.authority_reference,
    work_order_id: authority.work_order_id,
    scope_id: authority.scope_id,
    scope_path: authority.scope_path,
    scope_sha256: authority.scope_sha256,
    template_id: template.id,
    template_version: template.version,
    template_sha256: templateSha256,
    selected_node: template.canonical_node,
    nonce: authority.nonce,
    maximum_calls: 1,
    uses_consumed: 0,
    valid_from: authority.valid_from,
    expires_at: authority.expires_at,
    reviewed_scope_commit: authority.reviewed_scope_commit,
    activation_commit: authority.activation_commit,
    activation_evidence_path: authority.activation_evidence_path,
    activation_evidence_sha256: authority.activation_evidence_sha256,
    scheduler_state: "OFF",
    network_called: false,
    execution_performed: false,
  }
}

function repositoryRelative(value, prefix, label) {
  safeString(value, label, 256)
  if (path.isAbsolute(value) || value.includes("\\") || value.includes("..") || !value.startsWith(prefix)) {
    fail(`${label} is outside the reviewed repository evidence scope`)
  }
  if (!value.endsWith(".json")) fail(`${label} must be a JSON evidence artifact`)
  return value
}

function git(root, args, { encoding = "utf8" } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding, windowsHide: true })
  if (result.error || result.status !== 0) fail("trusted Git provenance proof failed")
  return result.stdout
}

export function proveBoundedDispatchAuthorityFromGit({
  repositoryRoot,
  settlement,
  trustedRef = "refs/remotes/origin/main",
}) {
  if (!settlement || settlement.status !== "SINGLE_USE_AUTHORITY_SETTLED") {
    fail("a settled single-use authority is required for Git provenance proof")
  }
  const root = fs.realpathSync(path.resolve(repositoryRoot))
  const scopePath = repositoryRelative(
    settlement.scope_path,
    "config/execution-fabric/dispatch-authority-scopes/",
    "scope_path",
  )
  const activationPath = repositoryRelative(
    settlement.activation_evidence_path,
    "docs/reports/execution-fabric-dispatch-activations/",
    "activation_evidence_path",
  )
  const scopeBytes = Buffer.from(git(root, ["show", `${settlement.reviewed_scope_commit}:${scopePath}`], { encoding: null }))
  const activationBytes = Buffer.from(git(root, ["show", `${settlement.activation_commit}:${activationPath}`], { encoding: null }))
  if (crypto.createHash("sha256").update(scopeBytes).digest("hex") !== settlement.scope_sha256) {
    fail("reviewed scope bytes do not match scope_sha256")
  }
  if (crypto.createHash("sha256").update(activationBytes).digest("hex") !== settlement.activation_evidence_sha256) {
    fail("activation evidence bytes do not match activation_evidence_sha256")
  }
  let scope
  let activation
  try {
    scope = validateBoundedDispatchScopeArtifact(JSON.parse(scopeBytes.toString("utf8")))
    activation = validateBoundedDispatchActivationEvidence(JSON.parse(activationBytes.toString("utf8")))
  } catch (error) {
    if (error instanceof BoundedDispatchAuthorityError) throw error
    fail("reviewed scope or activation evidence is not valid JSON")
  }
  const exactBindings = [
    ["scope.scope_id", scope.scope_id, settlement.scope_id],
    ["scope.work_order_id", scope.work_order_id, settlement.work_order_id],
    ["scope.template_sha256", scope.template_sha256, settlement.template_sha256],
    ["activation.authority_reference", activation.authority_reference, settlement.authority_reference],
    ["activation.work_order_id", activation.work_order_id, settlement.work_order_id],
    ["activation.scope_id", activation.scope_id, settlement.scope_id],
    ["activation.scope_sha256", activation.scope_sha256, settlement.scope_sha256],
    ["activation.template_sha256", activation.template_sha256, settlement.template_sha256],
    ["activation.selected_node", activation.selected_node, settlement.selected_node],
    ["activation.valid_from", activation.valid_from, settlement.valid_from],
    ["activation.expires_at", activation.expires_at, settlement.expires_at],
    ["activation.reviewed_scope_commit", activation.reviewed_scope_commit, settlement.reviewed_scope_commit],
    ["activation.nonce", activation.nonce, settlement.nonce],
  ]
  for (const [label, actual, expected] of exactBindings) {
    if (actual !== expected) fail(`${label} does not match the settled authority`)
  }
  const strictPairs = [
    [settlement.reviewed_scope_commit, settlement.activation_commit],
    [settlement.activation_commit, trustedRef],
  ]
  for (const [ancestor, descendant] of strictPairs) {
    if (ancestor === descendant) fail("scope, activation, and trusted ref must be distinct chronology points")
    const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    })
    if (result.error || result.status !== 0) fail("review-before-activation trusted-main chronology is not proven")
  }
  return {
    status: "TRUSTED_MAIN_AUTHORITY_PROVEN",
    trusted_ref: trustedRef,
    scope_commit: settlement.reviewed_scope_commit,
    scope_path: scopePath,
    scope_sha256: settlement.scope_sha256,
    activation_commit: settlement.activation_commit,
    activation_evidence_path: activationPath,
    activation_evidence_sha256: settlement.activation_evidence_sha256,
    scheduler_state: "OFF",
    execution_performed: false,
  }
}

function readJson(filePath, label) {
  let bytes
  try {
    bytes = fs.readFileSync(path.resolve(filePath))
  } catch (error) {
    fail(`unable to read ${label}: ${error.message}`)
  }
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`)
  }
}

export function loadBoundedDispatchAuthorityFiles({
  catalogPath = DEFAULT_BOUNDED_DISPATCH_TEMPLATE_CATALOG,
  registryPath = DEFAULT_BOUNDED_DISPATCH_AUTHORITY_REGISTRY,
} = {}) {
  return {
    catalog: validateBoundedDispatchTaskTemplateCatalog(readJson(catalogPath, "task-template catalog")),
    registry: validateBoundedDispatchAuthorityRegistry(readJson(registryPath, "authority registry")),
  }
}
