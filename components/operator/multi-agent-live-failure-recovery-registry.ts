import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentLiveFailureRecoveryEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-057-LIVE-FAILURE-RECOVERY-CERTIFICATION-V1"
  status: "CANONICAL_LIVE_FAILURE_RECOVERY_CERTIFICATION_VERIFIED"
  workOrderId: "WO-MAO-057"
  certificationId: "live-failure-recovery-certification-wo-mao-057-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  staleBaseRecoveredCommitSha: string
  liveRunId: "wo-mao-057-live-20260717195951"
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "LIVE_FAILURE_RECOVERY_CERTIFICATION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-056"]
  certifiedInjectionClasses: readonly ["COORDINATOR_RESTART", "PROVIDER_NETWORK_FAILURE", "RESERVATION_COLLISION", "STALE_BASE_EVENT", "WORKER_DEATH"]
  staleBaseControlPr: 411
  liveInjectionCount: 5
  recoveryGateCount: 5
  ownerOperationRequiredCount: 0
  reservedPathCount: 16
  changedPathCount: 16
  foreignChangeCount: 0
  secretLikeFindings: 0
  liveInjectionPerformed: true
  githubPrLifecycleUsed: true
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
  downstreamWorkOrderId: "WO-MAO-058"
  downstreamState: "READY_AFTER_LIVE_FAILURE_RECOVERY_CERTIFICATION"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_LIVE_FAILURE_RECOVERY_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-057-LIVE-FAILURE-RECOVERY-CERTIFICATION-V1",
  status: "CANONICAL_LIVE_FAILURE_RECOVERY_CERTIFICATION_VERIFIED",
  workOrderId: "WO-MAO-057",
  certificationId: "live-failure-recovery-certification-wo-mao-057-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "6b045f885b1a7935ad60110c3096a05bbf28d37c",
  staleBaseRecoveredCommitSha: "21f5e41bfacc5c6d76d743581f3ffb2aaaab2def",
  liveRunId: "wo-mao-057-live-20260717195951",
  planContentHash: "7ebf21ccdf75ee8e2726e2011f607177523eb47996e1769c7f608237cbb54b93",
  resultHash: "01d78b8775faac30dd071c3abaf125df1e3438612815d82a2943987a6eac783e",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "LIVE_FAILURE_RECOVERY_CERTIFICATION_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-056"] as const),
  certifiedInjectionClasses: Object.freeze(["COORDINATOR_RESTART", "PROVIDER_NETWORK_FAILURE", "RESERVATION_COLLISION", "STALE_BASE_EVENT", "WORKER_DEATH"] as const),
  staleBaseControlPr: 411,
  liveInjectionCount: 5,
  recoveryGateCount: 5,
  ownerOperationRequiredCount: 0,
  reservedPathCount: 16,
  changedPathCount: 16,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  liveInjectionPerformed: true,
  githubPrLifecycleUsed: true,
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
  downstreamWorkOrderId: "WO-MAO-058",
  downstreamState: "READY_AFTER_LIVE_FAILURE_RECOVERY_CERTIFICATION",
  recordContentHash: "a6ad3360b837a6cf1f16589dfd2d05ae49a8bdb4f237854763ec1a4d34391033",
} satisfies MultiAgentLiveFailureRecoveryEvidence)

export function isVerifiedWoMao057LiveFailureRecoveryEvidence(
  record: MultiAgentLiveFailureRecoveryEvidence = MULTI_AGENT_LIVE_FAILURE_RECOVERY_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_LIVE_FAILURE_RECOVERY_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-057-LIVE-FAILURE-RECOVERY-CERTIFICATION-V1"
    && record.status === "CANONICAL_LIVE_FAILURE_RECOVERY_CERTIFICATION_VERIFIED"
    && record.workOrderId === "WO-MAO-057"
    && record.certificationId === "live-failure-recovery-certification-wo-mao-057-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "6b045f885b1a7935ad60110c3096a05bbf28d37c"
    && record.staleBaseRecoveredCommitSha === "21f5e41bfacc5c6d76d743581f3ffb2aaaab2def"
    && record.liveRunId === "wo-mao-057-live-20260717195951"
    && record.planContentHash === "7ebf21ccdf75ee8e2726e2011f607177523eb47996e1769c7f608237cbb54b93"
    && record.resultHash === "01d78b8775faac30dd071c3abaf125df1e3438612815d82a2943987a6eac783e"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "LIVE_FAILURE_RECOVERY_CERTIFICATION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-056"])
    && JSON.stringify(record.certifiedInjectionClasses) === JSON.stringify(["COORDINATOR_RESTART", "PROVIDER_NETWORK_FAILURE", "RESERVATION_COLLISION", "STALE_BASE_EVENT", "WORKER_DEATH"])
    && record.staleBaseControlPr === 411
    && record.liveInjectionCount === 5
    && record.recoveryGateCount === 5
    && record.ownerOperationRequiredCount === 0
    && record.reservedPathCount === 16
    && record.changedPathCount === 16
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.liveInjectionPerformed === true
    && record.githubPrLifecycleUsed === true
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
    && record.downstreamWorkOrderId === "WO-MAO-058"
    && record.downstreamState === "READY_AFTER_LIVE_FAILURE_RECOVERY_CERTIFICATION"
    && [record.baseCommitSha, record.staleBaseRecoveredCommitSha].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "a6ad3360b837a6cf1f16589dfd2d05ae49a8bdb4f237854763ec1a4d34391033"
}
