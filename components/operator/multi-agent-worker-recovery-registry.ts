import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentWorkerRecoveryEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1"
  status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED"
  workOrderId: "WO-MAO-047"
  recoveryId: "worker-coordinator-recovery-wo-mao-047-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "WORKER_COORDINATOR_RECOVERY_MODEL_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-021", "WO-MAO-025", "WO-MAO-030", "WO-MAO-031", "WO-MAO-046"]
  dependencyCount: 5
  durableSourceCount: 5
  recoveryScenarioCount: 5
  concurrencyFenceCount: 6
  reservedPathCount: 5
  changedPathCount: 5
  foreignChangeCount: 0
  secretLikeFindings: 0
  schedulerAdded: false
  providerExecutionPerformed: false
  githubApiCalled: false
  githubWritePerformed: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  processControlPerformed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  stateMutationPerformed: false
  secretMaterialAllowed: false
  concurrentWritersAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-048"
  downstreamState: "READY_AFTER_COORDINATOR_INTEGRATION"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_WORKER_RECOVERY_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1",
  status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED",
  workOrderId: "WO-MAO-047",
  recoveryId: "worker-coordinator-recovery-wo-mao-047-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "8d875ab97ddd8159da37bff80ca41dfa2fe3d9dc",
  baseTreeHash: "a4240f8508f3c95671250e6fb677efa3dff6baea",
  planContentHash: "d74b5b5702d86333a9e4a535c1780453e02122a58d998f1bc1b86e57cbc1efd6",
  resultHash: "677aa418c40a7a5429a1d703b460a01599aef9fbbd135e54eb521f2a1d7ac8cd",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "WORKER_COORDINATOR_RECOVERY_MODEL_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-021", "WO-MAO-025", "WO-MAO-030", "WO-MAO-031", "WO-MAO-046"] as const),
  dependencyCount: 5,
  durableSourceCount: 5,
  recoveryScenarioCount: 5,
  concurrencyFenceCount: 6,
  reservedPathCount: 5,
  changedPathCount: 5,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  schedulerAdded: false,
  providerExecutionPerformed: false,
  githubApiCalled: false,
  githubWritePerformed: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  processControlPerformed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  stateMutationPerformed: false,
  secretMaterialAllowed: false,
  concurrentWritersAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-048",
  downstreamState: "READY_AFTER_COORDINATOR_INTEGRATION",
  recordContentHash: "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667",
} satisfies MultiAgentWorkerRecoveryEvidence)

export function isVerifiedWoMao047WorkerRecoveryEvidence(
  record: MultiAgentWorkerRecoveryEvidence = MULTI_AGENT_WORKER_RECOVERY_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_WORKER_RECOVERY_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1"
    && record.status === "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED"
    && record.workOrderId === "WO-MAO-047"
    && record.recoveryId === "worker-coordinator-recovery-wo-mao-047-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "8d875ab97ddd8159da37bff80ca41dfa2fe3d9dc"
    && record.baseTreeHash === "a4240f8508f3c95671250e6fb677efa3dff6baea"
    && record.planContentHash === "d74b5b5702d86333a9e4a535c1780453e02122a58d998f1bc1b86e57cbc1efd6"
    && record.resultHash === "677aa418c40a7a5429a1d703b460a01599aef9fbbd135e54eb521f2a1d7ac8cd"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "WORKER_COORDINATOR_RECOVERY_MODEL_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-021", "WO-MAO-025", "WO-MAO-030", "WO-MAO-031", "WO-MAO-046"])
    && record.dependencyCount === 5
    && record.durableSourceCount === 5
    && record.recoveryScenarioCount === 5
    && record.concurrencyFenceCount === 6
    && record.reservedPathCount === 5
    && record.changedPathCount === 5
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.schedulerAdded === false
    && record.providerExecutionPerformed === false
    && record.githubApiCalled === false
    && record.githubWritePerformed === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.processControlPerformed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.stateMutationPerformed === false
    && record.secretMaterialAllowed === false
    && record.concurrentWritersAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-048"
    && record.downstreamState === "READY_AFTER_COORDINATOR_INTEGRATION"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667"
}
