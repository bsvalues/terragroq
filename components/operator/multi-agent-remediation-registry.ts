import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentRemediationEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-040-REMEDIATION-REREVIEW-V1"
  status: "CANONICAL_REMEDIATION_REREVIEW_VERIFIED"
  workOrderId: "WO-MAO-040"
  remediationId: "remediation-wo-mao-040-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "REMEDIATION_REREVIEW_CLASSIFICATION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-026", "WO-MAO-031", "WO-MAO-039"]
  maxCycles: 1
  originalBuilderRequired: true
  independentReviewerRequired: true
  zeroUnresolvedThreadsRequired: true
  commandCount: 5
  reservedPathCount: 15
  changedPathCount: 15
  foreignChangeCount: 0
  secretLikeFindings: 0
  githubApiCalled: false
  branchMutated: false
  remediationApplied: false
  validationRerunPerformed: false
  reviewRequested: false
  reviewThreadResolved: false
  mergePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  productionWriteAllowed: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-041"
  downstreamState: "READY"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_REMEDIATION_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-040-REMEDIATION-REREVIEW-V1",
  status: "CANONICAL_REMEDIATION_REREVIEW_VERIFIED",
  workOrderId: "WO-MAO-040",
  remediationId: "remediation-wo-mao-040-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "eacc0c3aa1dc719f17b6b96377b8c6b31c2b7be1",
  baseTreeHash: "553fa0cf94a799e57b0f573d7e336f7aa83838b4",
  planContentHash: "2cc236487f15809ddfd89830400e2dbaa62b5ad7bfe628d11bc8bcf4eebbe1bf",
  resultHash: "463356546e218df13dde3c2b83bef18e14856de830a470a2401ba96116ea68d8",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "REMEDIATION_REREVIEW_CLASSIFICATION_ONLY",
  dependencyWorkOrders: ["WO-MAO-026", "WO-MAO-031", "WO-MAO-039"],
  maxCycles: 1,
  originalBuilderRequired: true,
  independentReviewerRequired: true,
  zeroUnresolvedThreadsRequired: true,
  commandCount: 5,
  reservedPathCount: 15,
  changedPathCount: 15,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  githubApiCalled: false,
  branchMutated: false,
  remediationApplied: false,
  validationRerunPerformed: false,
  reviewRequested: false,
  reviewThreadResolved: false,
  mergePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  productionWriteAllowed: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-041",
  downstreamState: "READY",
  recordContentHash: "5824568886fb6926457a68a0f7c3806ef0ee44859b38e932ed33a1e41c2102b9",
} satisfies MultiAgentRemediationEvidence)

export function isVerifiedWoMao040RemediationEvidence(
  record: MultiAgentRemediationEvidence = MULTI_AGENT_REMEDIATION_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_REMEDIATION_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-040-REMEDIATION-REREVIEW-V1"
    && record.status === "CANONICAL_REMEDIATION_REREVIEW_VERIFIED"
    && record.workOrderId === "WO-MAO-040"
    && record.remediationId === "remediation-wo-mao-040-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "eacc0c3aa1dc719f17b6b96377b8c6b31c2b7be1"
    && record.baseTreeHash === "553fa0cf94a799e57b0f573d7e336f7aa83838b4"
    && record.planContentHash === "2cc236487f15809ddfd89830400e2dbaa62b5ad7bfe628d11bc8bcf4eebbe1bf"
    && record.resultHash === "463356546e218df13dde3c2b83bef18e14856de830a470a2401ba96116ea68d8"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "REMEDIATION_REREVIEW_CLASSIFICATION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-026", "WO-MAO-031", "WO-MAO-039"])
    && record.maxCycles === 1
    && record.originalBuilderRequired === true
    && record.independentReviewerRequired === true
    && record.zeroUnresolvedThreadsRequired === true
    && record.commandCount === 5
    && record.reservedPathCount === 15
    && record.changedPathCount === 15
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.githubApiCalled === false
    && record.branchMutated === false
    && record.remediationApplied === false
    && record.validationRerunPerformed === false
    && record.reviewRequested === false
    && record.reviewThreadResolved === false
    && record.mergePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.productionWriteAllowed === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-041"
    && record.downstreamState === "READY"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "5824568886fb6926457a68a0f7c3806ef0ee44859b38e932ed33a1e41c2102b9"
}
