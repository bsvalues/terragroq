import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "./canonical-json.mjs"

const EXIT_INVALID = 2
const SHA256 = /^[a-f0-9]{64}$/
const GIT_SHA = /^[a-f0-9]{40}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const OUTCOME_PAIRS = new Map([
  ["COMPLETED", "SUCCEEDED"],
  ["FAILED", "FAILED"],
  ["BLOCKED", "BLOCKED"],
  ["CANCELLED", "CANCELLED"],
])
const RESOURCE_UNITS = new Map([
  ["concurrency_used", "count"],
  ["cpu_load_pct", "percent"],
  ["disk_used_bytes", "bytes"],
  ["gpu_vram_used_bytes", "bytes"],
  ["io_pressure_pct", "percent"],
  ["ram_used_bytes", "bytes"],
])
const EXECUTABLE_FIELD = /^(?:command|commands|cmd|args|argv|shell|script|executable|exec|spawn|cwd|stdin|environment|env)$/i
const SECRET_FIELD = /(?:^|[_-])(?:secret|secrets|password|passwd|token|tokens|api[_-]?key|credential|credentials|private[_-]?key|connection[_-]?string)(?:$|[_-])/i
const CALLER_DERIVED_FIELD = /^(?:latency|latency_ms|duration|duration_ms|elapsed|elapsed_ms)$/i
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

class ShadowOutcomeEvidenceError extends Error {
  constructor(detail) {
    super(`FABRIC_SHADOW_OUTCOME_EVIDENCE_INVALID: ${detail}`)
    this.name = "ShadowOutcomeEvidenceError"
  }
}

function fail(detail) {
  throw new ShadowOutcomeEvidenceError(detail)
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

function timestamp(value, label) {
  if (typeof value !== "string") fail(`${label} must be an explicit UTC timestamp`)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/.exec(value)
  if (!match) {
    fail(`${label} must be an explicit UTC timestamp`)
  }
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

function normalizeTimestamp(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : ""
}

function rejectUnsafeInput(value, location = "artifact") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectUnsafeInput(entry, `${location}[${index}]`))
    return
  }
  if (typeof value === "string") {
    if (SECRET_VALUES.some((pattern) => pattern.test(value))) fail(`${location} contains secret-like material`)
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_FIELD.test(key)) fail(`${location}.${key} is an executable field`)
    if (SECRET_FIELD.test(key) || /^authorization$/i.test(key)) fail(`${location}.${key} is a secret-like field`)
    if (CALLER_DERIVED_FIELD.test(key)) fail(`${location}.${key} is caller-authored derived timing`)
    rejectUnsafeInput(child, `${location}.${key}`)
  }
}

function validateDigest(value) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("expected SHA-256 must be lowercase hex")
}

function parseCanonicalArtifact(artifactBytes, expectedSha256) {
  if (!Buffer.isBuffer(artifactBytes) || artifactBytes.length === 0) fail("artifact bytes must be a non-empty Buffer")
  validateDigest(expectedSha256)
  const actualSha256 = crypto.createHash("sha256").update(artifactBytes).digest("hex")
  if (actualSha256 !== expectedSha256) fail("artifact bytes do not match expected SHA-256")

  if (artifactBytes.length >= 3 && artifactBytes[0] === 0xef
    && artifactBytes[1] === 0xbb && artifactBytes[2] === 0xbf) {
    fail("artifact bytes must not contain a UTF-8 BOM")
  }
  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes)
  } catch {
    fail("artifact bytes must be valid UTF-8")
  }

  let artifact
  try {
    artifact = JSON.parse(text)
  } catch (error) {
    fail(`artifact bytes are not valid JSON: ${error.message}`)
  }
  let canonicalBytes
  try {
    canonicalBytes = Buffer.from(`${canonicalizeJcs(artifact)}\n`, "utf8")
  } catch (error) {
    fail(`artifact cannot be canonically encoded: ${error.message}`)
  }
  if (!artifactBytes.equals(canonicalBytes)) fail("artifact bytes must be exact canonical JSON followed by one newline")
  return { artifact, actualSha256 }
}

function validateResourceObservations(resources, startedAt, completedAt) {
  if (!Array.isArray(resources) || resources.length === 0 || resources.length > 64) {
    fail("resource_observations must contain between 1 and 64 entries")
  }
  const seen = new Set()
  let previousKey = null
  return resources.map((entry, index) => {
    exactKeys(entry, ["metric", "observed_at", "unit", "value"], `resource_observations[${index}]`)
    const metric = identifier(entry.metric, `resource_observations[${index}].metric`)
    const requiredUnit = RESOURCE_UNITS.get(metric)
    if (!requiredUnit) fail(`${metric}: unsupported resource metric`)
    if (entry.unit !== requiredUnit) fail(`${metric}: unit must be ${requiredUnit}`)
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value) || entry.value < 0) {
      fail(`${metric}: value must be a finite non-negative number`)
    }
    if (requiredUnit === "percent" && entry.value > 100) fail(`${metric}: percent value must not exceed 100`)
    if (requiredUnit === "count" && !Number.isSafeInteger(entry.value)) fail(`${metric}: count value must be an integer`)
    if (requiredUnit === "bytes" && !Number.isSafeInteger(entry.value)) fail(`${metric}: byte value must be a safe integer`)
    const observedAt = timestamp(entry.observed_at, `resource_observations[${index}].observed_at`)
    if (observedAt < startedAt || observedAt > completedAt) fail(`${metric}: observation is outside outcome chronology`)
    const key = `${metric}\u0000${entry.observed_at}`
    if (seen.has(key)) fail(`${metric}: duplicate resource observation timestamp`)
    seen.add(key)
    if (previousKey !== null && key <= previousKey) fail("resource_observations must be sorted by metric and observed_at")
    previousKey = key
    return { ...entry }
  })
}

