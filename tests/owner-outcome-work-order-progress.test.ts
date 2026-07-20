import { describe, expect, it } from "vitest"

import { getPortfolioOperatorProgram } from "@/components/operator/portfolio-operator-registry"
import {
  buildLoopPacket,
  buildWorkOrderChain,
  deriveOrderedWorkOrderStatuses,
} from "@/components/operator/portfolio-operator-resolver"

describe("owner outcome work-order progress", () => {
  it("promotes exactly the next incomplete work order", () => {
    expect(deriveOrderedWorkOrderStatuses(9, 0)).toEqual([
      "READY",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ])
    expect(deriveOrderedWorkOrderStatuses(9, 1)).toEqual([
      "COMPLETE",
      "READY",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ])
    expect(deriveOrderedWorkOrderStatuses(9, 8)).toEqual([
      "COMPLETE",
      "COMPLETE",
      "COMPLETE",
      "COMPLETE",
      "COMPLETE",
      "COMPLETE",
      "COMPLETE",
      "COMPLETE",
      "READY",
    ])
  })

  it("advances the active owner-outcome work order from recorded progress", () => {
    const ownerOutcome = getPortfolioOperatorProgram().backlog.find(
      (program) => program.programId === "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001",
    )!

    expect(buildLoopPacket(ownerOutcome, 0)).toMatchObject({
      activeWorkOrder: "WO-OWNER-OUTCOME-001",
      eligibleWorkOrders: ["WO-OWNER-OUTCOME-001"],
    })
    expect(buildLoopPacket(ownerOutcome, 1)).toMatchObject({
      activeWorkOrder: "WO-OWNER-OUTCOME-002",
      eligibleWorkOrders: ["WO-OWNER-OUTCOME-002"],
    })
    expect(buildWorkOrderChain(ownerOutcome, 1).map((workOrder) => workOrder.status)).toEqual([
      "COMPLETE",
      "READY",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ])
  })

  it("rejects malformed progress instead of inventing readiness", () => {
    expect(() => deriveOrderedWorkOrderStatuses(0, 0)).toThrow(RangeError)
    expect(() => deriveOrderedWorkOrderStatuses(6, -1)).toThrow(RangeError)
    expect(() => deriveOrderedWorkOrderStatuses(9, 10)).toThrow(RangeError)
    expect(() => deriveOrderedWorkOrderStatuses(6, 1.5)).toThrow(RangeError)
  })
})
