import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "./canonical-json.mjs"
import {
  loadShadowEvidenceTrustRegistries,
  validateShadowEvidenceTrust,
} from "./shadow-evidence-trust.mjs"
import { validateShadowOutcomeEvidence } from "./shadow-outcome-evidence.mjs"

const EXIT_INVALID = 2
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,255}$/
const ALLOWED_DIVERGENCE_REASONS = new Set([
  "MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION",
  "RECORDED_AUTHORITY_CONSTRAINT",
  "RECORDED_CAPABILITY_CONSTRAINT",
  "RECORDED_RESOURCE_CONSTRAINT",
])
const CANONICAL_NODES = new Set(["omen", "hermes-node", "atlas", "aegis", "azure"])
const PROHIBITED_FIELD = /(?:^|_)(?:command|commands|cmd|shell|script|argv|args|executable|exec|spawn|cwd|stdin|environment|env|endpoint|credential|credentials|password|passwd|private_key|secret|secrets|token|tokens|api_key|connection_string|authorization)(?:$|_)/i
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@/i,
]
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

class ShadowPlacementError extends Error {
  constructor(detail) {
    super(`FABRIC_SHADOW_PLACEMENT_INVALID: ${detail}`)
    this.name = "ShadowPlacementError"
  }
}
function fail(detail) {
  throw new ShadowPlacementError(detail)
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} fields do not match the contract`)
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`)
  return value
}

function identifier(value, label) {
  text(value, label)
  if (!SAFE_ID.test(value)) fail(`${label} must be a safe identifier`)
  return value
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be lowercase SHA-256 hex`)
  return value
}

function timestamp(value, label) {
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value)
    : null
  if (!match) fail(`${label} must be an explicit UTC timestamp`)
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number)
  const milliseconds = Number(fraction.padEnd(3, "0"))
  const instant = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds)
  const date = new Date(instant)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second
    || date.getUTCMilliseconds() !== milliseconds) fail(`${label} is not a valid UTC calendar timestamp`)
  return instant
}

function readArtifact(filePath, label) {
  try {
    const resolved = path.resolve(filePath)
    const bytes = fs.readFileSync(resolved)
    return {
      path: resolved,
      bytes,
      value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")),
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    }
  } catch (error) {
    fail(`unable to read ${label}: ${error.message}`)
  }
}

function parseArtifactBytes(input, label) {
  try {
    const bytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input, "utf8")
    return {
      bytes,
      value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")),
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    }
  } catch (error) {
    fail(`unable to parse ${label}: ${error.message}`)
  }
}

function rejectExecutableInput(value, pathName = "input") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectExecutableInput(entry, `${pathName}[${index}]`))
    return
  }
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      fail(`${pathName} contains secret-like material`)
    }
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replaceAll("-", "_").toLowerCase()
    if (PROHIBITED_FIELD.test(normalized)) fail(`${pathName}.${key} is not permitted in observation-only input`)
    rejectExecutableInput(child, `${pathName}.${key}`)
  }
}

function resolveRetainedSource(repositoryRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "" || path.isAbsolute(relativePath)) {
    fail("observation.source.path must be a repository-relative path")
  }
  const root = fs.realpathSync(path.resolve(repositoryRoot))
  const resolved = path.resolve(root, relativePath)
  const relative = path.relative(root, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("observation source escapes repository root")
  if (!relative.replaceAll("\\", "/").startsWith("docs/reports/")) {
    fail("observation source must be a retained repository delivery record under docs/reports")
  }
  let realSource
  try {
    realSource = fs.realpathSync(resolved)
  } catch (error) {
    fail(`unable to read retained observation source: ${error.message}`)
  }
  const realRelative = path.relative(root, realSource)
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    fail("observation source resolves outside repository root")
  }
  if (!realRelative.replaceAll("\\", "/").startsWith("docs/reports/")) {
    fail("observation source resolves outside the retained report boundary")
  }
  return realSource
}

export function validateShadowSourceClaims(sourceBytes, observation, outcomeEvidence) {
  const sourceText = sourceBytes.toString("utf8")
  const escapedWorkOrder = observation.work_order_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (!new RegExp(`^#\\s+.*\\b${escapedWorkOrder}\\b`, "im").test(sourceText)) {
    fail("retained source does not identify the observed Work Order")
  }
  if (observation.manual_target !== null) {
    if (!CANONICAL_NODES.has(observation.manual_target)) fail("recorded manual target is not a canonical Fabric node")
    const escapedTarget = observation.manual_target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const explicitTarget = new RegExp(`(?:\\bmanual\\s+${escapedTarget}\\b|\\bTARGET\\s*:\\s*${escapedTarget}\\b)`, "i")
    if (!explicitTarget.test(sourceText)) fail("retained source does not identify the recorded manual target")
  }
  const resultSection = sourceText.match(/^##\s+Result\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1] ?? ""
  const resultLine = resultSection.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
  const outcomeMarkers = {
    SUCCEEDED: /^PASS\b/i,
    FAILED: /^FAIL(?:ED|URE)?\b/i,
    BLOCKED: /^BLOCKED\b/i,
    CANCELLED: /^CANCELLED\b/i,
  }
  const marker = outcomeMarkers[outcomeEvidence.outcome.result]
  if (marker && !marker.test(resultLine)) fail("retained source does not support the recorded outcome status")
  if (!new RegExp(`^LATENCY_MS\\s*:\\s*${outcomeEvidence.chronology.latency_ms}\\s*$`, "im").test(sourceText)) {
    fail("retained source does not support the recorded latency")
  }
}

