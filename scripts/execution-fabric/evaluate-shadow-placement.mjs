import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runPinnedPlacementCli } from "./recommend-pinned-placement.mjs"

const EXIT_INVALID = 2
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const TRUSTED_CONFIDENCE = new Set(["observed", "proven"])
const REQUIRED_EVIDENCE_NODES = ["aegis", "atlas", "hermes-node"]
export const PHASE1_VERIFIER_SHA256 = "c8f488953cf91e7ea8badd59e718185171096783b58a4d75b4ba4a77581297b6"
const EXECUTABLE_FIELD = /^(?:command|commands|cmd|args|argv|shell|script|executable|exec|spawn|cwd|stdin|environment|env)$/i
const SECRET_FIELD = /(?:^|[_-])(?:secret|secrets|password|passwd|token|tokens|api[_-]?key|credential|credentials|private[_-]?key|connection[_-]?string)(?:$|[_-])/i
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@/i,
]

function fail(message, context = {}) {
  const error = new Error(`FABRIC_SHADOW_PLACEMENT_INVALID: ${message}`)
  error.context = context
  throw error
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

function rejectUnsafeFields(value, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectUnsafeFields(entry, `${location}[${index}]`))
    return
  }
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) fail(`${location} contains a secret-like value`)
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_FIELD.test(key) || SECRET_FIELD.test(key) || /^authorization$/i.test(key)) {
      fail(`${location}.${key} is an executable or secret-like field`)
    }
    rejectUnsafeFields(child, `${location}.${key}`)
  }
}

