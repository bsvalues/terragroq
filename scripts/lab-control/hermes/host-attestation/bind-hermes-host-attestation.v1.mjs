#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const SCHEMA = "hermes-host-attestation/1"
export const COLLECTOR_SCHEMA = "hermes-host-attestation-source/1"
export const CANONICALIZATION = "recursive-key-sort-json/1"
export const TRUTH_STATES = Object.freeze(["OBSERVED", "UNKNOWN", "CONFLICTING", "STALE"])
export const PRIORITY_TYPES = Object.freeze([
  "HERMES_STORAGE_CRITICAL",
  "HERMES_DR_TARGET_UNHEALTHY",
  "HERMES_SECURITY_EXPOSURE_CRITICAL",
  "HERMES_INFERENCE_GOLDEN_DRIFT",
])

export const REQUIRED_FACT_IDS = Object.freeze([
  "os.identity",
  "os.updates",
  "os.licensing",
  "security.bitlocker",
  "security.boot",
  "security.defender",
  "security.firewallProfiles",
  "storage.physicalDisks",
  "storage.volumes",
  "storage.dockerDisk",
  "storage.topConsumers",
  "storage.growth",
  "operations.tasks",
  "operations.backups",
  "operations.heartbeats",
  "network.listeners",
  "network.firewallAdmissions",
  "network.addressing",
  "network.specialPortOwners",
  "inference.gpus",
  "inference.ollama",
  "inference.dockerContainers",
  "inference.guardBaseline",
  "dr.target",
])

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const SHA256 = /^[a-f0-9]{64}$/
export const FRESHNESS_BOUNDS = Object.freeze({ IDENTITY: 31536000, STATIC: 2592000, CONFIGURATION: 86400, STATE: 3600, VOLATILE: 300 })
const FRESHNESS_CLASSES = new Set(Object.keys(FRESHNESS_BOUNDS))
const SENSITIVE_KEY = /(?:password|passwd|secret|token|credential|private.?key|connection.?string|authorization|cookie)/i
const SENSITIVE_VALUE = /(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*(?!\[REDACTED\])\S+|\[REDACTED\]\s+\S+|(?:postgres(?:ql)?|mongodb(?:\+srv)?|redis|https?):\/\/[^/@\s:]+:[^/@\s]+@|-----BEGIN [^-]+PRIVATE KEY-----/i

const TRUSTED_NATIVE_PATHS = Object.freeze({
  docker: "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
  nvidiaSmi: "C:\\Windows\\System32\\nvidia-smi.exe",
  tailscale: "C:\\Program Files\\Tailscale\\tailscale.exe",
})

export const GOLDEN = Object.freeze({
  p40: { uuid: "GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2", driverVersion: "560.94", driverModel: "TCC", computeMode: "DEFAULT", powerLimitW: 150, defaultPowerLimitW: 250, eccMode: "ENABLED" },
  rtx3050: { uuid: "GPU-6d9ae165-7272-a38c-06b1-7276869e980f", role: "DISPLAY_CHASSIS_PROXY", driverModel: "WDDM" },
  ollama: {
    exe: "D:\\HermesServices\\ollama\\v0.9.2\\ollama.exe",
    exeSha256: "5a1eb0f073538ae609723b11e2efb92cedfa93f6925601cfe3963098e3786c7c",
    version: "0.9.2",
    bind: "127.0.0.1:11434",
    models: ["llama3.2:3b", "qwen2.5-coder:7b", "qwen3:4b-instruct", "snowflake-arctic-embed2:latest", "williamos-qwen3-4b:64k"],
    liveEnvironment: {
      CUDA_VISIBLE_DEVICES: "GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2",
      OLLAMA_LLM_LIBRARY: "cuda_v11",
      OLLAMA_NOPRUNE: "true",
    },
    configEnvironment: {
      OLLAMA_LLM_LIBRARY: "cuda_v11",
      OLLAMA_NOPRUNE: "1",
    },
    serviceScriptSha256: "179a917dca12fd498558872e9941581115a498786f24d89835f448454aa1054b",
    modelsPath: "D:\\HermesData\\ollama\\models",
    gpuUuid: "GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2",
  },
  containers: {
    "open-webui": { state: "running", restartPolicy: "unless-stopped" },
    portainer: { state: "running", restartPolicy: "unless-stopped" },
    postgres: { state: "running", restartPolicy: "unless-stopped" },
    redis: { state: "running", restartPolicy: "unless-stopped" },
    "williamos-hermes-inference-proxy": { state: "running", restartPolicy: "unless-stopped" },
  },
  guard: { p40EquilibriumC: 68, chassisDeltaC: 35, alertDeltaC: 41, startCeilingC: 80 },
})

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`)
  error.code = code
  throw error
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function windowsCommandTokens(value) {
  if (typeof value !== "string") return null
  const tokens = []
  let index = 0
  while (index < value.length) {
    while (index < value.length && /\s/.test(value[index])) index += 1
    if (index >= value.length) break
    if (value[index] === '"') {
      const end = value.indexOf('"', index + 1)
      if (end < 0) return null
      tokens.push(value.slice(index + 1, end))
      index = end + 1
      if (index < value.length && !/\s/.test(value[index])) return null
    } else {
      let end = index
      while (end < value.length && !/\s/.test(value[end])) {
        if (value[end] === '"') return null
        end += 1
      }
      tokens.push(value.slice(index, end))
      index = end
    }
  }
  return tokens
}

function normalizedWindowsToken(value) {
  return String(value).replaceAll("/", "\\").toLowerCase()
}

function exactPowerShellAction(action, expectedArguments) {
  if (!object(action) || typeof action.execute !== "string") return false
  const execute = normalizedWindowsToken(action.execute.trim())
  const acceptedExecutables = new Set([
    "powershell.exe",
    "c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe",
    "c:\\windows\\syswow64\\windowspowershell\\v1.0\\powershell.exe",
  ])
  if (!acceptedExecutables.has(execute)) return false
  const actual = windowsCommandTokens(action.arguments)
  return Array.isArray(actual)
    && actual.length === expectedArguments.length
    && actual.every((token, index) => normalizedWindowsToken(token) === normalizedWindowsToken(expectedArguments[index]))
}

function rootTaskPath(task) {
  return task.path === "\\"
}

function exactActiveTriggers(task, expected, observedAt) {
  if (!Array.isArray(task.triggers) || task.triggers.length !== expected.length) return false
  const observedAtMs = Date.parse(observedAt)
  if (!Number.isFinite(observedAtMs)) return false
  const remaining = [...task.triggers]
  for (const [type, repetitionInterval = undefined] of expected) {
    const match = remaining.findIndex((trigger) => {
      if (!object(trigger) || trigger.enabled !== true || String(trigger.type).toLowerCase() !== type.toLowerCase()) return false
      if (repetitionInterval === undefined) {
        if (trigger.repetitionInterval !== undefined && trigger.repetitionInterval !== null && String(trigger.repetitionInterval).trim() !== "") return false
      } else if (String(trigger.repetitionInterval).toUpperCase() !== repetitionInterval) return false
      const endBoundary = trigger.endBoundary === undefined || trigger.endBoundary === null ? "" : String(trigger.endBoundary).trim()
      return endBoundary === "" || (Number.isFinite(Date.parse(endBoundary)) && Date.parse(endBoundary) >= observedAtMs)
    })
    if (match < 0) return false
    remaining.splice(match, 1)
  }
  return remaining.length === 0
}

function exactKeys(value, expected, label) {
  if (!object(value)) fail("HERMES_ATTESTATION_INVALID", `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("HERMES_ATTESTATION_INVALID", `${label} keys must be exactly ${wanted.join(", ")}`)
  }
}

