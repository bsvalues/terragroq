const TRUST_RECORDS = Object.freeze([])
const BRIDGES = Object.freeze([])

export function loadCanonicalHostedCodexTrustRecord(proofId) {
  return TRUST_RECORDS.find((record) => record.proofId === proofId) ?? null
}

export function loadCanonicalHostedCodexNativeBridge(bridgeId) {
  return BRIDGES.find((bridge) => bridge.bridgeId === bridgeId) ?? null
}

export const HOSTED_CODEX_NATIVE_BRIDGE_REGISTRY_METADATA = Object.freeze({
  trustRecordCount: 0,
  bridgeCount: 0,
  mutableRegistrationAllowed: false,
  hostIdempotencyRequired: true,
  lookupMayPerformSideEffect: false,
  durableTransportClaimed: false,
  authorityGranted: false,
})
