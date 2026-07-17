import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentCertificationPortfolioEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-054-CERTIFICATION-PORTFOLIO-SELECTION-V1"
  status: "CANONICAL_CERTIFICATION_PORTFOLIO_SELECTION_VERIFIED"
  workOrderId: "WO-MAO-054"
  selectionId: "certification-portfolio-selection-wo-mao-054-v1"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  planContentHash: string
  resultHash: string
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  authorityScope: "CERTIFICATION_PORTFOLIO_SELECTION_ONLY"
  dependencyWorkOrders: readonly ["WO-MAO-036", "WO-MAO-044", "WO-MAO-053"]
  selectedProgramIds: readonly ["PROGRAM-DEVEX-HOOK-TOOLING-001", "PROGRAM-RELEASE-ENGINEERING-001"]
  selectedLaneCount: 2
  fanInLaneCount: 1
  providerExclusionCount: 1
  acceptanceGateCount: 5
  reservedPathCount: 5
  changedPathCount: 5
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
  claudeExclusionReason: "PROVIDER_UNAVAILABLE_WO_MAO_032"
  completionState: "COMPLETE"
  downstreamWorkOrderId: "WO-MAO-055"
  downstreamState: "READY_AFTER_CERTIFICATION_PORTFOLIO_SELECTION"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const MULTI_AGENT_CERTIFICATION_PORTFOLIO_EVIDENCE = Object.freeze({
  evidenceId: "EVIDENCE-WO-MAO-054-CERTIFICATION-PORTFOLIO-SELECTION-V1",
  status: "CANONICAL_CERTIFICATION_PORTFOLIO_SELECTION_VERIFIED",
  workOrderId: "WO-MAO-054",
  selectionId: "certification-portfolio-selection-wo-mao-054-v1",
  repository: "bsvalues/terragroq",
  baseCommitSha: "37e99b733676a1ac046125500eb6ca0232af0178",
  baseTreeHash: "841f5e5566fd73c5ab80074a71f62bd6de8f314a",
  planContentHash: "f8703c81c3f904fdafd76e93122a895c12652a332c83ed3328bb2bceb7632e78",
  resultHash: "7a7344c51fb1f3051bd2c155a6c9110c2887975e368b55ec78103788da520396",
  activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  authorityScope: "CERTIFICATION_PORTFOLIO_SELECTION_ONLY",
  dependencyWorkOrders: Object.freeze(["WO-MAO-036", "WO-MAO-044", "WO-MAO-053"] as const),
  selectedProgramIds: Object.freeze(["PROGRAM-DEVEX-HOOK-TOOLING-001", "PROGRAM-RELEASE-ENGINEERING-001"] as const),
  selectedLaneCount: 2,
  fanInLaneCount: 1,
  providerExclusionCount: 1,
  acceptanceGateCount: 5,
  reservedPathCount: 5,
  changedPathCount: 5,
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
  claudeExclusionReason: "PROVIDER_UNAVAILABLE_WO_MAO_032",
  completionState: "COMPLETE",
  downstreamWorkOrderId: "WO-MAO-055",
  downstreamState: "READY_AFTER_CERTIFICATION_PORTFOLIO_SELECTION",
  recordContentHash: "8a49d67f9425f059bdcfbf05cead09d25bf3cde425710a6f6528af3bc0227493",
} satisfies MultiAgentCertificationPortfolioEvidence)

export function isVerifiedWoMao054CertificationPortfolioEvidence(
  record: MultiAgentCertificationPortfolioEvidence = MULTI_AGENT_CERTIFICATION_PORTFOLIO_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_CERTIFICATION_PORTFOLIO_EVIDENCE).sort())
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-WO-MAO-054-CERTIFICATION-PORTFOLIO-SELECTION-V1"
    && record.status === "CANONICAL_CERTIFICATION_PORTFOLIO_SELECTION_VERIFIED"
    && record.workOrderId === "WO-MAO-054"
    && record.selectionId === "certification-portfolio-selection-wo-mao-054-v1"
    && record.repository === "bsvalues/terragroq"
    && record.baseCommitSha === "37e99b733676a1ac046125500eb6ca0232af0178"
    && record.baseTreeHash === "841f5e5566fd73c5ab80074a71f62bd6de8f314a"
    && record.planContentHash === "f8703c81c3f904fdafd76e93122a895c12652a332c83ed3328bb2bceb7632e78"
    && record.resultHash === "7a7344c51fb1f3051bd2c155a6c9110c2887975e368b55ec78103788da520396"
    && record.activeProgramGrant === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && record.authorityScope === "CERTIFICATION_PORTFOLIO_SELECTION_ONLY"
    && JSON.stringify(record.dependencyWorkOrders) === JSON.stringify(["WO-MAO-036", "WO-MAO-044", "WO-MAO-053"])
    && JSON.stringify(record.selectedProgramIds) === JSON.stringify(["PROGRAM-DEVEX-HOOK-TOOLING-001", "PROGRAM-RELEASE-ENGINEERING-001"])
    && record.selectedLaneCount === 2
    && record.fanInLaneCount === 1
    && record.providerExclusionCount === 1
    && record.acceptanceGateCount === 5
    && record.reservedPathCount === 5
    && record.changedPathCount === 5
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
    && record.claudeExclusionReason === "PROVIDER_UNAVAILABLE_WO_MAO_032"
    && record.completionState === "COMPLETE"
    && record.downstreamWorkOrderId === "WO-MAO-055"
    && record.downstreamState === "READY_AFTER_CERTIFICATION_PORTFOLIO_SELECTION"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && [record.planContentHash, record.resultHash, record.recordContentHash].every((value) => HASH_64.test(value))
    && record.recordContentHash === "8a49d67f9425f059bdcfbf05cead09d25bf3cde425710a6f6528af3bc0227493"
}
