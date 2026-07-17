import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentDependentReleaseEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-043-AUTOMATIC-DEPENDENT-RELEASE-V1"
  status: "CANONICAL_AUTOMATIC_DEPENDENT_RELEASE_VERIFIED"
  workOrderId: "WO-MAO-043"
  releaseId: "automatic-dependent-release-wo-mao-043-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "DEPENDENT_RELEASE_DECISION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-017", "WO-MAO-020", "WO-MAO-042"]
  releasedWorkOrders: readonly ["WO-MAO-043"]
  blockedWorkOrders: readonly ["WO-MAO-044"]
  gateCount: 6
  candidateWorkOrderCount: 2
  releasedWorkOrderCount: 1
  blockedWorkOrderCount: 1
  reservedPathCount: 15
  changedPathCount: 15
  foreignChangeCount: 0
  secretLikeFindings: 0
  providerDispatched: false
  githubApiCalled: false
  branchCreated: false
  commitCreated: false
  pullRequestCreated: false
  mergePerformed: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-044"
  downstreamState: "READY"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_DEPENDENT_RELEASE_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-043-AUTOMATIC-DEPENDENT-RELEASE-V1",
  status: "CANONICAL_AUTOMATIC_DEPENDENT_RELEASE_VERIFIED",
  workOrderId: "WO-MAO-043",
  releaseId: "automatic-dependent-release-wo-mao-043-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "e29f45fd045db316bb0179fb81ab546f1d88e147",
  baseTreeHash: "710068486bc6ebe0bf22d7703faa441e9b4b63c1",
  planContentHash: "c999b4eb97a64c0bf49f19f12702ba3ea3d7837e80b3998b14ec6c09c6e4f5ad",
  resultHash: "344eaedb9cb2b29ad525ea3011862ba4b510a5ad62660f99f9af2a9dffa0d159",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "DEPENDENT_RELEASE_DECISION_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-017", "WO-MAO-020", "WO-MAO-042"] as const),
  releasedWorkOrders: Object.freeze(["WO-MAO-043"] as const),
  blockedWorkOrders: Object.freeze(["WO-MAO-044"] as const),
  gateCount: 6,
  candidateWorkOrderCount: 2,
  releasedWorkOrderCount: 1,
  blockedWorkOrderCount: 1,
  reservedPathCount: 15,
  changedPathCount: 15,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  providerDispatched: false,
  githubApiCalled: false,
  branchCreated: false,
  commitCreated: false,
  pullRequestCreated: false,
  mergePerformed: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-044",
  downstreamState: "READY",
  recordContentHash: "2a252c8141aaecc974e0776a124672b0fe88d48c5754cede89115932100e2816",
} satisfies MultiAgentDependentReleaseEvidence)

export function isVerifiedWoMao043DependentReleaseEvidence(
  record: MultiAgentDependentReleaseEvidence = MULTI_AGENT_DEPENDENT_RELEASE_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_DEPENDENT_RELEASE_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-043-AUTOMATIC-DEPENDENT-RELEASE-V1"
    && record.status === "CANONICAL_AUTOMATIC_DEPENDENT_RELEASE_VERIFIED"
    && record.workOrderId === "WO-MAO-043"
    && record.releaseId === "automatic-dependent-release-wo-mao-043-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "e29f45fd045db316bb0179fb81ab546f1d88e147"
    && record.baseTreeHash === "710068486bc6ebe0bf22d7703faa441e9b4b63c1"
    && record.planContentHash === "c999b4eb97a64c0bf49f19f12702ba3ea3d7837e80b3998b14ec6c09c6e4f5ad"
    && record.resultHash === "344eaedb9cb2b29ad525ea3011862ba4b510a5ad62660f99f9af2a9dffa0d159"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "DEPENDENT_RELEASE_DECISION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-017", "WO-MAO-020", "WO-MAO-042"])
    && JSON.stringify(record.releasedWorkOrders) === JSON.stringify(["WO-MAO-043"])
    && JSON.stringify(record.blockedWorkOrders) === JSON.stringify(["WO-MAO-044"])
    && record.gateCount === 6
    && record.candidateWorkOrderCount === 2
    && record.releasedWorkOrderCount === 1
    && record.blockedWorkOrderCount === 1
    && record.reservedPathCount === 15
    && record.changedPathCount === 15
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.providerDispatched === false
    && record.githubApiCalled === false
    && record.branchCreated === false
    && record.commitCreated === false
    && record.pullRequestCreated === false
    && record.mergePerformed === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-044"
    && record.downstreamState === "READY"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "2a252c8141aaecc974e0776a124672b0fe88d48c5754cede89115932100e2816"
}
