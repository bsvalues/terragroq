import { describe, expect, it } from "vitest"

import {
  OWNER_OPERATION_COUNTER_NAMES,
  createOwnerOperationEvidencePlaceholder,
  evaluateOwnerOperationEvidence,
  type OwnerOperationCounters,
} from "@/lib/governance/owner-operation-evidence"

const zeroCounters: OwnerOperationCounters = {
  OWNER_OPERATION_TOUCH_COUNT: 0,
  OWNER_CREDENTIAL_TOUCH_COUNT: 0,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
  OWNER_ROUTINE_DECISION_COUNT: 0,
  OWNER_ROUTINE_CONTACT_COUNT: 0,
}
const binding = {
  surface: "work-order" as const,
  programId: "PROGRAM-TEST",
  goalId: "GOAL-TEST",
  loopId: "LOOP-TEST",
  workOrderId: "WO-TEST",
  decisionId: null,
  action: "verify",
}

describe("owner-operation evidence governance", () => {
  it("rejects malformed counters and bindings", () => {
    expect(() => evaluateOwnerOperationEvidence(null as never, binding)).toThrow(/counters must be an object/i)
    expect(() => evaluateOwnerOperationEvidence(zeroCounters, null as never)).toThrow(/supported surface/i)
    expect(() => createOwnerOperationEvidencePlaceholder({ ...binding, action: "" })).toThrow(/action/i)
    expect(() => evaluateOwnerOperationEvidence({ ...zeroCounters, OWNER_OTHER_TOUCH_COUNT: 0 } as never, binding))
      .toThrow(/canonical five keys/i)
  })

  it("defines the exact five counters without inventing a measurement", () => {
    expect(OWNER_OPERATION_COUNTER_NAMES).toEqual([
      "OWNER_OPERATION_TOUCH_COUNT",
      "OWNER_CREDENTIAL_TOUCH_COUNT",
      "OWNER_DIAGNOSTIC_TOUCH_COUNT",
      "OWNER_ROUTINE_DECISION_COUNT",
      "OWNER_ROUTINE_CONTACT_COUNT",
    ])
    const placeholder = createOwnerOperationEvidencePlaceholder(binding)
    expect(placeholder).toMatchObject({
      posture: "static/read-only",
      counters: {
        OWNER_OPERATION_TOUCH_COUNT: null,
        OWNER_CREDENTIAL_TOUCH_COUNT: null,
        OWNER_DIAGNOSTIC_TOUCH_COUNT: null,
        OWNER_ROUTINE_DECISION_COUNT: null,
        OWNER_ROUTINE_CONTACT_COUNT: null,
      },
      lifecycleState: "NO_OWNER_OPERATION_EVIDENCE",
      reasonCode: "OWNER_OPERATION_EVIDENCE_MISSING",
      certification: {
        independentEvidenceRequired: true,
        independentlyVerified: false,
      },
    })
    expect(placeholder.binding).toEqual(binding)
    expect(Object.isFrozen(placeholder)).toBe(true)
    expect(Object.isFrozen(placeholder.counters)).toBe(true)
  })

  it("never certifies caller-supplied zero counters", () => {
    expect(evaluateOwnerOperationEvidence(zeroCounters, binding)).toMatchObject({
      lifecycleState: "UNVERIFIED_ZERO_OWNER_OPERATIONS",
      reasonCode: "OWNER_OPERATION_EVIDENCE_UNVERIFIED",
      certification: { independentlyVerified: false, evidenceHeadHash: null, runId: null },
    })
  })

  it.each(OWNER_OPERATION_COUNTER_NAMES)("fails babysitting for nonzero %s with the failure reason", (name) => {
    const result = evaluateOwnerOperationEvidence({ ...zeroCounters, [name]: 1 }, binding)

    expect(result.lifecycleState).toBe("FAILED_OWNER_BABYSITTING")
    expect(result.reasonCode).toBe("FAIL_OWNER_BABYSITTING")
    expect(result.certification.independentlyVerified).toBe(false)
  })

  it("distinguishes genuine authority decisions from routine owner operations", () => {
    const model = createOwnerOperationEvidencePlaceholder(binding)

    expect(model.ownerAuthorityDecisions.countsAsRoutineOwnerOperation).toBe(false)
    expect(model.ownerAuthorityDecisions.description).toContain("consequential decisions")
    expect(model.routineOwnerOperations.countsAsRoutineOwnerOperation).toBe(true)
    expect(model.routineOwnerOperations.description).toContain("non-owner operators")
  })
})
