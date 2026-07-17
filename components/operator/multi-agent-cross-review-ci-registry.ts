import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentCrossReviewCiEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-056-CROSS-REVIEW-CI-REMEDIATION-CERTIFICATION-V1"
  status: "CANONICAL_CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_VERIFIED"
  workOrderId: "WO-MAO-056"
  certificationId: "cross-review-ci-remediation-certification-wo-mao-056-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-055"]
  requestedChangesCycle: "WO-MAO-055-RESERVATION-ACCOUNTING-P2"
  remediationStatus: "REMEDIATED"
  ciRepairStatus: "PASS"
  reviewCycleCount: 1
  ciRepairCycleCount: 1
  unresolvedReviewThreadsObserved: 0
  reservedPathCount: 9
  changedPathCount: 9
  foreignChangeCount: 0
  secretLikeFindings: 0
  schedulerAdded: false
  providerExecutionPerformed: false
  githubApiCalled: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  stateMutationPerformed: false
  productionWritePerformed: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-058"
  downstreamState: "WAITING_FOR_WO_MAO_057"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_CROSS_REVIEW_CI_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-056-CROSS-REVIEW-CI-REMEDIATION-CERTIFICATION-V1",
  status: "CANONICAL_CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_VERIFIED",
  workOrderId: "WO-MAO-056",
  certificationId: "cross-review-ci-remediation-certification-wo-mao-056-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "9ba25cf7ed3b948887fea8a37313eae4513e1804",
  baseTreeHash: "27fd22bc2ad834e0a270843e10196f17802fbd40",
  planContentHash: "4aec3517faafe914e1a89afa0c4f3e09f1ac6079070f04eb41be870dda237e4b",
  resultHash: "f2789b1c6d46270c8c0576735bbe1126c5ca0f05379806f3c6d0578890e73f8c",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-055"] as const),
  requestedChangesCycle: "WO-MAO-055-RESERVATION-ACCOUNTING-P2",
  remediationStatus: "REMEDIATED",
  ciRepairStatus: "PASS",
  reviewCycleCount: 1,
  ciRepairCycleCount: 1,
  unresolvedReviewThreadsObserved: 0,
  reservedPathCount: 9,
  changedPathCount: 9,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  schedulerAdded: false,
  providerExecutionPerformed: false,
  githubApiCalled: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  stateMutationPerformed: false,
  productionWritePerformed: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-058",
  downstreamState: "WAITING_FOR_WO_MAO_057",
  recordContentHash: "e8414ecf935ef6e14bf135c253cc9c62196a84bfd526d9e05fc15f9ed18fc727",
} satisfies MultiAgentCrossReviewCiEvidence)

export function isVerifiedWoMao056CrossReviewCiEvidence(
  record: MultiAgentCrossReviewCiEvidence = MULTI_AGENT_CROSS_REVIEW_CI_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_CROSS_REVIEW_CI_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-056-CROSS-REVIEW-CI-REMEDIATION-CERTIFICATION-V1"
    && record.status === "CANONICAL_CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_VERIFIED"
    && record.workOrderId === "WO-MAO-056"
    && record.certificationId === "cross-review-ci-remediation-certification-wo-mao-056-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "9ba25cf7ed3b948887fea8a37313eae4513e1804"
    && record.baseTreeHash === "27fd22bc2ad834e0a270843e10196f17802fbd40"
    && record.planContentHash === "4aec3517faafe914e1a89afa0c4f3e09f1ac6079070f04eb41be870dda237e4b"
    && record.resultHash === "f2789b1c6d46270c8c0576735bbe1126c5ca0f05379806f3c6d0578890e73f8c"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-055"])
    && record.requestedChangesCycle === "WO-MAO-055-RESERVATION-ACCOUNTING-P2"
    && record.remediationStatus === "REMEDIATED"
    && record.ciRepairStatus === "PASS"
    && record.reviewCycleCount === 1
    && record.ciRepairCycleCount === 1
    && record.unresolvedReviewThreadsObserved === 0
    && record.reservedPathCount === 9
    && record.changedPathCount === 9
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.schedulerAdded === false
    && record.providerExecutionPerformed === false
    && record.githubApiCalled === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.stateMutationPerformed === false
    && record.productionWritePerformed === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-058"
    && record.downstreamState === "WAITING_FOR_WO_MAO_057"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "e8414ecf935ef6e14bf135c253cc9c62196a84bfd526d9e05fc15f9ed18fc727"
}
