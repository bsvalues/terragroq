import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentMergeRaceEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1"
  status: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED"
  workOrderId: "WO-MAO-049"
  drillId: "stale-base-ci-review-merge-race-wo-mao-049-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "STALE_BASE_CI_REVIEW_MERGE_RACE_MODEL_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-046"]
  staleBaseControlCount: 3
  ciReviewOutcomeCount: 4
  mergeRaceGuardCount: 4
  flakyRetryBudget: 1
  maxBaseRefreshes: 2
  reservedPathCount: 5
  changedPathCount: 5
  foreignChangeCount: 0
  secretLikeFindings: 0
  schedulerAdded: false
  providerExecutionPerformed: false
  githubApiCalled: false
  rebasePerformed: false
  ciRerunPerformed: false
  reviewThreadResolved: false
  mergePerformed: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  stateMutationPerformed: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_MERGE_RACE_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1",
  status: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED",
  workOrderId: "WO-MAO-049",
  drillId: "stale-base-ci-review-merge-race-wo-mao-049-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "8d875ab97ddd8159da37bff80ca41dfa2fe3d9dc",
  baseTreeHash: "a4240f8508f3c95671250e6fb677efa3dff6baea",
  planContentHash: "c4fac68042a360532806aeb94248e52a58fa10c76d388fe217c15827b4c294bf",
  resultHash: "1ca6498b80222b9134a2e3fb70be03d01fa0f0c38a816fa3c6daedb59843d838",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "STALE_BASE_CI_REVIEW_MERGE_RACE_MODEL_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-046"] as const),
  staleBaseControlCount: 3,
  ciReviewOutcomeCount: 4,
  mergeRaceGuardCount: 4,
  flakyRetryBudget: 1,
  maxBaseRefreshes: 2,
  reservedPathCount: 5,
  changedPathCount: 5,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  schedulerAdded: false,
  providerExecutionPerformed: false,
  githubApiCalled: false,
  rebasePerformed: false,
  ciRerunPerformed: false,
  reviewThreadResolved: false,
  mergePerformed: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  stateMutationPerformed: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  recordContentHash: "bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671",
} satisfies MultiAgentMergeRaceEvidence)

export function isVerifiedWoMao049MergeRaceEvidence(
  record: MultiAgentMergeRaceEvidence = MULTI_AGENT_MERGE_RACE_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_MERGE_RACE_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1"
    && record.status === "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED"
    && record.workOrderId === "WO-MAO-049"
    && record.drillId === "stale-base-ci-review-merge-race-wo-mao-049-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "8d875ab97ddd8159da37bff80ca41dfa2fe3d9dc"
    && record.baseTreeHash === "a4240f8508f3c95671250e6fb677efa3dff6baea"
    && record.planContentHash === "c4fac68042a360532806aeb94248e52a58fa10c76d388fe217c15827b4c294bf"
    && record.resultHash === "1ca6498b80222b9134a2e3fb70be03d01fa0f0c38a816fa3c6daedb59843d838"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "STALE_BASE_CI_REVIEW_MERGE_RACE_MODEL_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-046"])
    && record.staleBaseControlCount === 3
    && record.ciReviewOutcomeCount === 4
    && record.mergeRaceGuardCount === 4
    && record.flakyRetryBudget === 1
    && record.maxBaseRefreshes === 2
    && record.reservedPathCount === 5
    && record.changedPathCount === 5
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.schedulerAdded === false
    && record.providerExecutionPerformed === false
    && record.githubApiCalled === false
    && record.rebasePerformed === false
    && record.ciRerunPerformed === false
    && record.reviewThreadResolved === false
    && record.mergePerformed === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.stateMutationPerformed === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671"
}
