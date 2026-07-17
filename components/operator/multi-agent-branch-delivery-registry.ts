import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentBranchDeliveryEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-037-BRANCH-COMMIT-PUSH-V1"
  status: "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_VERIFIED"
  workOrderId: "WO-MAO-037"
  planId: "plan-wo-mao-037-branch-commit-push-v1"
  repository: "bsvalues/terragroq"
  branch: "codex/wo-mao-037-governed-delivery"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "BRANCH_COMMIT_PUSH_RESERVED_PATHS_ONLY"
  reservedPathCount: 15
  changedPathCount: 15
  foreignChangeCount: 0
  secretLikeFindings: 0
  gitCommandPerformed: false
  branchCreated: false
  commitCreated: false
  pushed: false
  destructiveOperationAllowed: false
  forcePushAllowed: false
  tagAllowed: false
  releaseAllowed: false
  productionWriteAllowed: false
  secretMaterialAllowed: false
  ownerOperationRequired: false
  authorityGranted: false
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-038"
  downstreamState: "PENDING"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_BRANCH_DELIVERY_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-037-BRANCH-COMMIT-PUSH-V1",
  status: "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_VERIFIED",
  workOrderId: "WO-MAO-037",
  planId: "plan-wo-mao-037-branch-commit-push-v1",
  repository: "bsvalues/terragroq",
  branch: "codex/wo-mao-037-governed-delivery",
  baseCommitSha: "a553abf39299a1aecd7d97368bd212699483da61",
  baseTreeHash: "fca0bb39bac595e42abfd95f41aedfcf5f7fac4b",
  planContentHash: "9ad3e845c4dec0ad9c152393aa2b7a8bd720ecfe14b91129056e8dfa32da1c77",
  resultHash: "917e7eb0c6d97b6b1c0f177de230f6fdd607df1d7495bb830da323d7b1f59479",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "BRANCH_COMMIT_PUSH_RESERVED_PATHS_ONLY",
  reservedPathCount: 15,
  changedPathCount: 15,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  gitCommandPerformed: false,
  branchCreated: false,
  commitCreated: false,
  pushed: false,
  destructiveOperationAllowed: false,
  forcePushAllowed: false,
  tagAllowed: false,
  releaseAllowed: false,
  productionWriteAllowed: false,
  secretMaterialAllowed: false,
  ownerOperationRequired: false,
  authorityGranted: false,
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-038",
  downstreamState: "PENDING",
  recordContentHash: "259c38e57b17031ffcbaaa90cdf8ea8fde2a276908652e1e1d6e60671b9022f6",
} satisfies MultiAgentBranchDeliveryEvidence)

export function isVerifiedWoMao037BranchDeliveryEvidence(
  record: MultiAgentBranchDeliveryEvidence = MULTI_AGENT_BRANCH_DELIVERY_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_BRANCH_DELIVERY_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-037-BRANCH-COMMIT-PUSH-V1"
    && record.status === "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_VERIFIED"
    && record.workOrderId === "WO-MAO-037"
    && record.planId === "plan-wo-mao-037-branch-commit-push-v1"
    && record.repository === "bsvalues/terragroq"
    && record.branch === "codex/wo-mao-037-governed-delivery"
    && record.baseCommitSha === "a553abf39299a1aecd7d97368bd212699483da61"
    && record.baseTreeHash === "fca0bb39bac595e42abfd95f41aedfcf5f7fac4b"
    && record.planContentHash === "9ad3e845c4dec0ad9c152393aa2b7a8bd720ecfe14b91129056e8dfa32da1c77"
    && record.resultHash === "917e7eb0c6d97b6b1c0f177de230f6fdd607df1d7495bb830da323d7b1f59479"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "BRANCH_COMMIT_PUSH_RESERVED_PATHS_ONLY"
    && record.reservedPathCount === 15
    && record.changedPathCount === 15
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.gitCommandPerformed === false
    && record.branchCreated === false
    && record.commitCreated === false
    && record.pushed === false
    && record.destructiveOperationAllowed === false
    && record.forcePushAllowed === false
    && record.tagAllowed === false
    && record.releaseAllowed === false
    && record.productionWriteAllowed === false
    && record.secretMaterialAllowed === false
    && record.ownerOperationRequired === false
    && record.authorityGranted === false
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-038"
    && record.downstreamState === "PENDING"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "259c38e57b17031ffcbaaa90cdf8ea8fde2a276908652e1e1d6e60671b9022f6"
}
