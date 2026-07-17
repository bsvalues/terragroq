import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentRetryIdempotencyEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1"
  status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED"
  workOrderId: "WO-MAO-046"
  planId: "retry-idempotency-duplicate-prevention-wo-mao-046-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_MODEL_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-021", "WO-MAO-035", "WO-MAO-044"]
  maxAttempts: 3
  retryableClassCount: 3
  terminalClassCount: 4
  backoffStepCount: 3
  idempotencyKeyCount: 4
  duplicateFenceCount: 5
  duplicateOutcomeCount: 3
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
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_RETRY_IDEMPOTENCY_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1",
  status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED",
  workOrderId: "WO-MAO-046",
  planId: "retry-idempotency-duplicate-prevention-wo-mao-046-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "e3f3b02b7bea5f062e7a4dbd63cfe918dae6edb2",
  baseTreeHash: "7387f4dc3ba56e0ffb92cf29aac7043adb0059aa",
  planContentHash: "a1c34c2b835e19d6c4079e20e10109382ac26e6334933b37f1535128db37f618",
  resultHash: "807c2da8ab932dce2371b93356bb2cc83c97460c4c7196001de276b5c8f1554d",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_MODEL_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-021", "WO-MAO-035", "WO-MAO-044"] as const),
  maxAttempts: 3,
  retryableClassCount: 3,
  terminalClassCount: 4,
  backoffStepCount: 3,
  idempotencyKeyCount: 4,
  duplicateFenceCount: 5,
  duplicateOutcomeCount: 3,
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
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  recordContentHash: "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df",
} satisfies MultiAgentRetryIdempotencyEvidence)

export function isVerifiedWoMao046RetryIdempotencyEvidence(
  record: MultiAgentRetryIdempotencyEvidence = MULTI_AGENT_RETRY_IDEMPOTENCY_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_RETRY_IDEMPOTENCY_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1"
    && record.status === "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED"
    && record.workOrderId === "WO-MAO-046"
    && record.planId === "retry-idempotency-duplicate-prevention-wo-mao-046-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "e3f3b02b7bea5f062e7a4dbd63cfe918dae6edb2"
    && record.baseTreeHash === "7387f4dc3ba56e0ffb92cf29aac7043adb0059aa"
    && record.planContentHash === "a1c34c2b835e19d6c4079e20e10109382ac26e6334933b37f1535128db37f618"
    && record.resultHash === "807c2da8ab932dce2371b93356bb2cc83c97460c4c7196001de276b5c8f1554d"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_MODEL_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-021", "WO-MAO-035", "WO-MAO-044"])
    && record.maxAttempts === 3
    && record.retryableClassCount === 3
    && record.terminalClassCount === 4
    && record.backoffStepCount === 3
    && record.idempotencyKeyCount === 4
    && record.duplicateFenceCount === 5
    && record.duplicateOutcomeCount === 3
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
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df"
}
