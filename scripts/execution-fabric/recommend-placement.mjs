import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const EXIT_INVALID = 2
const OBSERVED_CONFIDENCE = new Set(["observed", "proven"])
const HEALTHY_RUNTIME_STATES = new Set(["healthy", "running"])

function fail(message) {
  throw new Error(`FABRIC_PLACEMENT_INVALID: ${message}`)
}

function inputRejected(error) {
  const detail = String(error?.message ?? error).replace(/^FABRIC_PLACEMENT_INVALID:\s*/, "")
  return {
    schema_version: "0.1-placement-recommendation",
    status: "INPUT_REJECTED",
    recommendation_only: true,
    eligibility_scope: "recommendation-only",
    recommendation: null,
    eligible_nodes: [],
    ineligible_nodes: [],
    error: { code: "FABRIC_PLACEMENT_INVALID", detail },
    authority_mutated: false,
    remote_systems_modified: false,
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value, expected, label) {
  if (!isObject(value)) fail(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} must contain exactly: ${wanted.join(", ")}`)
}

function typeMatches(value, expected) {
  if (expected === "null") return value === null
  if (expected === "array") return Array.isArray(value)
  if (expected === "object") return isObject(value)
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value)
  if (expected === "number") return typeof value === "number" && Number.isFinite(value)
  return typeof value === expected
}

function isUtcDateTime(value) {
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

function isRfc3339DateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText == null ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText == null ? 0 : Number(offsetMinuteText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  const parseableValue = second === 60
    ? value.replace(/:(?:60)(?=(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$)/, ":59")
    : value
  return day >= 1 && day <= daysInMonth && Number.isFinite(Date.parse(parseableValue))
}

function validateSchema(value, rawRule, schema, location = "$") {
  const errors = []
  let rule = rawRule
  if (typeof rule?.$ref === "string") {
    const match = /^#\/\$defs\/(.+)$/.exec(rule.$ref)
    if (!match || !schema.$defs?.[match[1]]) return [`${location}: unresolved schema reference ${rule.$ref}`]
    rule = schema.$defs[match[1]]
  }
  if (Array.isArray(rule?.oneOf)) {
    const matches = rule.oneOf.filter((candidate) => validateSchema(value, candidate, schema, location).length === 0)
    return matches.length === 1 ? [] : [`${location}: expected exactly one oneOf schema match`]
  }
  if (Object.hasOwn(rule, "const") && value !== rule.const) errors.push(`${location}: const mismatch`)
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) errors.push(`${location}: value is not in enum`)
  const expectedTypes = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : []
  if (expectedTypes.length && !expectedTypes.some((expected) => typeMatches(value, expected))) {
    return [`${location}: expected ${expectedTypes.join("|")}`]
  }
  if (typeof value === "string") {
    if (Number.isInteger(rule.minLength) && value.length < rule.minLength) errors.push(`${location}: shorter than minLength`)
    if (typeof rule.pattern === "string" && !new RegExp(rule.pattern).test(value)) errors.push(`${location}: pattern mismatch`)
    if (rule.format === "date-time" && !isRfc3339DateTime(value)) errors.push(`${location}: invalid RFC 3339 date-time`)
  }
  if (typeof value === "number") {
    if (typeof rule.minimum === "number" && value < rule.minimum) errors.push(`${location}: below minimum`)
    if (typeof rule.maximum === "number" && value > rule.maximum) errors.push(`${location}: above maximum`)
  }
  if (Array.isArray(value) && rule.items) {
    value.forEach((item, index) => errors.push(...validateSchema(item, rule.items, schema, `${location}[${index}]`)))
  }
  if (isObject(value)) {
    const properties = rule.properties ?? {}
    for (const required of rule.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}: missing required ${required}`)
    }
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${location}: additional property ${key}`)
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) errors.push(...validateSchema(child, properties[key], schema, `${location}.${key}`))
    }
  }
  return errors
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    fail(`${label} must be an array of non-empty strings`)
  }
  if (new Set(value).size !== value.length) fail(`${label} contains duplicate entries`)
  return value
}

function finiteNonNegative(value, label, nullable = false) {
  if (nullable && value === null) return null
  if (!Number.isFinite(value) || value < 0) fail(`${label} must be a non-negative number`)
  return value
}

function validateWorkload(workload) {
  if (!isObject(workload) || typeof workload.id !== "string" || workload.id.trim() === "") {
    fail("workload id is required")
  }
  const requirements = workload.requirements
  const preferences = workload.preferences
  if (!isObject(requirements) || !isObject(preferences)) fail(`${workload.id}: requirements and preferences are required`)
  exactKeys(workload, ["id", "title", "description", "requirements", "preferences", "storage_semantics"], workload.id)
  if (typeof workload.title !== "string" || workload.title.trim() === "") fail(`${workload.id}.title must be a non-empty string`)
  if (typeof workload.description !== "string" || workload.description.trim() === "") fail(`${workload.id}.description must be a non-empty string`)
  exactKeys(requirements, [
    "capabilities_all", "health_axes_all", "authority_all", "runtimes_all", "minimum_cpu_threads",
    "minimum_gpu_vram_bytes", "excluded_authority", "observed_evidence_required", "fresh_evidence_required",
  ], `${workload.id}.requirements`)
  exactKeys(preferences, ["capabilities", "availability_order", "higher_cpu_threads", "higher_gpu_vram"], `${workload.id}.preferences`)

  for (const field of ["capabilities_all", "health_axes_all", "authority_all", "excluded_authority"]) {
    stringArray(requirements[field], `${workload.id}.requirements.${field}`)
  }
  const excludedAuthority = new Set(requirements.excluded_authority)
  const authorityContradiction = requirements.authority_all.find((entry) => excludedAuthority.has(entry))
  if (authorityContradiction) fail(`${workload.id}: authority is both required and excluded: ${authorityContradiction}`)
  stringArray(preferences.capabilities, `${workload.id}.preferences.capabilities`)
  stringArray(preferences.availability_order, `${workload.id}.preferences.availability_order`)
  finiteNonNegative(requirements.minimum_cpu_threads, `${workload.id}.requirements.minimum_cpu_threads`, true)
  finiteNonNegative(requirements.minimum_gpu_vram_bytes, `${workload.id}.requirements.minimum_gpu_vram_bytes`, true)
  if (typeof requirements.observed_evidence_required !== "boolean" || typeof requirements.fresh_evidence_required !== "boolean") {
    fail(`${workload.id}: evidence requirements must be boolean`)
  }
  if (!Array.isArray(requirements.runtimes_all)) fail(`${workload.id}.requirements.runtimes_all must be an array`)
  for (const [index, runtime] of requirements.runtimes_all.entries()) {
    if (!isObject(runtime) || typeof runtime.kind !== "string" || runtime.kind.trim() === "") {
      fail(`${workload.id}.requirements.runtimes_all[${index}] is invalid`)
    }
    exactKeys(runtime, ["kind", "states"], `${workload.id}.requirements.runtimes_all[${index}]`)
    stringArray(runtime.states, `${workload.id}.requirements.runtimes_all[${index}].states`)
    if (runtime.states.some((state) => !HEALTHY_RUNTIME_STATES.has(state))) {
      fail(`${workload.id}: runtime states may only be healthy or running`)
    }
  }
  if (!["scratch-only", "authoritative-state", "none"].includes(workload.storage_semantics)) {
    fail(`${workload.id}: unsupported storage_semantics`)
  }
  for (const field of ["higher_cpu_threads", "higher_gpu_vram"]) {
    if (typeof preferences[field] !== "boolean") fail(`${workload.id}.preferences.${field} must be boolean`)
  }
  return workload
}

function validateRegistry(registry, schema) {
  if (!isObject(registry) || !Array.isArray(registry.nodes) || !isObject(registry.scheduler)) {
    fail("registry must contain nodes and scheduler")
  }
  if (!isObject(schema)) fail("registry schema is required")
  if (registry.scheduler.state !== "disabled" || registry.scheduler.authority !== "not-granted") {
    fail("scheduler must remain disabled with authority not-granted")
  }
  const schemaErrors = validateSchema(registry, schema, schema)
  if (schemaErrors.length > 0) fail(`registry schema: ${schemaErrors[0]}`)
  const ids = new Set()
  for (const node of registry.nodes) {
    if (!isObject(node) || typeof node.id !== "string" || node.id.trim() === "") fail("every node requires an id")
    if (ids.has(node.id)) fail(`duplicate node id: ${node.id}`)
    ids.add(node.id)
    for (const field of ["capabilities", "cpus", "gpus", "runtimes"]) {
      if (!Array.isArray(node[field])) fail(`${node.id}: ${field} must be an array`)
    }
    if (node.constraints === undefined) node.constraints = []
    else if (!Array.isArray(node.constraints)) fail(`${node.id}: constraints must be an array`)
    if (!isObject(node.authority) || !isObject(node.evidence)) fail(`${node.id}: authority and evidence are required`)
    stringArray(node.authority.allow, `${node.id}.authority.allow`)
    stringArray(node.authority.deny, `${node.id}.authority.deny`)
    const denied = new Set(node.authority.deny)
    const conflict = node.authority.allow.find((entry) => denied.has(entry))
    if (conflict) fail(`${node.id}: authority conflict for ${conflict}`)
    stringArray(node.capabilities, `${node.id}.capabilities`)
    stringArray(node.constraints, `${node.id}.constraints`)
    const resourceIdentityFields = {
      cpus: "id",
      dimms: "locator",
      gpus: "id",
      disks: "id",
      network: "id",
      runtimes: "id",
    }
    for (const [collection, identityField] of Object.entries(resourceIdentityFields)) {
      const resourceIds = new Set()
      for (const resource of node[collection]) {
        const resourceId = resource[identityField]
        if (resourceIds.has(resourceId)) fail(`${node.id}: duplicate ${collection} resource ${identityField}: ${resourceId}`)
        resourceIds.add(resourceId)
      }
    }
  }
  return registry
}

function validateCatalog(catalog) {
  exactKeys(catalog, ["schema_version", "recommendation_only", "workloads"], "workload catalog")
  if (catalog.schema_version !== "0.1-placement-workloads" || catalog.recommendation_only !== true || !Array.isArray(catalog.workloads)) {
    fail("workload catalog contract is invalid")
  }
  const ids = new Set()
  for (const workload of catalog.workloads) {
    validateWorkload(workload)
    if (ids.has(workload.id)) fail(`duplicate workload id: ${workload.id}`)
    ids.add(workload.id)
  }
  return catalog
}

function freshness(evidence, evaluatedAt) {
  const observedAt = Date.parse(evidence.observed_at)
  const ttlSeconds = evidence.ttl_seconds
  if (!Number.isFinite(observedAt) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return { state: "insufficient", age_seconds: null, ttl_seconds: Number.isFinite(ttlSeconds) ? ttlSeconds : null, expires_at: null }
  }
  const ageSeconds = (evaluatedAt.getTime() - observedAt) / 1000
  if (ageSeconds < 0) return { state: "future", age_seconds: ageSeconds, ttl_seconds: ttlSeconds, expires_at: new Date(observedAt + ttlSeconds * 1000).toISOString() }
  return {
    state: ageSeconds <= ttlSeconds ? "fresh" : "stale",
    age_seconds: Math.round(ageSeconds * 1000) / 1000,
    ttl_seconds: ttlSeconds,
    expires_at: new Date(observedAt + ttlSeconds * 1000).toISOString(),
  }
}

function totalCpuThreads(node) {
  if (node.cpus.length === 0 || node.cpus.some((cpu) => !Number.isFinite(cpu.threads))) return null
  return node.cpus.reduce((sum, cpu) => sum + cpu.threads, 0)
}

function maximumGpuVram(node) {
  const known = node.gpus.map((gpu) => gpu.vram_bytes).filter(Number.isFinite)
  return known.length === 0 ? null : Math.max(...known)
}

function evidenceRef(pathName, value) {
  return { path: pathName, value }
}

function reason(code, detail, required, observed, evidenceRefPaths) {
  return { code, detail, required, observed, evidence_ref: evidenceRefPaths }
}

function compareText(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

const CAPABILITY_HEALTH_AXES = new Map([
  ["backup-target", "backup_target"],
  ["archive-storage", "archive_storage"],
])

function capabilityHealthReason(node, capability, evaluatedAt) {
  const axisName = CAPABILITY_HEALTH_AXES.get(capability)
  if (!axisName) return null
  const axis = node.capability_health?.[axisName]
  const evidencePath = `nodes.${node.id}.capability_health.${axisName}`
  if (!isObject(axis)) {
    return reason("CAPABILITY_HEALTH_REQUIRED", capability, "READY", null, [evidencePath])
  }
  if (axis.state !== "READY") {
    return reason("CAPABILITY_NOT_READY", capability, "READY", axis.state, [`${evidencePath}.state`, `${evidencePath}.reason`])
  }
  const expiresAt = Date.parse(axis.expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= evaluatedAt.getTime()) {
    return reason("CAPABILITY_EVIDENCE_STALE", capability, "unexpired", axis.expires_at, [`${evidencePath}.expires_at`])
  }
  return null
}

function evaluateNode(node, workload, evaluatedAt) {
  const requirements = workload.requirements
  const preferences = workload.preferences
  const allow = new Set(node.authority.allow)
  const deny = new Set(node.authority.deny)
  const capabilities = new Set(node.capabilities)
  const nodeFreshness = freshness(node.evidence, evaluatedAt)
  const reasons = []
  const evidenceUsed = [
    evidenceRef(`nodes.${node.id}.evidence.confidence`, node.evidence.confidence),
    evidenceRef(`nodes.${node.id}.evidence.observed_at`, node.evidence.observed_at),
    evidenceRef(`nodes.${node.id}.evidence.ttl_seconds`, node.evidence.ttl_seconds),
    evidenceRef(`nodes.${node.id}.evidence.probe`, node.evidence.probe),
    evidenceRef(`nodes.${node.id}.evidence.probe_version`, node.evidence.probe_version),
    evidenceRef(`nodes.${node.id}.availability_class`, node.availability_class),
    evidenceRef(`nodes.${node.id}.constraints`, node.constraints),
    evidenceRef(`workload.storage_semantics`, workload.storage_semantics),
  ]

  if (requirements.observed_evidence_required && !OBSERVED_CONFIDENCE.has(node.evidence.confidence)) {
    reasons.push(reason(
      "OBSERVED_EVIDENCE_REQUIRED",
      `confidence is ${String(node.evidence.confidence)}`,
      ["observed", "proven"],
      node.evidence.confidence,
      [`nodes.${node.id}.evidence.confidence`],
    ))
  }
  if (requirements.fresh_evidence_required && nodeFreshness.state !== "fresh") {
    reasons.push(reason(
      nodeFreshness.state === "stale" ? "EVIDENCE_STALE" : "EVIDENCE_TTL_REQUIRED",
      `freshness is ${nodeFreshness.state}`,
      "fresh",
      nodeFreshness.state,
      [`nodes.${node.id}.evidence.observed_at`, `nodes.${node.id}.evidence.ttl_seconds`],
    ))
  }

  for (const capability of requirements.capabilities_all) {
    if (!capabilities.has(capability)) reasons.push(reason(
      "CAPABILITY_REQUIRED", capability, true, false, [`nodes.${node.id}.capabilities.${capability}`],
    ))
    evidenceUsed.push(evidenceRef(`nodes.${node.id}.capabilities.${capability}`, capabilities.has(capability)))
    const healthReason = capabilityHealthReason(node, capability, evaluatedAt)
    if (capabilities.has(capability) && healthReason) reasons.push(healthReason)
    const axisName = CAPABILITY_HEALTH_AXES.get(capability)
    if (axisName) evidenceUsed.push(evidenceRef(
      `nodes.${node.id}.capability_health.${axisName}`,
      node.capability_health?.[axisName] ?? null,
    ))
  }
  for (const axisName of requirements.health_axes_all) {
    const axis = node.capability_health?.[axisName]
    const evidencePath = `nodes.${node.id}.capability_health.${axisName}`
    if (!isObject(axis)) reasons.push(reason("CAPABILITY_HEALTH_REQUIRED", axisName, "READY", null, [evidencePath]))
    else if (axis.state !== "READY") reasons.push(reason(
      "CAPABILITY_NOT_READY", axisName, "READY", axis.state, [`${evidencePath}.state`, `${evidencePath}.reason`],
    ))
    else {
      const expiresAt = Date.parse(axis.expires_at)
      if (!Number.isFinite(expiresAt) || expiresAt <= evaluatedAt.getTime()) reasons.push(reason(
        "CAPABILITY_EVIDENCE_STALE", axisName, "unexpired", axis.expires_at, [`${evidencePath}.expires_at`],
      ))
    }
    evidenceUsed.push(evidenceRef(evidencePath, axis ?? null))
  }
  for (const authority of requirements.authority_all) {
    if (!allow.has(authority)) reasons.push(reason(
      "AUTHORITY_REQUIRED", authority, true, false, [`nodes.${node.id}.authority.allow.${authority}`],
    ))
    evidenceUsed.push(evidenceRef(`nodes.${node.id}.authority.allow.${authority}`, allow.has(authority)))
    if (deny.has(authority)) reasons.push(reason(
      "AUTHORITY_DENIED", authority, false, true, [`nodes.${node.id}.authority.deny.${authority}`],
    ))
    evidenceUsed.push(evidenceRef(`nodes.${node.id}.authority.deny.${authority}`, deny.has(authority)))
  }
  for (const authority of requirements.excluded_authority) {
    if (allow.has(authority)) reasons.push(reason(
      "AUTHORITY_EXCLUDED", authority, false, true, [`nodes.${node.id}.authority.allow.${authority}`],
    ))
    evidenceUsed.push(evidenceRef(`nodes.${node.id}.authority.allow.${authority}`, allow.has(authority)))
  }

  const cpuThreads = totalCpuThreads(node)
  const gpuVram = maximumGpuVram(node)
  evidenceUsed.push(evidenceRef(`nodes.${node.id}.resources.cpu_threads`, cpuThreads))
  evidenceUsed.push(evidenceRef(`nodes.${node.id}.resources.maximum_gpu_vram_bytes`, gpuVram))
  if (requirements.minimum_cpu_threads !== null && cpuThreads === null) {
    reasons.push(reason(
      "CPU_THREADS_UNKNOWN", "CPU thread inventory is unavailable", requirements.minimum_cpu_threads, null,
      [`nodes.${node.id}.resources.cpu_threads`],
    ))
  } else if (requirements.minimum_cpu_threads !== null && cpuThreads < requirements.minimum_cpu_threads) {
    reasons.push(reason(
      "CPU_THREADS_INSUFFICIENT", `${cpuThreads} < ${requirements.minimum_cpu_threads}`,
      requirements.minimum_cpu_threads, cpuThreads, [`nodes.${node.id}.resources.cpu_threads`],
    ))
  }
  if (requirements.minimum_gpu_vram_bytes !== null && gpuVram === null) {
    reasons.push(reason(
      "GPU_VRAM_UNKNOWN", "GPU VRAM inventory is unavailable", requirements.minimum_gpu_vram_bytes, null,
      [`nodes.${node.id}.resources.maximum_gpu_vram_bytes`],
    ))
  } else if (requirements.minimum_gpu_vram_bytes !== null && gpuVram < requirements.minimum_gpu_vram_bytes) {
    reasons.push(reason(
      "GPU_VRAM_INSUFFICIENT", `${gpuVram} < ${requirements.minimum_gpu_vram_bytes}`,
      requirements.minimum_gpu_vram_bytes, gpuVram, [`nodes.${node.id}.resources.maximum_gpu_vram_bytes`],
    ))
  }

  for (const runtimeRequirement of requirements.runtimes_all) {
    const matching = node.runtimes.filter((runtime) => runtime.kind === runtimeRequirement.kind)
    const satisfied = matching.some((runtime) => runtimeRequirement.states.includes(runtime.state))
    const observedStates = matching.map((runtime) => runtime.state)
    if (matching.length === 0) reasons.push(reason(
      "RUNTIME_REQUIRED", runtimeRequirement.kind, runtimeRequirement.states, [],
      [`nodes.${node.id}.runtimes.${runtimeRequirement.kind}`],
    ))
    else if (!satisfied) reasons.push(reason(
      "RUNTIME_STATE_INELIGIBLE", runtimeRequirement.kind, runtimeRequirement.states, observedStates,
      [`nodes.${node.id}.runtimes.${runtimeRequirement.kind}`],
    ))
    evidenceUsed.push(evidenceRef(
      `nodes.${node.id}.runtimes.${runtimeRequirement.kind}`,
      matching.map((runtime) => ({ id: runtime.id, state: runtime.state })),
    ))
  }

  if (workload.storage_semantics === "authoritative-state" && !allow.has("authoritative-durable-state")) {
    reasons.push(reason(
      "STORAGE_SEMANTICS_INELIGIBLE", "authoritative-durable-state", true, false,
      [`nodes.${node.id}.authority.allow.authoritative-durable-state`, "workload.storage_semantics"],
    ))
    evidenceUsed.push(evidenceRef(
      `nodes.${node.id}.authority.allow.authoritative-durable-state`,
      allow.has("authoritative-durable-state"),
    ))
  }
  if (workload.storage_semantics === "scratch-only" && allow.has("authoritative-durable-state")) {
    reasons.push(reason(
      "STORAGE_SEMANTICS_INELIGIBLE", "scratch-only excludes authoritative durable-state nodes", false, true,
      [`nodes.${node.id}.authority.allow.authoritative-durable-state`, "workload.storage_semantics"],
    ))
  }

  const eligible = reasons.length === 0
  let rankBasis = null
  if (eligible) {
    for (const capability of preferences.capabilities) {
      evidenceUsed.push(evidenceRef(`nodes.${node.id}.capabilities.${capability}`, capabilities.has(capability)))
    }
    const availabilityIndex = preferences.availability_order.indexOf(node.availability_class)
    rankBasis = {
      preferred_capability_count: preferences.capabilities.filter((entry) => capabilities.has(entry)).length,
      availability_index: availabilityIndex >= 0 ? availabilityIndex : Number.MAX_SAFE_INTEGER,
      cpu_threads: preferences.higher_cpu_threads ? (cpuThreads ?? 0) : null,
      maximum_gpu_vram_bytes: preferences.higher_gpu_vram ? (gpuVram ?? 0) : null,
      stable_node_id: node.id,
    }
  }

  return {
    node_id: node.id,
    eligible,
    rank: null,
    rank_basis: rankBasis,
    reasons: reasons.sort((left, right) => compareText(left.code, right.code) || compareText(left.detail, right.detail)),
    evidence_used: evidenceUsed,
    confidence: node.evidence.confidence,
    freshness: nodeFreshness,
    execution_authorized: false,
    dispatch_allowed: false,
    authority_note: "Recommendation eligibility does not grant node or scheduler authority.",
  }
}

function compareEligible(left, right) {
  const leftBasis = left.rank_basis
  const rightBasis = right.rank_basis
  return rightBasis.preferred_capability_count - leftBasis.preferred_capability_count
    || leftBasis.availability_index - rightBasis.availability_index
    || (rightBasis.cpu_threads ?? 0) - (leftBasis.cpu_threads ?? 0)
    || (rightBasis.maximum_gpu_vram_bytes ?? 0) - (leftBasis.maximum_gpu_vram_bytes ?? 0)
    || compareText(left.node_id, right.node_id)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function evaluatePlacementOrThrow(registryInput, workloadInput, options = {}) {
  const registry = validateRegistry(structuredClone(registryInput), options.schema)
  const workload = validateWorkload(structuredClone(workloadInput))
  if (typeof options.evaluatedAt !== "string" || !isUtcDateTime(options.evaluatedAt)) {
    fail("evaluated_at must be an explicit UTC timestamp")
  }
  const evaluatedAt = new Date(options.evaluatedAt)
  for (const node of registry.nodes) {
    const observedAt = Date.parse(node.evidence.observed_at)
    if (Number.isFinite(observedAt) && observedAt > evaluatedAt.getTime()) {
      fail(`${node.id}: observed evidence is future-dated at evaluated_at`)
    }
  }

  const results = registry.nodes.map((node) => evaluateNode(node, workload, evaluatedAt))
  const eligible = results.filter((result) => result.eligible).sort(compareEligible)
  eligible.forEach((result, index) => { result.rank = index + 1 })
  const ineligible = results.filter((result) => !result.eligible).sort((left, right) => compareText(left.node_id, right.node_id))
  const freshnessStates = new Set(results.map((result) => result.freshness.state))

  return {
    schema_version: "0.1-placement-recommendation",
    status: eligible.length > 0 ? "RECOMMENDED" : "NO_ELIGIBLE_NODE",
    recommendation_only: true,
    eligibility_scope: "recommendation-only",
    evaluated_at: evaluatedAt.toISOString(),
    workload: { id: workload.id, title: workload.title, storage_semantics: workload.storage_semantics },
    scheduler: {
      state: registry.scheduler.state,
      authority: registry.scheduler.authority,
      autonomous_dispatch: "forbidden",
    },
    workload_digest_sha256: crypto.createHash("sha256").update(canonicalJson(workload)).digest("hex").toUpperCase(),
    recommendation: eligible.length > 0 ? {
      node_id: eligible[0].node_id,
      rank: eligible[0].rank,
      rank_basis: eligible[0].rank_basis,
      execution_authorized: false,
      dispatch_allowed: false,
    } : null,
    eligible_nodes: eligible,
    ineligible_nodes: ineligible,
    confidence: {
      state: eligible.length === 0 ? "insufficient" : eligible[0].confidence,
      freshness: eligible.length === 0 ? "insufficient" : eligible[0].freshness.state,
      registry_freshness: freshnessStates.size === 1 ? [...freshnessStates][0] : "mixed",
    },
    authority_mutated: false,
    remote_systems_modified: false,
  }
}

export function evaluatePlacement(registryInput, workloadInput, options = {}) {
  try {
    return evaluatePlacementOrThrow(registryInput, workloadInput, options)
  } catch (error) {
    if (String(error?.message ?? error).startsWith("FABRIC_PLACEMENT_INVALID:")) return inputRejected(error)
    throw error
  }
}

function parseArguments(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) fail("arguments must use --name value pairs")
    parsed[key.slice(2)] = value
  }
  for (const required of ["snapshot", "schema", "workloads", "workload", "expected-snapshot-sha256", "at"]) {
    if (!parsed[required]) fail(`--${required} is required`)
  }
  return parsed
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    fail(`unable to read ${label}: ${error.message}`)
  }
}

function runCliOrThrow(argv) {
  const args = parseArguments(argv)
  const snapshotPath = path.resolve(args.snapshot)
  let snapshotBytes
  try {
    snapshotBytes = fs.readFileSync(snapshotPath)
  } catch (error) {
    fail(`unable to read snapshot: ${error.message}`)
  }
  const actualDigest = crypto.createHash("sha256").update(snapshotBytes).digest("hex").toUpperCase()
  const expectedDigest = args["expected-snapshot-sha256"].trim().toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(expectedDigest)) fail("expected snapshot digest must be SHA-256 hex")
  if (actualDigest !== expectedDigest) fail(`snapshot digest mismatch: expected ${expectedDigest}, received ${actualDigest}`)

  let registry
  try {
    registry = JSON.parse(snapshotBytes.toString("utf8"))
  } catch (error) {
    fail(`unable to parse snapshot: ${error.message}`)
  }
  const catalog = readJson(path.resolve(args.workloads), "workload catalog")
  validateCatalog(catalog)
  const workload = catalog.workloads.find((candidate) => candidate.id === args.workload)
  if (!workload) fail(`workload not found: ${args.workload}`)
  const schema = readJson(path.resolve(args.schema), "registry schema")
  const result = evaluatePlacement(registry, workload, { evaluatedAt: args.at, schema })
  result.snapshot = { path: snapshotPath, sha256: actualDigest }
  result.catalog_schema_version = catalog.schema_version
  return result
}

export function runCli(argv) {
  try {
    return runCliOrThrow(argv)
  } catch (error) {
    if (String(error?.message ?? error).startsWith("FABRIC_PLACEMENT_INVALID:")) return inputRejected(error)
    throw error
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const result = runCli(process.argv.slice(2))
  if (result.status === "INPUT_REJECTED") {
    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = EXIT_INVALID
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
}