function loadOutcomeEvidence(repositoryRoot, binding) {
  exactKeys(binding, ["kind", "path", "sha256"], "observation.outcome_evidence")
  if (binding.kind !== "retained-canonical-outcome-evidence") fail("outcome evidence kind is untrusted")
  digest(binding.sha256, "observation.outcome_evidence.sha256")
  const artifactPath = resolveRetainedSource(repositoryRoot, binding.path)
  const artifactBytes = fs.readFileSync(artifactPath)
  try {
    return {
      artifactBytes,
      evidence: validateShadowOutcomeEvidence({ artifactBytes, expectedSha256: binding.sha256 }),
    }
  } catch (error) {
    const detail = String(error?.message ?? error).replace(/^FABRIC_SHADOW_OUTCOME_EVIDENCE_INVALID:\s*/, "")
    fail(`outcome evidence rejected: ${detail}`)
  }
}

function settleOutcomeEvidenceTrust(repositoryRoot, artifactBytes, expectedArtifactSha256, retainedSourceSha256) {
  const registryDirectory = path.join(
    fs.realpathSync(path.resolve(repositoryRoot)),
    "config",
    "execution-fabric",
  )
  try {
    const registries = loadShadowEvidenceTrustRegistries({
      outcomeRegistryPath: path.join(registryDirectory, "shadow-outcome-registry.json"),
      authorityRegistryPath: path.join(registryDirectory, "shadow-authority-registry.json"),
    })
    return validateShadowEvidenceTrust({
      artifactBytes,
      expectedArtifactSha256,
      retainedSourceSha256,
      outcomeRegistry: registries.outcome_registry,
      authorityRegistry: registries.authority_registry,
    })
  } catch (error) {
    const detail = String(error?.message ?? error).replace(/^FABRIC_SHADOW_EVIDENCE_TRUST_INVALID:\s*/, "")
    fail(`outcome trust settlement rejected: ${detail}`)
  }
}

