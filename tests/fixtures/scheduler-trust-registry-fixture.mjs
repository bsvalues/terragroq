const records = new Map()

export function installTestSchedulerTrustRecord(registryId, registryVersion, entry, evaluationTime) {
  records.set(`${registryId}:${registryVersion}`, { ...structuredClone(entry), evaluationTime })
}

export function clearTestSchedulerTrustRecords() { records.clear() }

export function loadCanonicalSchedulerTrustRecord(registryId, registryVersion) {
  const entry = records.get(`${registryId}:${registryVersion}`)
  return entry ? structuredClone(entry) : null
}

export const SCHEDULER_TRUST_PIN_REGISTRY_METADATA = Object.freeze({
  registryId: "test-only-scheduler-trust-pins",
  version: 1,
  contentHash: "0".repeat(64),
  activeRecordCount: 0,
  mutableRegistrationAllowed: false,
  authorityGranted: false,
})
