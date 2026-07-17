const TRUST_RECORDS = Object.freeze([])
const BRIDGES = Object.freeze([])
const ATOMIC_AUTHORITY_FENCE_REJECTIONS = new WeakSet()
const OBSERVATION_PENDING_REJECTIONS = new WeakSet()

export function isHostedCodexAtomicAuthorityFenceRejection(error) {
  return error !== null
    && typeof error === "object"
    && ATOMIC_AUTHORITY_FENCE_REJECTIONS.has(error)
}

export function isHostedCodexObservationPending(error) {
  return error !== null
    && typeof error === "object"
    && OBSERVATION_PENDING_REJECTIONS.has(error)
}

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
  atomicAuthorityFenceRequired: true,
  authorityFenceEchoRequired: true,
  authorityStatusRegistryId: "hosted-codex-authority-status-registry-v1",
  durableTransportClaimed: false,
  authorityGranted: false,
})