function loadTrustedReceiptRegistry(repositoryRoot) {
  const registryPath = path.join(fs.realpathSync(path.resolve(repositoryRoot)), "config", "execution-fabric", "shadow-receipt-registry.json")
  const artifact = readArtifact(registryPath, "trusted shadow receipt registry")
  exactKeys(artifact.value, ["schema_version", "placement_policy_version", "trusted_receipts"], "trusted receipt registry")
  if (artifact.value.schema_version !== "0.1-shadow-receipt-registry"
    || artifact.value.placement_policy_version !== "execution-fabric-placement/0.2"
    || !Array.isArray(artifact.value.trusted_receipts)) fail("trusted receipt registry contract is invalid")
  const seen = new Set()
  for (const [index, entry] of artifact.value.trusted_receipts.entries()) {
    exactKeys(entry, [
      "receipt_sha256", "work_order_id", "workload_id", "decision_input_sha256", "evidence_snapshot",
      "reviewed_commit", "status",
    ], `trusted receipt registry entry ${index}`)
    digest(entry.receipt_sha256, `trusted receipt registry entry ${index}.receipt_sha256`)
    digest(entry.decision_input_sha256, `trusted receipt registry entry ${index}.decision_input_sha256`)
    identifier(entry.work_order_id, `trusted receipt registry entry ${index}.work_order_id`)
    identifier(entry.workload_id, `trusted receipt registry entry ${index}.workload_id`)
    if (!/^[a-f0-9]{40}$/.test(entry.reviewed_commit) || entry.status !== "TRUSTED") {
      fail(`trusted receipt registry entry ${index} review binding is invalid`)
    }
    if (!Array.isArray(entry.evidence_snapshot) || entry.evidence_snapshot.length !== 3) {
      fail(`trusted receipt registry entry ${index} evidence snapshot is invalid`)
    }
    for (const [evidenceIndex, evidence] of entry.evidence_snapshot.entries()) {
      exactKeys(evidence, ["node", "snapshot_sha256"], `trusted receipt registry entry ${index} evidence ${evidenceIndex}`)
      identifier(evidence.node, `trusted receipt registry entry ${index} evidence ${evidenceIndex}.node`)
      digest(evidence.snapshot_sha256, `trusted receipt registry entry ${index} evidence ${evidenceIndex}.snapshot_sha256`)
    }
    if (seen.has(entry.receipt_sha256)) fail("trusted receipt registry contains duplicate receipt digests")
    seen.add(entry.receipt_sha256)
  }
  return artifact
}

function verifyTrustedReceipt(registryArtifact, receipt, receiptSha256, workOrderId) {
  const trusted = registryArtifact.value.trusted_receipts.find((entry) => entry.receipt_sha256 === receiptSha256)
  if (!trusted) fail("receipt digest is absent from the reviewed trust registry")
  if (trusted.work_order_id !== workOrderId
    || trusted.workload_id !== receipt.workload.id
    || trusted.decision_input_sha256 !== receipt.decision_input_sha256
    || canonicalizeJcs(trusted.evidence_snapshot) !== canonicalizeJcs(receipt.evidence_snapshot)) {
    fail("receipt does not match its reviewed trust-registry binding")
  }
  return registryArtifact.sha256
}

