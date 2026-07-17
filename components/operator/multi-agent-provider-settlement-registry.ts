export type MultiAgentProviderSettlementRecord = {
  settlementId: "SETTLEMENT-WO-MAO-034-WO-MAO-033"
  status: "CANONICAL_PROVIDER_UNAVAILABLE_SETTLEMENT_VERIFIED"
  assessmentWorkOrderId: "WO-MAO-032"
  assessmentState: "COMPLETE"
  assessmentEnvelopeHash: string
  assessmentArtifactId: "settlement-wo-mao-034-claude-unavailable-v2"
  assessmentContentHash: string
  subjectWorkOrderId: "WO-MAO-033"
  subjectState: "DEFERRED_PROVIDER_UNAVAILABLE"
  subjectEnvelopeHash: string
  consumerWorkOrderId: "WO-MAO-034"
  consumerState: "READY"
  consumerCompleted: false
  consumerEnvelopeHash: string
  sourceAssessmentContentHash: string
  sourceCommitSha: "42a63e3e11e5bb1a9c1e9419db3e0f2651b1789c"
  trustRegistryId: "williamos-provider-assessment-pins"
  trustRegistryVersion: 2
  trustRootFingerprint: string
  trustBundleContentHash: string
  trustStatusHeadHash: string
  trustRegistryRecordContentHash: string
  trustRegistryContentHash: string
  settlementResultHash: string
  providerId: "claude-code"
  providerEnabled: false
  dispatchPerformed: false
  runtimeActivationAllowed: false
  authorityGranted: false
  ownerRelayRequired: false
}

const HASH = /^[a-f0-9]{64}$/

export const MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD = Object.freeze({
  settlementId: "SETTLEMENT-WO-MAO-034-WO-MAO-033",
  status: "CANONICAL_PROVIDER_UNAVAILABLE_SETTLEMENT_VERIFIED",
  assessmentWorkOrderId: "WO-MAO-032",
  assessmentState: "COMPLETE",
  assessmentEnvelopeHash: "4f4495e4ca5e0691ba99ac277a74f5c29c594e9f300fd02979fa2eea07628da8",
  assessmentArtifactId: "settlement-wo-mao-034-claude-unavailable-v2",
  assessmentContentHash: "5b19ba9eacf183ea8afaa799f3015c18e48ab0cf3356c5aa35de55056f68a3b6",
  subjectWorkOrderId: "WO-MAO-033",
  subjectState: "DEFERRED_PROVIDER_UNAVAILABLE",
  subjectEnvelopeHash: "5311ed8044b3b40a9ea7604cdb77a90d29f2d5562562a7c2988313f76a7226ee",
  consumerWorkOrderId: "WO-MAO-034",
  consumerState: "READY",
  consumerCompleted: false,
  consumerEnvelopeHash: "c03f2339666105cbe08b51ef32a50000d3b2441103f4420721f216c75667cb03",
  sourceAssessmentContentHash: "60917d122e314844e175c9d4e6e60e197a5e4f06bc2b6f2ea73b0fc1e09ed523",
  sourceCommitSha: "42a63e3e11e5bb1a9c1e9419db3e0f2651b1789c",
  trustRegistryId: "williamos-provider-assessment-pins",
  trustRegistryVersion: 2,
  trustRootFingerprint: "97ee87ea1c013ed8e4646c3852d935629c01d7c69cf38e8d0f66e87b2d8097be",
  trustBundleContentHash: "e5b64e7097afc38d363bba83c287053004531421add97c3908b27e8d3cd7a1b0",
  trustStatusHeadHash: "3f697265d1efc91373251d1f5bea3f847052ac425eb5a22d41fe74b8d86f8ff0",
  trustRegistryRecordContentHash: "302660be359c2bae4d058ed26c466c7e53c38784a895a7fcdcbf5f4312b4a069",
  trustRegistryContentHash: "a169923137282bd12d643107c8ec623378f14c1bad49743df1a39916ca8d37a2",
  settlementResultHash: "a1a3ee8742c14dcd458ce28d12d1a392d25d605018f074dc0ebe4855f62b11f9",
  providerId: "claude-code",
  providerEnabled: false,
  dispatchPerformed: false,
  runtimeActivationAllowed: false,
  authorityGranted: false,
  ownerRelayRequired: false,
} satisfies MultiAgentProviderSettlementRecord)

