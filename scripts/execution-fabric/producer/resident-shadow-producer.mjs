import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { compileShadowAdmission } from "../admission/compile-shadow-admission.mjs"
import { validateShadowPlacementReceipt, validateShadowSourceClaims } from "../evaluate-shadow-placement.mjs"
import { runPinnedPlacementCli } from "../recommend-pinned-placement.mjs"
import { validateShadowAuthorityRegistry } from "../shadow-evidence-trust.mjs"
import { validateShadowOutcomeEvidence } from "../shadow-outcome-evidence.mjs"
import {
  settleScopedShadowAuthority,
  validateScopedShadowAuthorityRegistry,
  validateShadowAuthorityArtifact,
} from "../shadow-scoped-authority.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const OUTCOME_PAIRS = new Map([
  ["COMPLETED", "SUCCEEDED"],
  ["FAILED", "FAILED"],
  ["BLOCKED", "BLOCKED"],
  ["CANCELLED", "CANCELLED"],
])
const RESULT_MARKERS = new Map([
  ["SUCCEEDED", "PASS"],
  ["FAILED", "FAILED"],
  ["BLOCKED", "BLOCKED"],
  ["CANCELLED", "CANCELLED"],
])
const SAFETY = Object.freeze({
  observation_only: true,
  job_launched: false,
  scheduler_activated: false,
  dispatch_authority_granted: false,
  registry_modified: false,
  authority_mutated: false,
  remote_accessed: false,
  shell_executed: false,
})

export class ResidentShadowProducerError extends Error {
  constructor(detail) {
    super(`FABRIC_RESIDENT_SHADOW_PRODUCER_INVALID: ${detail}`)
    this.name = "ResidentShadowProducerError"
  }
}

