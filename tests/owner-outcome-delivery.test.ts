import { describe, expect, it } from "vitest"

import {
  buildOwnerOutcomeDelivery,
  OWNER_OUTCOME_GOAL_ID,
  OWNER_OUTCOME_LOOP_ID,
  OWNER_OUTCOME_PROGRAM_ID,
  type OwnerOutcomeSource,
} from "@/components/operator/owner-outcome-delivery"

const eligibleSource: OwnerOutcomeSource = {
  ref: "GOAL-REGISTER-OWNER-OUTCOME-001",
  command: "Deliver a bounded WilliamOS-native operator status UI outcome.",
  lane: "ui",
  mode: "delivery",
  risk: "low",
  authority: "A2_WRITE_OWN",
  verdict: "requires_approval",
  requiresApproval: false,
  matchedRules: [],
  status: "classified",
}

describe("owner outcome delivery", () => {
  it("keeps fixed standing identities while awaiting an outcome", () => {
    expect(buildOwnerOutcomeDelivery(null)).toEqual(expect.objectContaining({
      programId: OWNER_OUTCOME_PROGRAM_ID,
      goalId: OWNER_OUTCOME_GOAL_ID,
      loopId: OWNER_OUTCOME_LOOP_ID,
      state: "AWAITING_OUTCOME",
      source: null,
      workOrders: [],
      ownerDecisionRequired: false,
      handoff: null,
    }))
  })

  it.each(["ui", "docs", "read_model"])(
    "standing-activates an eligible WilliamOS-native %s outcome",
    (lane) => {
      const delivery = buildOwnerOutcomeDelivery({ ...eligibleSource, lane })

      expect(delivery).toMatchObject({
        programId: "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001",
        goalId: "GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001",
        loopId: "LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001",
        state: "ACTIVE",
        authorityDecision: "STANDING_R0_R1",
        ownerDecisionRequired: false,
        ownerOperationsAllowed: false,
        durableRuntimeActive: false,
        source: {
          ref: eligibleSource.ref,
          lane,
          risk: "low",
        },
        handoff: {
          evidenceAnchor: `goal-register:${eligibleSource.ref}`,
          nextWorkOrderId: expect.any(String),
        },
      })
      expect(delivery.workOrders).toHaveLength(6)
      expect(delivery.workOrders.map((workOrder) => workOrder.status)).toEqual([
        "READY",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
        "PENDING",
      ])
      expect(delivery.handoff?.nextWorkOrderId).toBe(delivery.workOrders[0].workOrderId)
      expect(delivery.workOrders.every((workOrder) => workOrder.ownerOperationsAllowed === false)).toBe(true)
    },
  )

  it.each([
    "Deliver a TerraFusion status view.",
    "Read county assessment records.",
    "Integrate PACS parcel data.",
    "Deploy this change to production.",
    "Use a secret token for delivery.",
    "Enable runtime activation and a background worker.",
    "Retry issue #357 through a renamed adapter.",
  ])("never standing-activates protected scope: %s", (command) => {
    const delivery = buildOwnerOutcomeDelivery({ ...eligibleSource, command })

    expect(delivery.state).toBe("OWNER_DECISION_REQUIRED")
    expect(delivery.authorityDecision).not.toBe("STANDING_R0_R1")
    expect(delivery.ownerDecisionRequired).toBe(true)
    expect(delivery.workOrders).toEqual([])
    expect(delivery.handoff).toBeNull()
    expect(delivery.blockedReasons.length).toBeGreaterThan(0)
  })

  it("refuses a source whose doctrine verdict is refusal", () => {
    const delivery = buildOwnerOutcomeDelivery({ ...eligibleSource, verdict: "refuse" })

    expect(delivery).toMatchObject({
      state: "REFUSED",
      authorityDecision: "DOCTRINE_REFUSED",
      ownerDecisionRequired: false,
      workOrders: [],
      handoff: null,
    })
  })

  it("does not use standing authority to bypass a live doctrine approval gate", () => {
    const delivery = buildOwnerOutcomeDelivery({
      ...eligibleSource,
      matchedRules: ["RULE-PROTECTED-001"],
      requiresApproval: true,
    })

    expect(delivery).toMatchObject({
      state: "OWNER_DECISION_REQUIRED",
      authorityDecision: "NEW_OWNER_AUTHORITY_REQUIRED",
      ownerDecisionRequired: true,
      workOrders: [],
      handoff: null,
    })
  })

  it.each([
    ["dismissed", "DISMISSED", "OUTCOME_DISMISSED"],
    ["converted", "HANDED_OFF", "DRAFT_ALREADY_HANDED_OFF"],
  ])("does not regenerate work for a %s outcome", (status, state, authorityDecision) => {
    expect(buildOwnerOutcomeDelivery({ ...eligibleSource, status })).toMatchObject({
      state,
      authorityDecision,
      workOrders: [],
      handoff: null,
    })
  })
})
