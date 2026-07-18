import { describe, expect, it } from "vitest"

import {
  BACKEND_OE_PROGRAM_EVIDENCE,
  classifyBackendReadiness,
  isVerifiedBackendOeProgramEvidence,
} from "@/components/operator/backend-oe-registry"

const cloneEvidence = () => JSON.parse(JSON.stringify(BACKEND_OE_PROGRAM_EVIDENCE))

describe("Backend Operational Excellence static evidence", () => {
  it("records two useful backend Work Orders for the WO-MAO-059 soak", () => {
    expect(isVerifiedBackendOeProgramEvidence()).toBe(true)
    expect(BACKEND_OE_PROGRAM_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-BACKEND-OE-PROGRAM-V1",
      status: "STATIC_BACKEND_OPERATIONAL_EXCELLENCE_VERIFIED",
      programId: "PROGRAM-BACKEND-OE-001",
      completedWorkOrderCount: 2,
      completionState: "COMPLETE",
      certificationUse: "WO-MAO-059_SOAK_STATIC_WORK_ORDER_SEQUENCE",
    })
    expect(BACKEND_OE_PROGRAM_EVIDENCE.workOrders.map((workOrder) => workOrder.workOrderId)).toEqual([
      "WO-BACKEND-OE-001",
      "WO-BACKEND-OE-002",
    ])
  })

  it("classifies readiness without mutating backend state", () => {
    expect(classifyBackendReadiness({ routeReachable: true, semanticCurrent: true })).toBe("READY")
    expect(classifyBackendReadiness({ routeReachable: false, semanticCurrent: true })).toBe("DEGRADED")
    expect(classifyBackendReadiness({ routeReachable: true, semanticCurrent: false })).toBe("DEGRADED")
    expect(classifyBackendReadiness({ routeReachable: false, semanticCurrent: false, missingEvidence: true })).toBe("UNKNOWN")
    expect(classifyBackendReadiness({ routeReachable: true, semanticCurrent: true, authorityRequired: true })).toBe("BLOCKED_AUTHORITY")
    expect(classifyBackendReadiness({ routeReachable: true, semanticCurrent: true, safetyIssue: true })).toBe("BLOCKED_SAFETY")
  })

  it("keeps backend OE blocked from runtime, auth, DB, production, and secret scope", () => {
    expect(BACKEND_OE_PROGRAM_EVIDENCE.blockedSurfaces).toEqual(expect.arrayContaining([
      "runtime-service-change",
      "production-write",
      "auth-policy-change",
      "database-schema-data-mutation",
      "environment-package-vercel-change",
      "command-runner",
      "background-worker",
      "scheduler",
      "secret-or-credential-access",
      "pacs-county-protected-data",
    ]))
    expect(BACKEND_OE_PROGRAM_EVIDENCE.routeBehaviorChanged).toBe(false)
    expect(BACKEND_OE_PROGRAM_EVIDENCE.productionWritePerformed).toBe(false)
    expect(BACKEND_OE_PROGRAM_EVIDENCE.secretOrCredentialAccessed).toBe(false)
  })

  it("fails verification when sequence or safety claims are weakened", () => {
    const missingWorkOrder = cloneEvidence()
    missingWorkOrder.workOrders.pop()
    missingWorkOrder.completedWorkOrderCount = 1
    expect(isVerifiedBackendOeProgramEvidence(missingWorkOrder)).toBe(false)

    for (const mutate of [
      (value: any) => { value.productionWritePerformed = true },
      (value: any) => { value.commandRunnerAdded = true },
      (value: any) => { value.backgroundWorkerAdded = true },
      (value: any) => { value.secretOrCredentialAccessed = true },
      (value: any) => { value.ownerOperationRequired = true },
      (value: any) => { value.ownerTouchCount = 1 },
    ]) {
      const changed = cloneEvidence()
      mutate(changed)
      expect(isVerifiedBackendOeProgramEvidence(changed)).toBe(false)
    }
  })
})
