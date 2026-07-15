const RECORDS = new Map()

export function installTestCodexHostSessionRecord(record) {
  RECORDS.set(record.proofId, structuredClone(record))
}

export function clearTestCodexHostSessionRecords() {
  RECORDS.clear()
}

export function loadCanonicalCodexHostSessionRecord(proofId) {
  const record = RECORDS.get(proofId)
  return record === undefined ? null : structuredClone(record)
}
