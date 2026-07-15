import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"

import {
  MULTI_AGENT_OPERATOR_PROGRAM,
  MULTI_AGENT_OPERATOR_WORK_ORDERS,
  MULTI_AGENT_OWNER_COUNTER_NAMES,
  resolveMultiAgentWorkOrders,
} from "@/components/operator/multi-agent-operator-registry"

const workOrderId = (number: number) => `WO-MAO-${String(number).padStart(3, "0")}`

describe("multi-agent operator registry", () => {
  it("registers the exact 62-record executable program", () => {
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS).toHaveLength(62)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.map((record) => record.workOrderId)).toEqual(
      Array.from({ length: 62 }, (_, index) => `WO-MAO-${String(index + 1).padStart(3, "0")}`),
    )
    expect(new Set(MULTI_AGENT_OPERATOR_WORK_ORDERS.map((record) => record.workOrderId)).size).toBe(62)
  })

  it("projects evidenced provider outcomes without bypassing Phase 3 dependencies", () => {
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(0, 25).every(({ status }) => status === "COMPLETE")).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(0, 25).every(({ evidencePath }) => existsSync(evidencePath))).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[22]).toMatchObject({
      workOrderId: "WO-MAO-023",
      dependsOn: ["WO-MAO-017", "WO-MAO-018", "WO-MAO-019", "WO-MAO-020", "WO-MAO-021", "WO-MAO-022"],
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-023-eligible-set-scheduler-worker-pool.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[23]).toMatchObject({
      workOrderId: "WO-MAO-024",
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-024-team-topology-fan-out-fan-in.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[24]).toMatchObject({
      workOrderId: "WO-MAO-025",
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-025-isolated-workspace-manager.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.filter(({ status }) => status === "READY")
      .map(({ workOrderId }) => workOrderId)).toEqual(["WO-MAO-026"])
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[28]).toMatchObject({
      workOrderId: "WO-MAO-029",
      status: "COMPLETE",
      resumable: false,
      evidencePath: "docs/reports/WO-MAO-029-supported-codex-capability-conformance.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[31]).toMatchObject({
      workOrderId: "WO-MAO-032",
      status: "COMPLETE",
      resumable: false,
      evidencePath: "docs/reports/WO-MAO-032-claude-capability-transport-proof.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[32]).toMatchObject({
      workOrderId: "WO-MAO-033",
      status: "DEFERRED_PROVIDER_UNAVAILABLE",
      resumable: true,
      evidencePath: "docs/reports/WO-MAO-032-claude-capability-transport-proof.md",
    })
    expect([30, 31, 34, 35, 36].map((number) => MULTI_AGENT_OPERATOR_WORK_ORDERS[number - 1].status))
      .toEqual(["PENDING", "PENDING", "PENDING", "PENDING", "PENDING"])
    expect([23, 24, 25, 29, 32, 33].every((number) => existsSync(MULTI_AGENT_OPERATOR_WORK_ORDERS[number - 1].evidencePath))).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[53]).toMatchObject({ workOrderId: "WO-MAO-054", riskClass: "R2" })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.filter(({ status }) => status === "PENDING")).toHaveLength(33)

    const afterSixteen = resolveMultiAgentWorkOrders(
      new Set(Array.from({ length: 16 }, (_, index) => `WO-MAO-${String(index + 1).padStart(3, "0")}`)),
    )
    expect(afterSixteen[16].status).toBe("READY")
    expect(afterSixteen[17].status).toBe("READY")
    expect(afterSixteen[18].status).toBe("READY")
  })

  it("keeps a provider-unavailable defer explicit and resumable without releasing its blocked consumer", () => {
    const completed = new Set([...Array.from({ length: 25 }, (_, index) => workOrderId(index + 1)), "WO-MAO-029", "WO-MAO-032"])
    const workOrders = resolveMultiAgentWorkOrders(completed, new Set(), new Set(["WO-MAO-033"]))
    expect(workOrders[32]).toMatchObject({ status: "DEFERRED_PROVIDER_UNAVAILABLE", resumable: true })
    expect(workOrders[33]).toMatchObject({ workOrderId: "WO-MAO-034", status: "PENDING" })
    expect(workOrders.filter(({ status }) => status === "READY").map(({ workOrderId }) => workOrderId))
      .toEqual(["WO-MAO-026"])
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
