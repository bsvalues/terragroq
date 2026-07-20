import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao059Through062FinalCertificationEvidence,
  MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE,
} from "@/components/operator/multi-agent-final-certification-registry"
import { hashRecord } from "@/lib/governance/hash"

describe("WO-MAO-059 through WO-MAO-062 final certification closure", () => {
  it("records useful work as merged while rejecting unattended durable certification", () => {
    expect(isVerifiedWoMao059Through062FinalCertificationEvidence()).toBe(true)
    expect(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE).toMatchObject({
      programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
      repository: "bsvalues/terragroq",
      baseCommitSha: "da3d67aaa93afd74c4c3a72ecb67ae3265387f33",
      baseTreeHash: "8c61b46a50e3200c6adb8429273568cfd69351d7",
      mergedUsefulWorkOrderPr: 414,
      usefulWorkOrderGateSatisfied: true,
      usefulWorkOrderCount: 10,
      durationClockThresholdPassed: true,
      durableBackgroundRuntimeActive: false,
      continuousUnattendedOperatorProcessObserved: false,
      betweenSessionExecutionObserved: false,
      soakCertificationAccepted: false,
      rejectionReason: "NO_DURABLE_BACKGROUND_RUNTIME_OR_CONTINUOUS_UNATTENDED_PROCESS",
    })
  })

  it("closes the final four Work Orders without accepting false certification", () => {
    expect(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE.workOrders.map((workOrder) => ({
      workOrderId: workOrder.workOrderId,
      certificationAccepted: workOrder.certificationAccepted,
    }))).toEqual([
      { workOrderId: "WO-MAO-059", certificationAccepted: false },
      { workOrderId: "WO-MAO-060", certificationAccepted: false },
      { workOrderId: "WO-MAO-061", certificationAccepted: false },
      { workOrderId: "WO-MAO-062", certificationAccepted: false },
    ])
    expect(Object.values(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE.ownerCounters)).toEqual([0, 0, 0, 0, 0])
    expect(Object.values(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE.blockedScope)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE.portfolioContinuation).toEqual({
      multiAgentProgramState: "CLOSED_CERTIFICATION_REJECTED",
      nextEligibleProgramId: "PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001",
      ownerDecisionRequired: false,
    })
  })

  it("rejects rehashed non-canonical nested claims", () => {
    const forged = structuredClone(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE)
    forged.ownerCounters = {}
    const { recordContentHash: _discarded, ...claims } = forged
    forged.recordContentHash = hashRecord(claims)

    expect(forged.recordContentHash).not.toBe(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE.recordContentHash)
    expect(isVerifiedWoMao059Through062FinalCertificationEvidence(forged)).toBe(false)
  })

  it("accepts canonical nested claims regardless of object key insertion order", () => {
    const reordered = structuredClone(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE)
    reordered.ownerCounters = {
      OWNER_ROUTINE_CONTACT_COUNT: 0,
      OWNER_ROUTINE_DECISION_COUNT: 0,
      OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
      OWNER_CREDENTIAL_TOUCH_COUNT: 0,
      OWNER_OPERATION_TOUCH_COUNT: 0,
    }
    reordered.blockedScope = {
      destructiveCleanupPerformed: false,
      runtimeActivated: false,
      paidOverageUsed: false,
      rejectedRuntimeRetried: false,
      pacsCountyProtectedDataTouched: false,
      secretOrCredentialInspected: false,
      productionMutationPerformed: false,
    }

    expect(hashRecord(reordered)).toBe(hashRecord(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE))
    expect(isVerifiedWoMao059Through062FinalCertificationEvidence(reordered)).toBe(true)
  })

  it("rejects reordered or prefix-only final Work Order claims", () => {
    const forged = structuredClone(MULTI_AGENT_FINAL_CERTIFICATION_EVIDENCE)
    forged.workOrders = forged.workOrders.slice(0, 3)
    const { recordContentHash: _discarded, ...claims } = forged
    forged.recordContentHash = hashRecord(claims)

    expect(isVerifiedWoMao059Through062FinalCertificationEvidence(forged)).toBe(false)
  })
})