export function validateShadowOutcomeEvidence({ artifactBytes, expectedSha256 }) {
  const { artifact, actualSha256 } = parseCanonicalArtifact(artifactBytes, expectedSha256)
  rejectUnsafeInput(artifact)
  exactKeys(artifact, [
    "actual_target_node", "authority_outcome", "completed_at", "resource_observations",
    "result", "schema_version", "started_at", "status", "work_order_id",
  ], "artifact")
  if (!new Set(["0.1-shadow-outcome-evidence", "0.2-shadow-outcome-evidence"]).has(artifact.schema_version)) {
    fail("artifact schema_version is unsupported")
  }
  const scoped = artifact.schema_version === "0.2-shadow-outcome-evidence"
  const workOrderId = identifier(artifact.work_order_id, "artifact.work_order_id")
  const actualTargetNode = identifier(artifact.actual_target_node, "artifact.actual_target_node")
  if (!OUTCOME_PAIRS.has(artifact.status)) fail("artifact.status is unsupported")
  if (OUTCOME_PAIRS.get(artifact.status) !== artifact.result) fail("artifact status/result pair is inconsistent")

  const startedAt = timestamp(artifact.started_at, "artifact.started_at")
  const completedAt = timestamp(artifact.completed_at, "artifact.completed_at")
  if (completedAt < startedAt) fail("artifact completion precedes start")
  const latencyMs = completedAt - startedAt
  if (!Number.isSafeInteger(latencyMs)) fail("derived latency is outside the safe integer range")

  exactKeys(artifact.authority_outcome, scoped
    ? ["activation_commit", "checked_at", "reference", "scope_sha256", "status"]
    : ["checked_at", "reference", "status"], "artifact.authority_outcome")
  if (artifact.authority_outcome.status !== "COMPLIANT") fail("authority outcome is not COMPLIANT")
  const authorityReference = identifier(artifact.authority_outcome.reference, "artifact.authority_outcome.reference")
  const authorityScopeSha256 = scoped ? artifact.authority_outcome.scope_sha256 : null
  if (scoped && (typeof authorityScopeSha256 !== "string" || !SHA256.test(authorityScopeSha256))) {
    fail("artifact.authority_outcome.scope_sha256 must be lowercase SHA-256 hex")
  }
  const authorityActivationCommit = scoped ? artifact.authority_outcome.activation_commit : null
  if (scoped && (typeof authorityActivationCommit !== "string" || !GIT_SHA.test(authorityActivationCommit))) {
    fail("artifact.authority_outcome.activation_commit must be a lowercase Git commit")
  }
  const authorityCheckedAt = timestamp(artifact.authority_outcome.checked_at, "artifact.authority_outcome.checked_at")
  if (authorityCheckedAt < startedAt || authorityCheckedAt > completedAt) {
    fail("authority outcome timestamp is outside outcome chronology")
  }

  const resourceObservations = validateResourceObservations(
    artifact.resource_observations,
    startedAt,
    completedAt,
  )
  return {
    schema_version: scoped ? "0.2-shadow-outcome-evidence-validation" : "0.1-shadow-outcome-evidence-validation",
    status: "VALID",
    observation_only: true,
    artifact_sha256: actualSha256,
    work_order_id: workOrderId,
    actual_target_node: actualTargetNode,
    outcome: { status: artifact.status, result: artifact.result },
    chronology: {
      started_at: normalizeTimestamp(artifact.started_at),
      completed_at: normalizeTimestamp(artifact.completed_at),
      latency_ms: latencyMs,
    },
    authority_outcome: {
      status: "COMPLIANT",
      reference: authorityReference,
      checked_at: normalizeTimestamp(artifact.authority_outcome.checked_at),
      ...(scoped ? {
        scope_sha256: authorityScopeSha256,
        activation_commit: authorityActivationCommit,
      } : {}),
    },
    resource_observations: resourceObservations,
    dispatch_allowed: false,
    execution_authorized: false,
    remote_systems_modified: false,
    shell_executed: false,
  }
}

function rejected(error) {
  return {
    schema_version: "0.1-shadow-outcome-evidence-validation",
    status: "INPUT_REJECTED",
    observation_only: true,
    error: {
      code: "FABRIC_SHADOW_OUTCOME_EVIDENCE_INVALID",
      detail: String(error?.message ?? error),
    },
    dispatch_allowed: false,
    execution_authorized: false,
    remote_systems_modified: false,
    shell_executed: false,
  }
}

function parseArguments(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) fail("arguments must use --name value pairs")
    const name = key.slice(2)
    if (!new Set(["artifact", "sha256"]).has(name)) fail(`unknown --${name}`)
    if (Object.hasOwn(parsed, name)) fail(`duplicate --${name}`)
    parsed[name] = value
  }
  if (!parsed.artifact) fail("--artifact is required")
  if (!parsed.sha256) fail("--sha256 is required")
  return parsed
}

export function runShadowOutcomeEvidenceCli(argv) {
  try {
    const args = parseArguments(argv)
    return validateShadowOutcomeEvidence({
      artifactBytes: fs.readFileSync(path.resolve(args.artifact)),
      expectedSha256: args.sha256,
    })
  } catch (error) {
    if (error instanceof ShadowOutcomeEvidenceError || error?.code === "ENOENT" || error?.code === "EACCES") {
      return rejected(error)
    }
    throw error
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const result = runShadowOutcomeEvidenceCli(process.argv.slice(2))
  const stream = result.status === "INPUT_REJECTED" ? process.stderr : process.stdout
  stream.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status === "INPUT_REJECTED") process.exitCode = EXIT_INVALID
}