function isUtcDateTime(value) {
  if (typeof value !== "string") return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day >= 1 && day <= daysInMonth && Number.isFinite(Date.parse(value))
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function candidateReasonCodes(candidate) {
  if (!Array.isArray(candidate?.reasons)) return []
  return candidate.reasons.flatMap((reason) => typeof reason?.code === "string" ? [reason.code] : [])
}

function validateDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be lowercase SHA-256`)
}

function validateReceipt(receipt) {
  rejectUnsafeFields(receipt, "receipt")
  if (!isObject(receipt)) fail("receipt must be an object")
  if (receipt.schema_version !== "0.2-pinned-placement-recommendation") fail("receipt schema_version is invalid")
  if (receipt.status === "INPUT_REJECTED") fail("an INPUT_REJECTED receipt cannot be shadow evaluated")
  if (receipt.status !== "RECOMMENDED") fail("receipt must contain a successful recommendation")
  if (receipt.recommendation_only !== true) fail("receipt must remain recommendation-only")
  if (receipt.authority_mutated !== false || receipt.remote_systems_modified !== false) {
    fail("receipt root safety invariants are invalid")
  }
  validateDigest(receipt.decision_input_sha256, "decision_input_sha256")
  if (receipt.placement_policy_version !== "execution-fabric-placement/0.2") {
    fail("placement_policy_version is invalid")
  }
  if (!isUtcDateTime(receipt.evaluated_at)) fail("receipt evaluated_at must be an explicit UTC timestamp")
  exactKeys(receipt.workload, ["id", "title", "storage_semantics"], "workload")
  for (const field of ["id", "title", "storage_semantics"]) {
    if (typeof receipt.workload[field] !== "string" || receipt.workload[field].trim() === ""
      || receipt.workload[field].length > 256) fail(`workload.${field} is invalid`)
  }
  exactKeys(receipt.input_artifacts, [
    "registry_base_sha256", "registry_schema_sha256", "pinned_evidence_policy_sha256", "workload_catalog_sha256",
  ], "input_artifacts")
  for (const [field, digestValue] of Object.entries(receipt.input_artifacts)) {
    validateDigest(digestValue, `input_artifacts.${field}`)
  }
  exactKeys(receipt.evidence_verifier, ["contract", "reference_implementation", "sha256", "result"], "evidence_verifier")
  if (receipt.evidence_verifier.contract !== "jcs-rfc8785/1") fail("evidence_verifier.contract is invalid")
  if (receipt.evidence_verifier.reference_implementation !== "verify_snapshot.py") fail("evidence_verifier.reference_implementation is invalid")
  validateDigest(receipt.evidence_verifier.sha256, "evidence_verifier.sha256")
  if (receipt.evidence_verifier.sha256 !== PHASE1_VERIFIER_SHA256) fail("evidence_verifier.sha256 does not match the trusted Phase 1 verifier")
  if (receipt.evidence_verifier.result !== "PASS") fail("evidence verifier did not pass")
  if (!Array.isArray(receipt.evidence_snapshot)) fail("evidence_snapshot must be an array")
  const evidenceNodes = []
  for (const [index, reference] of receipt.evidence_snapshot.entries()) {
    exactKeys(reference, ["node", "snapshot_sha256"], `evidence_snapshot[${index}]`)
    if (typeof reference.node !== "string" || !SAFE_ID.test(reference.node)) fail(`evidence_snapshot[${index}].node is invalid`)
    validateDigest(reference.snapshot_sha256, `evidence_snapshot[${index}].snapshot_sha256`)
    evidenceNodes.push(reference.node)
  }
  if (new Set(evidenceNodes).size !== evidenceNodes.length
    || JSON.stringify([...evidenceNodes].sort()) !== JSON.stringify(REQUIRED_EVIDENCE_NODES)) {
    fail("evidence_snapshot must contain the exact unique aegis, atlas, and hermes-node set")
  }
  if (!isObject(receipt.confidence)
    || !TRUSTED_CONFIDENCE.has(receipt.confidence.state)
    || receipt.confidence.freshness !== "fresh") {
    fail("receipt confidence must be observed or proven with fresh evidence")
  }
  if (!isObject(receipt.scheduler)
    || receipt.scheduler.state !== "disabled"
    || receipt.scheduler.authority !== "not-granted"
    || receipt.scheduler.autonomous_dispatch !== "forbidden") {
    fail("receipt scheduler must remain disabled / not-granted / autonomous dispatch forbidden")
  }
  if (!Array.isArray(receipt.eligible_nodes) || !Array.isArray(receipt.ineligible_nodes)) {
    fail("receipt candidate collections are invalid")
  }
  const recommendation = receipt.recommendation
  if (recommendation !== null) {
    if (!isObject(recommendation)
      || typeof recommendation.node_id !== "string"
      || recommendation.execution_authorized !== false
      || recommendation.dispatch_allowed !== false) {
      fail("receipt recommendation must be non-authorizing")
    }
  }
  if ((receipt.status === "RECOMMENDED") !== (recommendation !== null)) {
    fail("receipt status and recommendation are inconsistent")
  }
  const candidates = [...receipt.eligible_nodes, ...receipt.ineligible_nodes]
  const nodeIds = []
  for (const candidate of candidates) {
    if (!isObject(candidate) || typeof candidate.node_id !== "string" || !SAFE_ID.test(candidate.node_id)) {
      fail("receipt candidate node_id is invalid")
    }
    if (candidate.execution_authorized !== false || candidate.dispatch_allowed !== false) {
      fail(`${candidate.node_id}: receipt candidate must be non-authorizing`)
    }
    nodeIds.push(candidate.node_id)
  }
  if (new Set(nodeIds).size !== nodeIds.length) fail("receipt candidate node IDs must be unique")
  for (const candidate of receipt.eligible_nodes) {
    if (candidate.eligible !== true) fail(`${candidate.node_id}: eligible candidate is inconsistent`)
    if (!isObject(candidate.freshness) || candidate.freshness.state !== "fresh") fail(`${candidate.node_id}: eligible candidate evidence is not fresh`)
    if (!isUtcDateTime(candidate.freshness.expires_at)) fail(`${candidate.node_id}: eligible candidate evidence expiry is invalid`)
    if (!TRUSTED_CONFIDENCE.has(candidate.confidence)) fail(`${candidate.node_id}: eligible candidate confidence is not observed or proven`)
    if (!Array.isArray(candidate.reasons) || candidate.reasons.length !== 0) fail(`${candidate.node_id}: eligible candidate must have no rejection reasons`)
    if (!Number.isInteger(candidate.rank) || candidate.rank < 1) fail(`${candidate.node_id}: eligible candidate rank is invalid`)
  }
  for (const candidate of receipt.ineligible_nodes) {
    if (candidate.eligible !== false) fail(`${candidate.node_id}: ineligible candidate is inconsistent`)
    if (Object.hasOwn(candidate, "rank") && candidate.rank !== null) fail(`${candidate.node_id}: ineligible candidate must be unranked`)
  }
  const eligibleRanks = receipt.eligible_nodes.map((candidate) => candidate.rank).sort((left, right) => left - right)
  if (new Set(eligibleRanks).size !== eligibleRanks.length
    || eligibleRanks.some((rank, index) => rank !== index + 1)) fail("eligible candidate ranks must be unique and coherent")
  if (recommendation !== null) {
    const selected = receipt.eligible_nodes.find((candidate) => candidate.node_id === recommendation.node_id)
    if (!selected) fail("recommended node must appear in eligible_nodes")
    if (recommendation.rank !== selected.rank || recommendation.rank !== 1) fail("recommendation rank is inconsistent")
  }
  return receipt
}

function actualTargetFlags(receipt, observation) {
  const rejected = receipt.ineligible_nodes.find((candidate) => candidate.node_id === observation.actual_target.node_id)
  const reasonCodes = candidateReasonCodes(rejected)
  return {
    authority_violation: reasonCodes.some((code) => code === "AUTHORITY_REQUIRED" || code === "AUTHORITY_EXCLUDED" || code === "AUTHORITY_DENIED"),
    stale_evidence: reasonCodes.some((code) => code === "EVIDENCE_STALE" || code === "EVIDENCE_TTL_REQUIRED" || code === "CAPABILITY_EVIDENCE_STALE"),
    silent_fallback: false,
  }
}

function authenticateReceipt(receipt, observation, args) {
  const replayArgs = [
    "--snapshot-root", args["snapshot-root"],
    "--verifier", args.verifier,
    "--python", args.python,
    "--registry", args.registry,
    "--schema", args.schema,
    "--policy", args.policy,
    "--workloads", args.workloads,
    "--workload", receipt.workload.id,
    "--at", receipt.evaluated_at,
  ]
  for (const reference of receipt.evidence_snapshot) {
    replayArgs.push("--evidence", `${reference.node}=${reference.snapshot_sha256}`)
  }
  const replayed = runPinnedPlacementCli(replayArgs)
  if (replayed.status === "INPUT_REJECTED") fail("trusted Phase 1 replay rejected the receipt inputs")
  if (canonicalJson(replayed) !== canonicalJson(receipt)) {
    fail(
      "receipt recommendation, candidate ranks, workload, or pinned decision artifacts do not exactly match the trusted Phase 1 replay",
      actualTargetFlags(receipt, observation),
    )
  }
}

function validateObservation(observation, receiptHash) {
  rejectUnsafeFields(observation, "observation")
  exactKeys(observation, [
    "schema_version", "observation_id", "work_order_id", "observed_at",
    "placement_receipt_sha256", "actual_target", "divergence",
  ], "observation")
  if (observation.schema_version !== "0.1-shadow-placement-observation") fail("observation schema_version is invalid")
  for (const field of ["observation_id", "work_order_id"]) {
    if (typeof observation[field] !== "string" || !SAFE_ID.test(observation[field])) fail(`${field} must be a safe ID`)
  }
  if (!isUtcDateTime(observation.observed_at)) fail("observed_at must be an explicit UTC timestamp")
  if (typeof observation.placement_receipt_sha256 !== "string" || !SHA256.test(observation.placement_receipt_sha256)) {
    fail("placement_receipt_sha256 must be lowercase SHA-256")
  }
  if (observation.placement_receipt_sha256 !== receiptHash) fail("placement receipt digest does not match exact receipt bytes")

  const actual = observation.actual_target
  exactKeys(actual, ["status", "node_id", "selection_source", "outcome_ref", "latency_ms"], "actual_target")
  if (!["RECORDED", "NOT_RUN"].includes(actual.status)) fail("actual_target.status is invalid")
  if (!["operator-selected", "known-safe", "none"].includes(actual.selection_source)) fail("actual_target.selection_source is invalid")
  if (actual.node_id !== null && (typeof actual.node_id !== "string" || actual.node_id.trim() === "" || actual.node_id.length > 128)) fail("actual_target.node_id is invalid")
  if (actual.outcome_ref !== null && (typeof actual.outcome_ref !== "string" || actual.outcome_ref.trim() === "" || actual.outcome_ref.length > 2048)) fail("actual_target.outcome_ref is invalid")
  if (actual.latency_ms !== null && (!Number.isInteger(actual.latency_ms) || actual.latency_ms < 0)) fail("actual_target.latency_ms is invalid")

  const divergence = observation.divergence
  exactKeys(divergence, ["status", "reason_code", "explanation"], "divergence")
  if (!["MATCH", "DIVERGED", "NOT_COMPARABLE"].includes(divergence.status)) fail("divergence.status is invalid")
  for (const field of ["reason_code", "explanation"]) {
    if (divergence[field] !== null && (typeof divergence[field] !== "string" || divergence[field].trim() === "")) {
      fail(`divergence.${field} must be null or a non-empty string`)
    }
  }
  if (divergence.reason_code !== null && !SAFE_ID.test(divergence.reason_code)) fail("divergence.reason_code must be a bounded safe ID")
  if (divergence.explanation !== null && divergence.explanation.length > 2000) fail("divergence.explanation is too long")

  if (actual.status === "NOT_RUN") {
    if (actual.node_id !== null || actual.outcome_ref !== null || actual.latency_ms !== null
      || actual.selection_source !== "none" || divergence.status !== "NOT_COMPARABLE"
      || divergence.reason_code !== null) {
      fail("NOT_RUN observation is inconsistent")
    }
  } else {
    if (actual.selection_source === "none") {
      fail("RECORDED observation cannot silently select a target", { silent_fallback: true })
    }
    if (actual.node_id === null || actual.outcome_ref === null || actual.latency_ms === null) {
      fail("RECORDED observation requires a node, explicit source, outcome, and latency")
    }
    if (divergence.status === "NOT_COMPARABLE") fail("RECORDED observation must be comparable")
  }
  if (divergence.status === "DIVERGED"
    && (divergence.reason_code === null || divergence.explanation === null)) {
    fail("DIVERGED observation requires a stable reason and explanation")
  }
  if (divergence.status !== "DIVERGED"
    && (divergence.reason_code !== null || divergence.explanation !== null)) {
    fail("only DIVERGED observations may include a reason or explanation")
  }
  return observation
}

function baseResult({ receiptHash, observation = null, receipt = null, error = null, flags = {} }) {
  const result = {
    schema_version: "0.1-shadow-placement-result",
    status: "INPUT_REJECTED",
    placement_receipt_sha256: receiptHash ?? null,
    observation_id: observation?.observation_id ?? null,
    work_order_id: observation?.work_order_id ?? null,
    recommended: receipt?.recommendation === null || receipt?.recommendation === undefined
      ? null
      : { node_id: receipt.recommendation.node_id },
    actual: observation?.actual_target ?? null,
    authority_violation: flags.authority_violation ?? false,
    stale_evidence: flags.stale_evidence ?? false,
    silent_fallback: flags.silent_fallback ?? false,
    divergence: observation?.divergence ?? null,
    evaluated_at: observation?.observed_at ?? null,
    shadow_only: true,
    dispatch_allowed: false,
    execution_authorized: false,
    remote_systems_modified: false,
    scheduler: { state: "disabled", authority: "not-granted", autonomous_dispatch: "forbidden" },
    error,
  }
  result.shadow_result_sha256 = sha256Canonical(result)
  return result
}

function evaluate(receipt, observation, receiptHash) {
  const recommendedNodeId = receipt.recommendation?.node_id ?? null
  if (observation.actual_target.status === "NOT_RUN") {
    const result = baseResult({ receiptHash, observation, receipt })
    result.status = "SHADOW_NOT_RUN"
    result.error = null
    delete result.shadow_result_sha256
    result.shadow_result_sha256 = sha256Canonical(result)
    return result
  }

  if (recommendedNodeId === null) fail("RECORDED observation cannot use a receipt with no recommendation")
  const actualNodeId = observation.actual_target.node_id
  const eligible = receipt.eligible_nodes.find((candidate) => candidate.node_id === actualNodeId)
  const rejected = receipt.ineligible_nodes.find((candidate) => candidate.node_id === actualNodeId)
  const flags = actualTargetFlags(receipt, observation)
  if (!eligible) {
    fail(rejected ? "actual target is not eligible in the pinned receipt" : "actual target is absent from the pinned receipt", flags)
  }
  if (Date.parse(observation.observed_at) < Date.parse(receipt.evaluated_at)) {
    fail("shadow observation predates the placement recommendation")
  }
  if (Date.parse(observation.observed_at) >= Date.parse(eligible.freshness.expires_at)) {
    fail("actual target evidence expired before the shadow observation", { ...flags, stale_evidence: true })
  }

  const matches = actualNodeId === recommendedNodeId
  if ((observation.divergence.status === "MATCH") !== matches) {
    fail("divergence status must be MATCH if and only if actual node equals recommended node", flags)
  }
  if (!matches && observation.divergence.status !== "DIVERGED") fail("a different actual node must be DIVERGED", flags)

  const result = baseResult({ receiptHash, observation, receipt, flags })
  result.status = matches ? "SHADOW_MATCH" : "SHADOW_DIVERGENCE"
  result.error = null
  delete result.shadow_result_sha256
  result.shadow_result_sha256 = sha256Canonical(result)
  return result
}

function parseArguments(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) fail("arguments must use --name value pairs")
    const name = key.slice(2)
    if (!new Set([
      "receipt", "observation", "snapshot-root", "verifier", "python",
      "registry", "schema", "policy", "workloads",
    ]).has(name)) fail(`unknown argument --${name}`)
    if (Object.hasOwn(parsed, name)) fail(`duplicate --${name}`)
    parsed[name] = value
  }
  for (const required of [
    "receipt", "observation", "snapshot-root", "verifier", "python",
    "registry", "schema", "policy", "workloads",
  ]) {
    if (!parsed[required]) fail(`--${required} is required`)
  }
  return parsed
}

function readArtifactOnce(filePath, label) {
  try {
    const bytes = fs.readFileSync(path.resolve(filePath))
    return { bytes, value: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) }
  } catch (error) {
    fail(`unable to read ${label}: ${error.message}`)
  }
}

export function runShadowPlacementCli(argv) {
  let receiptHash = null
  let observation = null
  let receipt = null
  try {
    const args = parseArguments(argv)
    const receiptArtifact = readArtifactOnce(args.receipt, "placement receipt")
    receiptHash = sha256Bytes(receiptArtifact.bytes)
    const receiptInput = receiptArtifact.value
    const observationArtifact = readArtifactOnce(args.observation, "shadow observation")
    const observationInput = observationArtifact.value
    validateObservation(observationInput, receiptHash)
    validateReceipt(receiptInput)
    authenticateReceipt(receiptInput, observationInput, args)
    receipt = receiptInput
    observation = observationInput
    return evaluate(receipt, observation, receiptHash)
  } catch (error) {
    if (!String(error?.message ?? error).startsWith("FABRIC_SHADOW_PLACEMENT_INVALID:")) throw error
    const detail = String(error.message).replace(/^FABRIC_SHADOW_PLACEMENT_INVALID:\s*/, "")
    return baseResult({
      receiptHash,
      observation,
      receipt,
      flags: error.context,
      error: { code: "FABRIC_SHADOW_PLACEMENT_INVALID", detail },
    })
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const result = runShadowPlacementCli(process.argv.slice(2))
  const stream = result.status === "INPUT_REJECTED" ? process.stderr : process.stdout
  stream.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status === "INPUT_REJECTED") process.exitCode = EXIT_INVALID
}
