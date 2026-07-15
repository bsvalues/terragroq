import crypto from "node:crypto"

const EMBEDDED_REGISTRY = Object.freeze({
  artifactType: "SCHEDULER_TRUST_PIN_REGISTRY",
  records: Object.freeze([]),
  registryId: "williamos-scheduler-trust-pins",
  schemaVersion: 1,
  version: 1,
})
const EMBEDDED_REGISTRY_CONTENT_HASH = "34c121cca87ac670536eddc844ff6856981421b0315c0a38bb18c7dd0c580be9"

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function verifyEmbeddedRegistry() {
  const computed = crypto.createHash("sha256").update(canonicalJson(EMBEDDED_REGISTRY)).digest("hex")
  if (computed !== EMBEDDED_REGISTRY_CONTENT_HASH) throw new Error("SCHEDULER_TRUST_PIN_REGISTRY_INTEGRITY_WALL")
}

export function loadCanonicalSchedulerTrustRecord(registryId, registryVersion) {
  verifyEmbeddedRegistry()
  if (registryId !== EMBEDDED_REGISTRY.registryId || registryVersion !== EMBEDDED_REGISTRY.version) return null
  const entry = EMBEDDED_REGISTRY.records.find((candidate) => candidate.registryRecord.registryId === registryId
    && candidate.registryRecord.registryVersion === registryVersion)
  return entry ? Object.freeze({ ...entry, evaluationTime: new Date().toISOString() }) : null
}

export const SCHEDULER_TRUST_PIN_REGISTRY_METADATA = Object.freeze({
  registryId: EMBEDDED_REGISTRY.registryId,
  version: EMBEDDED_REGISTRY.version,
  contentHash: EMBEDDED_REGISTRY_CONTENT_HASH,
  activeRecordCount: 0,
  mutableRegistrationAllowed: false,
  authorityGranted: false,
})
