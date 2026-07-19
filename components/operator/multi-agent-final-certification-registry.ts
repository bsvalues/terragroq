import { hashRecord } from "@/lib/governance/hash"

export type MultiAgentFinalWorkOrderId =
  | "WO-MAO-059"
  | "WO-MAO-060"
  | "WO-MAO-061"
  | "WO-MAO-062"

export type MultiAgentFinalCertificationWorkOrder = {
  workOrderId: MultiAgentFinalWorkOrderId
  result: "COMPLETE_EVIDENCE_BACKED_REJECTION" | "COMPLETE_AUDIT" | "COMPLETE_PROGRAM_CLOSURE"
  evidencePath: string
  certificationAccepted: boolean
}

export type MultiAgentFinalCertificationEvidence = {
  evidenceId: "EVIDENCE-WO-MAO-059-062-FINAL-CERTIFICATION-CLOSURE-V1"
  status: "UNATTENDED_DURABLE_CERTIFICATION_REJECTED_PROGRAM_CLOSED"
  programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  mergedUsefulWorkOrderPr: 414
  mergedUsefulWorkOrderCommit: string
  usefulWorkOrderGateSatisfied: true
  usefulWorkOrderCount: 10
  durationClockThresholdPassed: true
  durableBackgroundRuntimeActive: false
  continuousUnattendedOperatorProcessObserved: false
  betweenSessionExecutionObserved: false
  soakCertificationAccepted: false
  rejectionReason: "NO_DURABLE_BACKGROUND_RUNTIME_OR_CONTINUOUS_UNATTENDED_PROCESS"
  ownerAuthorizationScope: "PUSH_PR_MERGE_THROUGH_WO_MAO_062"
  workOrders: readonly MultiAgentFinalCertificationWorkOrder[]
  ownerCounters: Record<string, 0>
  blockedScope: {
    productionMutationPerformed: false
    secretOrCredentialInspected: false
    pacsCountyProtectedDataTouched: false
    rejectedRuntimeRetried: false
    paidOverageUsed: false
    runtimeActivated: false
    destructiveCleanupPerformed: false
  }
  portfolioContinuation: {
    multiAgentProgramState: "CLOSED_CERTIFICATION_REJECTED"
    nextEligibleProgramId: "PROGRAM-PROPERTY-WORKBENCH-001"
    ownerDecisionRequired: false
  }
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

const OWNER_COUNTERS = Object.freeze({
  OWNER_OPERATION_TOUCH_COUNT: 0,
  OWNER_CREDENTIAL_TOUCH_COUNT: 0,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
  OWNER_ROUTINE_DECISION_COUNT: 0,
  OWNER_ROUTINE_CONTACT_COUNT: 0,
} as const)

const WORK_ORDERS = Object.freeze([
  {
    workOrderId: "WO-MAO-059",
    result: "COMPLETE_EVIDENCE_BACKED_REJECTION",
    evidencePath: "docs/reports/WO-MAO-059-sustained-zero-touch-soak-rejection.md",
    certificationAccepted: false,
  },
  {
    workOrderId: "WO-MAO-060",
    result: "COMPLETE_AUDIT",
    evidencePath: "docs/reports/WO-MAO-060-zero-owner-touch-audit.md",
    certificationAccepted: false,
  },
  {
    workOrderId: "WO-MAO-061",
    result: "COMPLETE_EVIDENCE_BACKED_REJECTION",
    evidencePath: "docs/reports/WO-MAO-061-unattended-multi-agent-certification-rejection.md",
    certificationAccepted: false,
  },
  {
    workOrderId: "WO-MAO-062",
    result: "COMPLETE_PROGRAM_CLOSURE",
    evidencePath: "docs/reports/WO-MAO-062-program-closure-portfolio-continuation.md",
    certificationAccepted: false,
  },
] as const satisfies readonly MultiAgentFinalCertificationWorkOrder[])

const CLAIMS = {
  evidenceId: "EVIDENCE-WO-MAO-059-062-FINAL-CERTIFICATION-CLOSURE-V1",
  status: "UNATTENDED_DURABLE_CERTIFICATION_REJECTED_PROGRAM_CLOSED",
  programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  repository: "bsvalues/terragroq",
  baseCommitSha: "da3d67aaa93afd74c4c3a72ecb67ae3265387f33",
  baseTreeHash: "8c61b46a50e3200c6adb8429273568cfd69351d7",
  mergedUsefulWorkOrderPr: 414,
  mergedUsefulWorkOrderCommit: "da3d67aaa93afd74c4c3a72ecb67ae3265387f33",
  usefulWorkOrderGateSatisfied: true,
  usefulWorkOrderCount: 10,
  durationClockThresholdPassed: true,
  durableBackgroundRuntimeActive: false,
  continuousUnattendedOperatorProcessObserved: false,
  betweenSessionExecutionObserved: false,
  soakCertificationAccepted: false,
  rejectionReason: "NO_DURABLE_BACKGROUND_RUNTIME_OR_CONTINUOUS_UNATTENDED_PROCESS",
  ownerAuthorizationScope: "PUSH_PR_MERGE_THROUGH_WO_MAO_062",
  workOrders: WORK_ORDERS,
  ownerCounters: OWNER_COUNTERS,
  blockedScope: {
    productionMutationPerformed: false,
    secretOrCredentialInspected: false,
    pacsCountyProtectedDataTouched: false,
    rejectedRuntimeRetried: false,
    paidOverageUsed: false,
    runtimeActivated: false,
    destructiveCleanupPerformed: false,
  },
  portfolioContinuation: {
    multiAgentProgramState: "CLOSED_CERTIFICATION_REJECTED",
    nextEligibleProgramId: "PROGRAM-PROPERTY-WORKBENCH-001",
    ownerDecisionRequired: false,
  },
} as const

export const MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE = Object.freeze({
  ...CLAIMS,
  recordContentHash: hashRecord(CLAIMS),
} satisfies MultiAgentFinalCertificationEvidence)

export function isVerifiedWoMao059Through062FinalCertificationEvidence(
  record: unknown = MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE,
) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return false
  const candidate = record as MultiAgentFinalCertificationEvidence
  const { recordContentHash, ...recordClaims } = candidate
  let computedHash
  try {
    computedHash = hashRecord(recordClaims)
  } catch {
    return false
  }

  return JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify(Object.keys(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE).sort())
    && computedHash === recordContentHash
    && candidate.evidenceId === "EVIDENCE-WO-MAO-059-062-FINAL-CERTIFICATION-CLOSURE-V1"
    && candidate.status === "UNATTENDED_DURABLE_CERTIFICATION_REJECTED_PROGRAM_CLOSED"
    && candidate.programId === "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    && candidate.repository === "bsvalues/terragroq"
    && candidate.baseCommitSha === "da3d67aaa93afd74c4c3a72ecb67ae3265387f33"
    && candidate.baseTreeHash === "8c61b46a50e3200c6adb8429273568cfd69351d7"
    && candidate.mergedUsefulWorkOrderPr === 414
    && candidate.mergedUsefulWorkOrderCommit === "da3d67aaa93afd74c4c3a72ecb67ae3265387f33"
    && candidate.usefulWorkOrderGateSatisfied === true
    && candidate.usefulWorkOrderCount === 10
    && candidate.durationClockThresholdPassed === true
    && candidate.durableBackgroundRuntimeActive === false
    && candidate.continuousUnattendedOperatorProcessObserved === false
    && candidate.betweenSessionExecutionObserved === false
    && candidate.soakCertificationAccepted === false
    && candidate.rejectionReason === "NO_DURABLE_BACKGROUND_RUNTIME_OR_CONTINUOUS_UNATTENDED_PROCESS"
    && candidate.ownerAuthorizationScope === "PUSH_PR_MERGE_THROUGH_WO_MAO_062"
    && candidate.workOrders.map((workOrder) => workOrder.workOrderId).join(",") === "WO-MAO-059,WO-MAO-060,WO-MAO-061,WO-MAO-062"
    && candidate.workOrders.every((workOrder) => workOrder.evidencePath.startsWith("docs/reports/WO-MAO-0"))
    && candidate.workOrders.every((workOrder) => workOrder.certificationAccepted === false)
    && Object.values(candidate.ownerCounters).every((value) => value === 0)
    && Object.values(candidate.blockedScope).every((value) => value === false)
    && candidate.portfolioContinuation.multiAgentProgramState === "CLOSED_CERTIFICATION_REJECTED"
    && candidate.portfolioContinuation.nextEligibleProgramId === "PROGRAM-PROPERTY-WORKBENCH-001"
    && candidate.portfolioContinuation.ownerDecisionRequired === false
    && [candidate.baseCommitSha, candidate.baseTreeHash, candidate.mergedUsefulWorkOrderCommit].every((value) => SHA_40.test(value))
    && HASH_64.test(candidate.recordContentHash)
}
