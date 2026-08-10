import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { validateShadowOutcomeEvidence } from "./shadow-outcome-evidence.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const GIT_SHA = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_SCOPE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const CANONICAL_NODES = new Set(["aegis", "atlas", "azure", "hermes-node", "omen"])

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_SHADOW_OUTCOME_REGISTRY = path.resolve(
  moduleDirectory,
  "../../config/execution-fabric/shadow-outcome-registry.json",
)
export const DEFAULT_SHADOW_AUTHORITY_REGISTRY = path.resolve(
  moduleDirectory,
  "../../config/execution-fabric/shadow-authority-registry.json",
)

export class ShadowEvidenceTrustError extends Error {
  constructor(detail) {
    super(`FABRIC_SHADOW_EVIDENCE_TRUST_INVALID: ${detail}`)
    this.name = "ShadowEvidenceTrustError"
  }
}

function fail(detail) {
  throw new ShadowEvidenceTrustError(detail)
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

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail(`${label} must be a safe identifier`)
  return value
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be lowercase SHA-256 hex`)
  return value
}

function gitCommit(value, label) {
  if (typeof value !== "string" || !GIT_SHA.test(value)) fail(`${label} must be a lowercase 40-character Git commit`)
  return value
}

function timestamp(value, label) {
  if (typeof value !== "string") fail(`${label} must be an explicit UTC timestamp`)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/.exec(value)
  if (!match) fail(`${label} must be an explicit UTC timestamp`)
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59) fail(`${label} is not a valid UTC timestamp`)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) fail(`${label} is not a valid UTC timestamp`)
  return milliseconds
}

function validateRegistryEnvelope(registry, schemaVersion, label) {
  exactKeys(registry, ["entries", "registry_id", "schema_version"], label)
  if (registry.schema_version !== schemaVersion) fail(`${label}.schema_version is unsupported`)
  identifier(registry.registry_id, `${label}.registry_id`)
  if (!Array.isArray(registry.entries)) fail(`${label}.entries must be an array`)
  if (registry.entries.length > 1024) fail(`${label}.entries exceeds the 1024-entry bound`)
}

function canonicalNode(value, label) {
  identifier(value, label)
  if (!CANONICAL_NODES.has(value)) fail(`${label} is not a canonical execution node`)
  return value
}

function scopeValue(value, label) {
  if (typeof value !== "string" || !SAFE_SCOPE_VALUE.test(value)) fail(`${label} must be a safe scope value`)
  return value
}

function sortedScopeValues(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`)
  const normalized = value.map((entry, index) => scopeValue(entry, `${label}[${index}]`))
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicates`)
  if (JSON.stringify(normalized) !== JSON.stringify([...normalized].sort())) fail(`${label} must be sorted`)
  return normalized
}

function validateAuthorityScope(scope, label) {
  exactKeys(scope, [
    "allowed_actions", "data_classification", "environment_scope", "forbidden_actions",
    "owner_decision_condition", "repository_scope", "risk_class", "task_template_id", "workload_id",
  ], label)
  return {
    workload_id: identifier(scope.workload_id, `${label}.workload_id`),
    risk_class: identifier(scope.risk_class, `${label}.risk_class`),
    task_template_id: identifier(scope.task_template_id, `${label}.task_template_id`),
    repository_scope: sortedScopeValues(scope.repository_scope, `${label}.repository_scope`),
    environment_scope: sortedScopeValues(scope.environment_scope, `${label}.environment_scope`),
    allowed_actions: sortedScopeValues(scope.allowed_actions, `${label}.allowed_actions`),
    forbidden_actions: sortedScopeValues(scope.forbidden_actions, `${label}.forbidden_actions`),
    data_classification: identifier(scope.data_classification, `${label}.data_classification`),
    owner_decision_condition: identifier(scope.owner_decision_condition, `${label}.owner_decision_condition`),
  }
}

export function validateShadowOutcomeRegistry(registryInput) {
  const registry = structuredClone(registryInput)
  validateRegistryEnvelope(registry, "0.1-shadow-outcome-registry", "outcome_registry")
  const artifactDigests = new Set()
  const entries = registry.entries.map((entry, index) => {
    const label = `outcome_registry.entries[${index}]`
    exactKeys(entry, [
      "actual_target_node", "artifact_sha256", "authority_reference", "retained_source_sha256",
      "reviewed_commit", "status", "work_order_id",
    ], label)
    const artifactSha256 = digest(entry.artifact_sha256, `${label}.artifact_sha256`)
    if (artifactDigests.has(artifactSha256)) fail(`${label}.artifact_sha256 is duplicated`)
    artifactDigests.add(artifactSha256)
    if (entry.status !== "ACTIVE") fail(`${label}.status must be ACTIVE`)
    return {
      artifact_sha256: artifactSha256,
      work_order_id: identifier(entry.work_order_id, `${label}.work_order_id`),
      actual_target_node: canonicalNode(entry.actual_target_node, `${label}.actual_target_node`),
      retained_source_sha256: digest(entry.retained_source_sha256, `${label}.retained_source_sha256`),
      authority_reference: identifier(entry.authority_reference, `${label}.authority_reference`),
      reviewed_commit: gitCommit(entry.reviewed_commit, `${label}.reviewed_commit`),
      status: "ACTIVE",
    }
  })
  return {
    schema_version: registry.schema_version,
    registry_id: registry.registry_id,
    status: entries.length === 0 ? "EMPTY_FAIL_CLOSED" : "VALID",
    entries,
  }
}

export function validateShadowAuthorityRegistry(registryInput) {
  const registry = structuredClone(registryInput)
  validateRegistryEnvelope(registry, "0.1-shadow-authority-registry", "authority_registry")
  const references = new Set()
  const entries = registry.entries.map((entry, index) => {
    const label = `authority_registry.entries[${index}]`
    exactKeys(entry, [
      "allowed_canonical_nodes", "authority_scope", "expires_at", "reference", "reviewed_commit", "status",
      "valid_from", "work_order_id",
    ], label)
    const reference = identifier(entry.reference, `${label}.reference`)
    if (references.has(reference)) fail(`${label}.reference is duplicated`)
    references.add(reference)
    if (entry.status !== "ACTIVE") fail(`${label}.status must be ACTIVE`)
    if (!Array.isArray(entry.allowed_canonical_nodes) || entry.allowed_canonical_nodes.length === 0) {
      fail(`${label}.allowed_canonical_nodes must be non-empty`)
    }
    const allowedCanonicalNodes = entry.allowed_canonical_nodes.map((node, nodeIndex) => (
      canonicalNode(node, `${label}.allowed_canonical_nodes[${nodeIndex}]`)
    ))
    if (new Set(allowedCanonicalNodes).size !== allowedCanonicalNodes.length) {
      fail(`${label}.allowed_canonical_nodes contains duplicates`)
    }
    const sortedNodes = [...allowedCanonicalNodes].sort()
    if (JSON.stringify(allowedCanonicalNodes) !== JSON.stringify(sortedNodes)) {
      fail(`${label}.allowed_canonical_nodes must be sorted`)
    }
    const validFrom = timestamp(entry.valid_from, `${label}.valid_from`)
    const expiresAt = timestamp(entry.expires_at, `${label}.expires_at`)
    if (expiresAt <= validFrom) fail(`${label}.expires_at must be after valid_from`)
    return {
      reference,
      work_order_id: identifier(entry.work_order_id, `${label}.work_order_id`),
      authority_scope: validateAuthorityScope(entry.authority_scope, `${label}.authority_scope`),
      allowed_canonical_nodes: allowedCanonicalNodes,
      valid_from: new Date(validFrom).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      reviewed_commit: gitCommit(entry.reviewed_commit, `${label}.reviewed_commit`),
      status: "ACTIVE",
    }
  })
  return {
    schema_version: registry.schema_version,
    registry_id: registry.registry_id,
    status: entries.length === 0 ? "EMPTY_FAIL_CLOSED" : "VALID",
    entries,
  }
}

function readJson(filePath, label) {
  let bytes
  try {
    bytes = fs.readFileSync(path.resolve(filePath))
  } catch (error) {
    fail(`unable to read ${label}: ${error.message}`)
  }
  let value
  try {
    value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`)
  }
  return value
}

