import crypto from "node:crypto"

import { canonicalizeJcs } from "./canonical-json.mjs"

const SCHEMA_VERSION = "0.2-shadow-authority-scope"
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const CANONICAL_NODES = new Set(["aegis", "atlas", "azure", "hermes-node", "omen"])
const MAX_ARRAY_ITEMS = 64
const MAX_TEXT_LENGTH = 256
const EXECUTABLE_FIELD = /^(?:command|commands|cmd|args|argv|shell|script|executable|exec|spawn|cwd|stdin|environment|env)$/i
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

export class ShadowAuthorityScopeError extends Error {
  constructor(detail) {
    super(`FABRIC_SHADOW_AUTHORITY_SCOPE_INVALID: ${detail}`)
    this.name = "ShadowAuthorityScopeError"
  }
}

function fail(detail) {
  throw new ShadowAuthorityScopeError(detail)
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

function scanForProhibitedMaterial(value, label = "scope", seen = new WeakSet()) {
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

function safeText(value, label, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    fail(`${label} must be a non-empty string no longer than ${maxLength} characters`)
  }
  if (value !== value.normalize("NFC") || value !== value.trim()) fail(`${label} must be NFC-normalized and trimmed`)
  if (/\p{Cc}|\p{Cf}/u.test(value)) fail(`${label} must not contain control or format characters`)
  return value
}

function identifier(value, label) {
  safeText(value, label, 128)
  if (!SAFE_ID.test(value)) fail(`${label} must be a safe identifier`)
  return value
}

function digest(value, label) {
  safeText(value, label, 64)
  if (!SHA256.test(value)) fail(`${label} must be lowercase SHA-256 hex`)
  return value
}

function sortedUniqueStrings(value, label, validateItem = safeText) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`)
  if (value.length > MAX_ARRAY_ITEMS) fail(`${label} exceeds the ${MAX_ARRAY_ITEMS}-item bound`)
  const strings = value.map((item, index) => validateItem(item, `${label}[${index}]`))
  if (new Set(strings).size !== strings.length) fail(`${label} contains duplicates`)
  if (JSON.stringify(strings) !== JSON.stringify([...strings].sort())) fail(`${label} must be sorted`)
  return strings
}

function contract(value, label) {
  exactKeys(value, ["contract_sha256", "id"], label)
  return {
    id: identifier(value.id, `${label}.id`),
    contract_sha256: digest(value.contract_sha256, `${label}.contract_sha256`),
  }
}

function canonicalNode(value, label) {
  identifier(value, label)
  if (!CANONICAL_NODES.has(value)) fail(`${label} is not a governed canonical execution node`)
  return value
}

export function validateShadowAuthorityScope(scopeInput) {
  scanForProhibitedMaterial(scopeInput)
  exactKeys(scopeInput, [
    "allowed_actions",
    "allowed_canonical_nodes",
    "authority_reference",
    "data_classification",
    "environment_scope",
    "forbidden_actions",
    "owner_decision_conditions",
    "repository_scope",
    "risk_class",
    "schema_version",
    "task_template",
    "work_order_id",
    "workload",
  ], "scope")
  if (scopeInput.schema_version !== SCHEMA_VERSION) fail("scope.schema_version is unsupported")
  if (!new Set(["R0", "R1"]).has(scopeInput.risk_class)) fail("scope.risk_class must be R0 or R1")

  const allowedActions = sortedUniqueStrings(scopeInput.allowed_actions, "scope.allowed_actions")
  const forbiddenActions = sortedUniqueStrings(scopeInput.forbidden_actions, "scope.forbidden_actions")
  const forbiddenFolded = new Set(forbiddenActions.map((action) => action.toLocaleLowerCase("en-US")))
  if (allowedActions.some((action) => forbiddenFolded.has(action.toLocaleLowerCase("en-US")))) {
    fail("scope.allowed_actions and scope.forbidden_actions must be disjoint")
  }

  return {
    schema_version: SCHEMA_VERSION,
    authority_reference: identifier(scopeInput.authority_reference, "scope.authority_reference"),
    work_order_id: identifier(scopeInput.work_order_id, "scope.work_order_id"),
    workload: contract(scopeInput.workload, "scope.workload"),
    risk_class: scopeInput.risk_class,
    task_template: contract(scopeInput.task_template, "scope.task_template"),
    repository_scope: sortedUniqueStrings(scopeInput.repository_scope, "scope.repository_scope"),
    environment_scope: sortedUniqueStrings(scopeInput.environment_scope, "scope.environment_scope"),
    allowed_actions: allowedActions,
    forbidden_actions: forbiddenActions,
    data_classification: safeText(scopeInput.data_classification, "scope.data_classification"),
    owner_decision_conditions: sortedUniqueStrings(scopeInput.owner_decision_conditions, "scope.owner_decision_conditions"),
    allowed_canonical_nodes: sortedUniqueStrings(
      scopeInput.allowed_canonical_nodes,
      "scope.allowed_canonical_nodes",
      canonicalNode,
    ),
  }
}

export function digestShadowAuthorityScope(scopeInput) {
  const scope = validateShadowAuthorityScope(scopeInput)
  return crypto.createHash("sha256").update(`${canonicalizeJcs(scope)}\n`, "utf8").digest("hex")
}