export function validateShadowPlacementReceipt(receipt, receiptSha256) {
  object(receipt, "receipt")
  rejectExecutableInput(receipt, "receipt")
  if (receipt.schema_version !== "0.2-pinned-placement-recommendation") fail("receipt schema_version is unsupported")
  if (!new Set(["RECOMMENDED", "NO_ELIGIBLE_NODE"]).has(receipt.status)) fail("receipt status is not shadow-observable")
  if (receipt.recommendation_only !== true || receipt.authority_mutated !== false
    || receipt.remote_systems_modified !== false) fail("receipt must remain recommendation-only and non-mutating")
  if (receipt.scheduler?.state !== "disabled" || receipt.scheduler?.authority !== "not-granted"
    || receipt.scheduler?.autonomous_dispatch !== "forbidden") fail("receipt scheduler boundary is invalid")
  if (receipt.placement_policy_version !== "execution-fabric-placement/0.2") fail("receipt policy version is unsupported")
  timestamp(receipt.evaluated_at, "receipt.evaluated_at")
  identifier(receipt.workload?.id, "receipt.workload.id")
  digest(receipt.decision_input_sha256, "receipt.decision_input_sha256")
  if (receipt.evidence_verifier?.result !== "PASS") fail("receipt evidence verifier did not pass")
  if (!Array.isArray(receipt.evidence_snapshot) || receipt.evidence_snapshot.length === 0) {
    fail("receipt evidence_snapshot must be non-empty")
  }
  const evidenceNodes = receipt.evidence_snapshot.map((entry, index) => {
    exactKeys(entry, ["node", "snapshot_sha256"], `receipt.evidence_snapshot[${index}]`)
    identifier(entry.node, `receipt.evidence_snapshot[${index}].node`)
    digest(entry.snapshot_sha256, `receipt.evidence_snapshot[${index}].snapshot_sha256`)
    return entry.node
  })
  if (new Set(evidenceNodes).size !== evidenceNodes.length) fail("receipt evidence_snapshot contains duplicate nodes")
  if (JSON.stringify([...evidenceNodes].sort()) !== JSON.stringify(["aegis", "atlas", "hermes-node"])) {
    fail("receipt evidence_snapshot must contain exact Phase 1 pinned node set")
  }
  digest(receipt.evidence_verifier.sha256, "receipt.evidence_verifier.sha256")
  const inputArtifacts = object(receipt.input_artifacts, "receipt.input_artifacts")
  if (Object.keys(inputArtifacts).length === 0) fail("receipt input_artifacts must be non-empty")
  for (const [name, value] of Object.entries(inputArtifacts)) digest(value, `receipt.input_artifacts.${name}`)

  const eligible = Array.isArray(receipt.eligible_nodes) ? receipt.eligible_nodes : fail("receipt eligible_nodes must be an array")
  const ineligible = Array.isArray(receipt.ineligible_nodes) ? receipt.ineligible_nodes : fail("receipt ineligible_nodes must be an array")
  const candidates = [...eligible, ...ineligible]
  const candidateIds = candidates.map((candidate, index) => identifier(candidate?.node_id, `receipt candidate ${index} node_id`))
  if (new Set(candidateIds).size !== candidateIds.length) fail("receipt candidate nodes must be unique")
  for (const candidate of candidates) {
    if (candidate.execution_authorized !== false || candidate.dispatch_allowed !== false) {
      fail(`${candidate.node_id}: receipt candidate is authority-bearing`)
    }
  }
  const receiptTime = timestamp(receipt.evaluated_at, "receipt.evaluated_at")
  for (const candidate of eligible) {
    if (candidate.eligible !== true || !Number.isInteger(candidate.rank) || candidate.rank < 1
      || candidate.freshness?.state !== "fresh"
      || !["observed", "proven"].includes(candidate.confidence)) {
      fail(`${candidate.node_id}: eligible candidate semantics are contradictory or untrusted`)
    }
    const expiresAt = timestamp(candidate.freshness.expires_at, `${candidate.node_id}: eligible evidence expiry`)
    if (expiresAt <= receiptTime) fail(`${candidate.node_id}: eligible evidence is already expired`)
  }
  for (const candidate of ineligible) {
    if (candidate.eligible !== false) fail(`${candidate.node_id}: ineligible candidate semantics are contradictory`)
  }

  if (receipt.status === "RECOMMENDED") {
    const selected = object(receipt.recommendation, "receipt.recommendation")
    const selectedNode = eligible.find((candidate) => candidate.node_id === selected.node_id)
    if (!selectedNode || selectedNode.eligible !== true || selectedNode.rank !== 1
      || selected.rank !== 1 || selected.execution_authorized !== false || selected.dispatch_allowed !== false) {
      fail("receipt recommendation is not the rank-1 non-authorizing eligible candidate")
    }
    if (selectedNode.freshness?.state !== "fresh"
      || !["observed", "proven"].includes(selectedNode.confidence)) {
      fail("receipt recommendation uses stale or untrusted evidence")
    }
    timestamp(selectedNode.freshness.expires_at, "receipt recommendation evidence expiry")
  } else if (receipt.recommendation !== null || eligible.length !== 0) {
    fail("NO_ELIGIBLE_NODE receipt must not contain a recommendation or eligible node")
  }
  return { receipt_sha256: receiptSha256, selected_node_id: receipt.recommendation?.node_id ?? null }
}