export function loadShadowEvidenceTrustRegistries({
  outcomeRegistryPath = DEFAULT_SHADOW_OUTCOME_REGISTRY,
  authorityRegistryPath = DEFAULT_SHADOW_AUTHORITY_REGISTRY,
} = {}) {
  return {
    outcome_registry: validateShadowOutcomeRegistry(readJson(outcomeRegistryPath, "outcome registry")),
    authority_registry: validateShadowAuthorityRegistry(readJson(authorityRegistryPath, "authority registry")),
  }
}

function normalizeOutcomeRegistry(registry) {
  if (!isObject(registry) || !Object.hasOwn(registry, "status")) return validateShadowOutcomeRegistry(registry)
  exactKeys(registry, ["entries", "registry_id", "schema_version", "status"], "outcome_registry")
  const validated = validateShadowOutcomeRegistry({
    schema_version: registry.schema_version,
    registry_id: registry.registry_id,
    entries: registry.entries,
  })
  if (registry.status !== validated.status) fail("outcome_registry normalized status is inconsistent")
  return validated
}

function normalizeAuthorityRegistry(registry) {
  if (!isObject(registry) || !Object.hasOwn(registry, "status")) return validateShadowAuthorityRegistry(registry)
  exactKeys(registry, ["entries", "registry_id", "schema_version", "status"], "authority_registry")
  const validated = validateShadowAuthorityRegistry({
    schema_version: registry.schema_version,
    registry_id: registry.registry_id,
    entries: registry.entries,
  })
  if (registry.status !== validated.status) fail("authority_registry normalized status is inconsistent")
  return validated
}

