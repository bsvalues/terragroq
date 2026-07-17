import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentFailureRecoveryEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-057-FAILURE-RECOVERY-CERTIFICATION-V1"
  status: "CANONICAL_FAILURE_RECOVERY_CERTIFICATION_VERIFIED"
  workOrderId: "WO-MAO-057"
  certificationId: "failure-recovery-certification-wo-mao-057-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "FAILURE_RECOVERY_CERTIFICATION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-056"]
  certifiedInjectionClasses: readonly ["COORDINATOR_RESTART", "PROVIDER_NETWORK_FAILURE", "RESERVATION_COLLISION", "STALE_BASE_EVENT", "WORKER_DEATH"]
  failureInjectionCount: 5
  recoveryGateCount: 5
  ownerOperationRequiredCount: 0
  reservedPathCount: 16
  changedPathCount: 16
  foreignChangeCount: 0
  secretLikeFindings: 0
  schedulerAdded: false
  liveInjectionPerformed: false
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
  downstreamState: "READY_AFTER_FAILURE_RECOVERY_CERTIFICATION"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_FAILURE_RECOVERY_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-057-FAILURE-RECOVERY-CERTIFICATION-V1",
  status: "CANONICAL_FAILURE_RECOVERY_CERTIFICATION_VERIFIED",
  workOrderId: "WO-MAO-057",
  certificationId: "failure-recovery-certification-wo-mao-057-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "6b045f885b1a7935ad60110c3096a05bbf28d37c",
  baseTreeHash: "0e034aed17d15644f44f99018cd6f8eaccb4d1d0",
  planContentHash: "3506c0188d0c3f50bdb3f184fa39f1a37c341f3926c4b578f833d94969f03dd4",
  resultHash: "362ebba45121ce3be1b66ebab5179737d1d1932bc919b0d0196d28c09249f9cf",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "FAILURE_RECOVERY_CERTIFICATION_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-056"] as const),
  certifiedInjectionClasses: Object.freeze(["COORDINATOR_RESTART", "PROVIDER_NETWORK_FAILURE", "RESERVATION_COLLISION", "STALE_BASE_EVENT", "WORKER_DEATH"] as const),
  failureInjectionCount: 5,
  recoveryGateCount: 5,
  ownerOperationRequiredCount: 0,
  reservedPathCount: 16,
  changedPathCount: 16,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  schedulerAdded: false,
  liveInjectionPerformed: false,
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
  downstreamState: "READY_AFTER_FAILURE_RECOVERY_CERTIFICATION",
  recordContentHash: "9e2cebd1a6b75fb0cc36151f4a58efe80a88d283a65bbe495428da4693290a36",
} satisfies MultiAgentFailureRecoveryEvidence)

export function isVerifiedWoMao057FailureRecoveryEvidence(
  record: MultiAgentFailureRecoveryEvidence = MULTI_AGENT_FAILURE_RECOVERY_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_FAILURE_RECOVERY_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-057-FAILURE-RECOVERY-CERTIFICATION-V1"
    && record.status === "CANONICAL_FAILURE_RECOVERY_CERTIFICATION_VERIFIED"
    && record.workOrderId === "WO-MAO-057"
    && record.certificationId === "failure-recovery-certification-wo-mao-057-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "6b045f885b1a7935ad60110c3096a05bbf28d37c"
    && record.baseTreeHash === "0e034aed17d15644f44f99018cd6f8eaccb4d1d0"
    && record.planContentHash === "3506c0188d0c3f50bdb3f184fa39f1a37c341f3926c4b578f833d94969f03dd4"
    && record.resultHash === "362ebba45121ce3be1b66ebab5179737d1d1932bc919b0d0196d28c09249f9cf"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "FAILURE_RECOVERY_CERTIFICATION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-056"])
    && JSON.stringify(record.certifiedInjectionClasses) === JSON.stringify(["COORDINATOR_RESTART", "PROVIDER_NETWORK_FAILURE", "RESERVATION_COLLISION", "STALE_BASE_EVENT", "WORKER_DEATH"])
    && record.failureInjectionCount === 5
    && record.recoveryGateCount === 5
    && record.ownerOperationRequiredCount === 0
    && record.reservedPathCount === 16
    && record.changedPathCount === 16
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.schedulerAdded === false
    && record.liveInjectionPerformed === false
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
    && record.downstreamState === "READY_AFTER_FAILURE_RECOVERY_CERTIFICATION"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "9e2cebd1a6b75fb0cc36151f4a58efe80a88d283a65bbe495428da4693290a36"
}