const fail = (detail) => { throw new ResidentShadowProducerError(detail) }
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalBytes = (value) => Buffer.from(`${canonicalizeJcs(value)}\n`, "utf8")

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function exact(value, keys, label) {
  object(value, label)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} fields do not match the contract`)
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

function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail(`${label} must be an explicit millisecond UTC timestamp`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(`${label} must name a real UTC instant`)
  }
  return milliseconds
}

function trustedNow(clock, label) {
  if (typeof clock !== "function") fail(`${label} requires an injected trusted clock`)
  return new Date(timestamp(clock(), label)).toISOString()
}

function realRepositoryRoot(repositoryRoot) {
  try {
    return fs.realpathSync(path.resolve(repositoryRoot))
  } catch (error) {
    fail(`unable to resolve repository root: ${error.message}`)
  }
}

function readJsonNoSymlink(filePath, label) {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) fail(`${label} must not be a symbolic link`)
    const bytes = fs.readFileSync(filePath)
    return { bytes, value: JSON.parse(bytes.toString("utf8")) }
  } catch (error) {
    if (error instanceof ResidentShadowProducerError) throw error
    fail(`unable to read ${label}: ${error.message}`)
  }
}

function loadActiveAuthority(repositoryRoot, workOrderId, workload, nodeId, at, trustedAuthorityProof, trustedScopedAuthorityProof) {
  const scopedRegistryPath = path.join(repositoryRoot, "config", "execution-fabric", "shadow-authority-registry-v0.2.json")
  if (fs.existsSync(scopedRegistryPath)) {
    const loadedScoped = readJsonNoSymlink(scopedRegistryPath, "reviewed scoped shadow authority registry")
    let scopedRegistry
    try { scopedRegistry = validateScopedShadowAuthorityRegistry(loadedScoped.value) } catch (error) {
      fail(String(error?.message ?? error).replace(/^FABRIC_SHADOW_SCOPED_AUTHORITY_INVALID:\s*/, ""))
    }
    const candidates = []
    for (const entry of scopedRegistry.entries.filter((item) => item.work_order_id === workOrderId)) {
      const artifactPath = path.resolve(repositoryRoot, entry.authority_artifact_path)
      const relative = path.relative(repositoryRoot, artifactPath)
      if (relative.startsWith("..") || path.isAbsolute(relative)) fail("scoped authority artifact resolves outside repository")
      const artifact = readJsonNoSymlink(artifactPath, "scoped authority artifact")
      const validation = validateShadowAuthorityArtifact({ artifactBytes: artifact.bytes, expectedSha256: entry.authority_artifact_sha256 })
      if (validation.scope.allowed_canonical_nodes.includes(nodeId)) candidates.push({ entry, artifact })
    }
    if (candidates.length > 1) fail("multiple scoped authorities bind the Work Order and resident node")
    if (candidates.length === 1) {
      if (typeof trustedScopedAuthorityProof !== "function") fail("an injected scoped authority proof is required")
      const selected = candidates[0]
      const proof = trustedScopedAuthorityProof({
        repositoryRoot,
        registryPath: scopedRegistryPath,
        registryBytes: Buffer.from(loadedScoped.bytes),
        entry: structuredClone(selected.entry),
        artifactPath: path.resolve(repositoryRoot, selected.entry.authority_artifact_path),
        artifactBytes: Buffer.from(selected.artifact.bytes),
      })
      exact(proof, ["activation_proof", "scope_proof"], "trusted scoped authority proof")
      const settlement = settleScopedShadowAuthority({
        entry: selected.entry,
        artifactBytes: selected.artifact.bytes,
        checkedAt: at,
        workOrderId,
        workloadId: workload.id,
        workloadContractSha256: sha256(canonicalBytes(workload)),
        nodeId,
        scopeProof: proof.scope_proof,
        activationProof: proof.activation_proof,
      })
      return {
        authority: settlement,
        authority_registry_sha256: sha256(loadedScoped.bytes),
        authority_proof: structuredClone(proof),
      }
    }
  }

  const registryPath = path.join(repositoryRoot, "config", "execution-fabric", "shadow-authority-registry.json")
  let realRegistry
  try { realRegistry = fs.realpathSync(registryPath) } catch (error) { fail(`unable to resolve authority registry: ${error.message}`) }
  const registryRelative = path.relative(repositoryRoot, realRegistry)
  if (registryRelative.startsWith("..") || path.isAbsolute(registryRelative)) fail("authority registry resolves outside repository")
  const loaded = readJsonNoSymlink(registryPath, "reviewed shadow authority registry")
  let registry
  try { registry = validateShadowAuthorityRegistry(loaded.value) } catch (error) {
    fail(String(error?.message ?? error).replace(/^FABRIC_SHADOW_EVIDENCE_TRUST_INVALID:\s*/, ""))
  }
  const matches = registry.entries.filter((entry) => entry?.work_order_id === workOrderId
    && Array.isArray(entry?.allowed_canonical_nodes) && entry.allowed_canonical_nodes.includes(nodeId))
  if (matches.length !== 1) fail("exactly one reviewed authority must bind the Work Order and resident node")
  const authority = matches[0]
  const validFrom = timestamp(authority.valid_from, "authority valid_from")
  const expiresAt = timestamp(authority.expires_at, "authority expires_at")
  const checkedAt = timestamp(at, "authority check time")
  if (validFrom > checkedAt || checkedAt >= expiresAt) fail("reviewed authority does not cover preflight")
  if (typeof trustedAuthorityProof !== "function") fail("an injected trusted-main authority proof is required")
  const registrySha256 = sha256(loaded.bytes)
  const proof = trustedAuthorityProof({
    repositoryRoot,
    registryPath,
    registryBytes: Buffer.from(loaded.bytes),
    registrySha256,
    authority: structuredClone(authority),
  })
  exact(proof, [
    "schema_version", "trusted_ref", "registry_sha256", "authority_reference",
    "authority_reviewed_commit", "exact_entry_count",
  ], "trusted authority proof")
  if (proof.schema_version !== "0.1-trusted-shadow-authority-proof"
    || proof.trusted_ref !== "refs/heads/main"
    || proof.registry_sha256 !== registrySha256
    || proof.authority_reference !== authority.reference
    || proof.authority_reviewed_commit !== authority.reviewed_commit
    || proof.exact_entry_count !== 1) fail("trusted-main authority proof does not bind the exact registry and entry")
  return {
    authority: { ...authority, allowed_canonical_nodes: [...authority.allowed_canonical_nodes] },
    authority_registry_sha256: registrySha256,
    authority_proof: { ...proof },
  }
}

function parseReceipt(receiptBytes, expectedSha256) {
  if (!Buffer.isBuffer(receiptBytes) || receiptBytes.length === 0) fail("receipt bytes must be a non-empty Buffer")
  digest(expectedSha256, "receipt sha256")
  if (sha256(receiptBytes) !== expectedSha256) fail("receipt bytes do not match the declared SHA-256")
  let receipt
  try { receipt = JSON.parse(receiptBytes.toString("utf8")) } catch (error) { fail(`receipt is not JSON: ${error.message}`) }
  try { validateShadowPlacementReceipt(receipt, expectedSha256) } catch (error) {
    fail(String(error?.message ?? error).replace(/^FABRIC_SHADOW_PLACEMENT_INVALID:\s*/, ""))
  }
  return receipt
}

function validatePreflight(preflight) {
  exact(preflight, [
    "schema_version", "status", "work_order_id", "workload_id", "producer_lane", "resident_node_id",
    "receipt_sha256", "receipt_evaluated_at", "preflight_checked_at", "fresh_until", "authority",
    "authority_registry_sha256", "authority_proof",
    "recommendation_node_id", "safety", "preflight_sha256",
  ], "preflight")
  const unsigned = { ...preflight }
  delete unsigned.preflight_sha256
  if (sha256(canonicalBytes(unsigned)) !== digest(preflight.preflight_sha256, "preflight_sha256")) {
    fail("preflight self-digest does not match exact content")
  }
  if (preflight.schema_version !== "0.1-resident-shadow-producer-preflight" || preflight.status !== "PREFLIGHT_PASSED") {
    fail("preflight contract or status is invalid")
  }
  if (canonicalizeJcs(preflight.safety) !== canonicalizeJcs(SAFETY)) fail("preflight safety boundary is invalid")
}

export function preflightResidentShadowProducer({
  repositoryRoot,
  receiptBytes,
  receiptSha256,
  workOrderId,
  trustedClock,
  trustedResidentIdentity,
  trustedAuthorityProof,
  trustedScopedAuthorityProof,
}) {
  const root = realRepositoryRoot(repositoryRoot)
  const receipt = parseReceipt(receiptBytes, receiptSha256)
  identifier(workOrderId, "work_order_id")
  if (typeof trustedResidentIdentity !== "function") fail("an injected trusted resident identity provider is required")

  // Identity and clock providers are deliberately not touched until exact receipt validation passes.
  const identity = trustedResidentIdentity()
  exact(identity, ["node_id", "producer_lane"], "trusted resident identity")
  const nodeId = identifier(identity.node_id, "trusted resident node_id")
  const producerLane = identifier(identity.producer_lane, "trusted producer_lane")
  if (nodeId !== "hermes-node" || producerLane !== "resident-hermes") {
    fail("trusted identity is not the resident Hermes producer")
  }
  const checkedAt = trustedNow(trustedClock, "preflight clock")
  const checkedAtMs = timestamp(checkedAt, "preflight checked_at")
  const receiptAt = timestamp(receipt.evaluated_at, "receipt evaluated_at")
  if (checkedAtMs < receiptAt) fail("preflight predates the placement receipt")
  const eligible = receipt.eligible_nodes.find((entry) => entry.node_id === nodeId && entry.eligible === true)
  if (!eligible) fail("resident Hermes is not eligible in the exact placement receipt")
  const freshUntil = new Date(timestamp(eligible.freshness?.expires_at, "resident evidence expiry")).toISOString()
  if (checkedAtMs >= Date.parse(freshUntil)) fail("resident placement evidence is not fresh at preflight")
  const authoritySettlement = loadActiveAuthority(
    root, workOrderId, receipt.workload, nodeId, checkedAt, trustedAuthorityProof, trustedScopedAuthorityProof,
  )

  const result = {
    schema_version: "0.1-resident-shadow-producer-preflight",
    status: "PREFLIGHT_PASSED",
    work_order_id: workOrderId,
    workload_id: receipt.workload.id,
    producer_lane: producerLane,
    resident_node_id: nodeId,
    receipt_sha256: receiptSha256,
    receipt_evaluated_at: new Date(receiptAt).toISOString(),
    preflight_checked_at: checkedAt,
    fresh_until: freshUntil,
    authority: authoritySettlement.authority,
    authority_registry_sha256: authoritySettlement.authority_registry_sha256,
    authority_proof: authoritySettlement.authority_proof,
    recommendation_node_id: receipt.recommendation?.node_id ?? null,
    safety: { ...SAFETY },
  }
  return { ...result, preflight_sha256: sha256(canonicalBytes(result)) }
}

export function recommendAndPreflightResidentShadowProducer({ pinnedPlacementArguments, ...preflightInput }) {
  const receipt = runPinnedPlacementCli(pinnedPlacementArguments)
  if (receipt.status === "INPUT_REJECTED") fail(receipt.error?.detail ?? "pinned placement input was rejected")
  const receiptBytes = canonicalBytes(receipt)
  return {
    receipt_bytes: receiptBytes,
    preflight: preflightResidentShadowProducer({
      ...preflightInput,
      receiptBytes,
      receiptSha256: sha256(receiptBytes),
    }),
  }
}

function validateFacts(facts) {
  const scoped = facts?.schema_version === "0.2-resident-shadow-producer-facts"
  exact(facts, [
    "schema_version", "preflight_sha256", "receipt_sha256", "work_order_id", "resident_node_id",
    "producer_lane", "started_at", "completed_at", "authority_checked_at", "authority_reference",
    "authority_status", "status", "result", "resource_observations",
    ...(scoped ? ["authority_activation_commit", "authority_scope_sha256"] : []),
  ], "trusted producer facts")
  if (!scoped && facts.schema_version !== "0.1-resident-shadow-producer-facts") fail("trusted producer facts schema is unsupported")
  identifier(facts.work_order_id, "facts work_order_id")
  identifier(facts.resident_node_id, "facts resident_node_id")
  identifier(facts.producer_lane, "facts producer_lane")
  digest(facts.preflight_sha256, "facts preflight_sha256")
  digest(facts.receipt_sha256, "facts receipt_sha256")
  identifier(facts.authority_reference, "facts authority_reference")
  if (scoped) {
    digest(facts.authority_scope_sha256, "facts authority_scope_sha256")
    if (!COMMIT.test(facts.authority_activation_commit)) fail("facts authority_activation_commit must be a full lowercase Git commit")
  }
  if (facts.authority_status !== "COMPLIANT") fail("facts authority_status must be COMPLIANT")
  timestamp(facts.started_at, "facts started_at")
  timestamp(facts.completed_at, "facts completed_at")
  timestamp(facts.authority_checked_at, "facts authority_checked_at")
  if (!OUTCOME_PAIRS.has(facts.status) || OUTCOME_PAIRS.get(facts.status) !== facts.result) {
    fail("facts terminal status/result pair is invalid")
  }
  if (!Array.isArray(facts.resource_observations) || facts.resource_observations.length === 0) {
    fail("trusted producer resource facts are required")
  }
}

export function captureResidentShadowOutcome({
  repositoryRoot,
  receiptBytes,
  preflight,
  readTrustedProducerFacts,
  trustedAuthorityProof,
  trustedScopedAuthorityProof,
}) {
  validatePreflight(preflight)
  const root = realRepositoryRoot(repositoryRoot)
  const receipt = parseReceipt(receiptBytes, preflight.receipt_sha256)
  const eligible = receipt.eligible_nodes.find((entry) => entry.node_id === preflight.resident_node_id && entry.eligible === true)
  if (!eligible || eligible.freshness.expires_at !== preflight.fresh_until) fail("preflight no longer binds the exact eligible receipt entry")
  const currentAuthority = loadActiveAuthority(
    root, preflight.work_order_id, receipt.workload, preflight.resident_node_id,
    preflight.preflight_checked_at, trustedAuthorityProof, trustedScopedAuthorityProof,
  )
  if (canonicalizeJcs(currentAuthority.authority) !== canonicalizeJcs(preflight.authority)
    || currentAuthority.authority_registry_sha256 !== preflight.authority_registry_sha256
    || canonicalizeJcs(currentAuthority.authority_proof) !== canonicalizeJcs(preflight.authority_proof)) {
    fail("reviewed authority changed after preflight")
  }
  if (typeof readTrustedProducerFacts !== "function") fail("an injected trusted producer fact reader is required")

  // This seam reads already-produced resident facts. It has no execution, dispatch, or remote-action API.
  const facts = readTrustedProducerFacts({
    preflight_sha256: preflight.preflight_sha256,
    receipt_sha256: preflight.receipt_sha256,
    work_order_id: preflight.work_order_id,
    resident_node_id: preflight.resident_node_id,
  })
  validateFacts(facts)
  if (facts.work_order_id !== preflight.work_order_id
    || facts.resident_node_id !== preflight.resident_node_id
    || facts.producer_lane !== preflight.producer_lane
    || facts.preflight_sha256 !== preflight.preflight_sha256
    || facts.receipt_sha256 !== preflight.receipt_sha256) fail("trusted producer facts do not bind the exact preflight and receipt")
  if (facts.authority_reference !== preflight.authority.reference || facts.authority_status !== "COMPLIANT") {
    fail("trusted producer facts do not bind a compliant reviewed authority outcome")
  }
  const scoped = preflight.authority.schema_version === "0.2-shadow-scoped-authority-settlement"
  if (scoped && (facts.schema_version !== "0.2-resident-shadow-producer-facts"
    || facts.authority_scope_sha256 !== preflight.authority.authority_scope_sha256
    || facts.authority_activation_commit !== preflight.authority.authority_activation_commit)) {
    fail("trusted producer facts do not bind the exact scoped authority")
  }
  if (!scoped && facts.schema_version !== "0.1-resident-shadow-producer-facts") {
    fail("legacy producer facts cannot claim scoped authority")
  }
  const startedAt = timestamp(facts.started_at, "facts started_at")
  const completedAt = timestamp(facts.completed_at, "facts completed_at")
  const authorityCheckedAt = timestamp(facts.authority_checked_at, "facts authority_checked_at")
  if (startedAt < timestamp(preflight.preflight_checked_at, "preflight checked_at")) fail("outcome began before producer preflight")
  if (startedAt >= timestamp(preflight.fresh_until, "fresh_until")) fail("outcome did not begin while placement evidence was fresh")
  const authorityStart = timestamp(preflight.authority.valid_from, "authority valid_from")
  const authorityExpiry = timestamp(preflight.authority.expires_at, "authority expires_at")
  if (completedAt < startedAt) fail("outcome completion precedes start")
  if (authorityCheckedAt !== startedAt) fail("authority must be checked at the exact outcome start")
  if (authorityStart > startedAt || authorityCheckedAt < authorityStart || authorityCheckedAt >= authorityExpiry
    || completedAt >= authorityExpiry) fail("reviewed authority does not cover check, start, and completion")

  const outcome = {
    actual_target_node: facts.resident_node_id,
    authority_outcome: {
      checked_at: facts.authority_checked_at,
      reference: facts.authority_reference,
      status: facts.authority_status,
      ...(scoped ? {
        scope_sha256: facts.authority_scope_sha256,
        activation_commit: facts.authority_activation_commit,
      } : {}),
    },
    completed_at: facts.completed_at,
    resource_observations: facts.resource_observations.map((entry) => ({ ...entry })),
    result: facts.result,
    schema_version: scoped ? "0.2-shadow-outcome-evidence" : "0.1-shadow-outcome-evidence",
    started_at: facts.started_at,
    status: facts.status,
    work_order_id: facts.work_order_id,
  }
  const outcomeBytes = canonicalBytes(outcome)
  const outcomeSha256 = sha256(outcomeBytes)
  let validation
  try { validation = validateShadowOutcomeEvidence({ artifactBytes: outcomeBytes, expectedSha256: outcomeSha256 }) } catch (error) {
    fail(String(error?.message ?? error).replace(/^FABRIC_SHADOW_OUTCOME_EVIDENCE_INVALID:\s*/, ""))
  }
  const deliveryText = `# ${facts.work_order_id} resident Hermes delivery\n\nTARGET: ${facts.resident_node_id}\n\n## Result\n${RESULT_MARKERS.get(facts.result)}\n\nLATENCY_MS: ${validation.chronology.latency_ms}\n`
  const result = {
    schema_version: "0.1-resident-shadow-producer-capture",
    status: "GENUINE_FACTS_CAPTURED",
    preflight,
    outcome,
    outcome_sha256: outcomeSha256,
    delivery_sha256: sha256(Buffer.from(deliveryText, "utf8")),
    safety: { ...SAFETY },
  }
  return {
    ...result,
    capture_sha256: sha256(canonicalBytes(result)),
    outcome_bytes: outcomeBytes,
    delivery_bytes: Buffer.from(deliveryText, "utf8"),
  }
}

