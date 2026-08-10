import crypto from "node:crypto"

import { canonicalizeJcs } from "./canonical-json.mjs"
import {
  digestShadowAuthorityScope,
  validateShadowAuthorityScope,
} from "./shadow-authority-scope.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_PATH = /^docs\/reports\/execution-fabric-shadow-authorities\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/

export class ShadowScopedAuthorityError extends Error {
  constructor(detail) {
    super(`FABRIC_SHADOW_SCOPED_AUTHORITY_INVALID: ${detail}`)
    this.name = "ShadowScopedAuthorityError"
  }
}

const fail = (detail) => { throw new ShadowScopedAuthorityError(detail) }
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalDigest = (value) => sha256(Buffer.from(`${canonicalizeJcs(value)}\n`, "utf8"))

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
}

function exact(value, keys, label) {
  object(value, label)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} must contain exactly: ${[...keys].sort().join(", ")}`)
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

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) fail(`${label} must be a lowercase Git commit`)
  return value
}

function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail(`${label} must be an explicit millisecond UTC timestamp`)
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(`${label} must name a real UTC instant`)
  return parsed
}

function canonicalArtifact(artifactBytes, expectedSha256) {
  if (!Buffer.isBuffer(artifactBytes) || artifactBytes.length === 0) fail("authority artifact must be non-empty bytes")
  if (sha256(artifactBytes) !== digest(expectedSha256, "authority_artifact_sha256")) {
    fail("authority artifact bytes do not match authority_artifact_sha256")
  }
  let artifact
  try { artifact = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes)) } catch (error) {
    fail(`authority artifact is not valid UTF-8 JSON: ${error.message}`)
  }
  let expectedBytes
  try { expectedBytes = Buffer.from(`${canonicalizeJcs(artifact)}\n`, "utf8") } catch (error) {
    fail(`authority artifact cannot be canonically encoded: ${error.message}`)
  }
  if (!artifactBytes.equals(expectedBytes)) fail("authority artifact must be exact JCS JSON followed by one newline")
  return artifact
}

export function validateShadowAuthorityArtifact({ artifactBytes, expectedSha256 }) {
  const scope = validateShadowAuthorityScope(canonicalArtifact(artifactBytes, expectedSha256))
  return {
    schema_version: "0.2-shadow-authority-artifact-validation",
    status: "VALID",
    artifact_sha256: expectedSha256,
    authority_scope_sha256: digestShadowAuthorityScope(scope),
    scope,
  }
}

export function validateScopedShadowAuthorityRegistry(registryInput) {
  const registry = structuredClone(registryInput)
  exact(registry, ["entries", "registry_id", "schema_version"], "registry")
  if (registry.schema_version !== "0.2-shadow-authority-registry") fail("registry.schema_version is unsupported")
  identifier(registry.registry_id, "registry.registry_id")
  if (!Array.isArray(registry.entries) || registry.entries.length > 1024) fail("registry.entries must be a bounded array")
  const references = new Set()
  const entries = registry.entries.map((entry, index) => {
    const label = `registry.entries[${index}]`
    exact(entry, [
      "authority_artifact_path", "authority_artifact_sha256", "authority_scope_sha256",
      "expires_at", "reference", "scope_review_commit", "status", "valid_from", "work_order_id",
    ], label)
    const reference = identifier(entry.reference, `${label}.reference`)
    if (references.has(reference)) fail(`${label}.reference is duplicated`)
    references.add(reference)
    if (entry.status !== "ACTIVE") fail(`${label}.status must be ACTIVE`)
    if (typeof entry.authority_artifact_path !== "string" || !SAFE_PATH.test(entry.authority_artifact_path)) {
      fail(`${label}.authority_artifact_path is outside the immutable authority artifact boundary`)
    }
    const validFrom = timestamp(entry.valid_from, `${label}.valid_from`)
    const expiresAt = timestamp(entry.expires_at, `${label}.expires_at`)
    if (expiresAt <= validFrom) fail(`${label}.expires_at must be after valid_from`)
    return {
      reference,
      work_order_id: identifier(entry.work_order_id, `${label}.work_order_id`),
      authority_artifact_path: entry.authority_artifact_path,
      authority_artifact_sha256: digest(entry.authority_artifact_sha256, `${label}.authority_artifact_sha256`),
      authority_scope_sha256: digest(entry.authority_scope_sha256, `${label}.authority_scope_sha256`),
      scope_review_commit: commit(entry.scope_review_commit, `${label}.scope_review_commit`),
      valid_from: new Date(validFrom).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
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

export function digestScopedAuthorityActivationEntry(entryInput) {
  const registry = validateScopedShadowAuthorityRegistry({
    schema_version: "0.2-shadow-authority-registry",
    registry_id: "activation-entry-digest",
    entries: [entryInput],
  })
  return canonicalDigest(registry.entries[0])
}

export function settleScopedShadowAuthority({
  entry,
  artifactBytes,
  checkedAt,
  workOrderId,
  workloadId,
  workloadContractSha256,
  nodeId,
  scopeProof,
  activationProof,
}) {
  const artifact = validateShadowAuthorityArtifact({
    artifactBytes,
    expectedSha256: entry.authority_artifact_sha256,
  })
  const scope = artifact.scope
  if (artifact.authority_scope_sha256 !== entry.authority_scope_sha256) fail("authority scope digest mismatch")
  if (scope.authority_reference !== entry.reference) fail("authority reference mismatch")
  if (scope.work_order_id !== entry.work_order_id || scope.work_order_id !== workOrderId) fail("authority Work Order mismatch")
  if (scope.workload.id !== workloadId) fail("authority workload identifier mismatch")
  if (scope.workload.contract_sha256 !== workloadContractSha256) fail("authority workload contract mismatch")
  if (!scope.allowed_canonical_nodes.includes(nodeId)) fail("authority does not allow the selected node")
  const checked = timestamp(checkedAt, "checked_at")
  if (checked < timestamp(entry.valid_from, "valid_from") || checked >= timestamp(entry.expires_at, "expires_at")) {
    fail("authority activation does not cover checked_at")
  }
  exact(scopeProof, ["artifact_sha256", "reviewed_commit", "trusted_ref"], "scope_proof")
  if (scopeProof.trusted_ref !== "refs/heads/main"
    || scopeProof.artifact_sha256 !== entry.authority_artifact_sha256
    || scopeProof.reviewed_commit !== entry.scope_review_commit) fail("scope proof does not bind the reviewed authority artifact")
  exact(activationProof, ["activation_commit", "entry_sha256", "trusted_ref"], "activation_proof")
  if (activationProof.trusted_ref !== "refs/heads/main") fail("activation proof is not bound to trusted main")
  commit(activationProof.activation_commit, "activation_proof.activation_commit")
  if (digest(activationProof.entry_sha256, "activation_proof.entry_sha256")
    !== digestScopedAuthorityActivationEntry(entry)) fail("activation proof does not bind the exact registry entry")
  return {
    schema_version: "0.2-shadow-scoped-authority-settlement",
    status: "AUTHORIZED",
    reference: entry.reference,
    work_order_id: workOrderId,
    workload_id: workloadId,
    node_id: nodeId,
    checked_at: new Date(checked).toISOString(),
    authority_artifact_sha256: entry.authority_artifact_sha256,
    authority_scope_sha256: entry.authority_scope_sha256,
    scope_review_commit: entry.scope_review_commit,
    authority_activation_commit: activationProof.activation_commit,
    activation_entry_sha256: activationProof.entry_sha256,
    valid_from: entry.valid_from,
    expires_at: entry.expires_at,
  }
}