function validateObservation(observation, repositoryRoot, receipt, receiptSha256) {
  rejectExecutableInput(observation, "observation")
  exactKeys(observation, [
    "schema_version", "classification", "observation_id", "work_order_id", "workload_id",
    "receipt_sha256", "recorded_at", "manual_target", "source", "outcome_evidence", "divergence_reasons",
  ], "observation")
  if (observation.schema_version !== "0.1-shadow-placement-observation") fail("observation schema_version is unsupported")
  if (observation.classification !== "recorded-historical-observation") {
    fail("observation must be classified as recorded-historical-observation")
  }
  identifier(observation.observation_id, "observation.observation_id")
  identifier(observation.work_order_id, "observation.work_order_id")
  identifier(observation.workload_id, "observation.workload_id")
  if (observation.workload_id !== receipt.workload.id) fail("observation workload does not match receipt")
  if (digest(observation.receipt_sha256, "observation.receipt_sha256") !== receiptSha256) {
    fail("observation receipt hash does not match exact receipt bytes")
  }
  timestamp(observation.recorded_at, "observation.recorded_at")
  if (observation.manual_target === null) fail("genuine shadow observations require a recorded actual target")
  identifier(observation.manual_target, "observation.manual_target")
  if (!CANONICAL_NODES.has(observation.manual_target)) fail("recorded manual target is not a canonical Fabric node")

  exactKeys(observation.source, ["kind", "path", "sha256"], "observation.source")
  if (observation.source.kind !== "retained-repository-delivery-record") fail("observation source kind is untrusted")
  const sourcePath = resolveRetainedSource(repositoryRoot, observation.source.path)
  const sourceBytes = fs.readFileSync(sourcePath)
  const sourceSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex")
  if (digest(observation.source.sha256, "observation.source.sha256") !== sourceSha256) {
    fail("observation source hash does not match exact retained record bytes")
  }

  const loadedOutcome = loadOutcomeEvidence(repositoryRoot, observation.outcome_evidence)
  const outcomeEvidence = loadedOutcome.evidence
  if (outcomeEvidence.work_order_id !== observation.work_order_id) fail("outcome evidence Work Order does not match observation")
  if (outcomeEvidence.actual_target_node !== observation.manual_target) fail("outcome evidence target does not match observation")
  const receiptTime = timestamp(receipt.evaluated_at, "receipt.evaluated_at")
  const outcomeStart = timestamp(outcomeEvidence.chronology.started_at, "outcome_evidence.started_at")
  const outcomeComplete = timestamp(outcomeEvidence.chronology.completed_at, "outcome_evidence.completed_at")
  const observationTime = timestamp(observation.recorded_at, "observation.recorded_at")
  if (observationTime < receiptTime) fail("shadow observation predates the placement recommendation")
  if (outcomeStart < receiptTime) fail("outcome execution predates the placement recommendation")
  const selectedCandidate = receipt.eligible_nodes.find((candidate) => candidate.node_id === observation.manual_target)
  if (!selectedCandidate || selectedCandidate.eligible !== true) {
    fail("actual target is not eligible in the trusted placement receipt")
  }
  if (outcomeStart >= timestamp(selectedCandidate.freshness.expires_at, "selected evidence expiry")) {
    fail("outcome execution began at or after selected evidence expiry")
  }
  if (observationTime < outcomeComplete) fail("shadow observation predates outcome completion")
  validateShadowSourceClaims(sourceBytes, observation, outcomeEvidence)
  const outcomeTrust = settleOutcomeEvidenceTrust(
    repositoryRoot,
    loadedOutcome.artifactBytes,
    observation.outcome_evidence.sha256,
    sourceSha256,
  )

  if (!Array.isArray(observation.divergence_reasons)
    || new Set(observation.divergence_reasons).size !== observation.divergence_reasons.length
    || observation.divergence_reasons.some((reason) => !ALLOWED_DIVERGENCE_REASONS.has(reason))) {
    fail("observation divergence_reasons are invalid or duplicated")
  }
  const selected = receipt.recommendation?.node_id ?? null
  const diverged = observation.manual_target !== selected
  if (selected !== null && observation.manual_target !== null && selected !== observation.manual_target
    && !observation.divergence_reasons.includes("MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION")) {
    fail("target mismatch requires MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION")
  }
  if (diverged && observation.divergence_reasons.length === 0) fail("divergence requires at least one explicit reason")
  if (!diverged && observation.divergence_reasons.length !== 0) fail("matching targets must not claim divergence")
  return { source_sha256: sourceSha256, outcome_evidence: outcomeEvidence, outcome_trust: outcomeTrust, diverged }
}

