import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentMergeVerifyFanInEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-058-MERGE-VERIFY-CLEAN-FANIN-RELEASE-V1"
  status: "CANONICAL_MERGE_VERIFY_CLEAN_FANIN_RELEASE_VERIFIED"
  workOrderId: "WO-MAO-058"
  releaseId: "merge-verify-clean-fanin-release-wo-mao-058-v1"
  repository: "bsvalues/terragroq"
  mainCommitSha: string
  mainTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "MERGE_VERIFY_CLEAN_FANIN_RELEASE_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-056", "WO-MAO-057"]
  mergedPullRequests: readonly [411, 412]
  mergedPullRequestCount: 2
  routeCheckCount: 4
  releasedReservationCount: 2
  deniedCleanupActionCount: 6
  reservedPathCount: 16
  changedPathCount: 16
  foreignChangeCount: 0
  secretLikeFindings: 0
  githubPrLifecycleUsed: true
  mergePerformed: true
  cleanupPerformed: true
  unsafeCleanupPerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  productionWritePerformed: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  paidOverageAllowed: false
  rejectedRuntimeRetried: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-059"
  downstreamState: "READY_AFTER_WO_MAO_058_FANIN_RELEASE"
  soakDurationCertified: false
  tenConsecutiveWorkOrdersCertified: false
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[0-9a-f]{40}$/

export const MULTI_AGENT_MERGE_VERIFY_FANIN_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-058-MERGE-VERIFY-CLEAN-FANIN-RELEASE-V1",
  status: "CANONICAL_MERGE_VERIFY_CLEAN_FANIN_RELEASE_VERIFIED",
  workOrderId: "WO-MAO-058",
  releaseId: "merge-verify-clean-fanin-release-wo-mao-058-v1",
  repository: "bsvalues/terragroq",
  mainCommitSha: "9a1fff71727c9df72d476e5df20b9ae6457631ba",
  mainTreeHash: "0c5a74698825b8b48c6a2a991277e7931acd8ffe",
  planContentHash: "17e19107f70be0b75d31bc7ac88422293f89232cd60c6bea7feb9c78ddb2a229",
  resultHash: "4461ccc615edb0746ffdd15743caf903aaf340a858640b2bb4ef78236a112cc4",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "MERGE_VERIFY_CLEAN_FANIN_RELEASE_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-056", "WO-MAO-057"] as const),
  mergedPullRequests: Object.freeze([411, 412] as const),
  mergedPullRequestCount: 2,
  routeCheckCount: 4,
  releasedReservationCount: 2,
  deniedCleanupActionCount: 6,
  reservedPathCount: 16,
  changedPathCount: 16,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  githubPrLifecycleUsed: true,
  mergePerformed: true,
  cleanupPerformed: true,
  unsafeCleanupPerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  productionWritePerformed: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  paidOverageAllowed: false,
  rejectedRuntimeRetried: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-059",
  downstreamState: "READY_AFTER_WO_MAO_058_FANIN_RELEASE",
  soakDurationCertified: false,
  tenConsecutiveWorkOrdersCertified: false,
  recordContentHash: "ec2418f4572b74c14cb345af18d886631a2c0e17930bf43a8f0c5649c696b8d6",
} satisfies MultiAgentMergeVerifyFanInEvidence)

export function isVerifiedWoMao058MergeVerifyFanInEvidence(
  record: MultiAgentMergeVerifyFanInEvidence = MULTI_AGENT_MERGE_VERIFY_FANIN_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_MERGE_VERIFY_FANIN_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-058-MERGE-VERIFY-CLEAN-FANIN-RELEASE-V1"
    && record.status === "CANONICAL_MERGE_VERIFY_CLEAN_FANIN_RELEASE_VERIFIED"
    && record.workOrderId === "WO-MAO-058"
    && record.releaseId === "merge-verify-clean-fanin-release-wo-mao-058-v1"
    && record.repository === "bsvalues/terragroq"
    && record.mainCommitSha === "9a1fff71727c9df72d476e5df20b9ae6457631ba"
    && record.mainTreeHash === "0c5a74698825b8b48c6a2a991277e7931acd8ffe"
    && record.planContentHash === "17e19107f70be0b75d31bc7ac88422293f89232cd60c6bea7feb9c78ddb2a229"
    && record.resultHash === "4461ccc615edb0746ffdd15743caf903aaf340a858640b2bb4ef78236a112cc4"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "MERGE_VERIFY_CLEAN_FANIN_RELEASE_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-056", "WO-MAO-057"])
    && JSON.stringify(record.mergedPullRequests) === JSON.stringify([411, 412])
    && record.mergedPullRequestCount === 2
    && record.routeCheckCount === 4
    && record.releasedReservationCount === 2
    && record.deniedCleanupActionCount === 6
    && record.reservedPathCount === 16
    && record.changedPathCount === 16
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.githubPrLifecycleUsed === true
    && record.mergePerformed === true
    && record.cleanupPerformed === true
    && record.unsafeCleanupPerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.productionWritePerformed === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.paidOverageAllowed === false
    && record.rejectedRuntimeRetried === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-059"
    && record.downstreamState === "READY_AFTER_WO_MAO_058_FANIN_RELEASE"
    && record.soakDurationCertified === false
    && record.tenConsecutiveWorkOrdersCertified === false
    && [record.mainCommitSha, record.mainTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "ec2418f4572b74c14cb345af18d886631a2c0e17930bf43a8f0c5649c696b8d6"
}
