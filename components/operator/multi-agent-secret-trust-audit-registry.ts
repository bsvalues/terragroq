import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentSecretTrustAuditEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-045-INDEPENDENT-SECRET-IDENTITY-TRUST-AUDIT-V1"
  status: "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_VERIFIED"
  workOrderId: "WO-MAO-045"
  auditId: "secret-identity-trust-audit-wo-mao-045-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "INDEPENDENT_SECRET_IDENTITY_TRUST_BOUNDARY_AUDIT_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-022", "WO-MAO-036", "WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042", "WO-MAO-043", "WO-MAO-044"]
  dependencyCount: 10
  auditDomainCount: 5
  trustBoundaryGateCount: 6
  reservedPathCount: 5
  changedPathCount: 5
  foreignChangeCount: 0
  secretLikeFindings: 0
  runtimeActivated: false
  secretReadAttempted: false
  secretValueObserved: false
  credentialMaterialStored: false
  githubApiCalled: false
  productionWritePerformed: false
  authPolicyChanged: false
  identityMutated: false
  trustBoundaryExpanded: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-046"
  downstreamState: "READY"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_SECRET_TRUST_AUDIT_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-045-INDEPENDENT-SECRET-IDENTITY-TRUST-AUDIT-V1",
  status: "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_VERIFIED",
  workOrderId: "WO-MAO-045",
  auditId: "secret-identity-trust-audit-wo-mao-045-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "e3f3b02b7bea5f062e7a4dbd63cfe918dae6edb2",
  baseTreeHash: "7387f4dc3ba56e0ffb92cf29aac7043adb0059aa",
  planContentHash: "413975c5dd9babeb61b7bb8d188c9c5809185cc6d12c2e0e0cbf16dddf84b52e",
  resultHash: "5d4219b7d9ea133b9fdcd09595a1d7879c05a6ffb9103956508707c7925c4d5e",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "INDEPENDENT_SECRET_IDENTITY_TRUST_BOUNDARY_AUDIT_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-022", "WO-MAO-036", "WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042", "WO-MAO-043", "WO-MAO-044"] as const),
  dependencyCount: 10,
  auditDomainCount: 5,
  trustBoundaryGateCount: 6,
  reservedPathCount: 5,
  changedPathCount: 5,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  runtimeActivated: false,
  secretReadAttempted: false,
  secretValueObserved: false,
  credentialMaterialStored: false,
  githubApiCalled: false,
  productionWritePerformed: false,
  authPolicyChanged: false,
  identityMutated: false,
  trustBoundaryExpanded: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-046",
  downstreamState: "READY",
  recordContentHash: "2850c0c9690a32c2a8454c389473f94d63ba30be3bbea6f90108fa067d34828d",
} satisfies MultiAgentSecretTrustAuditEvidence)

export function isVerifiedWoMao045SecretTrustAuditEvidence(
  record: MultiAgentSecretTrustAuditEvidence = MULTI_AGENT_SECRET_TRUST_AUDIT_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_SECRET_TRUST_AUDIT_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-045-INDEPENDENT-SECRET-IDENTITY-TRUST-AUDIT-V1"
    && record.status === "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_VERIFIED"
    && record.workOrderId === "WO-MAO-045"
    && record.auditId === "secret-identity-trust-audit-wo-mao-045-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "e3f3b02b7bea5f062e7a4dbd63cfe918dae6edb2"
    && record.baseTreeHash === "7387f4dc3ba56e0ffb92cf29aac7043adb0059aa"
    && record.planContentHash === "413975c5dd9babeb61b7bb8d188c9c5809185cc6d12c2e0e0cbf16dddf84b52e"
    && record.resultHash === "5d4219b7d9ea133b9fdcd09595a1d7879c05a6ffb9103956508707c7925c4d5e"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "INDEPENDENT_SECRET_IDENTITY_TRUST_BOUNDARY_AUDIT_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-022", "WO-MAO-036", "WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042", "WO-MAO-043", "WO-MAO-044"])
    && record.dependencyCount === 10
    && record.auditDomainCount === 5
    && record.trustBoundaryGateCount === 6
    && record.reservedPathCount === 5
    && record.changedPathCount === 5
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.runtimeActivated === false
    && record.secretReadAttempted === false
    && record.secretValueObserved === false
    && record.credentialMaterialStored === false
    && record.githubApiCalled === false
    && record.productionWritePerformed === false
    && record.authPolicyChanged === false
    && record.identityMutated === false
    && record.trustBoundaryExpanded === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-046"
    && record.downstreamState === "READY"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "2850c0c9690a32c2a8454c389473f94d63ba30be3bbea6f90108fa067d34828d"
}