function verifyCapture(capture) {
  const unsigned = {
    schema_version: capture.schema_version,
    status: capture.status,
    preflight: capture.preflight,
    outcome: capture.outcome,
    outcome_sha256: capture.outcome_sha256,
    delivery_sha256: capture.delivery_sha256,
    safety: capture.safety,
  }
  if (capture.schema_version !== "0.1-resident-shadow-producer-capture"
    || capture.status !== "GENUINE_FACTS_CAPTURED"
    || sha256(canonicalBytes(unsigned)) !== digest(capture.capture_sha256, "capture_sha256")) fail("capture contract or self-digest is invalid")
  if (!Buffer.isBuffer(capture.outcome_bytes) || sha256(capture.outcome_bytes) !== capture.outcome_sha256) fail("capture outcome bytes do not match")
  if (!Buffer.isBuffer(capture.delivery_bytes) || sha256(capture.delivery_bytes) !== capture.delivery_sha256) fail("capture delivery bytes do not match")
  validatePreflight(capture.preflight)
  if (!capture.outcome_bytes.equals(canonicalBytes(capture.outcome))) fail("capture outcome object and canonical bytes do not match")
  let validation
  try {
    validation = validateShadowOutcomeEvidence({
      artifactBytes: capture.outcome_bytes,
      expectedSha256: capture.outcome_sha256,
    })
  } catch (error) {
    fail(String(error?.message ?? error).replace(/^FABRIC_SHADOW_OUTCOME_EVIDENCE_INVALID:\s*/, ""))
  }
  if (validation.work_order_id !== capture.preflight.work_order_id
    || validation.actual_target_node !== capture.preflight.resident_node_id
    || validation.authority_outcome.reference !== capture.preflight.authority.reference) {
    fail("capture outcome does not bind the preflight Work Order, node, and authority")
  }
  try {
    validateShadowSourceClaims(capture.delivery_bytes, {
      work_order_id: capture.preflight.work_order_id,
      manual_target: capture.preflight.resident_node_id,
    }, validation)
  } catch (error) {
    fail(String(error?.message ?? error).replace(/^FABRIC_SHADOW_PLACEMENT_INVALID:\s*/, ""))
  }
  if (canonicalizeJcs(capture.safety) !== canonicalizeJcs(SAFETY)) fail("capture safety boundary is invalid")
}

