import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentProviderConformanceEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-036-PROVIDER-CONFORMANCE-SUITE-V1"
  status: "CANONICAL_PROVIDER_CONFORMANCE_SUITE_VERIFIED"
  workOrderId: "WO-MAO-036"
  registryId: "williamos-provider-conformance-suite"
  registryVersion: 1
  readinessBaseCommitSha: string
  readinessBaseTreeHash: string
  registryContentHash: string
  resultHash: string
  codexConformanceContentHash: string
  woMao035EvidenceHash: string
  hostedCodexStatus: "SESSION_ONLY_CONFORMANT"
  claudeCodeStatus: "DEFERRED_PROVIDER_UNAVAILABLE"
  localNestedCodexStatus: "REJECTED"
  enabledExecutableProviderCount: 0
  callerInputAccepted: false
  dispatchPerformed: false
  providerCallPerformed: false
  executableWorkerCertified: false
  disabledProviderCertified: false
  durablePersistenceClaimed: false
  serviceWorkerClaimed: false
  runtimeActivationAllowed: false
  authorityGranted: false
  secretsExposed: false
  ownerRelayRequired: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-037"
  downstreamState: "PENDING"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_PROVIDER_CONFORMANCE_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-036-PROVIDER-CONFORMANCE-SUITE-V1",
  status: "CANONICAL_PROVIDER_CONFORMANCE_SUITE_VERIFIED",
  workOrderId: "WO-MAO-036",
  registryId: "williamos-provider-conformance-suite",
  registryVersion: 1,
  readinessBaseCommitSha: "ae25dddb0590c19748dc0af13aebfa60bd080728",
  readinessBaseTreeHash: "97ab235a6f343a6de2fafbb3d406d7bf8b0695e2",
  registryContentHash: "cdd0b0e429228567e18925dd66a40d672181fb54c0111ad0e200d6031097d733",
  resultHash: "79117c7b2046c673e45b2b6f71f6e229ee7868f907bb7e0dd05024ad737ca1b4",
  codexConformanceContentHash: "052c437518a59b15c3d3c5e3553765a00dcf8d94b2eba76b55f9b37f845c0d38",
  woMao035EvidenceHash: "50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a",
  hostedCodexStatus: "SESSION_ONLY_CONFORMANT",
  claudeCodeStatus: "DEFERRED_PROVIDER_UNAVAILABLE",
  localNestedCodexStatus: "REJECTED",
  enabledExecutableProviderCount: 0,
  callerInputAccepted: false,
  dispatchPerformed: false,
  providerCallPerformed: false,
  executableWorkerCertified: false,
  disabledProviderCertified: false,
  durablePersistenceClaimed: false,
  serviceWorkerClaimed: false,
  runtimeActivationAllowed: false,
  authorityGranted: false,
  secretsExposed: false,
  ownerRelayRequired: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-037",
  downstreamState: "PENDING",
  recordContentHash: "3283799cc653436b8a0d35575b08fc344611e3ec289afe8ca90e5de1db295f80",
} satisfies MultiAgentProviderConformanceEvidence)

export function isVerifiedWoMao036ProviderConformanceEvidence(
  record: MultiAgentProviderConformanceEvidence = MULTI_AGENT_PROVIDER_CONFORMANCE_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_PROVIDER_CONFORMANCE_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-036-PROVIDER-CONFORMANCE-SUITE-V1"
    && record.status === "CANONICAL_PROVIDER_CONFORMANCE_SUITE_VERIFIED"
    && record.workOrderId === "WO-MAO-036"
    && record.registryId === "williamos-provider-conformance-suite"
    && record.registryVersion === 1
    && record.readinessBaseCommitSha === "ae25dddb0590c19748dc0af13aebfa60bd080728"
    && record.readinessBaseTreeHash === "97ab235a6f343a6de2fafbb3d406d7bf8b0695e2"
    && record.registryContentHash === "cdd0b0e429228567e18925dd66a40d672181fb54c0111ad0e200d6031097d733"
    && record.resultHash === "79117c7b2046c673e45b2b6f71f6e229ee7868f907bb7e0dd05024ad737ca1b4"
    && record.codexConformanceContentHash === "052c437518a59b15c3d3c5e3553765a00dcf8d94b2eba76b55f9b37f845c0d38"
    && record.woMao035EvidenceHash === "50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a"
    && record.hostedCodexStatus === "SESSION_ONLY_CONFORMANT"
    && record.claudeCodeStatus === "DEFERRED_PROVIDER_UNAVAILABLE"
    && record.localNestedCodexStatus === "REJECTED"
    && record.enabledExecutableProviderCount === 0
    && record.callerInputAccepted === false
    && record.dispatchPerformed === false
    && record.providerCallPerformed === false
    && record.executableWorkerCertified === false
    && record.disabledProviderCertified === false
    && record.durablePersistenceClaimed === false
    && record.serviceWorkerClaimed === false
    && record.runtimeActivationAllowed === false
    && record.authorityGranted === false
    && record.secretsExposed === false
    && record.ownerRelayRequired === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-037"
    && record.downstreamState === "PENDING"
    && [record.readinessBaseCommitSha, record.readinessBaseTreeHash].every((value) => SHA_40.test(value))
    && [
      record.registryContentHash,
      record.resultHash,
      record.codexConformanceContentHash,
      record.woMao035EvidenceHash,
      record.recordContentHash,
    ].every((value) => HASH_64.test(value))
    && record.recordContentHash === "3283799cc653436b8a0d35575b08fc344611e3ec289afe8ca90e5de1db295f80"
}
