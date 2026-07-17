import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentResilienceSafetyRollupEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-053-RESILIENCE-SAFETY-ROLLUP-V1"
  status: "CANONICAL_RESILIENCE_SAFETY_ROLLUP_VERIFIED"
  workOrderId: "WO-MAO-053"
  rollupId: "resilience-safety-rollup-wo-mao-053-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "RESILIENCE_SAFETY_ROLLUP_MODEL_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-051", "WO-MAO-052"]
  dependencyCount: 8
  resilienceClaimCount: 6
  safetyClaimCount: 2
  reservedPathCount: 5
  changedPathCount: 5
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
  downstreamWorkOrderId: "WO-MAO-054"
  downstreamState: "READY_AFTER_RESILIENCE_SAFETY_ROLLUP"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_RESILIENCE_SAFETY_ROLLUP_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-053-RESILIENCE-SAFETY-ROLLUP-V1",
  status: "CANONICAL_RESILIENCE_SAFETY_ROLLUP_VERIFIED",
  workOrderId: "WO-MAO-053",
  rollupId: "resilience-safety-rollup-wo-mao-053-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "2d85063c0fc36ff270af7bd5da85009e7050b995",
  baseTreeHash: "1d81231f9a148d277f4c972e8b315ee60296bf96",
  planContentHash: "8b2747a827fd13b29051704e430150e9bd2c0883ff460a4d23da9fb3748bfa7f",
  resultHash: "5175604d5d2af4a81eea4006757aa0f7b211b8d17f75acc5ef3899ec5b006cf8",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "RESILIENCE_SAFETY_ROLLUP_MODEL_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-051", "WO-MAO-052"] as const),
  dependencyCount: 8,
  resilienceClaimCount: 6,
  safetyClaimCount: 2,
  reservedPathCount: 5,
  changedPathCount: 5,
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
  downstreamWorkOrderId: "WO-MAO-054",
  downstreamState: "READY_AFTER_RESILIENCE_SAFETY_ROLLUP",
  recordContentHash: "ecf035fef1569b44a3ab6e22478e78623ef8b8e416e54410f63cc92190c41f54",
} satisfies MultiAgentResilienceSafetyRollupEvidence)

export function isVerifiedWoMao053ResilienceSafetyRollupEvidence(
  record: MultiAgentResilienceSafetyRollupEvidence = MULTI_AGENT_RESILIENCE_SAFETY_ROLLUP_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_RESILIENCE_SAFETY_ROLLUP_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-053-RESILIENCE-SAFETY-ROLLUP-V1"
    && record.status === "CANONICAL_RESILIENCE_SAFETY_ROLLUP_VERIFIED"
    && record.workOrderId === "WO-MAO-053"
    && record.rollupId === "resilience-safety-rollup-wo-mao-053-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "2d85063c0fc36ff270af7bd5da85009e7050b995"
    && record.baseTreeHash === "1d81231f9a148d277f4c972e8b315ee60296bf96"
    && record.planContentHash === "8b2747a827fd13b29051704e430150e9bd2c0883ff460a4d23da9fb3748bfa7f"
    && record.resultHash === "5175604d5d2af4a81eea4006757aa0f7b211b8d17f75acc5ef3899ec5b006cf8"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "RESILIENCE_SAFETY_ROLLUP_MODEL_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-051", "WO-MAO-052"])
    && record.dependencyCount === 8
    && record.resilienceClaimCount === 6
    && record.safetyClaimCount === 2
    && record.reservedPathCount === 5
    && record.changedPathCount === 5
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
    && record.downstreamWorkOrderId === "WO-MAO-054"
    && record.downstreamState === "READY_AFTER_RESILIENCE_SAFETY_ROLLUP"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "ecf035fef1569b44a3ab6e22478e78623ef8b8e416e54410f63cc92190c41f54"
}