export function isVerifiedWoMao034ProviderSettlement(
  record: MultiAgentProviderSettlementRecord = MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
) {
  return record.settlementId === "SETTLEMENT-WO-MAO-034-WO-MAO-033"
    && record.status === "CANONICAL_PROVIDER_UNAVAILABLE_SETTLEMENT_VERIFIED"
    && record.assessmentWorkOrderId === "WO-MAO-032"
    && record.assessmentState === "COMPLETE"
    && record.assessmentEnvelopeHash === "4f4495e4ca5e0691ba99ac277a74f5c29c594e9f300fd02979fa2eea07628da8"
    && record.assessmentArtifactId === "settlement-wo-mao-034-claude-unavailable-v2"
    && record.assessmentContentHash === "5b19ba9eacf183ea8afaa799f3015c18e48ab0cf3356c5aa35de55056f68a3b6"
    && record.subjectWorkOrderId === "WO-MAO-033"
    && record.subjectState === "DEFERRED_PROVIDER_UNAVAILABLE"
    && record.subjectEnvelopeHash === "5311ed8044b3b40a9ea7604cdb77a90d29f2d5562562a7c2988313f76a7226ee"
    && record.consumerWorkOrderId === "WO-MAO-034"
    && record.consumerState === "READY"
    && record.consumerCompleted === false
    && record.consumerEnvelopeHash === "c03f2339666105cbe08b51ef32a50000d3b2441103f4420721f216c75667cb03"
    && record.sourceAssessmentContentHash === "60917d122e314844e175c9d4e6e60e197a5e4f06bc2b6f2ea73b0fc1e09ed523"
    && record.sourceCommitSha === "42a63e3e11e5bb1a9c1e9419db3e0f2651b1789c"
    && record.trustRegistryId === "williamos-provider-assessment-pins"
    && record.trustRegistryVersion === 2
    && record.trustRootFingerprint === "97ee87ea1c013ed8e4646c3852d935629c01d7c69cf38e8d0f66e87b2d8097be"
    && record.trustBundleContentHash === "e5b64e7097afc38d363bba83c287053004531421add97c3908b27e8d3cd7a1b0"
    && record.trustStatusHeadHash === "3f697265d1efc91373251d1f5bea3f847052ac425eb5a22d41fe74b8d86f8ff0"
    && record.trustRegistryRecordContentHash === "302660be359c2bae4d058ed26c466c7e53c38784a895a7fcdcbf5f4312b4a069"
    && record.trustRegistryContentHash === "a169923137282bd12d643107c8ec623378f14c1bad49743df1a39916ca8d37a2"
    && record.settlementResultHash === "a1a3ee8742c14dcd458ce28d12d1a392d25d605018f074dc0ebe4855f62b11f9"
    && [record.assessmentEnvelopeHash, record.assessmentContentHash, record.subjectEnvelopeHash,
      record.consumerEnvelopeHash, record.sourceAssessmentContentHash, record.trustRootFingerprint,
      record.trustBundleContentHash, record.trustStatusHeadHash, record.trustRegistryRecordContentHash,
      record.trustRegistryContentHash, record.settlementResultHash].every((value) => HASH.test(value))
    && record.providerId === "claude-code"
    && record.providerEnabled === false
    && record.dispatchPerformed === false
    && record.runtimeActivationAllowed === false
    && record.authorityGranted === false
    && record.ownerRelayRequired === false
}
