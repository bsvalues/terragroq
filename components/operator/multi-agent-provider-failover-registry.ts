import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentProviderFailoverEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1"
  status: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED"
  workOrderId: "WO-MAO-048"
  drillId: "provider-outage-failover-drill-wo-mao-048-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "PROVIDER_OUTAGE_FAILOVER_DRILL_MODEL_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-035", "WO-MAO-036", "WO-MAO-046", "WO-MAO-047"]
  dependencyCount: 4
  outageCaseCount: 7
  failoverDecisionCount: 4
  quarantineRuleCount: 2
  retryableOutageCount: 5
  maxAttempts: 3
  maxReroutes: 1
  maxBackoffMs: 60000
  ownerDiagnosticBudget: 0
  reservedPathCount: 5
  changedPathCount: 5
  foreignChangeCount: 0
  secretLikeFindings: 0
  schedulerAdded: false
  providerExecutionPerformed: false
  networkInjectionPerformed: false
  githubApiCalled: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  stateMutationPerformed: false
  secretMaterialAllowed: false
  ownerDiagnosticsRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-050"
  downstreamState: "READY_AFTER_COORDINATOR_INTEGRATION"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_PROVIDER_FAILOVER_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1",
  status: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED",
  workOrderId: "WO-MAO-048",
  drillId: "provider-outage-failover-drill-wo-mao-048-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "1379318899672e059959da09b9b1d886243167f4",
  baseTreeHash: "c1a278e9a1183829501ae0c07be2610828526b5a",
  planContentHash: "54533fcda642c669d7a60663d5f12a67036623e43a3c6d66e4ec5313350a4a76",
  resultHash: "d834bf4fe7677dbd86f1d6d930c0d0041b8c183cdc63a5f8391a697610b2001e",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "PROVIDER_OUTAGE_FAILOVER_DRILL_MODEL_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-035", "WO-MAO-036", "WO-MAO-046", "WO-MAO-047"] as const),
  dependencyCount: 4,
  outageCaseCount: 7,
  failoverDecisionCount: 4,
  quarantineRuleCount: 2,
  retryableOutageCount: 5,
  maxAttempts: 3,
  maxReroutes: 1,
  maxBackoffMs: 60000,
  ownerDiagnosticBudget: 0,
  reservedPathCount: 5,
  changedPathCount: 5,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  schedulerAdded: false,
  providerExecutionPerformed: false,
  networkInjectionPerformed: false,
  githubApiCalled: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  stateMutationPerformed: false,
  secretMaterialAllowed: false,
  ownerDiagnosticsRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-050",
  downstreamState: "READY_AFTER_COORDINATOR_INTEGRATION",
  recordContentHash: "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81",
} satisfies MultiAgentProviderFailoverEvidence)

export function isVerifiedWoMao048ProviderFailoverEvidence(
  record: MultiAgentProviderFailoverEvidence = MULTI_AGENT_PROVIDER_FAILOVER_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_PROVIDER_FAILOVER_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1"
    && record.status === "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED"
    && record.workOrderId === "WO-MAO-048"
    && record.drillId === "provider-outage-failover-drill-wo-mao-048-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "1379318899672e059959da09b9b1d886243167f4"
    && record.baseTreeHash === "c1a278e9a1183829501ae0c07be2610828526b5a"
    && record.planContentHash === "54533fcda642c669d7a60663d5f12a67036623e43a3c6d66e4ec5313350a4a76"
    && record.resultHash === "d834bf4fe7677dbd86f1d6d930c0d0041b8c183cdc63a5f8391a697610b2001e"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "PROVIDER_OUTAGE_FAILOVER_DRILL_MODEL_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-035", "WO-MAO-036", "WO-MAO-046", "WO-MAO-047"])
    && record.dependencyCount === 4
    && record.outageCaseCount === 7
    && record.failoverDecisionCount === 4
    && record.quarantineRuleCount === 2
    && record.retryableOutageCount === 5
    && record.maxAttempts === 3
    && record.maxReroutes === 1
    && record.maxBackoffMs === 60000
    && record.ownerDiagnosticBudget === 0
    && record.reservedPathCount === 5
    && record.changedPathCount === 5
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.schedulerAdded === false
    && record.providerExecutionPerformed === false
    && record.networkInjectionPerformed === false
    && record.githubApiCalled === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.stateMutationPerformed === false
    && record.secretMaterialAllowed === false
    && record.ownerDiagnosticsRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-050"
    && record.downstreamState === "READY_AFTER_COORDINATOR_INTEGRATION"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81"
}