export function validateShadowEvidenceTrust({
  artifactBytes,
  expectedArtifactSha256,
  retainedSourceSha256,
  workloadId,
  outcomeRegistry,
  authorityRegistry,
}) {
  let outcomeEvidence
  try {
    outcomeEvidence = validateShadowOutcomeEvidence({
      artifactBytes,
      expectedSha256: expectedArtifactSha256,
    })
  } catch (error) {
    fail(`outcome artifact validation failed: ${error.message}`)
  }
  digest(retainedSourceSha256, "retained_source_sha256")
  identifier(workloadId, "workload_id")
  const outcomes = normalizeOutcomeRegistry(outcomeRegistry)
  const authorities = normalizeAuthorityRegistry(authorityRegistry)
  if (outcomes.status !== "VALID" || authorities.status !== "VALID") {
    fail("empty or invalid trust registries cannot settle outcome evidence")
  }

  const outcomeEntry = outcomes.entries.find((entry) => entry.artifact_sha256 === outcomeEvidence.artifact_sha256)
  if (!outcomeEntry) fail("outcome artifact is not present in the reviewed outcome registry")
  if (outcomeEntry.work_order_id !== outcomeEvidence.work_order_id) fail("outcome Work Order binding mismatch")
  if (outcomeEntry.actual_target_node !== outcomeEvidence.actual_target_node) fail("outcome actual-node binding mismatch")
  if (outcomeEntry.retained_source_sha256 !== retainedSourceSha256) fail("outcome retained-source binding mismatch")
  if (outcomeEntry.authority_reference !== outcomeEvidence.authority_outcome.reference) {
    fail("outcome authority-reference binding mismatch")
  }

  const authorityEntry = authorities.entries.find((entry) => entry.reference === outcomeEntry.authority_reference)
  if (!authorityEntry) fail("authority reference is not present in the reviewed authority registry")
  if (authorityEntry.work_order_id !== outcomeEvidence.work_order_id) fail("authority Work Order binding mismatch")
  if (authorityEntry.authority_scope.workload_id !== workloadId) fail("authority workload binding mismatch")
  if (!authorityEntry.allowed_canonical_nodes.includes(outcomeEvidence.actual_target_node)) {
    fail("actual target is not allowed by the reviewed authority entry")
  }
  const checkedAt = timestamp(outcomeEvidence.authority_outcome.checked_at, "outcome_evidence.authority_outcome.checked_at")
  const startedAt = timestamp(outcomeEvidence.chronology.started_at, "outcome_evidence.started_at")
  const completedAt = timestamp(outcomeEvidence.chronology.completed_at, "outcome_evidence.completed_at")
  const validFrom = timestamp(authorityEntry.valid_from, "authority_entry.valid_from")
  const expiresAt = timestamp(authorityEntry.expires_at, "authority_entry.expires_at")
  if ([checkedAt, startedAt, completedAt].some((instant) => instant < validFrom || instant >= expiresAt)) {
    fail("authority check or execution chronology is outside the reviewed validity window")
  }

  return {
    schema_version: "0.1-shadow-evidence-trust-validation",
    status: "TRUSTED",
    observation_only: true,
    artifact_sha256: outcomeEvidence.artifact_sha256,
    retained_source_sha256: retainedSourceSha256,
    work_order_id: outcomeEvidence.work_order_id,
    actual_target_node: outcomeEvidence.actual_target_node,
    authority_reference: authorityEntry.reference,
    outcome_reviewed_commit: outcomeEntry.reviewed_commit,
    authority_reviewed_commit: authorityEntry.reviewed_commit,
    dispatch_allowed: false,
    execution_authorized: false,
    remote_systems_modified: false,
  }
}