function evaluateShadowPlacementAtRoot({ receiptBytes, observationBytes, repositoryRoot, trustScope }) {
  const receiptArtifact = parseArtifactBytes(receiptBytes, "Phase 1 receipt bytes")
  const observationArtifact = parseArtifactBytes(observationBytes, "historical observation bytes")
  const receipt = receiptArtifact.value
  const observation = observationArtifact.value
  const receiptView = validateShadowPlacementReceipt(structuredClone(receipt), receiptArtifact.sha256)
  const trustRegistry = loadTrustedReceiptRegistry(repositoryRoot)
  const trustRegistrySha256 = verifyTrustedReceipt(
    trustRegistry,
    receipt,
    receiptArtifact.sha256,
    observation.work_order_id,
  )
  const observationView = validateObservation(structuredClone(observation), repositoryRoot, receipt, receiptArtifact.sha256)
  const result = {
    schema_version: "0.1-shadow-placement-result",
    status: trustScope === "production" ? "OBSERVED" : "TEST_OBSERVED",
    trust_scope: trustScope,
    observation_only: true,
    observation_id: observation.observation_id,
    work_order_id: observation.work_order_id,
    workload_id: observation.workload_id,
    policy_receipt: {
      sha256: receiptView.receipt_sha256,
      trust_registry_sha256: trustRegistrySha256,
      status: receipt.status,
      selected_node_id: receiptView.selected_node_id,
      evaluated_at: receipt.evaluated_at,
    },
    recorded_observation: {
      sha256: observationArtifact.sha256,
      recorded_at: observation.recorded_at,
      manual_target: observation.manual_target,
      outcome_evidence: observationView.outcome_evidence,
      outcome_trust: observationView.outcome_trust,
      source_path: observation.source.path,
      source_sha256: observationView.source_sha256,
    },
    comparison: {
      diverged: observationView.diverged,
      divergence_reasons: [...observation.divergence_reasons].sort(),
      silent_fallback: false,
    },
    safety: {
      authority_violations: 0,
      stale_evidence_placements: 0,
      silent_fallbacks: 0,
      scheduler_state: "disabled",
    },
    job_launched: false,
    scheduler_activated: false,
    authority_mutated: false,
    remote_accessed: false,
    shell_executed: false,
  }
  result.replay_sha256 = crypto.createHash("sha256").update(canonicalizeJcs(result)).digest("hex")
  return result
}

export function evaluateShadowPlacement({ receiptBytes, observationBytes }) {
  return evaluateShadowPlacementAtRoot({
    receiptBytes,
    observationBytes,
    repositoryRoot: REPOSITORY_ROOT,
    trustScope: "production",
  })
}

export function evaluateShadowPlacementTestFixture({ receiptBytes, observationBytes, repositoryRoot }) {
  const realRoot = fs.realpathSync(path.resolve(repositoryRoot))
  const realTemp = fs.realpathSync(os.tmpdir())
  const relative = path.relative(realTemp, realRoot)
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("test fixture root must be under the OS temporary directory")
  return evaluateShadowPlacementAtRoot({
    receiptBytes,
    observationBytes,
    repositoryRoot: realRoot,
    trustScope: "test-fixture",
  })
}

