const CHAINS = Object.freeze([])

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function detachedChain(chain, afterFencingToken) {
  return deepFreeze(structuredClone({
    registryId: chain.registryId,
    registryVersion: chain.registryVersion,
    evaluationTime: chain.evaluationTime,
    recordId: chain.recordId,
    latestFencingToken: chain.latestFencingToken,
    latestRecordContentHash: chain.records.at(-1)?.recordContentHash ?? null,
    records: chain.records.filter((record) => record.fencingToken > afterFencingToken),
  }))
}

export function loadCanonicalHostedCodexAuthorityStatusChain(recordId, afterFencingToken = 0) {
  const chain = CHAINS.find((candidate) => candidate.recordId === recordId)
  return chain === undefined ? null : detachedChain(chain, afterFencingToken)
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
