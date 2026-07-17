import { loadCanonicalHostedCodexAuthorityStatusChain } from "./hosted-codex-authority-status-registry-fixture.mjs"

const TRUST_RECORDS = new Map()
const BRIDGES = new Map()
const EFFECT_BINDINGS = new Map()
const ATOMIC_AUTHORITY_FENCE_REJECTIONS = new WeakSet()
const OBSERVATION_PENDING_REJECTIONS = new WeakSet()

const FENCE_FIELDS = new Set([
  "registryId", "registryVersion", "recordId", "fencingToken", "recordContentHash",
  "workOrderId", "grantId", "authorityDecisionId", "status",
])
const BRIDGE_OPERATIONS = [
  "spawn", "lookupSpawn", "send", "lookupSend", "cancel", "lookupCancel", "observe",
]

function exactAuthorityFence(value) {
  const reject = (code) => {
    const error = new Error(code)
    error.code = "HOSTED_CODEX_HOST_AUTHORITY_FENCE_WALL"
    ATOMIC_AUTHORITY_FENCE_REJECTIONS.add(error)
    throw error
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== FENCE_FIELDS.size
    || Object.keys(value).some((field) => !FENCE_FIELDS.has(field))) {
    reject("HOST_AUTHORITY_FENCE_SCHEMA_WALL")
  }
  const chain = loadCanonicalHostedCodexAuthorityStatusChain(value.recordId, 0)
  const current = chain?.records?.at(-1)
  if (chain?.registryId !== value.registryId
    || chain?.registryVersion !== value.registryVersion
    || chain?.latestFencingToken !== value.fencingToken
    || chain?.latestRecordContentHash !== value.recordContentHash
    || current?.recordId !== value.recordId
    || current?.fencingToken !== value.fencingToken
    || current?.recordContentHash !== value.recordContentHash
    || current?.workOrderId !== value.workOrderId
    || current?.grantId !== value.grantId
    || current?.authorityDecisionId !== value.authorityDecisionId
    || current?.status !== "ACTIVE"
    || value.status !== "ACTIVE") {
    reject("HOST_AUTHORITY_FENCE_STALE_OR_REVOKED_WALL")
  }
  return structuredClone(value)
}

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
  return TRUST_RECORDS.get(proofId) ?? null
}

export function loadCanonicalHostedCodexNativeBridge(bridgeId) {
  return BRIDGES.get(bridgeId) ?? null
}

export function installTestHostedCodexTrustRecord(record) {
  TRUST_RECORDS.set(record.proofId, record)
}

export function installTestHostedCodexNativeBridge(bridge) {
  const registered = { ...bridge }
  delete registered.beforeAuthorityFenceCheck
  delete registered.transformBridgeInvocation
  delete registered.effectCommittedAfterThrow
  for (const operation of BRIDGE_OPERATIONS) {
    registered[operation] = (request) => {
      const perform = bridge[operation]
      bridge.beforeAuthorityFenceCheck?.(operation, request)
      // This check and the immediately following host operation model one trusted-host
      // critical section. A changed/revoked head is rejected before the operation runs.
      const authorityFence = exactAuthorityFence(request.authorityFence)
      const isLookup = operation.startsWith("lookup")
      const effectOperation = isLookup ? operation.slice("lookup".length).toUpperCase() : operation.toUpperCase()
      const bindingKey = `${bridge.bridgeId}\u0000${effectOperation}\u0000${request.idempotencyKey}`
      if (isLookup) {
        const stored = EFFECT_BINDINGS.get(bindingKey)
        if (stored === undefined
          || JSON.stringify(stored) !== JSON.stringify(request.originalEffectBinding)) {
          const error = new Error("HOST_ORIGINAL_EFFECT_BINDING_WALL")
          error.code = "HOSTED_CODEX_HOST_AUTHORITY_FENCE_WALL"
          ATOMIC_AUTHORITY_FENCE_REJECTIONS.add(error)
          throw error
        }
      }
      let result
      try {
        result = perform(request)
      } catch (error) {
        if (operation === "observe" && error?.code === "HOST_OBSERVATION_PENDING") {
          OBSERVATION_PENDING_REJECTIONS.add(error)
        }
        if (!isLookup && bridge.effectCommittedAfterThrow?.(operation, request, error) === true) {
          EFFECT_BINDINGS.set(bindingKey, structuredClone({
            operation: effectOperation,
            idempotencyKey: request.idempotencyKey,
            effectDigest: request.effectDigest,
            acceptedAuthorityFence: request.authorityFence,
          }))
        }
        throw error
      }
      if (!isLookup) {
        EFFECT_BINDINGS.set(bindingKey, structuredClone({
          operation: effectOperation,
          idempotencyKey: request.idempotencyKey,
          effectDigest: request.effectDigest,
          acceptedAuthorityFence: request.authorityFence,
        }))
      }
      const invocation = {
        authorityFence,
        hostEnforced: true,
        result,
      }
      if (isLookup) invocation.originalEffectBinding = structuredClone(request.originalEffectBinding)
      return bridge.transformBridgeInvocation?.(operation, invocation, request) ?? invocation
    }
  }
  BRIDGES.set(bridge.bridgeId, Object.freeze(registered))
}

export function clearTestHostedCodexNativeBridgeRegistry() {
  TRUST_RECORDS.clear()
  BRIDGES.clear()
  EFFECT_BINDINGS.clear()
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