function retainedPath(root, relative, label) {
  if (typeof relative !== "string" || path.isAbsolute(relative)) fail(`${label} must be repository-relative`)
  const normalized = relative.replaceAll("\\", "/")
  if (!normalized.startsWith("docs/reports/") || normalized.includes("/../")) fail(`${label} is outside docs/reports`)
  const target = path.resolve(root, relative)
  const rel = path.relative(root, target)
  if (rel.startsWith("..") || path.isAbsolute(rel)) fail(`${label} escapes the repository`)
  return { normalized, target }
}

function ensureSafeParent(root, target) {
  const parent = path.dirname(target)
  let existing = parent
  while (!fs.existsSync(existing)) {
    const next = path.dirname(existing)
    if (next === existing) fail("unable to find a safe retained-artifact parent")
    existing = next
  }
  if (fs.lstatSync(existing).isSymbolicLink()) fail("retained-artifact parent must not be a symbolic link")
  const existingReal = fs.realpathSync(existing)
  const existingRelative = path.relative(root, existingReal)
  if (existingRelative.startsWith("..") || path.isAbsolute(existingRelative)) fail("retained-artifact parent resolves outside repository")
  fs.mkdirSync(parent, { recursive: true })
  if (fs.lstatSync(parent).isSymbolicLink()) fail("retained-artifact parent must not be a symbolic link")
  const parentReal = fs.realpathSync(parent)
  const parentRelative = path.relative(root, parentReal)
  if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) fail("retained-artifact parent resolves outside repository")
}

