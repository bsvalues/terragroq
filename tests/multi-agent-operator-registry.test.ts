import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"

import {
  MULTI_AGENT_OPERATOR_PROGRAM,
  MULTI_AGENT_OPERATOR_WORK_ORDERS,
  MULTI_AGENT_OWNER_COUNTER_NAMES,
  resolveMultiAgentWorkOrders,
} from "@/components/operator/multi-agent-operator-registry"

describe("multi-agent operator registry", () => {
  it("registers the exact 62-record executable program", () => {
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS).toHaveLength(62)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.map((record) => record.workOrderId)).toEqual(
      Array.from({ length: 62 }, (_, index) => `WO-MAO-${String(index + 1).padStart(3, "0")}`),
    )
    expect(new Set(MULTI_AGENT_OPERATOR_WORK_ORDERS.map((record) => record.workOrderId)).size).toBe(62)
  })

  it("advances after final independent assurance passes", () => {
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(0, 15).every(({ status }) => status === "COMPLETE")).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(0, 15).every(({ evidencePath }) => existsSync(evidencePath))).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[15]).toMatchObject({
      workOrderId: "WO-MAO-016",
      dependsOn: ["WO-MAO-015"],
      status: "READY",
      riskClass: "R3",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[53]).toMatchObject({ workOrderId: "WO-MAO-054", riskClass: "R2" })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(16).every(({ status }) => status === "PENDING")).toBe(true)

    const afterSixteen = resolveMultiAgentWorkOrders(
      new Set(Array.from({ length: 16 }, (_, index) => `WO-MAO-${String(index + 1).padStart(3, "0")}`)),
    )
    expect(afterSixteen[16].status).toBe("READY")
    expect(afterSixteen[17].status).toBe("READY")
    expect(afterSixteen[18].status).toBe("READY")
  })

  it("has only known, acyclic, backward dependencies", () => {
    const known = new Set(MULTI_AGENT_OPERATOR_WORK_ORDERS.map(({ workOrderId }) => workOrderId))
    for (const record of MULTI_AGENT_OPERATOR_WORK_ORDERS) {
      expect(record.dependsOn.every((dependency) => known.has(dependency))).toBe(true)
      expect(record.dependsOn.every((dependency) => dependency < record.workOrderId)).toBe(true)
      expect(new Set(record.dependsOn).size).toBe(record.dependsOn.length)
    }
  })

  it("forbids owner operations and binds final-only communication with five zero counters", () => {
    expect(MULTI_AGENT_OPERATOR_PROGRAM).toMatchObject({
      executionMode: "DEPENDENCY_RESERVATION_ELIGIBLE_SET",
      communicationMode: "FINAL_OUTCOME_OR_GENUINE_AUTHORITY_WALL_ONLY",
      ownerRole: "AUTHORITY_ONLY",
      ownerOperationsAllowed: false,
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.every(({ ownerOperationsAllowed }) => ownerOperationsAllowed === false)).toBe(true)
    expect(MULTI_AGENT_OWNER_COUNTER_NAMES).toEqual([
      "OWNER_OPERATION_TOUCH_COUNT",
      "OWNER_CREDENTIAL_TOUCH_COUNT",
      "OWNER_DIAGNOSTIC_TOUCH_COUNT",
      "OWNER_ROUTINE_DECISION_COUNT",
      "OWNER_ROUTINE_CONTACT_COUNT",
    ])
    expect(Object.values(MULTI_AGENT_OPERATOR_PROGRAM.ownerCounters)).toEqual([0, 0, 0, 0, 0])
  })
})
