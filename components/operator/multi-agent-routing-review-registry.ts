import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentRoutingReviewEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-034-ROUTING-REVIEW-V1"
  status: "IMPLEMENTATION_AND_INDEPENDENT_ASSURANCE_VERIFIED"
  workOrderId: "WO-MAO-034"
  candidateBaseCommitSha: string
  candidateCommitSha: string
  candidateTreeHash: string
  candidateDiffSha256: string
  candidateChangedPaths: readonly string[]
  routingRegistryContentHash: string
  routingResultHash: string
  assuranceIdentity: "wo-mao-034-independent-assurance-v1"
  assuranceSource: "HOSTED_CODEX_LOGICAL_ROLE_EXACT_CANDIDATE_REVIEW"
  assuranceProviderId: "hosted-codex"
  assuranceRole: "assurance"
  assuranceVerdict: "APPROVE"
  validationSource: "INDEPENDENT_5_FILE_36_TEST_EXACT_TREE_RUN"
  syntaxCheck: "PASS"
  diffCheck: "PASS"
  deterministicRunnerCheck: "PASS"
  blockingFindingCount: 0
  substantiveFindingCount: 0
  unresolvedFindingCount: 0
  reviewerEditedCandidate: false
  hostNativeBindingClaimed: false
  providerDispatchPerformed: false
  githubAutomationPerformed: false
  runtimeActivationPerformed: false
  authorityGranted: false
  ownerRelayRequired: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-035"
  downstreamState: "PENDING"
  downstreamDependencyWaived: false
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_ROUTING_REVIEW_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-034-ROUTING-REVIEW-V1",
  status: "IMPLEMENTATION_AND_INDEPENDENT_ASSURANCE_VERIFIED",
  workOrderId: "WO-MAO-034",
  candidateBaseCommitSha: "6cf94e9dcd1c482fdf5f0df74747c69b85ec7898",
  candidateCommitSha: "1d12d958c05d83d3dd3f20a2b0be8bbaf4c6bc36",
  candidateTreeHash: "9af5d82f9bbdb994aa5b4500f0d47ac78cbc510c",
  candidateDiffSha256: "4e740a6ad3e0cb82ed7158def659819acd7aa9931c2d338b294cd90c49232ef8",
  candidateChangedPaths: Object.freeze([
    "scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs",
    "scripts/multi-agent-operator/cross-provider-routing-review-registry.mjs",
    "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
    "tests/multi-agent-cross-provider-routing-review.test.ts",
  ]),
  routingRegistryContentHash: "d83af5f3792225d5127e6dc024eb606b66961360967a9ab0c7069054af2dfb65",
  routingResultHash: "e91e943a989403d93a9aaf52ff99bf63cab73dc9a7b3c855ef7a7a5211a33da3",
  assuranceIdentity: "wo-mao-034-independent-assurance-v1",
  assuranceSource: "HOSTED_CODEX_LOGICAL_ROLE_EXACT_CANDIDATE_REVIEW",
  assuranceProviderId: "hosted-codex",
  assuranceRole: "assurance",
  assuranceVerdict: "APPROVE",
  validationSource: "INDEPENDENT_5_FILE_36_TEST_EXACT_TREE_RUN",
  syntaxCheck: "PASS",
  diffCheck: "PASS",
  deterministicRunnerCheck: "PASS",
  blockingFindingCount: 0,
  substantiveFindingCount: 0,
  unresolvedFindingCount: 0,
  reviewerEditedCandidate: false,
  hostNativeBindingClaimed: false,
  providerDispatchPerformed: false,
  githubAutomationPerformed: false,
  runtimeActivationPerformed: false,
  authorityGranted: false,
  ownerRelayRequired: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-035",
  downstreamState: "PENDING",
  downstreamDependencyWaived: false,
  recordContentHash: "1c2083d722b26d728dfa9f89700e2440a0b0b0d4852764f43ee3db95e9e14e07",
} satisfies MultiAgentRoutingReviewEvidence)

export function isVerifiedWoMao034RoutingReviewEvidence(
  record: MultiAgentRoutingReviewEvidence = MULTI_AGENT_ROUTING_REVIEW_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_ROUTING_REVIEW_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-034-ROUTING-REVIEW-V1"
    && record.status === "IMPLEMENTATION_AND_INDEPENDENT_ASSURANCE_VERIFIED"
    && record.workOrderId === "WO-MAO-034"
    && record.candidateBaseCommitSha === "6cf94e9dcd1c482fdf5f0df74747c69b85ec7898"
    && record.candidateCommitSha === "1d12d958c05d83d3dd3f20a2b0be8bbaf4c6bc36"
    && record.candidateTreeHash === "9af5d82f9bbdb994aa5b4500f0d47ac78cbc510c"
    && record.candidateDiffSha256 === "4e740a6ad3e0cb82ed7158def659819acd7aa9931c2d338b294cd90c49232ef8"
    && JSON.stringify(record.candidateChangedPaths) === JSON.stringify(MULTI_AGENT_ROUTING_REVIEW_EVIDENCE.candidateChangedPaths)
    && record.routingRegistryContentHash === "d83af5f3792225d5127e6dc024eb606b66961360967a9ab0c7069054af2dfb65"
    && record.routingResultHash === "e91e943a989403d93a9aaf52ff99bf63cab73dc9a7b3c855ef7a7a5211a33da3"
    && record.assuranceIdentity === "wo-mao-034-independent-assurance-v1"
    && record.assuranceSource === "HOSTED_CODEX_LOGICAL_ROLE_EXACT_CANDIDATE_REVIEW"
    && record.assuranceProviderId === "hosted-codex"
    && record.assuranceRole === "assurance"
    && record.assuranceVerdict === "APPROVE"
    && record.validationSource === "INDEPENDENT_5_FILE_36_TEST_EXACT_TREE_RUN"
    && record.syntaxCheck === "PASS"
    && record.diffCheck === "PASS"
    && record.deterministicRunnerCheck === "PASS"
    && record.blockingFindingCount === 0
    && record.substantiveFindingCount === 0
    && record.unresolvedFindingCount === 0
    && record.reviewerEditedCandidate === false
    && record.hostNativeBindingClaimed === false
    && record.providerDispatchPerformed === false
    && record.githubAutomationPerformed === false
    && record.runtimeActivationPerformed === false
    && record.authorityGranted === false
    && record.ownerRelayRequired === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-035"
    && record.downstreamState === "PENDING"
    && record.downstreamDependencyWaived === false
    && [record.candidateBaseCommitSha, record.candidateCommitSha, record.candidateTreeHash].every((value) => SHA_40.test(value))
    && [record.candidateDiffSha256, record.routingRegistryContentHash, record.routingResultHash,
      record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "1c2083d722b26d728dfa9f89700e2440a0b0b0d4852764f43ee3db95e9e14e07"
}