function writeImmutable(root, target, bytes) {
  ensureSafeParent(root, target)
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink()) fail("retained artifact must not be a symbolic link")
    const targetRelative = path.relative(root, fs.realpathSync(target))
    if (targetRelative.startsWith("..") || path.isAbsolute(targetRelative)) fail("retained artifact resolves outside repository")
  }
  try { fs.writeFileSync(target, bytes, { flag: "wx" }) } catch (error) {
    if (error?.code !== "EEXIST") throw error
    if (!fs.readFileSync(target).equals(bytes)) fail(`refusing to overwrite different retained artifact: ${target}`)
  }
}

export function materializeResidentShadowEvidence({ repositoryRoot, receiptBytes, capture }) {
  const root = realRepositoryRoot(repositoryRoot)
  verifyCapture(capture)
  parseReceipt(receiptBytes, capture.preflight.receipt_sha256)
  const seed = sha256(canonicalBytes({
    work_order_id: capture.preflight.work_order_id,
    receipt_sha256: capture.preflight.receipt_sha256,
    outcome_sha256: capture.outcome_sha256,
  })).slice(0, 16)
  const candidateId = `${capture.preflight.work_order_id}-resident-${seed}`
  const paths = {
    receipt: retainedPath(root, `docs/reports/shadow-admission/${candidateId}-receipt.json`, "receipt path"),
    delivery: retainedPath(root, `docs/reports/${candidateId}-delivery.md`, "delivery path"),
    outcome: retainedPath(root, `docs/reports/execution-fabric-shadow-outcomes/${candidateId}-outcome.json`, "outcome path"),
  }
  writeImmutable(root, paths.receipt.target, receiptBytes)
  writeImmutable(root, paths.delivery.target, capture.delivery_bytes)
  writeImmutable(root, paths.outcome.target, capture.outcome_bytes)
  return {
    schema_version: "0.1-resident-shadow-retained-evidence",
    candidate_id: candidateId,
    work_order_id: capture.preflight.work_order_id,
    receipt: { path: paths.receipt.normalized, sha256: capture.preflight.receipt_sha256 },
    delivery_record: { path: paths.delivery.normalized, sha256: capture.delivery_sha256 },
    outcome_evidence: { path: paths.outcome.normalized, sha256: capture.outcome_sha256 },
    safety: { ...SAFETY },
  }
}

