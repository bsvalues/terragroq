const RECORDS = Object.freeze([])

export function loadCanonicalCodexHostSessionRecord(proofId) {
  return RECORDS.find((record) => record.proofId === proofId) ?? null
}

export const CODEX_HOST_SESSION_REGISTRY_METADATA = Object.freeze({
  activeRecordCount: 0,
  mutableRegistrationAllowed: false,
  authorityGranted: false,
})
