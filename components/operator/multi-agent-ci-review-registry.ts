import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentCiReviewEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-039-CI-REVIEW-INGESTION-V1"
  status: "CANONICAL_CI_REVIEW_INGESTION_VERIFIED"
  workOrderId: "WO-MAO-039"
  ingestionId: "ingestion-wo-mao-039-ci-review-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "CI_REVIEW_INGESTION_CLASSIFICATION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-020", "WO-MAO-022", "WO-MAO-038"]
  requiredCheckCount: 3
  optionalCheckCount: 1
  reviewThreadClassCount: 3
  failureClassCount: 5
  reservedPathCount: 15
  changedPathCount: 15
  foreignChangeCount: 0
  secretLikeFindings: 0
  githubApiCalled: false
  checkRerunPerformed: false
  reviewThreadResolved: false
  reviewCommentPosted: false
  remediationPerformed: false
  mergePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  productionWriteAllowed: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-040"
  downstreamState: "READY"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_CI_REVIEW_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-039-CI-REVIEW-INGESTION-V1",
  status: "CANONICAL_CI_REVIEW_INGESTION_VERIFIED",
  workOrderId: "WO-MAO-039",
  ingestionId: "ingestion-wo-mao-039-ci-review-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "365c42a4d64b3d374f6a4417624ce2df54460c0a",
  baseTreeHash: "41a7444b50bb2cd4f707d523cd5837c03e109221",
  planContentHash: "9eaac8aec1c65ec262b9d13227971a1a44a8705892906e2159f5d811814b067e",
  resultHash: "b8975bca7ecb9ea4ffcd730d03f6a26915e8da0ec08dfd58137c1bfdaef3da7d",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "CI_REVIEW_INGESTION_CLASSIFICATION_ONLY",
  dependencyWorkOrders: ["WO-MAO-020", "WO-MAO-022", "WO-MAO-038"],
  requiredCheckCount: 3,
  optionalCheckCount: 1,
  reviewThreadClassCount: 3,
  failureClassCount: 5,
  reservedPathCount: 15,
  changedPathCount: 15,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  githubApiCalled: false,
  checkRerunPerformed: false,
  reviewThreadResolved: false,
  reviewCommentPosted: false,
  remediationPerformed: false,
  mergePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  productionWriteAllowed: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-040",
  downstreamState: "READY",
  recordContentHash: "10dcc5064432b0274a21fb6601f9df74623217f810f3c9b9b80ac87c10b650d8",
} satisfies MultiAgentCiReviewEvidence)

export function isVerifiedWoMao039CiReviewEvidence(
  record: MultiAgentCiReviewEvidence = MULTI_AGENT_CI_REVIEW_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_CI_REVIEW_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-039-CI-REVIEW-INGESTION-V1"
    && record.status === "CANONICAL_CI_REVIEW_INGESTION_VERIFIED"
    && record.workOrderId === "WO-MAO-039"
    && record.ingestionId === "ingestion-wo-mao-039-ci-review-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "365c42a4d64b3d374f6a4417624ce2df54460c0a"
    && record.baseTreeHash === "41a7444b50bb2cd4f707d523cd5837c03e109221"
    && record.planContentHash === "9eaac8aec1c65ec262b9d13227971a1a44a8705892906e2159f5d811814b067e"
    && record.resultHash === "b8975bca7ecb9ea4ffcd730d03f6a26915e8da0ec08dfd58137c1bfdaef3da7d"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "CI_REVIEW_INGESTION_CLASSIFICATION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-020", "WO-MAO-022", "WO-MAO-038"])
    && record.requiredCheckCount === 3
    && record.optionalCheckCount === 1
    && record.reviewThreadClassCount === 3
    && record.failureClassCount === 5
    && record.reservedPathCount === 15
    && record.changedPathCount === 15
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.githubApiCalled === false
    && record.checkRerunPerformed === false
    && record.reviewThreadResolved === false
    && record.reviewCommentPosted === false
    && record.remediationPerformed === false
    && record.mergePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.productionWriteAllowed === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-040"
    && record.downstreamState === "READY"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "10dcc5064432b0274a21fb6601f9df74623217f810f3c9b9b80ac87c10b650d8"
}
