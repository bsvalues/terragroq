import { describe, expect, it } from "vitest"

import { getEvidenceRollupSurface } from "@/components/evidence/evidence-rollup-surface"
import { getAuthorityRegistrySurface } from "@/components/governance/authority-registry"
import { getGoalNativeConceptSurface } from "@/components/goal-console/goal-native-concept"
import { getLoopNativeConceptSurface } from "@/components/goal-console/loop-native-concept"
import { buildOperatorStopPacket } from "@/components/operator/codex-operator-resolver"
import {
  OWNER_OPERATION_COUNTER_NAMES,
} from "@/lib/governance/owner-operation-evidence"

const zeroCounters = {
  OWNER_OPERATION_TOUCH_COUNT: 0,
  OWNER_CREDENTIAL_TOUCH_COUNT: 0,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
  OWNER_ROUTINE_DECISION_COUNT: 0,
  OWNER_ROUTINE_CONTACT_COUNT: 0,
} as const

describe("owner-operation cross-surface binding", () => {
  it("uses one no-evidence model across goal, loop, evidence, and authority", () => {
    const surfaces = [
      getGoalNativeConceptSurface().ownerOperationEvidence,
      getLoopNativeConceptSurface().ownerOperationEvidence,
      getEvidenceRollupSurface([]).ownerOperationEvidence,
      getAuthorityRegistrySurface().ownerOperationEvidence,
    ]

    expect(surfaces.map((surface) => surface.binding.surface)).toEqual(["goal", "loop", "evidence", "authority"])
    expect(surfaces.every((surface) => surface.counters.OWNER_OPERATION_TOUCH_COUNT === null)).toBe(true)
    expect(OWNER_OPERATION_COUNTER_NAMES).toHaveLength(5)
    expect(surfaces[0]).toMatchObject({
      lifecycleState: "NO_OWNER_OPERATION_EVIDENCE",
      reasonCode: "OWNER_OPERATION_EVIDENCE_MISSING",
      certification: { independentlyVerified: false },
    })
  })

  it("keeps genuine authority decisions outside routine owner-operation counts", () => {
    const packet = buildOperatorStopPacket({
      decisionId: "DECISION-MAO-OWNER-ANCHOR",
      blockedWorkOrderId: "WO-MAO-001",
      wallType: "AUTH_ACCESS_WALL",
      decisionRequired: "Provision the independent owner trust anchor.",
      options: ["Keep the program blocked", "Provision the owner anchor"],
      recommendedOption: "Keep blocked until the Owner provisions the anchor",
      risk: "R3",
      safeDefault: "Runtime remains disabled",
      resumeAction: "Verify owner-issued artifacts, then resume WO-MAO-001.",
      ownerOperationCounters: zeroCounters,
    })

    expect(packet.ownerDecisionRequired).toBe(true)
    expect(packet.ownerOperationEvidence.ownerAuthorityDecisions.countsAsRoutineOwnerOperation).toBe(false)
    expect(packet.ownerOperationEvidence.routineOwnerOperations.countsAsRoutineOwnerOperation).toBe(true)
    expect(packet.ownerOperationEvidence.lifecycleState).toBe("UNVERIFIED_ZERO_OWNER_OPERATIONS")
    expect(packet.ownerOperationEvidence.binding).toMatchObject({
      surface: "stop-packet",
      workOrderId: "WO-MAO-001",
      decisionId: "DECISION-MAO-OWNER-ANCHOR",
    })
  })
})
