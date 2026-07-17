import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentProviderHealthEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-035-PROVIDER-HEALTH-REROUTE-V1"
  status: "CANONICAL_PROVIDER_HEALTH_REROUTE_VERIFIED"
  workOrderId: "WO-MAO-035"
  registryId: "williamos-provider-health-reroute"
  registryVersion: 1
  readinessBaseCommitSha: string
  readinessBaseTreeHash: string
  registryContentHash: string
  resultHash: string
  trustedObservationSource: "CANONICAL_ZERO_INPUT_REGISTRY"
  circuitBreakerModel: "STATEFUL_TRANSITION_LEDGER"
  rerouteModel: "BOUNDED_STATIC_FALLBACK_SELECTION"
  rerouteFromProviderId: "hosted-codex"
  rerouteToProviderId: "hosted-codex-secondary"
  unavailableProviderId: "claude-code"
  unavailableProviderState: "UNAVAILABLE"
  callerInputAccepted: false
  dispatchPerformed: false
  providerCallPerformed: false
  durablePersistenceClaimed: false
  serviceWorkerClaimed: false
  runtimeActivationAllowed: false
  authorityGranted: false
  secretsExposed: false
  ownerRelayRequired: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-036"
  downstreamState: "PENDING"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_PROVIDER_HEALTH_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-035-PROVIDER-HEALTH-REROUTE-V1",
  status: "CANONICAL_PROVIDER_HEALTH_REROUTE_VERIFIED",
  workOrderId: "WO-MAO-035",
  registryId: "williamos-provider-health-reroute",
  registryVersion: 1,
  readinessBaseCommitSha: "726fb9a3d396c1500aed6c60092d9ea4756c6ad5",
  readinessBaseTreeHash: "616ee350063efcedfa7ac7ddf01a6c8df24e8391",
  registryContentHash: "50033dc24bc289342f6c7dfd447a2a8c62bd7fb4436e18b18127543590956cc3",
  resultHash: "678ddad3816fdbc8e9e6646906b4b1938147acc3629db9af34b65c644c5d8ca5",
  trustedObservationSource: "CANONICAL_ZERO_INPUT_REGISTRY",
  circuitBreakerModel: "STATEFUL_TRANSITION_LEDGER",
  rerouteModel: "BOUNDED_STATIC_FALLBACK_SELECTION",
  rerouteFromProviderId: "hosted-codex",
  rerouteToProviderId: "hosted-codex-secondary",
  unavailableProviderId: "claude-code",
  unavailableProviderState: "UNAVAILABLE",
  callerInputAccepted: false,
  dispatchPerformed: false,
  providerCallPerformed: false,
  durablePersistenceClaimed: false,
  serviceWorkerClaimed: false,
  runtimeActivationAllowed: false,
  authorityGranted: false,
  secretsExposed: false,
  ownerRelayRequired: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-036",
  downstreamState: "PENDING",
  recordContentHash: "50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a",
} satisfies MultiAgentProviderHealthEvidence)

export function isVerifiedWoMao035ProviderHealthEvidence(
  record: MultiAgentProviderHealthEvidence = MULTI_AGENT_PROVIDER_HEALTH_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_PROVIDER_HEALTH_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-035-PROVIDER-HEALTH-REROUTE-V1"
    && record.status === "CANONICAL_PROVIDER_HEALTH_REROUTE_VERIFIED"
    && record.workOrderId === "WO-MAO-035"
    && record.registryId === "williamos-provider-health-reroute"
    && record.registryVersion === 1
    && record.readinessBaseCommitSha === "726fb9a3d396c1500aed6c60092d9ea4756c6ad5"
    && record.readinessBaseTreeHash === "616ee350063efcedfa7ac7ddf01a6c8df24e8391"
    && record.registryContentHash === "50033dc24bc289342f6c7dfd447a2a8c62bd7fb4436e18b18127543590956cc3"
    && record.resultHash === "678ddad3816fdbc8e9e6646906b4b1938147acc3629db9af34b65c644c5d8ca5"
    && record.trustedObservationSource === "CANONICAL_ZERO_INPUT_REGISTRY"
    && record.circuitBreakerModel === "STATEFUL_TRANSITION_LEDGER"
    && record.rerouteModel === "BOUNDED_STATIC_FALLBACK_SELECTION"
    && record.rerouteFromProviderId === "hosted-codex"
    && record.rerouteToProviderId === "hosted-codex-secondary"
    && record.unavailableProviderId === "claude-code"
    && record.unavailableProviderState === "UNAVAILABLE"
    && record.callerInputAccepted === false
    && record.dispatchPerformed === false
    && record.providerCallPerformed === false
    && record.durablePersistenceClaimed === false
    && record.serviceWorkerClaimed === false
    && record.runtimeActivationAllowed === false
    && record.authorityGranted === false
    && record.secretsExposed === false
    && record.ownerRelayRequired === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-036"
    && record.downstreamState === "PENDING"
    && [record.readinessBaseCommitSha, record.readinessBaseTreeHash].every((value) => SHA_40.test(value))
    && [record.registryContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a"
}
