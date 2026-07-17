import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentStatusUxEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-051-STATUS-EVIDENCE-OWNER-DECISION-UX-V1"
  status: "CANONICAL_STATUS_EVIDENCE_OWNER_DECISION_UX_VERIFIED"
  workOrderId: "WO-MAO-051"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "STATUS_EVIDENCE_OWNER_DECISION_UX_ONLY"
  activeWorkOrderBeforeCompletion: "WO-MAO-051"
  downstreamWorkOrderId: "WO-MAO-052"
  statusCounts: {
    total: 62
    complete: 49
    ready: 1
    pending: 11
    blocked: 0
    deferred: 1
  }
  activeDependencyCount: 9
  activeDependencySatisfiedCount: 9
  evidenceTrailWorkOrders: readonly ["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050"]
  providerPostureCount: 3
  ownerAuthorityWallCount: 7
  controlsExposed: 0
  schedulerAdded: false
  providerExecutionPerformed: false
  githubOperationAdded: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  authorityGranted: false
  ownerOperationControlAdded: false
  secretsExposed: false
  completionState: "COMPLETE"
  downstreamState: "READY_AFTER_STATUS_EVIDENCE_OWNER_DECISION_UX"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_STATUS_UX_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-051-STATUS-EVIDENCE-OWNER-DECISION-UX-V1",
  status: "CANONICAL_STATUS_EVIDENCE_OWNER_DECISION_UX_VERIFIED",
  workOrderId: "WO-MAO-051",
  repository: "bsvalues/terragroq",
  baseCommitSha: "1e2383bae5b7ce789b45d612d9b77dfe7b1e8917",
  baseTreeHash: "f0bfb5e3086eeffc874b19940a92b958204d6d51",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "STATUS_EVIDENCE_OWNER_DECISION_UX_ONLY",
  activeWorkOrderBeforeCompletion: "WO-MAO-051",
  downstreamWorkOrderId: "WO-MAO-052",
  statusCounts: Object.freeze({
    total: 62,
    complete: 49,
    ready: 1,
    pending: 11,
    blocked: 0,
    deferred: 1,
  }),
  activeDependencyCount: 9,
  activeDependencySatisfiedCount: 9,
  evidenceTrailWorkOrders: Object.freeze(["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050"] as const),
  providerPostureCount: 3,
  ownerAuthorityWallCount: 7,
  controlsExposed: 0,
  schedulerAdded: false,
  providerExecutionPerformed: false,
  githubOperationAdded: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  authorityGranted: false,
  ownerOperationControlAdded: false,
  secretsExposed: false,
  completionState: "COMPLETE",
  downstreamState: "READY_AFTER_STATUS_EVIDENCE_OWNER_DECISION_UX",
  recordContentHash: "6d3e2279b02f2a50bde868c2494ea20acfef06485c01b6f52dff24c0fff97d77",
} satisfies MultiAgentStatusUxEvidence)

export function isVerifiedWoMao051StatusUxEvidence(
  record: MultiAgentStatusUxEvidence = MULTI_AGENT_STATUS_UX_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_STATUS_UX_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-051-STATUS-EVIDENCE-OWNER-DECISION-UX-V1"
    && record.status === "CANONICAL_STATUS_EVIDENCE_OWNER_DECISION_UX_VERIFIED"
    && record.workOrderId === "WO-MAO-051"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "1e2383bae5b7ce789b45d612d9b77dfe7b1e8917"
    && record.baseTreeHash === "f0bfb5e3086eeffc874b19940a92b958204d6d51"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "STATUS_EVIDENCE_OWNER_DECISION_UX_ONLY"
    && record.activeWorkOrderBeforeCompletion === "WO-MAO-051"
    && record.downstreamWorkOrderId === "WO-MAO-052"
    && record.statusCounts.total === 62
    && record.statusCounts.complete === 49
    && record.statusCounts.ready === 1
    && record.statusCounts.pending === 11
    && record.statusCounts.blocked === 0
    && record.statusCounts.deferred === 1
    && record.activeDependencyCount === 9
    && record.activeDependencySatisfiedCount === 9
    && JSON.stringify(record.evidenceTrailWorkOrders) === JSON.stringify(["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050"])
    && record.providerPostureCount === 3
    && record.ownerAuthorityWallCount === 7
    && record.controlsExposed === 0
    && record.schedulerAdded === false
    && record.providerExecutionPerformed === false
    && record.githubOperationAdded === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.authorityGranted === false
    && record.ownerOperationControlAdded === false
    && record.secretsExposed === false
    && record.completionState === "COMPLETE"
    && record.downstreamState === "READY_AFTER_STATUS_EVIDENCE_OWNER_DECISION_UX"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && record.recordContentHash === "6d3e2279b02f2a50bde868c2494ea20acfef06485c01b6f52dff24c0fff97d77"
    && HASH_64.test(record.recordContentHash)
}
