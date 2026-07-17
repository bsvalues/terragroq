import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentIncidentProcedureEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-052-KILL-REVOKE-ROLLBACK-INCIDENT-PROCEDURE-V1"
  status: "CANONICAL_KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_VERIFIED"
  workOrderId: "WO-MAO-052"
  procedureId: "kill-revoke-rollback-incident-procedure-wo-mao-052-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_MODEL_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-051"]
  dependencyCount: 7
  incidentClassCount: 6
  procedureStepCount: 6
  rollbackRuleCount: 4
  ownerDecisionRuleCount: 3
  ownerDecisionRequiredClassCount: 1
  reservedPathCount: 5
  changedPathCount: 5
  foreignChangeCount: 0
  secretLikeFindings: 0
  schedulerAdded: false
  providerExecutionPerformed: false
  githubApiCalled: false
  revokeExecuted: false
  rollbackExecuted: false
  cleanupExecuted: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  stateMutationPerformed: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-053"
  downstreamState: "READY_AFTER_INCIDENT_PROCEDURE"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_INCIDENT_PROCEDURE_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-052-KILL-REVOKE-ROLLBACK-INCIDENT-PROCEDURE-V1",
  status: "CANONICAL_KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_VERIFIED",
  workOrderId: "WO-MAO-052",
  procedureId: "kill-revoke-rollback-incident-procedure-wo-mao-052-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "8de0b73bcfd13055de7d3ffc86bc42a1a178f0a1",
  baseTreeHash: "3310d65b8bc96f57c78cd660b4f715eefddee335",
  planContentHash: "20eb61ed04b933c8a6fed6be377130eff40eb5dc6f2a74ee27a6b4f52a926e5c",
  resultHash: "6887a88544ee3aba208c7c1348402492752028ae1d43ef76a334e3551de58bb5",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_MODEL_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-051"] as const),
  dependencyCount: 7,
  incidentClassCount: 6,
  procedureStepCount: 6,
  rollbackRuleCount: 4,
  ownerDecisionRuleCount: 3,
  ownerDecisionRequiredClassCount: 1,
  reservedPathCount: 5,
  changedPathCount: 5,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  schedulerAdded: false,
  providerExecutionPerformed: false,
  githubApiCalled: false,
  revokeExecuted: false,
  rollbackExecuted: false,
  cleanupExecuted: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  stateMutationPerformed: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-053",
  downstreamState: "READY_AFTER_INCIDENT_PROCEDURE",
  recordContentHash: "e3a60ca23bafaff20d33304fdc965600e000f0245822416cb560b46829075b45",
} satisfies MultiAgentIncidentProcedureEvidence)

export function isVerifiedWoMao052IncidentProcedureEvidence(
  record: MultiAgentIncidentProcedureEvidence = MULTI_AGENT_INCIDENT_PROCEDURE_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_INCIDENT_PROCEDURE_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-052-KILL-REVOKE-ROLLBACK-INCIDENT-PROCEDURE-V1"
    && record.status === "CANONICAL_KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_VERIFIED"
    && record.workOrderId === "WO-MAO-052"
    && record.procedureId === "kill-revoke-rollback-incident-procedure-wo-mao-052-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "8de0b73bcfd13055de7d3ffc86bc42a1a178f0a1"
    && record.baseTreeHash === "3310d65b8bc96f57c78cd660b4f715eefddee335"
    && record.planContentHash === "20eb61ed04b933c8a6fed6be377130eff40eb5dc6f2a74ee27a6b4f52a926e5c"
    && record.resultHash === "6887a88544ee3aba208c7c1348402492752028ae1d43ef76a334e3551de58bb5"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_MODEL_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-051"])
    && record.dependencyCount === 7
    && record.incidentClassCount === 6
    && record.procedureStepCount === 6
    && record.rollbackRuleCount === 4
    && record.ownerDecisionRuleCount === 3
    && record.ownerDecisionRequiredClassCount === 1
    && record.reservedPathCount === 5
    && record.changedPathCount === 5
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.schedulerAdded === false
    && record.providerExecutionPerformed === false
    && record.githubApiCalled === false
    && record.revokeExecuted === false
    && record.rollbackExecuted === false
    && record.cleanupExecuted === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.stateMutationPerformed === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-053"
    && record.downstreamState === "READY_AFTER_INCIDENT_PROCEDURE"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "e3a60ca23bafaff20d33304fdc965600e000f0245822416cb560b46829075b45"
}
