import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentGitHubLifecycleEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-044-GITHUB-LIFECYCLE-CONFORMANCE-V1"
  status: "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_VERIFIED"
  workOrderId: "WO-MAO-044"
  conformanceId: "github-lifecycle-conformance-wo-mao-044-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "GITHUB_LIFECYCLE_CONFORMANCE_DECISION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042", "WO-MAO-043"]
  dependencyCount: 7
  lifecycleStageCount: 7
  conformanceGateCount: 6
  reservedPathCount: 15
  changedPathCount: 15
  foreignChangeCount: 0
  secretLikeFindings: 0
  githubApiCalled: false
  branchCreated: false
  commitCreated: false
  pullRequestCreated: false
  reviewThreadResolved: false
  mergePerformed: false
  cleanupPerformed: false
  providerDispatched: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-045"
  downstreamState: "READY"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_GITHUB_LIFECYCLE_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-044-GITHUB-LIFECYCLE-CONFORMANCE-V1",
  status: "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_VERIFIED",
  workOrderId: "WO-MAO-044",
  conformanceId: "github-lifecycle-conformance-wo-mao-044-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "1541db6530de525ef6f86c1b55758a71c7c5447f",
  baseTreeHash: "a0913fdefec84ef2d0cdf26a27e57abcfa6d2d6a",
  planContentHash: "029298e8dc683e74613e5d2dc1a56e0149c713ec0fcaf1e05341280f8cfbbacc",
  resultHash: "810fb1b18cb6b64a6497899588d17e975ce2b51575bb278bea0379d4e5a2f48e",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "GITHUB_LIFECYCLE_CONFORMANCE_DECISION_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042", "WO-MAO-043"] as const),
  dependencyCount: 7,
  lifecycleStageCount: 7,
  conformanceGateCount: 6,
  reservedPathCount: 15,
  changedPathCount: 15,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  githubApiCalled: false,
  branchCreated: false,
  commitCreated: false,
  pullRequestCreated: false,
  reviewThreadResolved: false,
  mergePerformed: false,
  cleanupPerformed: false,
  providerDispatched: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-045",
  downstreamState: "READY",
  recordContentHash: "95d7d86e4f6f2daa1174e7b1f7671a67b8ca88c4b7d691dbf1d8314ada8a3041",
} satisfies MultiAgentGitHubLifecycleEvidence)

export function isVerifiedWoMao044GitHubLifecycleEvidence(
  record: MultiAgentGitHubLifecycleEvidence = MULTI_AGENT_GITHUB_LIFECYCLE_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_GITHUB_LIFECYCLE_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-044-GITHUB-LIFECYCLE-CONFORMANCE-V1"
    && record.status === "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_VERIFIED"
    && record.workOrderId === "WO-MAO-044"
    && record.conformanceId === "github-lifecycle-conformance-wo-mao-044-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "1541db6530de525ef6f86c1b55758a71c7c5447f"
    && record.baseTreeHash === "a0913fdefec84ef2d0cdf26a27e57abcfa6d2d6a"
    && record.planContentHash === "029298e8dc683e74613e5d2dc1a56e0149c713ec0fcaf1e05341280f8cfbbacc"
    && record.resultHash === "810fb1b18cb6b64a6497899588d17e975ce2b51575bb278bea0379d4e5a2f48e"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "GITHUB_LIFECYCLE_CONFORMANCE_DECISION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042", "WO-MAO-043"])
    && record.dependencyCount === 7
    && record.lifecycleStageCount === 7
    && record.conformanceGateCount === 6
    && record.reservedPathCount === 15
    && record.changedPathCount === 15
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.githubApiCalled === false
    && record.branchCreated === false
    && record.commitCreated === false
    && record.pullRequestCreated === false
    && record.reviewThreadResolved === false
    && record.mergePerformed === false
    && record.cleanupPerformed === false
    && record.providerDispatched === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-045"
    && record.downstreamState === "READY"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "95d7d86e4f6f2daa1174e7b1f7671a67b8ca88c4b7d691dbf1d8314ada8a3041"
}