function readRetainedBinding(root, binding, label) {
  exact(binding, ["path", "sha256"], label)
  const resolved = retainedPath(root, binding.path, `${label}.path`)
  digest(binding.sha256, `${label}.sha256`)
  let bytes
  try {
    if (fs.lstatSync(resolved.target).isSymbolicLink()) fail(`${label} must not be a symbolic link`)
    const realTarget = fs.realpathSync(resolved.target)
    const realRelative = path.relative(root, realTarget)
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) fail(`${label} resolves outside repository`)
    bytes = fs.readFileSync(resolved.target)
  } catch (error) {
    if (error instanceof ResidentShadowProducerError) throw error
    fail(`unable to read ${label}: ${error.message}`)
  }
  if (sha256(bytes) !== binding.sha256) fail(`${label} bytes do not match declared SHA-256`)
  return { ...binding, path: resolved.normalized, bytes }
}

export function materializeResidentShadowCandidate({
  repositoryRoot,
  capture,
  retainedEvidence,
  reviewEvidence,
  executionCommit,
  reviewCommit,
  reviewerIdentity,
  trustedClock,
  trustedAuthorityProof,
  trustedScopedAuthorityProof,
  proveReviewCommitOrder,
}) {
  const root = realRepositoryRoot(repositoryRoot)
  verifyCapture(capture)
  if (!COMMIT.test(executionCommit) || !COMMIT.test(reviewCommit) || executionCommit === reviewCommit) {
    fail("execution and review commits must be distinct full lowercase Git commits")
  }
  identifier(reviewerIdentity, "reviewer_identity")
  if (reviewerIdentity === capture.preflight.producer_lane) fail("reviewer identity must be independent from the producer lane")
  const receipt = readRetainedBinding(root, retainedEvidence.receipt, "retained receipt")
  const receiptValue = parseReceipt(receipt.bytes, receipt.sha256)
  const currentAuthority = loadActiveAuthority(
    root, capture.preflight.work_order_id, receiptValue.workload, capture.preflight.resident_node_id,
    capture.preflight.preflight_checked_at, trustedAuthorityProof, trustedScopedAuthorityProof,
  )
  if (canonicalizeJcs(currentAuthority.authority) !== canonicalizeJcs(capture.preflight.authority)
    || currentAuthority.authority_registry_sha256 !== capture.preflight.authority_registry_sha256) {
    fail("reviewed authority changed before candidate materialization")
  }
  if (typeof proveReviewCommitOrder !== "function") fail("an injected trusted-main commit-order proof is required")
  const commitOrder = proveReviewCommitOrder({ executionCommit, reviewCommit })
  exact(commitOrder, ["trusted_ref", "execution_commit", "review_commit", "execution_is_strict_ancestor"], "commit-order proof")
  if (commitOrder.trusted_ref !== "refs/heads/main" || commitOrder.execution_commit !== executionCommit
    || commitOrder.review_commit !== reviewCommit || commitOrder.execution_is_strict_ancestor !== true) {
    fail("trusted-main proof does not establish strict execution-before-review commit order")
  }
  const delivery = readRetainedBinding(root, retainedEvidence.delivery_record, "retained delivery")
  const outcome = readRetainedBinding(root, retainedEvidence.outcome_evidence, "retained outcome")
  const review = readRetainedBinding(root, reviewEvidence, "independent review evidence")
  const scoped = capture.preflight.authority.schema_version === "0.2-shadow-scoped-authority-settlement"
  if (!review.bytes.toString("utf8").includes(capture.preflight.work_order_id)
    || !review.bytes.toString("utf8").includes(executionCommit)
    || (scoped && !review.bytes.toString("utf8").includes(capture.preflight.authority.authority_scope_sha256))
    || !new RegExp(`^REVIEWER\\s*:\\s*${reviewerIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(review.bytes.toString("utf8"))
    || !/^VERDICT\s*:\s*PASS\s*$/im.test(review.bytes.toString("utf8"))) {
    fail("independent review does not bind the Work Order, execution commit, reviewer, and PASS verdict")
  }
  if (receipt.sha256 !== capture.preflight.receipt_sha256 || delivery.sha256 !== capture.delivery_sha256
    || outcome.sha256 !== capture.outcome_sha256) fail("retained evidence does not bind the captured facts")
  const recordedAt = trustedNow(trustedClock, "candidate materialization clock")
  if (timestamp(recordedAt, "recorded_at") < timestamp(capture.outcome.completed_at, "outcome completed_at")) {
    fail("candidate materialization predates outcome completion")
  }
  const diverged = capture.preflight.recommendation_node_id !== capture.preflight.resident_node_id
  const candidate = {
    schema_version: scoped ? "0.2-shadow-admission-candidate" : "0.1-shadow-admission-candidate",
    candidate_id: retainedEvidence.candidate_id,
    work_order_id: capture.preflight.work_order_id,
    workload_id: capture.preflight.workload_id,
    producer_lane: capture.preflight.producer_lane,
    outcome_kind: "RESIDENT_HERMES_REVIEWED",
    receipt: { path: receipt.path, sha256: receipt.sha256 },
    delivery_record: { path: delivery.path, sha256: delivery.sha256 },
    outcome_evidence: { path: outcome.path, sha256: outcome.sha256 },
    review_evidence: { path: review.path, sha256: review.sha256 },
    authority: scoped ? structuredClone(capture.preflight.authority) : {
      reference: capture.preflight.authority.reference,
      allowed_canonical_nodes: [...capture.preflight.authority.allowed_canonical_nodes].sort(),
      valid_from: capture.preflight.authority.valid_from,
      expires_at: capture.preflight.authority.expires_at,
      reviewed_commit: capture.preflight.authority.reviewed_commit,
    },
    execution_commit: executionCommit,
    review_commit: reviewCommit,
    reviewer_identity: reviewerIdentity,
    recorded_at: recordedAt,
    divergence_reasons: diverged ? ["MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION"] : [],
  }
  const candidatePath = retainedPath(root, `docs/reports/shadow-admission/${candidate.candidate_id}-candidate.json`, "candidate path")
  const bytes = canonicalBytes(candidate)
  writeImmutable(root, candidatePath.target, bytes)
  return {
    candidate,
    candidate_path: candidatePath.normalized,
    candidate_sha256: sha256(bytes),
    status: "PENDING_REVIEWED_REGISTRY_ADMISSION",
    safety: { ...SAFETY },
  }
}

export function compileReviewedResidentShadowCandidate({ candidate, repositoryRoot, reviewProof, scopedAuthorityProof }) {
  if (typeof reviewProof !== "function") fail("an injected trusted-main admission proof is required")
  return compileShadowAdmission({ candidate, repositoryRoot, reviewProof, scopedAuthorityProof })
}