function normalizeCollectorFact(fact) {
  if (!object(fact.value) || !("__truth" in fact.value) && !("__value" in fact.value)) return fact
  exactKeys(fact.value, ["__truth", "__value"], `fact ${fact.id} truth marker`)
  if (fact.truth !== "OBSERVED" || fact.provenance?.result !== "SUCCESS") {
    fail("HERMES_ATTESTATION_INVALID", `fact ${fact.id} has a truth marker on a non-observed outer fact`)
  }
  const truth = String(fact.value.__truth)
  if (!TRUTH_STATES.includes(truth) || !["UNKNOWN", "CONFLICTING"].includes(truth)) {
    fail("HERMES_ATTESTATION_INVALID", `fact ${fact.id} has an invalid collector truth marker`)
  }
  return {
    ...fact,
    truth,
    value: fact.value.__value,
    provenance: {
      ...fact.provenance,
      result: truth === "CONFLICTING" ? "CONTRADICTION_PRESERVED" : "READ_ONLY_PROBE_FAILED",
    },
  }
}

function normalizedCollectorFacts(facts) {
  return facts.map(normalizeCollectorFact)
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("HERMES_ATTESTATION_INVALID", `${label} must be a non-empty string`)
  }
  return value
}

function instant(value, label) {
  text(value, label)
  if (!ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("HERMES_ATTESTATION_INVALID", `${label} must be a UTC RFC 3339 timestamp`)
  }
  return Date.parse(value)
}

