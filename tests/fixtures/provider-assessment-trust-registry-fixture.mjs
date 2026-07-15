const RECORDS = new Map()

export function installTestProviderTrustRecord(registryId, registryVersion, entry, evaluationTime = "2026-07-14T00:00:00.000Z") {
  RECORDS.set(`${registryId}:${registryVersion}`, { ...entry, evaluationTime })
}

export function clearTestProviderTrustRecords() {
  RECORDS.clear()
}

export function loadCanonicalProviderTrustRecord(registryId, registryVersion) {
  return RECORDS.get(`${registryId}:${registryVersion}`) ?? null
}