function evaluateShadowPlacementBatchWith(entries, evaluator, trustScope) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 32) {
    fail("shadow batch must contain between 1 and 32 observations")
  }
  const observations = entries.map((entry) => evaluator(entry))
    .sort((left, right) => left.observation_id < right.observation_id ? -1 : left.observation_id > right.observation_id ? 1 : 0)
  const ids = observations.map((entry) => entry.observation_id)
  if (new Set(ids).size !== ids.length) fail("shadow batch contains duplicate observation IDs")
  const sourceBindings = observations.map((entry) => [
    entry.policy_receipt.sha256,
    entry.work_order_id,
    entry.workload_id,
    entry.recorded_observation.source_sha256,
  ].join(":"))
  if (new Set(sourceBindings).size !== sourceBindings.length) {
    fail("shadow batch contains duplicate receipt-to-source bindings")
  }
  const outcomeBindings = observations.map((entry) => entry.recorded_observation.outcome_evidence.artifact_sha256)
  if (new Set(outcomeBindings).size !== outcomeBindings.length) {
    fail("shadow batch contains duplicate immutable outcomes")
  }
  const result = {
    schema_version: "0.1-shadow-placement-proof",
    gate: trustScope === "production" ? "HERMES_PLACEMENT_SHADOW_PROOF" : "HERMES_PLACEMENT_SHADOW_TEST_FIXTURE",
    status: trustScope === "production" ? "PASS" : "TEST_PASS",
    trust_scope: trustScope,
    observation_only: true,
    bounded_observation_count: observations.length,
    divergence_count: observations.filter((entry) => entry.comparison.diverged).length,
    authority_violations: observations.reduce((sum, entry) => sum + entry.safety.authority_violations, 0),
    stale_evidence_placements: observations.reduce((sum, entry) => sum + entry.safety.stale_evidence_placements, 0),
    silent_fallbacks: observations.reduce((sum, entry) => sum + entry.safety.silent_fallbacks, 0),
    observation_replay_sha256: observations.map((entry) => entry.replay_sha256),
    job_launched: false,
    scheduler_activated: false,
    authority_mutated: false,
    remote_accessed: false,
    shell_executed: false,
  }
  result.replay_sha256 = crypto.createHash("sha256").update(canonicalizeJcs(result)).digest("hex")
  return result
}

export function evaluateShadowPlacementBatch(entries) {
  return evaluateShadowPlacementBatchWith(entries, evaluateShadowPlacement, "production")
}

export function evaluateShadowPlacementTestFixtureBatch(entries) {
  return evaluateShadowPlacementBatchWith(entries, evaluateShadowPlacementTestFixture, "test-fixture")
}

function rejected(error) {
  return {
    schema_version: "0.1-shadow-placement-result",
    status: "INPUT_REJECTED",
    observation_only: true,
    error: { code: "FABRIC_SHADOW_PLACEMENT_INVALID", detail: String(error?.message ?? error) },
    job_launched: false,
    scheduler_activated: false,
    authority_mutated: false,
    remote_accessed: false,
    shell_executed: false,
  }
}

function parseArguments(argv) {
  const parsed = {}
  const allowed = new Set(["receipt", "observation"])
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) fail("arguments must use --name value pairs")
    const name = key.slice(2)
    if (!allowed.has(name)) fail(`--${name} is not supported`)
    if (Object.hasOwn(parsed, name)) fail(`duplicate --${name}`)
    parsed[name] = value
  }
  for (const required of ["receipt", "observation"]) {
    if (!parsed[required]) fail(`--${required} is required`)
  }
  return parsed
}

export function runShadowPlacementCli(argv) {
  try {
    const args = parseArguments(argv)
    const receipt = readArtifact(args.receipt, "Phase 1 receipt")
    const observation = readArtifact(args.observation, "historical observation")
    return evaluateShadowPlacement({
      receiptBytes: receipt.bytes,
      observationBytes: observation.bytes,
    })
  } catch (error) {
    if (String(error?.message ?? error).startsWith("FABRIC_SHADOW_PLACEMENT_INVALID:")) return rejected(error)
    throw error
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const result = runShadowPlacementCli(process.argv.slice(2))
  const stream = result.status === "INPUT_REJECTED" ? process.stderr : process.stdout
  stream.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status === "INPUT_REJECTED") process.exitCode = EXIT_INVALID
}
