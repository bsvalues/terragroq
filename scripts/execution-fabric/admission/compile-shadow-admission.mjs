import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { validateShadowPlacementReceipt } from "../evaluate-shadow-placement.mjs"
import { validateShadowOutcomeEvidence } from "../shadow-outcome-evidence.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,255}$/
const NODES = new Set(["omen", "hermes-node", "atlas", "aegis", "azure"])
const DIVERGENCE = new Set([
  "MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION",
  "RECORDED_AUTHORITY_CONSTRAINT",
  "RECORDED_CAPABILITY_CONSTRAINT",
  "RECORDED_RESOURCE_CONSTRAINT",
])
const UNSAFE_KEY = /(?:^|[_-])(?:command|commands|cmd|shell|script|argv|args|executable|exec|spawn|cwd|stdin|environment|env|endpoint|credential|credentials|password|passwd|private[_-]?key|secret|secrets|token|tokens|api[_-]?key|connection[_-]?string|authorization)(?:$|[_-])/i
const SECRET = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,})/i

class AdmissionError extends Error {
  constructor(detail) {
    super(`FABRIC_SHADOW_ADMISSION_INVALID: ${detail}`)
    this.name = "AdmissionError"
  }
}
const fail = (detail) => { throw new AdmissionError(detail) }
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalBytes = (value) => Buffer.from(`${canonicalizeJcs(value)}\n`, "utf8")

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} fields do not match the contract`)
}
function id(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail(`${label} must be a safe identifier`)
  return value
}
function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be lowercase SHA-256 hex`)
  return value
}
function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be an explicit valid UTC timestamp`)
  }
  if (new Date(Date.parse(value)).toISOString() !== (value.length === 20 ? value.replace("Z", ".000Z") : value)) {
    fail(`${label} must name a real UTC calendar instant`)
  }
  return Date.parse(value)
}
function safe(value, label = "candidate") {
  if (Array.isArray(value)) return value.forEach((entry, index) => safe(entry, `${label}[${index}]`))
  if (typeof value === "string" && SECRET.test(value)) fail(`${label} contains secret-like material`)
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key)) fail(`${label}.${key} is not permitted in observation-only admission`)
    safe(child, `${label}.${key}`)
  }
}
function retained(root, binding, label, extensions) {
  exact(binding, ["path", "sha256"], label)
  if (typeof binding.path !== "string" || path.isAbsolute(binding.path)) fail(`${label}.path must be repository-relative`)
  const normalized = binding.path.replaceAll("\\", "/")
  if (!normalized.startsWith("docs/reports/") || !extensions.some((extension) => normalized.endsWith(extension))) fail(`${label}.path is outside its retained report boundary`)
  const resolved = path.resolve(root, binding.path)
  const relative = path.relative(root, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`${label}.path escapes repository root`)
  let real
  try {
    if (fs.lstatSync(resolved).isSymbolicLink()) fail(`${label}.path must not be a symbolic link`)
    real = fs.realpathSync(resolved)
  } catch (error) {
    if (error instanceof AdmissionError) throw error
    fail(`unable to resolve ${label}: ${error.message}`)
  }
  const realRelative = path.relative(root, real)
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) fail(`${label}.path resolves outside repository root`)
  let bytes
  try { bytes = fs.readFileSync(resolved) } catch (error) { fail(`unable to read ${label}: ${error.message}`) }
  if (hash(bytes) !== digest(binding.sha256, `${label}.sha256`)) fail(`${label} bytes do not match declared SHA-256`)
  return { bytes, normalized, sha256: binding.sha256 }
}

function proveReviewedCommit({ repositoryRoot, reviewedCommit, artifacts }) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", reviewedCommit, "refs/heads/main"], { cwd: repositoryRoot, stdio: "ignore" })
    for (const artifact of artifacts) {
      const committed = execFileSync("git", ["show", `${reviewedCommit}:${artifact.normalized}`], { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 })
      if (hash(committed) !== artifact.sha256) fail(`${artifact.normalized} exact bytes are absent from reviewed_commit`)
    }
    return { trusted_ref: "refs/heads/main", reviewed_commit: reviewedCommit, exact_artifact_count: artifacts.length }
  } catch (error) {
    if (error instanceof AdmissionError) throw error
    fail("reviewed_commit is not an ancestor of trusted main or cannot prove exact retained bytes")
  }
}

export function compileShadowAdmission({ candidate, repositoryRoot, reviewProof = proveReviewedCommit }) {
  safe(candidate)
  exact(candidate, [
    "schema_version", "candidate_id", "work_order_id", "workload_id", "producer_lane",
    "outcome_kind", "receipt", "delivery_record", "outcome_evidence", "review_evidence",
    "authority", "review_commit", "recorded_at", "divergence_reasons",
  ], "candidate")
  if (candidate.schema_version !== "0.1-shadow-admission-candidate") fail("candidate schema_version is unsupported")
  if (!new Set(["MANUAL_KNOWN_SAFE", "RESIDENT_HERMES_REVIEWED"]).has(candidate.outcome_kind)) fail("outcome_kind is not eligible for genuine admission")
  id(candidate.candidate_id, "candidate.candidate_id")
  const workOrder = id(candidate.work_order_id, "candidate.work_order_id")
  const workload = id(candidate.workload_id, "candidate.workload_id")
  id(candidate.producer_lane, "candidate.producer_lane")
  const root = fs.realpathSync(path.resolve(repositoryRoot))
  const receiptArtifact = retained(root, candidate.receipt, "candidate.receipt", [".json"])
  const delivery = retained(root, candidate.delivery_record, "candidate.delivery_record", [".md"])
  const outcome = retained(root, candidate.outcome_evidence, "candidate.outcome_evidence", [".json"])
  const review = retained(root, candidate.review_evidence, "candidate.review_evidence", [".json", ".md"])
  let receipt
  try { receipt = JSON.parse(receiptArtifact.bytes.toString("utf8")) } catch { fail("receipt is not JSON") }
  validateShadowPlacementReceipt(receipt, receiptArtifact.sha256)
  if (receipt.work_order_id !== workOrder || receipt?.workload?.id !== workload) fail("receipt identity does not match candidate")
  const outcomeValidation = validateShadowOutcomeEvidence({ artifactBytes: outcome.bytes, expectedSha256: candidate.outcome_evidence.sha256 })
  if (outcomeValidation.work_order_id !== workOrder) fail("outcome Work Order does not match candidate")
  const actualNode = outcomeValidation.actual_target_node
  if (!NODES.has(actualNode)) fail("outcome target is not a canonical Fabric node")
  exact(candidate.authority, ["reference", "allowed_canonical_nodes", "valid_from", "expires_at", "reviewed_commit"], "candidate.authority")
  id(candidate.authority.reference, "candidate.authority.reference")
  if (!Array.isArray(candidate.authority.allowed_canonical_nodes) || !candidate.authority.allowed_canonical_nodes.includes(actualNode)) fail("reviewed authority does not include actual target")
  if (candidate.authority.allowed_canonical_nodes.some((node) => !NODES.has(node))) fail("reviewed authority contains a noncanonical node")
  const validFrom = timestamp(candidate.authority.valid_from, "candidate.authority.valid_from")
  const expiresAt = timestamp(candidate.authority.expires_at, "candidate.authority.expires_at")
  const recordedAt = timestamp(candidate.recorded_at, "candidate.recorded_at")
  if (validFrom > Date.parse(outcomeValidation.chronology.started_at) || expiresAt < Date.parse(outcomeValidation.chronology.completed_at)) fail("reviewed authority does not cover outcome chronology")
  if (recordedAt < Date.parse(outcomeValidation.chronology.completed_at)) fail("admission predates outcome completion")
  if (!COMMIT.test(candidate.authority.reviewed_commit)) fail("reviewed_commit must be a full lowercase Git commit")
  if (!COMMIT.test(candidate.review_commit)) fail("review_commit must be a full lowercase Git commit")
  if (outcomeValidation.authority_outcome.reference !== candidate.authority.reference) fail("outcome authority reference does not match reviewed authority")
  const checkedAt = timestamp(outcomeValidation.authority_outcome.checked_at, "outcome authority checked_at")
  if (checkedAt < validFrom || checkedAt >= expiresAt) fail("outcome authority check is outside the reviewed authority window")
  if (Date.parse(outcomeValidation.chronology.completed_at) >= expiresAt) fail("reviewed authority expires at or before outcome completion")
  if (!Array.isArray(candidate.divergence_reasons) || new Set(candidate.divergence_reasons).size !== candidate.divergence_reasons.length || candidate.divergence_reasons.some((reason) => !DIVERGENCE.has(reason))) fail("divergence_reasons are invalid or duplicated")
  const selectedNode = receipt?.recommendation?.node_id ?? null
  const diverged = selectedNode !== actualNode
  if (diverged !== candidate.divergence_reasons.includes("MANUAL_TARGET_DIFFERS_FROM_RECOMMENDATION")) fail("target divergence classification does not match receipt and outcome")
  if (!review.bytes.toString("utf8").includes(workOrder) || !review.bytes.toString("utf8").includes(candidate.authority.reviewed_commit)) fail("review evidence does not bind Work Order and reviewed commit")
  const commitProof = reviewProof({
    repositoryRoot: root,
    reviewedCommit: candidate.authority.reviewed_commit,
    // The execution commit contains the three execution facts. A separate later review commit
    // contains the retained review record that names and reviews this execution commit.
    artifacts: [receiptArtifact, delivery, outcome],
  })
  if (!commitProof || commitProof.reviewed_commit !== candidate.authority.reviewed_commit || commitProof.trusted_ref !== "refs/heads/main" || commitProof.exact_artifact_count !== 3) {
    fail("review proof did not bind trusted main, reviewed commit, and all exact artifacts")
  }
  const reviewCommitProof = reviewProof({
    repositoryRoot: root,
    reviewedCommit: candidate.review_commit,
    artifacts: [review],
  })
  if (!reviewCommitProof || reviewCommitProof.reviewed_commit !== candidate.review_commit
    || reviewCommitProof.trusted_ref !== "refs/heads/main" || reviewCommitProof.exact_artifact_count !== 1) {
    fail("review proof did not bind the exact review record to trusted main")
  }

  const receiptSha256 = hash(receiptArtifact.bytes)
  const observation = {
    schema_version: "0.1-shadow-placement-observation", classification: "recorded-historical-observation",
    observation_id: `shadow-${candidate.candidate_id}`, work_order_id: workOrder, workload_id: workload,
    receipt_sha256: receiptSha256, recorded_at: candidate.recorded_at, manual_target: actualNode,
    source: { kind: "retained-repository-delivery-record", path: delivery.normalized, sha256: candidate.delivery_record.sha256 },
    outcome_evidence: { kind: "retained-canonical-outcome-evidence", path: outcome.normalized, sha256: candidate.outcome_evidence.sha256 },
    divergence_reasons: [...candidate.divergence_reasons].sort(),
  }
  const result = {
    schema_version: "0.1-shadow-admission-bundle", status: "READY_FOR_REVIEWED_REGISTRY_ADMISSION",
    candidate_id: candidate.candidate_id, observation,
    registry_entries: {
      receipt: { receipt_sha256: receiptSha256, work_order_id: workOrder, workload_id: workload, decision_input_sha256: receipt.decision_input_sha256, evidence_snapshot: receipt.evidence_snapshot, reviewed_commit: candidate.authority.reviewed_commit, status: "TRUSTED" },
      outcome: { artifact_sha256: candidate.outcome_evidence.sha256, work_order_id: workOrder, actual_target_node: actualNode, retained_source_sha256: candidate.delivery_record.sha256, authority_reference: candidate.authority.reference, reviewed_commit: candidate.authority.reviewed_commit, status: "ACTIVE" },
      authority: { reference: candidate.authority.reference, work_order_id: workOrder, allowed_canonical_nodes: [...candidate.authority.allowed_canonical_nodes].sort(), valid_from: candidate.authority.valid_from, expires_at: candidate.authority.expires_at, reviewed_commit: candidate.authority.reviewed_commit, status: "ACTIVE" },
    },
    evidence: { review_path: review.normalized, review_sha256: candidate.review_evidence.sha256, producer_lane: candidate.producer_lane, outcome_kind: candidate.outcome_kind, commit_proof: commitProof, review_commit_proof: reviewCommitProof },
    safety: { observation_only: true, job_launched: false, scheduler_activated: false, dispatch_authority_granted: false, authority_mutated: false, remote_accessed: false, shell_executed: false },
  }
  return { ...result, bundle_sha256: hash(canonicalBytes(result)) }
}

export function runShadowAdmissionCli(argv) {
  try {
    if (argv.length !== 2 || argv[0] !== "--candidate") fail("usage: --candidate <retained candidate JSON>")
    const candidatePath = path.resolve(argv[1])
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
    const relative = path.relative(repositoryRoot, candidatePath).replaceAll("\\", "/")
    if (!relative.startsWith("docs/reports/") || relative.startsWith("../")) fail("candidate must be retained under docs/reports")
    if (fs.lstatSync(candidatePath).isSymbolicLink()) fail("candidate path must not be a symbolic link")
    const realRelative = path.relative(repositoryRoot, fs.realpathSync(candidatePath)).replaceAll("\\", "/")
    if (!realRelative.startsWith("docs/reports/") || realRelative.startsWith("../")) fail("candidate resolves outside docs/reports")
    return compileShadowAdmission({ candidate: JSON.parse(fs.readFileSync(candidatePath, "utf8")), repositoryRoot })
  } catch (error) {
    if (!(error instanceof AdmissionError)) throw error
    return { schema_version: "0.1-shadow-admission-bundle", status: "INPUT_REJECTED", error: { code: "FABRIC_SHADOW_ADMISSION_INVALID", detail: error.message }, safety: { observation_only: true, job_launched: false, scheduler_activated: false, dispatch_authority_granted: false, authority_mutated: false, remote_accessed: false, shell_executed: false } }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const result = runShadowAdmissionCli(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status === "INPUT_REJECTED") process.exitCode = 2
}
