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

  it("uses dependency-driven status with Phase 0 complete and WO-MAO-008 ready", () => {
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(0, 7).every(({ status }) => status === "COMPLETE")).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(0, 7).every(({ evidencePath }) => existsSync(evidencePath))).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[7]).toMatchObject({
      workOrderId: "WO-MAO-008",
      dependsOn: ["WO-MAO-005", "WO-MAO-007"],
      status: "READY",
      riskClass: "R1",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[15]).toMatchObject({ workOrderId: "WO-MAO-016", riskClass: "R3" })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[53]).toMatchObject({ workOrderId: "WO-MAO-054", riskClass: "R2" })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(8).every(({ status }) => status === "PENDING")).toBe(true)

    const afterEight = resolveMultiAgentWorkOrders(
      new Set(Array.from({ length: 8 }, (_, index) => `WO-MAO-${String(index + 1).padStart(3, "0")}`)),
    )
    expect(afterEight[8].status).toBe("READY")
    expect(afterEight[9].status).toBe("PENDING")
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