function scanForSensitiveKeys(value, label = "value") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForSensitiveKeys(entry, `${label}[${index}]`))
    return
  }
  if (typeof value === "string" && SENSITIVE_VALUE.test(value)) {
    fail("HERMES_ATTESTATION_SECRET_REFUSED", `${label} contains an unredacted credential-shaped value`)
  }
  if (!object(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) fail("HERMES_ATTESTATION_SECRET_REFUSED", `${label}.${key} is a forbidden sensitive field`)
    scanForSensitiveKeys(entry, `${label}.${key}`)
  }
}

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`
}

export function stableDigest(value) {
  return crypto.createHash("sha256").update(canonicalize(value), "utf8").digest("hex")
}

function validateFact(fact, index, { allowStale = false } = {}) {
  const label = `facts[${index}]`
  exactKeys(fact, ["id", "domain", "truth", "value", "provenance", "freshness", "redaction"], label)
  if (!/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(fact.id)) {
    fail("HERMES_ATTESTATION_INVALID", `${label}.id is invalid`)
  }
  text(fact.domain, `${label}.domain`)
  if (!TRUTH_STATES.includes(fact.truth) || (!allowStale && fact.truth === "STALE")) {
    fail("HERMES_ATTESTATION_INVALID", `${label}.truth must be fresh OBSERVED, UNKNOWN, or CONFLICTING at bind time`)
  }
  exactKeys(fact.provenance, ["source", "probe", "collectorVersion", "result"], `${label}.provenance`)
  text(fact.provenance.source, `${label}.provenance.source`)
  text(fact.provenance.probe, `${label}.provenance.probe`)
  if (fact.provenance.collectorVersion !== "1.0.0") {
    fail("HERMES_ATTESTATION_INVALID", `${label}.provenance.collectorVersion must be 1.0.0`)
  }
  if (!["SUCCESS", "READ_ONLY_PROBE_FAILED", "CONTRADICTION_PRESERVED"].includes(fact.provenance.result)) {
    fail("HERMES_ATTESTATION_INVALID", `${label}.provenance.result is invalid`)
  }
  if (fact.truth === "UNKNOWN" && (fact.value !== null || fact.provenance.result !== "READ_ONLY_PROBE_FAILED")) {
    fail("HERMES_ATTESTATION_INVALID", `${label} UNKNOWN must carry null value and an explicit probe failure result`)
  }
  if (fact.truth === "CONFLICTING" && fact.provenance.result !== "CONTRADICTION_PRESERVED") {
    fail("HERMES_ATTESTATION_INVALID", `${label} CONFLICTING must preserve its contradiction result`)
  }
  exactKeys(fact.freshness, ["class", "boundSeconds", "observedAt", "validUntil"], `${label}.freshness`)
  if (!FRESHNESS_CLASSES.has(fact.freshness.class)) {
    fail("HERMES_ATTESTATION_INVALID", `${label}.freshness.class is invalid`)
  }
  if (fact.freshness.boundSeconds !== FRESHNESS_BOUNDS[fact.freshness.class]) {
    fail("HERMES_ATTESTATION_INVALID", `${label}.freshness.boundSeconds must equal the class contract`)
  }
  const observedAt = instant(fact.freshness.observedAt, `${label}.freshness.observedAt`)
  const validUntil = instant(fact.freshness.validUntil, `${label}.freshness.validUntil`)
  if (validUntil !== observedAt + fact.freshness.boundSeconds * 1000) {
    fail("HERMES_ATTESTATION_INVALID", `${label}.freshness.validUntil does not match its bound`)
  }
  exactKeys(fact.redaction, ["applied", "fields"], `${label}.redaction`)
  if (typeof fact.redaction.applied !== "boolean" || !Array.isArray(fact.redaction.fields)
    || fact.redaction.fields.some((field) => typeof field !== "string" || field.length === 0)) {
    fail("HERMES_ATTESTATION_INVALID", `${label}.redaction is invalid`)
  }
  if (fact.redaction.applied !== (fact.redaction.fields.length > 0)) {
    fail("HERMES_ATTESTATION_INVALID", `${label}.redaction.applied must agree with fields`)
  }
  scanForSensitiveKeys(fact.value, `${label}.value`)
  return { observedAt, validUntil }
}

function validateLaunch(source, launchManifest, launchReceipt, sourceBytesSha256) {
  exactKeys(launchManifest, ["schema", "nonce", "stagedAt", "collectorSha256", "binderSha256", "nodeSha256", "powershellSha256", "nativeExecutables", "expectedUacPrompts", "uacMethod", "persistentCredential", "outputPathSha256"], "launchManifest")
  if (launchManifest.schema !== "hermes-host-attestation-launch/1" || !/^[a-f0-9-]{36}$/.test(launchManifest.nonce)
    || !SHA256.test(launchManifest.collectorSha256) || !SHA256.test(launchManifest.binderSha256) || !SHA256.test(launchManifest.nodeSha256)
    || !SHA256.test(launchManifest.powershellSha256) || launchManifest.expectedUacPrompts !== 1
    || launchManifest.uacMethod !== "Start-Process/RunAs" || launchManifest.persistentCredential !== false
    || !SHA256.test(launchManifest.outputPathSha256)) {
    fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "launch manifest is invalid")
  }
  exactKeys(launchManifest.nativeExecutables, Object.keys(TRUSTED_NATIVE_PATHS), "launchManifest.nativeExecutables")
  for (const [name, expectedPath] of Object.entries(TRUSTED_NATIVE_PATHS)) {
    const entry = launchManifest.nativeExecutables[name]
    exactKeys(entry, ["path", "sha256"], `launchManifest.nativeExecutables.${name}`)
    if (String(entry.path).toLowerCase() !== expectedPath.toLowerCase() || !SHA256.test(entry.sha256)) {
      fail("HERMES_ATTESTATION_AUTHORITY_INVALID", `${name} is not bound to its trusted absolute path and digest`)
    }
  }
  const stagedAt = instant(launchManifest.stagedAt, "launchManifest.stagedAt")
  exactKeys(launchReceipt, ["schema", "nonce", "manifestSha256", "collectorSha256", "binderSha256", "nodeSha256", "powershellSha256", "sourceSha256", "uacStartInvocations", "elevatedProcessId", "exitCode", "completedAt"], "launchReceipt")
  if (launchReceipt.schema !== "hermes-host-attestation-launch-receipt/1"
    || launchReceipt.nonce !== launchManifest.nonce
    || launchReceipt.manifestSha256 !== stableDigest(launchManifest)
    || launchReceipt.collectorSha256 !== launchManifest.collectorSha256
    || launchReceipt.binderSha256 !== launchManifest.binderSha256
    || launchReceipt.nodeSha256 !== launchManifest.nodeSha256
    || launchReceipt.powershellSha256 !== launchManifest.powershellSha256
    || launchReceipt.sourceSha256 !== sourceBytesSha256
    || launchReceipt.uacStartInvocations !== 1
    || !Number.isInteger(launchReceipt.elevatedProcessId) || launchReceipt.elevatedProcessId < 1
    || launchReceipt.exitCode !== 0) {
    fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "launch receipt does not prove exactly one successful UAC transition")
  }
  const receiptAt = instant(launchReceipt.completedAt, "launchReceipt.completedAt")
  if (source.collector.sha256 !== launchManifest.collectorSha256
    || source.authority.launchNonce !== launchManifest.nonce
    || source.authority.launchManifestSha256 !== launchReceipt.manifestSha256) {
    fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "source is not bound to its pre-staged collector/nonce")
  }
  return { stagedAt, receiptAt }
}

export function validateSource(source, { now = new Date(), launchManifest, launchReceipt, sourceBytesSha256 = stableDigest(source) } = {}) {
  exactKeys(source, ["schema", "artifact", "collector", "authority", "collectionId", "collectedAt", "collectionCompletedAt", "host", "facts"], "source")
  if (source.schema !== COLLECTOR_SCHEMA || source.artifact !== "HERMES_HOST_ATTESTATION") {
    fail("HERMES_ATTESTATION_INVALID", "source schema or artifact identity is wrong")
  }
  exactKeys(source.collector, ["name", "version", "sha256", "readOnly"], "source.collector")
  if (source.collector.name !== "collect-hermes-host-attestation.v1.ps1" || source.collector.version !== "1.0.0"
    || !SHA256.test(source.collector.sha256) || source.collector.readOnly !== true) {
    fail("HERMES_ATTESTATION_INVALID", "collector identity is invalid")
  }
  exactKeys(source.authority, ["boundary", "elevated", "persistentCredential", "hostMutationAuthorized", "launchNonce", "launchManifestSha256"], "source.authority")
  if (source.authority.boundary !== "single-prestaged-uac-read-only"
    || source.authority.elevated !== true
    || source.authority.persistentCredential !== false
    || source.authority.hostMutationAuthorized !== false
    || !SHA256.test(source.authority.launchManifestSha256)) {
    fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "the source did not preserve the one-UAC read-only boundary")
  }
  if (!launchManifest || !launchReceipt) fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "independent launch manifest and receipt are required")
  if (!SHA256.test(sourceBytesSha256)) fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "source byte digest is invalid")
  const launchTimes = validateLaunch(source, launchManifest, launchReceipt, sourceBytesSha256)
  text(source.collectionId, "source.collectionId")
  if (source.collectionId !== launchManifest.nonce) fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "collectionId must equal the staged launch nonce")
  const collectedAt = instant(source.collectedAt, "source.collectedAt")
  const completedAt = instant(source.collectionCompletedAt, "source.collectionCompletedAt")
  if (completedAt < collectedAt) fail("HERMES_ATTESTATION_INVALID", "collectionCompletedAt precedes collectedAt")
  if (launchTimes.stagedAt > collectedAt || completedAt > launchTimes.receiptAt) fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "launch/collection/receipt chronology is inconsistent")
  exactKeys(source.host, ["hostname", "machineIdentitySha256", "isWindows"], "source.host")
  text(source.host.hostname, "source.host.hostname")
  if (source.host.hostname.toUpperCase() !== "HERMES" || !SHA256.test(source.host.machineIdentitySha256) || source.host.isWindows !== true) {
    fail("HERMES_ATTESTATION_INVALID", "host identity is invalid")
  }
  if (!Array.isArray(source.facts)) fail("HERMES_ATTESTATION_INVALID", "facts must be an array")
  const ids = source.facts.map((fact, index) => {
    const times = validateFact(fact, index)
    if (times.observedAt < collectedAt || times.observedAt > completedAt) {
      fail("HERMES_ATTESTATION_INVALID", `${fact.id} was observed outside the collection window`)
    }
    return fact.id
  })
  if (new Set(ids).size !== ids.length) fail("HERMES_ATTESTATION_INVALID", "fact ids must be unique")
  const missing = REQUIRED_FACT_IDS.filter((id) => !ids.includes(id))
  const extra = ids.filter((id) => !REQUIRED_FACT_IDS.includes(id))
  if (missing.length > 0 || extra.length > 0 || ids.length !== REQUIRED_FACT_IDS.length) fail("HERMES_ATTESTATION_INCOMPLETE", `fact set mismatch; missing=${missing.join(",")} extra=${extra.join(",")}`)
  const bindTime = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(bindTime)) fail("HERMES_ATTESTATION_INVALID", "bind time is invalid")
  if (completedAt > bindTime + 300000 || launchTimes.receiptAt > bindTime) fail("HERMES_ATTESTATION_INVALID", "collection or receipt completion is implausibly in the future")
  const stale = source.facts.filter((fact) => Date.parse(fact.freshness.validUntil) < bindTime).map((fact) => fact.id)
  if (stale.length > 0) fail("HERMES_ATTESTATION_STALE_BIND", `stale facts require re-sensing: ${stale.join(", ")}`)
  return source
}

function factMap(facts) {
  return new Map(facts.map((fact) => [fact.id, fact]))
}

function nonObserved(fact) {
  return !fact || fact.truth !== "OBSERVED"
}

function storageCritical(facts) {
  const disks = facts.get("storage.physicalDisks")
  const volumes = facts.get("storage.volumes")
  if (nonObserved(disks) || nonObserved(volumes)) return true
  if (!Array.isArray(disks.value) || !Array.isArray(volumes.value)) return true
  const diskBad = disks.value.some((disk) => {
    const health = String(disk.health ?? "UNKNOWN").toUpperCase()
    const operational = Array.isArray(disk.operationalStatus) ? disk.operationalStatus.map((entry) => String(entry).toUpperCase()) : []
    const exposed = disk.reliabilityEvidence === "EXPOSED"
    const readErrors = Number(disk.readErrors)
    const writeErrors = Number(disk.writeErrors)
    return disk.reliabilityState !== "OBSERVED" || !["EXPOSED", "NOT_EXPOSED"].includes(disk.reliabilityEvidence)
      || !["HEALTHY", "OK"].includes(health) || operational.some((entry) => !["OK", "HEALTHY", "ONLINE"].includes(entry))
      || (exposed && ((disk.readErrors !== null && !Number.isFinite(readErrors)) || (disk.writeErrors !== null && !Number.isFinite(writeErrors))
        || readErrors > 0 || writeErrors > 0))
      || (Number.isFinite(disk.wearPercent) && disk.wearPercent >= 90)
  })
  const volumeBad = volumes.value.some((volume) => Number.isFinite(volume.freePercent) && volume.freePercent < 10)
  return diskBad || volumeBad
}

function drUnhealthy(facts) {
  const target = facts.get("dr.target")
  if (nonObserved(target) || !object(target.value)) return true
  return ["capacityAttested", "accessAttested", "storageHealthAttested", "independenceAttested", "readBackAttested"]
    .some((field) => target.value[field] !== true)
}

function securityCritical(facts) {
  const owners = facts.get("network.specialPortOwners")
  const admissions = facts.get("network.firewallAdmissions")
  const profiles = facts.get("security.firewallProfiles")
  const defender = facts.get("security.defender")
  const bitlocker = facts.get("security.bitlocker")
  const boot = facts.get("security.boot")
  if ([owners, admissions, profiles, defender, bitlocker, boot].some(nonObserved)) return true
  if (!Array.isArray(owners.value) || !Array.isArray(admissions.value)) return true
  return owners.value.some((entry) => entry.owner === "UNKNOWN")
    || admissions.value.some((entry) => entry.publicAnyScope === true || entry.unresolvedProgram === true)
    || !Array.isArray(profiles.value) || profiles.value.some((profile) => profile.enabled !== true || String(profile.defaultInbound).toLowerCase() === "allow")
    || !object(defender.value) || defender.value.antivirusEnabled !== true || defender.value.realTimeProtectionEnabled !== true
      || defender.value.behaviorMonitorEnabled !== true || defender.value.tamperProtection !== true
    || !Array.isArray(bitlocker.value) || bitlocker.value.length === 0
      || bitlocker.value.some((volume) => String(volume.protectionStatus).toLowerCase() !== "on" || String(volume.volumeStatus).toLowerCase() !== "fullyencrypted")
    || !object(boot.value) || boot.value.secureBoot !== true || !object(boot.value.tpm)
      || boot.value.tpm.present !== true || boot.value.tpm.ready !== true || boot.value.tpm.enabled !== true || boot.value.tpm.activated !== true
}

function inferenceDrift(facts) {
  const gpus = facts.get("inference.gpus")
  const ollama = facts.get("inference.ollama")
  const containers = facts.get("inference.dockerContainers")
  const baseline = facts.get("inference.guardBaseline")
  const tasks = facts.get("operations.tasks")
  const heartbeats = facts.get("operations.heartbeats")
  if ([gpus, ollama, containers, baseline, tasks, heartbeats].some(nonObserved)) return true
  if (!Array.isArray(gpus.value) || !object(ollama.value) || !Array.isArray(containers.value) || !object(baseline.value)) return true
  const p40 = gpus.value.find((gpu) => gpu.uuid === GOLDEN.p40.uuid)
  const rtx3050 = gpus.value.find((gpu) => gpu.uuid === GOLDEN.rtx3050.uuid)
  if (!p40 || String(p40.driverModelCurrent).toUpperCase() !== GOLDEN.p40.driverModel
    || String(p40.driverModelPending).toUpperCase() !== GOLDEN.p40.driverModel
    || String(p40.driver) !== GOLDEN.p40.driverVersion
    || String(p40.computeMode).toUpperCase() !== GOLDEN.p40.computeMode
    || String(p40.eccModeCurrent).toUpperCase() !== GOLDEN.p40.eccMode
    || String(p40.eccModePending).toUpperCase() !== GOLDEN.p40.eccMode
    || !Number.isFinite(Number(p40.powerLimitW)) || Math.abs(Number(p40.powerLimitW) - GOLDEN.p40.powerLimitW) > 0.5
    || !Number.isFinite(Number(p40.defaultPowerLimitW)) || Math.abs(Number(p40.defaultPowerLimitW) - GOLDEN.p40.defaultPowerLimitW) > 0.5
    || [p40.correctedVolatileEcc, p40.uncorrectedVolatileEcc, p40.correctedAggregateEcc, p40.uncorrectedAggregateEcc]
      .some((value) => value === null || !Number.isFinite(Number(value)))
    || Number(p40.correctedVolatileEcc) !== 0 || Number(p40.uncorrectedVolatileEcc) !== 0
    || Number(p40.correctedAggregateEcc) !== 6 || Number(p40.uncorrectedAggregateEcc) !== 0) return true
  if (!rtx3050 || rtx3050.role !== GOLDEN.rtx3050.role || String(rtx3050.driverModelCurrent).toUpperCase() !== GOLDEN.rtx3050.driverModel) return true
  const p40Apps = Array.isArray(p40.computeApps) ? p40.computeApps : []
  const rtxApps = Array.isArray(rtx3050.computeApps) ? rtx3050.computeApps : []
  if (rtxApps.length > 0 || p40Apps.some((app) => String(app.process).toLowerCase() !== GOLDEN.ollama.exe.toLowerCase())) return true
  const p40Temp = Number(p40.temperatureC)
  const rtxTemp = Number(rtx3050.temperatureC)
  const equilibrium = Number(baseline.value.p40EquilibriumC)
  const baselineDelta = Number(baseline.value.chassisDeltaC)
  const observedDelta = Number(baseline.value.observedDeltaC)
  const observedGuardP40 = Number(baseline.value.observedP40C)
  const observedGuardChassis = Number(baseline.value.observedChassisProxyC)
  const sampleAge = Number(baseline.value.sampleAgeSeconds)
  if ([p40Temp, rtxTemp, equilibrium, baselineDelta, observedDelta, observedGuardP40, observedGuardChassis, sampleAge].some((value) => !Number.isFinite(value))
    || equilibrium !== GOLDEN.guard.p40EquilibriumC || baselineDelta !== GOLDEN.guard.chassisDeltaC
    || p40Temp >= GOLDEN.guard.startCeilingC || rtxTemp >= GOLDEN.guard.startCeilingC
    || observedDelta >= GOLDEN.guard.alertDeltaC || sampleAge < -300 || sampleAge > 120
    || Math.abs((observedGuardP40 - observedGuardChassis) - observedDelta) > 1
    || (p40Temp - rtxTemp) >= GOLDEN.guard.alertDeltaC
    || baseline.value.uuid !== GOLDEN.p40.uuid || String(baseline.value.driverModel).toUpperCase() !== GOLDEN.p40.driverModel
    || !Number.isFinite(Number(baseline.value.powerLimitW)) || Math.abs(Number(baseline.value.powerLimitW) - GOLDEN.p40.powerLimitW) > 0.5
    || String(baseline.value.overall).toLowerCase() !== "ok" || baseline.value.simulated !== false
    || !Array.isArray(baseline.value.problems) || baseline.value.problems.length !== 0) return true
  const models = Array.isArray(ollama.value.models) ? [...ollama.value.models].sort() : []
  const liveEnvironment = ollama.value.liveEnvironment
  const safeConfig = ollama.value.safeConfig
  if (String(ollama.value.exe).toLowerCase() !== GOLDEN.ollama.exe.toLowerCase()
    || ollama.value.exeSha256 !== GOLDEN.ollama.exeSha256
    || !String(ollama.value.version).includes(GOLDEN.ollama.version)
    || ollama.value.bind !== GOLDEN.ollama.bind
    || ollama.value.configurationAgreement !== true
    || !object(safeConfig) || String(safeConfig.exe).toLowerCase() !== GOLDEN.ollama.exe.toLowerCase()
    || safeConfig.exeSha256 !== GOLDEN.ollama.exeSha256
    || String(safeConfig.models).toLowerCase() !== GOLDEN.ollama.modelsPath.toLowerCase()
    || safeConfig.host !== GOLDEN.ollama.bind || safeConfig.gpuUuid !== GOLDEN.ollama.gpuUuid
    || safeConfig.serviceScriptSha256 !== GOLDEN.ollama.serviceScriptSha256
    || safeConfig.repositoryDoctrineSha256 !== GOLDEN.ollama.serviceScriptSha256
    || canonicalize(safeConfig.environment) !== canonicalize(GOLDEN.ollama.configEnvironment)
    || !object(liveEnvironment) || liveEnvironment.state !== "OBSERVED"
    || canonicalize(liveEnvironment.values) !== canonicalize(GOLDEN.ollama.liveEnvironment)
    || JSON.stringify(models) !== JSON.stringify([...GOLDEN.ollama.models].sort())) return true
  if (!object(ollama.value.task) || ollama.value.task.name !== "WilliamOS-HERMES-Ollama" || !rootTaskPath(ollama.value.task) || ollama.value.task.state !== "Running"
    || !object(ollama.value.task.principal) || String(ollama.value.task.principal.user).toUpperCase() !== "SYSTEM"
    || String(ollama.value.task.principal.runLevel).toLowerCase() !== "highest"
    || !exactPowerShellAction(ollama.value.task, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\HermesLab\\hermes\\ollama-service\\hermes-ollama-service.ps1"])
    || !exactActiveTriggers(ollama.value.task, [["MSFT_TaskBootTrigger"], ["MSFT_TaskTimeTrigger", "PT2M"]], ollama.freshness.observedAt)) return true
  const observed = Object.fromEntries(containers.value.map((container) => [container.name, container]))
  if (JSON.stringify(Object.keys(observed).sort()) !== JSON.stringify(Object.keys(GOLDEN.containers).sort())) return true
  if (Object.entries(GOLDEN.containers).some(([name, expected]) => observed[name].state !== expected.state || observed[name].restartPolicy !== expected.restartPolicy)) return true
  const expectedGuards = {
    HermesP40Guard: {
      arguments: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\HermesLab\\hermes\\p40-guard.ps1", "-Quiet"],
      state: ["Ready", "Running"],
      triggers: [["MSFT_TaskBootTrigger"], ["MSFT_TaskTimeTrigger", "PT1H"]],
    },
    HermesP40Watch: {
      arguments: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\HermesLab\\hermes\\p40-guard.ps1", "-Watch", "-WatchIntervalS", "30", "-Quiet"],
      state: ["Running"],
      triggers: [["MSFT_TaskBootTrigger"]],
    },
  }
  if (!Array.isArray(tasks.value) || Object.entries(expectedGuards).some(([name, expected]) => {
    const task = tasks.value.find((entry) => entry.name === name)
    return !task || !rootTaskPath(task) || !expected.state.includes(task.state) || !object(task.principal) || String(task.principal.user).toUpperCase() !== "SYSTEM"
      || String(task.principal.runLevel).toLowerCase() !== "highest" || !Array.isArray(task.actions)
      || task.actions.length !== 1 || !exactPowerShellAction(task.actions[0], expected.arguments)
      || !exactActiveTriggers(task, expected.triggers, tasks.freshness.observedAt)
      || ![0, 267009].includes(Number(task.lastResult))
  })) return true
  if (!object(heartbeats.value) || !Array.isArray(heartbeats.value.heartbeatFiles)) return true
  const watchHeartbeat = heartbeats.value.heartbeatFiles.find((entry) => /p40-watch\.heartbeat$/i.test(String(entry.path)))
  const heartbeatAt = watchHeartbeat ? Date.parse(watchHeartbeat.writtenAt) : Number.NaN
  const heartbeatObservedAt = Date.parse(heartbeats.freshness.observedAt)
  return !Number.isFinite(heartbeatAt) || heartbeatAt > heartbeatObservedAt + 300000 || heartbeatObservedAt - heartbeatAt > 120000
}

export function derivePriorityOverrides(factArray) {
  const facts = factMap(factArray)
  const candidates = [
    ["HERMES_STORAGE_CRITICAL", 100, storageCritical(facts), "REPRIORITIZE_STORAGE_PROTECTION"],
    ["HERMES_SECURITY_EXPOSURE_CRITICAL", 90, securityCritical(facts), "REPRIORITIZE_SECURITY_CONTAINMENT"],
    ["HERMES_INFERENCE_GOLDEN_DRIFT", 80, inferenceDrift(facts), "STOP_ORDINARY_HOST_MUTATION"],
    ["HERMES_DR_TARGET_UNHEALTHY", 70, drUnhealthy(facts), "REPRIORITIZE_RECOVERY_TRUTH"],
  ]
  return candidates.filter((entry) => entry[2]).map(([type, precedence, , disposition]) => ({ type, precedence, disposition }))
}

function digestShape(attestation) {
  const { digestSha256: _omitted, ...binding } = attestation.binding
  return { ...attestation, binding }
}

export function bindAttestation(source, { now = new Date(), launchManifest, launchReceipt, sourceBytesSha256 = stableDigest(source) } = {}) {
  validateSource(source, { now, launchManifest, launchReceipt, sourceBytesSha256 })
  const boundAt = (now instanceof Date ? now : new Date(now)).toISOString()
  const facts = normalizedCollectorFacts(source.facts).sort((left, right) => left.id.localeCompare(right.id))
  const sourceDigestSha256 = stableDigest(source)
  const unsigned = {
    schema: SCHEMA,
    artifact: "HERMES_HOST_ATTESTATION",
    collectedAt: source.collectedAt,
    collectionCompletedAt: source.collectionCompletedAt,
    boundAt,
    collectionId: source.collectionId,
    host: source.host,
    collector: source.collector,
    authority: source.authority,
    facts,
    priorityOverrides: derivePriorityOverrides(facts),
    resense: { mode: "ONLY_STALE_OR_CHANGED_PREREQUISITES", factIds: [] },
    binding: {
      digestAlgorithm: "sha256",
      canonicalization: CANONICALIZATION,
      sourceDigestSha256,
      launchManifestSha256: stableDigest(launchManifest),
      launchReceiptSha256: stableDigest(launchReceipt),
      digestSha256: "",
    },
  }
  unsigned.binding.digestSha256 = stableDigest(digestShape(unsigned))
  return unsigned
}

export function verifyBoundAttestation(attestation, { now = new Date(), changedPrerequisiteIds = [], launchManifest, launchReceipt, source, sourceBytes } = {}) {
  if (!object(attestation) || attestation.schema !== SCHEMA || attestation.artifact !== "HERMES_HOST_ATTESTATION") {
    fail("HERMES_ATTESTATION_INVALID", "bound artifact identity is invalid")
  }
  exactKeys(attestation, ["schema", "artifact", "collectedAt", "collectionCompletedAt", "boundAt", "collectionId", "host", "collector", "authority", "facts", "priorityOverrides", "resense", "binding"], "attestation")
  instant(attestation.collectedAt, "attestation.collectedAt")
  instant(attestation.collectionCompletedAt, "attestation.collectionCompletedAt")
  instant(attestation.boundAt, "attestation.boundAt")
  if (!Array.isArray(attestation.facts)) fail("HERMES_ATTESTATION_INVALID", "bound facts must be an array")
  attestation.facts.forEach((fact, index) => validateFact(fact, index, { allowStale: true }))
  const ids = attestation.facts.map((fact) => fact.id)
  if (new Set(ids).size !== ids.length || ids.length !== REQUIRED_FACT_IDS.length
    || REQUIRED_FACT_IDS.some((id) => !ids.includes(id)) || ids.some((id) => !REQUIRED_FACT_IDS.includes(id))) fail("HERMES_ATTESTATION_INCOMPLETE", "bound fact set is not exact")
  if (!Array.isArray(attestation.priorityOverrides) || attestation.priorityOverrides.some((entry) => !object(entry)
    || !PRIORITY_TYPES.includes(entry.type) || !Number.isInteger(entry.precedence) || typeof entry.disposition !== "string")) {
    fail("HERMES_ATTESTATION_INVALID", "priority overrides are invalid")
  }
  if (JSON.stringify(attestation.priorityOverrides) !== JSON.stringify(derivePriorityOverrides(attestation.facts))) {
    fail("HERMES_ATTESTATION_INVALID", "priority overrides do not match bound facts")
  }
  exactKeys(attestation.resense, ["mode", "factIds"], "attestation.resense")
  if (attestation.resense.mode !== "ONLY_STALE_OR_CHANGED_PREREQUISITES" || !Array.isArray(attestation.resense.factIds)) fail("HERMES_ATTESTATION_INVALID", "resense contract is invalid")
  if (!object(attestation.binding) || attestation.binding.canonicalization !== CANONICALIZATION
    || attestation.binding.digestAlgorithm !== "sha256" || !SHA256.test(attestation.binding.digestSha256)
    || !SHA256.test(attestation.binding.sourceDigestSha256) || !SHA256.test(attestation.binding.launchManifestSha256)
    || !SHA256.test(attestation.binding.launchReceiptSha256)) {
    fail("HERMES_ATTESTATION_DIGEST_INVALID", "binding metadata is invalid")
  }
  exactKeys(attestation.binding, ["digestAlgorithm", "canonicalization", "sourceDigestSha256", "launchManifestSha256", "launchReceiptSha256", "digestSha256"], "attestation.binding")
  const expected = stableDigest(digestShape(attestation))
  if (expected !== attestation.binding.digestSha256) fail("HERMES_ATTESTATION_DIGEST_INVALID", "artifact digest does not match")
  if (!launchManifest || !launchReceipt || !source || !(Buffer.isBuffer(sourceBytes) || sourceBytes instanceof Uint8Array)) {
    fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "external source bytes, launch manifest, and receipt are required for verification")
  }
  const sourceBytesSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex")
  // Revalidate launch/source authority at the original bind instant. Current freshness is assessed
  // separately below so an expired packet yields a selective re-sense list instead of losing provenance.
  validateSource(source, { now: new Date(attestation.boundAt), launchManifest, launchReceipt, sourceBytesSha256 })
  if (stableDigest(source) !== attestation.binding.sourceDigestSha256
    || stableDigest(launchManifest) !== attestation.binding.launchManifestSha256
    || stableDigest(launchReceipt) !== attestation.binding.launchReceiptSha256
    || attestation.collectionId !== source.collectionId
    || canonicalize(attestation.host) !== canonicalize(source.host)
    || canonicalize(attestation.collector) !== canonicalize(source.collector)
    || canonicalize(attestation.authority) !== canonicalize(source.authority)
    || canonicalize(attestation.facts) !== canonicalize(normalizedCollectorFacts(source.facts).sort((left, right) => left.id.localeCompare(right.id)))) {
    fail("HERMES_ATTESTATION_AUTHORITY_INVALID", "bound packet does not match its external source/launch evidence")
  }
  const at = now instanceof Date ? now.getTime() : Date.parse(now)
  const staleFactIds = attestation.facts.filter((fact) => Date.parse(fact.freshness.validUntil) < at).map((fact) => fact.id)
  const changed = changedPrerequisiteIds.filter((id) => attestation.facts.some((fact) => fact.id === id))
  return {
    validDigest: true,
    fresh: staleFactIds.length === 0,
    staleFactIds,
    resenseFactIds: [...new Set([...staleFactIds, ...changed])].sort(),
    broadResetRequired: false,
  }
}

function parseCli(argv) {
  const args = [...argv]
  const sourcePath = args.shift()
  const manifestPath = args.shift()
  const receiptPath = args.shift()
  const outputPath = args.shift()
  if (!sourcePath || !manifestPath || !receiptPath || !outputPath || args.length > 0) {
    fail("HERMES_ATTESTATION_USAGE", "usage: node bind-hermes-host-attestation.v1.mjs <source.json> <launch.json> <receipt.json> <bound.json>")
  }
  return { sourcePath: path.resolve(sourcePath), manifestPath: path.resolve(manifestPath), receiptPath: path.resolve(receiptPath), outputPath: path.resolve(outputPath) }
}

export function runCli(argv = process.argv.slice(2)) {
  const { sourcePath, manifestPath, receiptPath, outputPath } = parseCli(argv)
  if (fs.existsSync(outputPath)) fail("HERMES_ATTESTATION_OUTPUT_EXISTS", outputPath)
  const sourceBytes = fs.readFileSync(sourcePath)
  const source = JSON.parse(sourceBytes.toString("utf8").replace(/^\uFEFF/, ""))
  const launchManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""))
  const launchReceipt = JSON.parse(fs.readFileSync(receiptPath, "utf8").replace(/^\uFEFF/, ""))
  const sourceBytesSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex")
  const bound = bindAttestation(source, { launchManifest, launchReceipt, sourceBytesSha256 })
  verifyBoundAttestation(bound, { launchManifest, launchReceipt, source, sourceBytes })
  fs.writeFileSync(outputPath, `${JSON.stringify(bound, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  process.stdout.write(`${bound.binding.digestSha256}\n`)
  return bound
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) runCli()
