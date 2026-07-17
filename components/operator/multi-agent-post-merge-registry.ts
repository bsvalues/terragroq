import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentPostMergeEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-042-POST-MERGE-VERIFICATION-CLEANUP-V1"
  status: "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_VERIFIED"
  workOrderId: "WO-MAO-042"
  verificationId: "post-merge-verification-cleanup-wo-mao-042-v1"
  repository: "bsvalues/terragroq"
  mainCommitSha: string
  mainTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "POST_MERGE_VERIFICATION_AND_SAFE_CLEANUP_DECISION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-022", "WO-MAO-025", "WO-MAO-041"]
  gateCount: 7
  routeCheckCount: 4
  deniedCleanupActionCount: 6
  releasedReservationCount: 2
  reservedPathCount: 15
  changedPathCount: 15
  foreignChangeCount: 0
  secretLikeFindings: 0
  githubApiCalled: false
  cleanupPerformed: false
  unsafeCleanupPerformed: false
  worktreeDeleted: false
  branchDeleted: false
  artifactDeleted: false
  evidenceDeleted: false
  productionWritePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-043"
  downstreamState: "READY"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_POST_MERGE_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-042-POST-MERGE-VERIFICATION-CLEANUP-V1",
  status: "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_VERIFIED",
  workOrderId: "WO-MAO-042",
  verificationId: "post-merge-verification-cleanup-wo-mao-042-v1",
  repository: "bsvalues/terragroq",
  mainCommitSha: "2fafb13ef4f4d2c0b62a63cdf24f4fdd4c7d438c",
  mainTreeHash: "21a6fb6fb2374e6055b00ed4cf762391db6a63cd",
  planContentHash: "f55dbaff41391096d37ac08a8534e2337fc242281903150459c070341299b0d5",
  resultHash: "d17bd146ec600253da4f07687a0c07816a7fb35845fe979489a4a38a6748443e",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "POST_MERGE_VERIFICATION_AND_SAFE_CLEANUP_DECISION_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-022", "WO-MAO-025", "WO-MAO-041"] as const),
  gateCount: 7,
  routeCheckCount: 4,
  deniedCleanupActionCount: 6,
  releasedReservationCount: 2,
  reservedPathCount: 15,
  changedPathCount: 15,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  githubApiCalled: false,
  cleanupPerformed: false,
  unsafeCleanupPerformed: false,
  worktreeDeleted: false,
  branchDeleted: false,
  artifactDeleted: false,
  evidenceDeleted: false,
  productionWritePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-043",
  downstreamState: "READY",
  recordContentHash: "45f76c7ed920dfc88b6c49044be17fd6f0ef8a154c3b8f687df78aa064e8fd2d",
} satisfies MultiAgentPostMergeEvidence)

export function isVerifiedWoMao042PostMergeEvidence(
  record: MultiAgentPostMergeEvidence = MULTI_AGENT_POST_MERGE_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_POST_MERGE_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-042-POST-MERGE-VERIFICATION-CLEANUP-V1"
    && record.status === "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_VERIFIED"
    && record.workOrderId === "WO-MAO-042"
    && record.verificationId === "post-merge-verification-cleanup-wo-mao-042-v1"
    && record.repository === "bsvalues/terragroq"
    && record.mainCommitSha === "2fafb13ef4f4d2c0b62a63cdf24f4fdd4c7d438c"
    && record.mainTreeHash === "21a6fb6fb2374e6055b00ed4cf762391db6a63cd"
    && record.planContentHash === "f55dbaff41391096d37ac08a8534e2337fc242281903150459c070341299b0d5"
    && record.resultHash === "d17bd146ec600253da4f07687a0c07816a7fb35845fe979489a4a38a6748443e"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "POST_MERGE_VERIFICATION_AND_SAFE_CLEANUP_DECISION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-022", "WO-MAO-025", "WO-MAO-041"])
    && record.gateCount === 7
    && record.routeCheckCount === 4
    && record.deniedCleanupActionCount === 6
    && record.releasedReservationCount === 2
    && record.reservedPathCount === 15
    && record.changedPathCount === 15
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.githubApiCalled === false
    && record.cleanupPerformed === false
    && record.unsafeCleanupPerformed === false
    && record.worktreeDeleted === false
    && record.branchDeleted === false
    && record.artifactDeleted === false
    && record.evidenceDeleted === false
    && record.productionWritePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-043"
    && record.downstreamState === "READY"
    && [record.mainCommitSha, record.mainTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "45f76c7ed920dfc88b6c49044be17fd6f0ef8a154c3b8f687df78aa064e8fd2d"
}
