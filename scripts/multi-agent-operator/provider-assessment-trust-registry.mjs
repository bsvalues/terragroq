import crypto from "node:crypto"

const EMBEDDED_REGISTRY = Object.freeze({
  artifactType: "PROVIDER_ASSESSMENT_PIN_REGISTRY",
  records: Object.freeze([]),
  registryId: "williamos-provider-assessment-pins",
  schemaVersion: 1,
  version: 1,
})
const EMBEDDED_REGISTRY_CONTENT_HASH = "d99370907f9c2b97e9d00c46a43c3c4f6c24bb0bc57d4e88ea85791f62b70b25"

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function verifyEmbeddedRegistry() {
  const computed = crypto.createHash("sha256").update(canonicalJson(EMBEDDED_REGISTRY)).digest("hex")
  if (computed !== EMBEDDED_REGISTRY_CONTENT_HASH) {
    throw new Error("PROVIDER_ASSESSMENT_PIN_REGISTRY_INTEGRITY_WALL")
  }
}

export function loadCanonicalProviderTrustRecord(registryId, registryVersion) {
  verifyEmbeddedRegistry()
  if (registryId !== EMBEDDED_REGISTRY.registryId || registryVersion !== EMBEDDED_REGISTRY.version) return null
  const entry = EMBEDDED_REGISTRY.records.find((record) => record.registryRecord.registryId === registryId
    && record.registryRecord.registryVersion === registryVersion)
  return entry ? Object.freeze({ ...entry, evaluationTime: new Date().toISOString() }) : null
}

export const PROVIDER_ASSESSMENT_PIN_REGISTRY_METADATA = Object.freeze({
  registryId: EMBEDDED_REGISTRY.registryId,
  version: EMBEDDED_REGISTRY.version,
  contentHash: EMBEDDED_REGISTRY_CONTENT_HASH,
  activeRecordCount: 0,
  mutableRegistrationAllowed: false,
  authorityGranted: false,
})
