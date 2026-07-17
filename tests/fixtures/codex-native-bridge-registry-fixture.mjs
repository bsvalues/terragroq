const TRUST_RECORDS = new Map()
const BRIDGES = new Map()

export function loadCanonicalHostedCodexTrustRecord(proofId) {
  return TRUST_RECORDS.get(proofId) ?? null
}

export function loadCanonicalHostedCodexNativeBridge(bridgeId) {
  return BRIDGES.get(bridgeId) ?? null
}

export function installTestHostedCodexTrustRecord(record) {
  TRUST_RECORDS.set(record.proofId, record)
}

export function installTestHostedCodexNativeBridge(bridge) {
  BRIDGES.set(bridge.bridgeId, bridge)
}

export function clearTestHostedCodexNativeBridgeRegistry() {
  TRUST_RECORDS.clear()
  BRIDGES.clear()
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
