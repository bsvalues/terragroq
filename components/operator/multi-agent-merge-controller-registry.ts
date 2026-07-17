import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentMergeControllerEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-041-BOUNDED-MERGE-CONTROLLER-V1"
  status: "CANONICAL_BOUNDED_MERGE_CONTROLLER_VERIFIED"
  workOrderId: "WO-MAO-041"
  mergeControllerId: "merge-controller-wo-mao-041-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "BOUNDED_MERGE_ELIGIBILITY_DECISION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-007", "WO-MAO-020", "WO-MAO-039", "WO-MAO-040"]
  gateCount: 6
  deniedBypassCount: 5
  reservedPathCount: 15
  changedPathCount: 15
  foreignChangeCount: 0
  secretLikeFindings: 0
  githubApiCalled: false
  mergePerformed: false
  branchProtectionBypassed: false
  securityThreadDismissed: false
  authorityThreadDismissed: false
  reviewThreadResolved: false
  productionWriteAllowed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-042"
  downstreamState: "READY"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_MERGE_CONTROLLER_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-041-BOUNDED-MERGE-CONTROLLER-V1",
  status: "CANONICAL_BOUNDED_MERGE_CONTROLLER_VERIFIED",
  workOrderId: "WO-MAO-041",
  mergeControllerId: "merge-controller-wo-mao-041-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "ceccfb9b2496865f1b60bb54de24a7d6c8af79e5",
  baseTreeHash: "8dc455883469ee550e6d8d95eacf5ae986a31a2d",
  planContentHash: "f74c983d01c8757783c6d9277b8fb18b9af3191138576b12e4c58bb8fdf82f08",
  resultHash: "6c47aade2d779b27be7b72227196ec7e9d0740b8674b25084256740eb7ce6fa2",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "BOUNDED_MERGE_ELIGIBILITY_DECISION_ONLY",
  dependencyWorkOrders: ["WO-MAO-007", "WO-MAO-020", "WO-MAO-039", "WO-MAO-040"],
  gateCount: 6,
  deniedBypassCount: 5,
  reservedPathCount: 15,
  changedPathCount: 15,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  githubApiCalled: false,
  mergePerformed: false,
  branchProtectionBypassed: false,
  securityThreadDismissed: false,
  authorityThreadDismissed: false,
  reviewThreadResolved: false,
  productionWriteAllowed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-042",
  downstreamState: "READY",
  recordContentHash: "627a8ab17e98aa8c0c579653af013f5b7771f6bb2c05d4c31d11a8ce5369cd8b",
} satisfies MultiAgentMergeControllerEvidence)

export function isVerifiedWoMao041MergeControllerEvidence(
  record: MultiAgentMergeControllerEvidence = MULTI_AGENT_MERGE_CONTROLLER_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_MERGE_CONTROLLER_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-041-BOUNDED-MERGE-CONTROLLER-V1"
    && record.status === "CANONICAL_BOUNDED_MERGE_CONTROLLER_VERIFIED"
    && record.workOrderId === "WO-MAO-041"
    && record.mergeControllerId === "merge-controller-wo-mao-041-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "ceccfb9b2496865f1b60bb54de24a7d6c8af79e5"
    && record.baseTreeHash === "8dc455883469ee550e6d8d95eacf5ae986a31a2d"
    && record.planContentHash === "f74c983d01c8757783c6d9277b8fb18b9af3191138576b12e4c58bb8fdf82f08"
    && record.resultHash === "6c47aade2d779b27be7b72227196ec7e9d0740b8674b25084256740eb7ce6fa2"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "BOUNDED_MERGE_ELIGIBILITY_DECISION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-007", "WO-MAO-020", "WO-MAO-039", "WO-MAO-040"])
    && record.gateCount === 6
    && record.deniedBypassCount === 5
    && record.reservedPathCount === 15
    && record.changedPathCount === 15
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.githubApiCalled === false
    && record.mergePerformed === false
    && record.branchProtectionBypassed === false
    && record.securityThreadDismissed === false
    && record.authorityThreadDismissed === false
    && record.reviewThreadResolved === false
    && record.productionWriteAllowed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-042"
    && record.downstreamState === "READY"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "627a8ab17e98aa8c0c579653af013f5b7771f6bb2c05d4c31d11a8ce5369cd8b"
}
