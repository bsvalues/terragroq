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
  record: unknown = MULTI_AGENT_MERGE_VERIFY_FANIN_EVIDENCE,
) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return false
  const candidate = record as MultiAgentMergeVerifyFanInEvidence
  const { recordContentHash, ...recordClaims } = candidate
  let computedHash
  try {
    computedHash = hashRecord(recordClaims)
  } catch {
    return false
  }
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_MERGE_VERIFY_FANIN_EVIDENCE).sort())
    && computedHash === recordContentHash
    && candidate.evidenceId === "EVIDENCE-WO-MAO-058-MERGE-VERIFY-CLEAN-FANIN-RELEASE-V1"
    && candidate.status === "CANONICAL_MERGE_VERIFY_CLEAN_FANIN_RELEASE_VERIFIED"
    && candidate.workOrderId === "WO-MAO-058"
    && candidate.releaseId === "merge-verify-clean-fanin-release-wo-mao-058-v1"
    && candidate.repository === "bsvalues/terragroq"
    && candidate.mainCommitSha === "9a1fff71727c9df72d476e5df20b9ae6457631ba"
    && candidate.mainTreeHash === "0c5a74698825b8b48c6a2a991277e7931acd8ffe"
    && candidate.planContentHash === "17e19107f70be0b75d31bc7ac88422293f89232cd60c6bea7feb9c78ddb2a229"
    && candidate.resultHash === "4461ccc615edb0746ffdd15743caf903aaf340a858640b2bb4ef78236a112cc4"
    && candidate.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && candidate.authorityScope === "MERGE_VERIFY_CLEAN_FANIN_RELEASE_ONLY"
    && JSON.stringify(candidate.dependencyWorkOrders) === JSON.stringify(["WO-MAO-056", "WO-MAO-057"])
    && JSON.stringify(candidate.mergedPullRequests) === JSON.stringify([411, 412])
    && candidate.mergedPullRequestCount === 2
    && candidate.routeCheckCount === 4
    && candidate.releasedReservationCount === 2
    && candidate.deniedCleanupActionCount === 6
    && candidate.reservedPathCount === 16
    && candidate.changedPathCount === 16
    && candidate.foreignChangeCount === 0
    && candidate.secretLikeFindings === 0
    && candidate.githubPrLifecycleUsed === true
    && candidate.mergePerformed === true
    && candidate.cleanupPerformed === true
    && candidate.unsafeCleanupPerformed === false
    && candidate.runtimeActivationAllowed === false
    && candidate.commandRunnerAdded === false
    && candidate.backgroundWorkerAdded === false
    && candidate.productionWritePerformed === false
    && candidate.secretMaterialAllowed === false
    && candidate.ownerOperationRequired === false
    && candidate.paidOverageAllowed === false
    && candidate.rejectedRuntimeRetried === false
    && candidate.authorityGranted === false
    && candidate.completionState === "COMPLETE"
    && candidate.downstreamWorkOrderId === "WO-MAO-059"
    && candidate.downstreamState === "READY_AFTER_WO_MAO_058_FANIN_RELEASE"
    && candidate.soakDurationCertified === false
    && candidate.tenConsecutiveWorkOrdersCertified === false
    && [candidate.mainCommitSha, candidate.mainTreeHash].every((value) => SHA_40.test(value))
    && [candidate.planContentHash, candidate.resultHash, candidate.recordContentHash].every((value) => HASH_64.test(value))
    && candidate.recordContentHash === "ec2418f4572b74c14cb345af18d886631a2c0e17930bf43a8f0c5649c696b8d6"
}
