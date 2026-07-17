import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentPrLinkageEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-038-PR-CREATION-PACKET-LINKAGE-V1"
  status: "CANONICAL_PR_CREATION_PACKET_LINKAGE_VERIFIED"
  workOrderId: "WO-MAO-038"
  packetId: "packet-wo-mao-038-pr-creation-linkage-v1"
  repository: "bsvalues/terragroq"
  sourceBranch: "codex/wo-mao-038-pr-packet-linkage"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "PR_PACKET_LINKAGE_RESERVED_PATHS_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-022", "WO-MAO-037"]
  requiredPrBodySectionCount: 7
  packetLinkCount: 4
  reservedPathCount: 15
  changedPathCount: 15
  foreignChangeCount: 0
  secretLikeFindings: 0
  githubWritePerformed: false
  pullRequestCreated: false
  reviewThreadResolved: false
  mergePerformed: false
  runtimeActivationAllowed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  productionWriteAllowed: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-039"
  downstreamState: "READY"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_PR_LINKAGE_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-038-PR-CREATION-PACKET-LINKAGE-V1",
  status: "CANONICAL_PR_CREATION_PACKET_LINKAGE_VERIFIED",
  workOrderId: "WO-MAO-038",
  packetId: "packet-wo-mao-038-pr-creation-linkage-v1",
  repository: "bsvalues/terragroq",
  sourceBranch: "codex/wo-mao-038-pr-packet-linkage",
  baseCommitSha: "bae305e63ab3b73d88e34fb8ddcac5cc738763ed",
  baseTreeHash: "0bce0bedea159dfb3057fac63e9389525610da3a",
  planContentHash: "63186eb86629b85f9b6055b633feaf28a4272cbd6865a7ddbbb98285a8257756",
  resultHash: "bd1d18403625d149586d6fa9b6f89c5db464eb71b42fbd3fbe0cf51c3e0c3c30",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "PR_PACKET_LINKAGE_RESERVED_PATHS_ONLY",
  dependencyWorkOrders: ["WO-MAO-022", "WO-MAO-037"],
  requiredPrBodySectionCount: 7,
  packetLinkCount: 4,
  reservedPathCount: 15,
  changedPathCount: 15,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  githubWritePerformed: false,
  pullRequestCreated: false,
  reviewThreadResolved: false,
  mergePerformed: false,
  runtimeActivationAllowed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  productionWriteAllowed: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-039",
  downstreamState: "READY",
  recordContentHash: "fa24625e6880da53255e0337ac49a03eb4cc4831f75001873f4426ae6ef0544f",
} satisfies MultiAgentPrLinkageEvidence)

export function isVerifiedWoMao038PrLinkageEvidence(
  record: MultiAgentPrLinkageEvidence = MULTI_AGENT_PR_LINKAGE_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_PR_LINKAGE_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-038-PR-CREATION-PACKET-LINKAGE-V1"
    && record.status === "CANONICAL_PR_CREATION_PACKET_LINKAGE_VERIFIED"
    && record.workOrderId === "WO-MAO-038"
    && record.packetId === "packet-wo-mao-038-pr-creation-linkage-v1"
    && record.repository === "bsvalues/terragroq"
    && record.sourceBranch === "codex/wo-mao-038-pr-packet-linkage"
    && record.baseCommitSha === "bae305e63ab3b73d88e34fb8ddcac5cc738763ed"
    && record.baseTreeHash === "0bce0bedea159dfb3057fac63e9389525610da3a"
    && record.planContentHash === "63186eb86629b85f9b6055b633feaf28a4272cbd6865a7ddbbb98285a8257756"
    && record.resultHash === "bd1d18403625d149586d6fa9b6f89c5db464eb71b42fbd3fbe0cf51c3e0c3c30"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "PR_PACKET_LINKAGE_RESERVED_PATHS_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-022", "WO-MAO-037"])
    && record.requiredPrBodySectionCount === 7
    && record.packetLinkCount === 4
    && record.reservedPathCount === 15
    && record.changedPathCount === 15
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.githubWritePerformed === false
    && record.pullRequestCreated === false
    && record.reviewThreadResolved === false
    && record.mergePerformed === false
    && record.runtimeActivationAllowed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.productionWriteAllowed === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-039"
    && record.downstreamState === "READY"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "fa24625e6880da53255e0337ac49a03eb4cc4831f75001873f4426ae6ef0544f"
}
