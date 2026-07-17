const CHAINS = new Map()

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function detached(value) {
  return deepFreeze(structuredClone(value))
}

export function installTestHostedCodexAuthorityStatusChain(chain) {
  const installed = structuredClone(chain)
  CHAINS.set(installed.recordId, installed)
}

export function advanceTestHostedCodexAuthorityStatusChain(recordId, record, evaluationTime) {
  const current = CHAINS.get(recordId)
  if (current === undefined) throw new Error(`UNKNOWN_TEST_AUTHORITY_STATUS_CHAIN:${recordId}`)
  const fence = record.fencingToken
  current.records.push(structuredClone(record))
  current.evaluationTime = evaluationTime
  current.latestFencingToken = fence
}

export function removeTestHostedCodexAuthorityStatusChain(recordId) {
  CHAINS.delete(recordId)
}

export function clearTestHostedCodexAuthorityStatusRegistry() {
  CHAINS.clear()
}

export function loadCanonicalHostedCodexAuthorityStatusChain(recordId, afterFencingToken = 0) {
  const chain = CHAINS.get(recordId)
  if (chain === undefined) return null
  const headFence = chain.latestFencingToken
  return detached({
    registryId: chain.registryId,
    registryVersion: chain.registryVersion,
    evaluationTime: chain.evaluationTime,
    recordId: chain.recordId,
    latestFencingToken: headFence,
    latestRecordContentHash: chain.records.at(-1)?.recordContentHash ?? null,
    records: chain.records.filter((record) => record.fencingToken > afterFencingToken),
  })
}

export const HOSTED_CODEX_AUTHORITY_STATUS_REGISTRY_METADATA = Object.freeze({
  registryId: "hosted-codex-authority-status-registry-v1",
  schemaVersion: 1,
  mutableRegistrationAllowed: false,
  hostBacked: true,
  authenticatedRecordsRequired: true,
  monotonicFenceRequired: true,
  terminalRevocationEnforced: true,
  authorityGranted: false,
})
