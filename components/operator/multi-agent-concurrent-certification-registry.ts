import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentConcurrentCertificationEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-055-CONCURRENT-CERTIFICATION-LANES-V1"
  status: "CANONICAL_CONCURRENT_CERTIFICATION_LANES_VERIFIED"
  workOrderId: "WO-MAO-055"
  executionId: "concurrent-certification-lanes-wo-mao-055-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "CONCURRENT_CERTIFICATION_LANE_EXECUTION_STATIC_USEFUL_WORK"
  dependencyWorkOrders: readonly ["WO-MAO-054"]
  builderLaneIds: readonly ["codex-devex-hook-tooling-foundation", "codex-release-engineering-foundation"]
  selectedProgramIds: readonly ["PROGRAM-DEVEX-HOOK-TOOLING-001", "PROGRAM-RELEASE-ENGINEERING-001"]
  builderLaneCount: 2
  fanInProjectionCount: 1
  providerExclusionCount: 1
  reservedPathCount: 7
  changedPathCount: 7
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
  claudeSelected: false
  completionState: "COMPLETE"
  downstreamWorkOrders: readonly ["WO-MAO-056", "WO-MAO-057"]
  downstreamState: "READY_AFTER_CONCURRENT_CERTIFICATION_LANES"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_CONCURRENT_CERTIFICATION_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-055-CONCURRENT-CERTIFICATION-LANES-V1",
  status: "CANONICAL_CONCURRENT_CERTIFICATION_LANES_VERIFIED",
  workOrderId: "WO-MAO-055",
  executionId: "concurrent-certification-lanes-wo-mao-055-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "af656d442b6ca47fc7f12bd1ac46a7b7ccdd4a13",
  baseTreeHash: "1f12d7e2d8ed87d148f3f68272775f0768b299fb",
  planContentHash: "c19174545641b5c7e5381990a83639b40dffadf941e78073e27ba572c36f9cf5",
  resultHash: "f5a7384ad6ed27b57d5d83339528a02289e88f1b3037f49ede9a586c39ac5b5f",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "CONCURRENT_CERTIFICATION_LANE_EXECUTION_STATIC_USEFUL_WORK",
  dependencyWorkOrders: Object.freeze(["WO-MAO-054"] as const),
  builderLaneIds: Object.freeze(["codex-devex-hook-tooling-foundation", "codex-release-engineering-foundation"] as const),
  selectedProgramIds: Object.freeze(["PROGRAM-DEVEX-HOOK-TOOLING-001", "PROGRAM-RELEASE-ENGINEERING-001"] as const),
  builderLaneCount: 2,
  fanInProjectionCount: 1,
  providerExclusionCount: 1,
  reservedPathCount: 7,
  changedPathCount: 7,
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
  claudeSelected: false,
  completionState: "COMPLETE",
  downstreamWorkOrders: Object.freeze(["WO-MAO-056", "WO-MAO-057"] as const),
  downstreamState: "READY_AFTER_CONCURRENT_CERTIFICATION_LANES",
  recordContentHash: "6ea76942424ac149536ec81f299477b133d07a7af151cd1fa694ba0ea393350e",
} satisfies MultiAgentConcurrentCertificationEvidence)

export function isVerifiedWoMao055ConcurrentCertificationEvidence(
  record: MultiAgentConcurrentCertificationEvidence = MULTI_AGENT_CONCURRENT_CERTIFICATION_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_CONCURRENT_CERTIFICATION_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-055-CONCURRENT-CERTIFICATION-LANES-V1"
    && record.status === "CANONICAL_CONCURRENT_CERTIFICATION_LANES_VERIFIED"
    && record.workOrderId === "WO-MAO-055"
    && record.executionId === "concurrent-certification-lanes-wo-mao-055-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "af656d442b6ca47fc7f12bd1ac46a7b7ccdd4a13"
    && record.baseTreeHash === "1f12d7e2d8ed87d148f3f68272775f0768b299fb"
    && record.planContentHash === "c19174545641b5c7e5381990a83639b40dffadf941e78073e27ba572c36f9cf5"
    && record.resultHash === "f5a7384ad6ed27b57d5d83339528a02289e88f1b3037f49ede9a586c39ac5b5f"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "CONCURRENT_CERTIFICATION_LANE_EXECUTION_STATIC_USEFUL_WORK"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-054"])
    && JSON.stringify(record.builderLaneIds) === JSON.stringify(["codex-devex-hook-tooling-foundation", "codex-release-engineering-foundation"])
    && JSON.stringify(record.selectedProgramIds) === JSON.stringify(["PROGRAM-DEVEX-HOOK-TOOLING-001", "PROGRAM-RELEASE-ENGINEERING-001"])
    && record.builderLaneCount === 2
    && record.fanInProjectionCount === 1
    && record.providerExclusionCount === 1
    && record.reservedPathCount === 7
    && record.changedPathCount === 7
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
    && record.claudeSelected === false
    && record.completionState === "COMPLETE"
    && JSON.stringify(record.downstreamWorkOrders) === JSON.stringify(["WO-MAO-056", "WO-MAO-057"])
    && record.downstreamState === "READY_AFTER_CONCURRENT_CERTIFICATION_LANES"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "6ea76942424ac149536ec81f299477b133d07a7af151cd1fa694ba0ea393350e"
}
