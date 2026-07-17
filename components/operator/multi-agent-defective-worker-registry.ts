import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentDefectiveWorkerEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-050-MALICIOUS-DEFECTIVE-WORKER-DRILL-V1"
  status: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED"
  workOrderId: "WO-MAO-050"
  drillId: "malicious-defective-worker-drill-wo-mao-050-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "MALICIOUS_DEFECTIVE_WORKER_DRILL_MODEL_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049"]
  dependencyCount: 5
  defectCaseCount: 7
  containmentDecisionCount: 7
  evidenceRequirementCount: 5
  terminalDefectCount: 7
  reservedPathCount: 5
  changedPathCount: 5
  foreignChangeCount: 0
  secretLikeFindings: 0
  schedulerAdded: false
  providerExecutionPerformed: false
  githubApiCalled: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  stateMutationPerformed: false
  secretMaterialAllowed: false
  unsafeCleanupAllowed: false
  policyOverrideAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-051"
  downstreamState: "READY_AFTER_DEFECTIVE_WORKER_DRILL"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_DEFECTIVE_WORKER_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-050-MALICIOUS-DEFECTIVE-WORKER-DRILL-V1",
  status: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED",
  workOrderId: "WO-MAO-050",
  drillId: "malicious-defective-worker-drill-wo-mao-050-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "761dc98a9d80d51d1373172bbdd40b1088298c4c",
  baseTreeHash: "386713335f0153e3b579c75f46c9c155c23d630f",
  planContentHash: "49d29bf5a5c03fb3172021ac61006e3b85aae963372eb08a8893181a8ac9ba17",
  resultHash: "c1d2db0cb1e01be04cb815e06a57e89ce4b5d6fcd9d25d277866c864a095cf51",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "MALICIOUS_DEFECTIVE_WORKER_DRILL_MODEL_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049"] as const),
  dependencyCount: 5,
  defectCaseCount: 7,
  containmentDecisionCount: 7,
  evidenceRequirementCount: 5,
  terminalDefectCount: 7,
  reservedPathCount: 5,
  changedPathCount: 5,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  schedulerAdded: false,
  providerExecutionPerformed: false,
  githubApiCalled: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  stateMutationPerformed: false,
  secretMaterialAllowed: false,
  unsafeCleanupAllowed: false,
  policyOverrideAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-051",
  downstreamState: "READY_AFTER_DEFECTIVE_WORKER_DRILL",
  recordContentHash: "7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75",
} satisfies MultiAgentDefectiveWorkerEvidence)

export function isVerifiedWoMao050DefectiveWorkerEvidence(
  record: MultiAgentDefectiveWorkerEvidence = MULTI_AGENT_DEFECTIVE_WORKER_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_DEFECTIVE_WORKER_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-050-MALICIOUS-DEFECTIVE-WORKER-DRILL-V1"
    && record.status === "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED"
    && record.workOrderId === "WO-MAO-050"
    && record.drillId === "malicious-defective-worker-drill-wo-mao-050-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "761dc98a9d80d51d1373172bbdd40b1088298c4c"
    && record.baseTreeHash === "386713335f0153e3b579c75f46c9c155c23d630f"
    && record.planContentHash === "49d29bf5a5c03fb3172021ac61006e3b85aae963372eb08a8893181a8ac9ba17"
    && record.resultHash === "c1d2db0cb1e01be04cb815e06a57e89ce4b5d6fcd9d25d277866c864a095cf51"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "MALICIOUS_DEFECTIVE_WORKER_DRILL_MODEL_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049"])
    && record.dependencyCount === 5
    && record.defectCaseCount === 7
    && record.containmentDecisionCount === 7
    && record.evidenceRequirementCount === 5
    && record.terminalDefectCount === 7
    && record.reservedPathCount === 5
    && record.changedPathCount === 5
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.schedulerAdded === false
    && record.providerExecutionPerformed === false
    && record.githubApiCalled === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.stateMutationPerformed === false
    && record.secretMaterialAllowed === false
    && record.unsafeCleanupAllowed === false
    && record.policyOverrideAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-051"
    && record.downstreamState === "READY_AFTER_DEFECTIVE_WORKER_DRILL"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75"
}
