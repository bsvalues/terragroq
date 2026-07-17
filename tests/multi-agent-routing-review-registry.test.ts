import { describe, expect, it } from "vitest"

import {
  MULTI_AGENT_ROUTING_REVIEW_EVIDENCE,
  isVerifiedWoMao034RoutingReviewEvidence,
  type MultiAgentRoutingReviewEvidence,
} from "@/components/operator/multi-agent-routing-review-registry"
import { hashRecord } from "@/lib/governance/hash"

function copyEvidence() {
  return structuredClone(MULTI_AGENT_ROUTING_REVIEW_EVIDENCE) as MultiAgentRoutingReviewEvidence
}

describe("WO-MAO-034 routing review evidence registry", () => {
  it("binds the independently approved exact implementation candidate", () => {
    expect(isVerifiedWoMao034RoutingReviewEvidence()).toBe(true)
    expect(MULTI_AGENT_ROUTING_REVIEW_EVIDENCE).toMatchObject({
      candidateBaseCommitSha: "6cf94e9dcd1c482fdf5f0df74747c69b85ec7898",
      candidateCommitSha: "1d12d958c05d83d3dd3f20a2b0be8bbaf4c6bc36",
      candidateTreeHash: "9af5d82f9bbdb994aa5b4500f0d47ac78cbc510c",
      candidateDiffSha256: "4e740a6ad3e0cb82ed7158def659819acd7aa9931c2d338b294cd90c49232ef8",
      routingRegistryContentHash: "d83af5f3792225d5127e6dc024eb606b66961360967a9ab0c7069054af2dfb65",
      routingResultHash: "e91e943a989403d93a9aaf52ff99bf63cab73dc9a7b3c855ef7a7a5211a33da3",
      assuranceIdentity: "wo-mao-034-independent-assurance-v1",
      assuranceSource: "HOSTED_CODEX_LOGICAL_ROLE_EXACT_CANDIDATE_REVIEW",
      assuranceProviderId: "hosted-codex",
      assuranceRole: "assurance",
      assuranceVerdict: "APPROVE",
      validationSource: "INDEPENDENT_5_FILE_36_TEST_EXACT_TREE_RUN",
      blockingFindingCount: 0,
      substantiveFindingCount: 0,
      unresolvedFindingCount: 0,
      reviewerEditedCandidate: false,
      hostNativeBindingClaimed: false,
      providerDispatchPerformed: false,
      githubAutomationPerformed: false,
      runtimeActivationPerformed: false,
      authorityGranted: false,
      completionState: "COMPLETE",
      downstreamWorkOrderId: "WO-MAO-035",
      downstreamState: "PENDING",
      downstreamDependencyWaived: false,
      recordContentHash: "1c2083d722b26d728dfa9f89700e2440a0b0b0d4852764f43ee3db95e9e14e07",
    })
    expect(MULTI_AGENT_ROUTING_REVIEW_EVIDENCE.candidateChangedPaths).toEqual([
      "scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs",
      "scripts/multi-agent-operator/cross-provider-routing-review-registry.mjs",
      "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
      "tests/multi-agent-cross-provider-routing-review.test.ts",
    ])
  })

  it("rejects candidate, assurance, nonclaim, path, hash, and schema substitution", () => {
    for (const mutate of [
      (value: any) => { value.candidateCommitSha = "f".repeat(40) },
      (value: any) => { value.candidateTreeHash = "f".repeat(40) },
      (value: any) => { value.candidateDiffSha256 = "f".repeat(64) },
      (value: any) => { value.candidateChangedPaths.pop() },
      (value: any) => { value.candidateChangedPaths.push(value.candidateChangedPaths[0]) },
      (value: any) => { value.candidateChangedPaths.reverse() },
      (value: any) => { value.assuranceIdentity = "caller-assurance" },
      (value: any) => { value.assuranceVerdict = "APPROVE_WITH_FINDINGS" },
      (value: any) => { value.unresolvedFindingCount = 1 },
      (value: any) => { value.reviewerEditedCandidate = true },
      (value: any) => { value.hostNativeBindingClaimed = true },
      (value: any) => { value.providerDispatchPerformed = true },
      (value: any) => { value.runtimeActivationPerformed = true },
      (value: any) => { value.downstreamState = "READY" },
      (value: any) => { value.downstreamDependencyWaived = true },
      (value: any) => { value.recordContentHash = "f".repeat(64) },
      (value: any) => { delete value.routingResultHash },
      (value: any) => { value.unexpected = true },
    ]) {
      const value = copyEvidence()
      mutate(value)
      expect(isVerifiedWoMao034RoutingReviewEvidence(value)).toBe(false)
    }
  })

  it("rejects a mutated record even when the caller recomputes its content hash", () => {
    const value = copyEvidence() as any
    value.assuranceVerdict = "CALLER_APPROVED"
    const { recordContentHash: _discarded, ...recordClaims } = value
    value.recordContentHash = hashRecord(recordClaims)
    expect(value.recordContentHash).not.toBe(MULTI_AGENT_ROUTING_REVIEW_EVIDENCE.recordContentHash)
    expect(isVerifiedWoMao034RoutingReviewEvidence(value)).toBe(false)
  })
})
