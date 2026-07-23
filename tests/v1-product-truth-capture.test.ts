import { describe, expect, it } from "vitest"

import { buildProductTruthEvidence } from "@/scripts/hermes-bridge/v1-product-truth-capture.mjs"

describe("Issue #448 persisted product truth capture", () => {
  it("binds Work Orders, Runtime, Trace, Eval, and Evidence to one persisted work order", () => {
    const evidence = buildProductTruthEvidence({
      workOrder: { id: 42, ref: "WO-HERMES-OUTCOME-8" },
      events: [
        { id: 101, eventType: "HERMES_RUNTIME_CHECKPOINT" },
        { id: 102, eventType: "HERMES_RUNTIME_FAILURE_EVAL" },
        { id: 103, eventType: "HERMES_RUNTIME_LEASE" },
      ],
      evidenceRecords: [{ id: 9, workOrderId: 42 }],
    })

    expect(evidence).toMatchObject({
      workOrderId: 42,
      workOrderRef: "WO-HERMES-OUTCOME-8",
      workOrderViewId: 42,
      runtimeWorkOrderId: 42,
      traceWorkOrderId: 42,
      runtimeExecutionId: "work-order:42",
      checkpointEventIds: ["101"],
      failureEvalEventIds: ["102"],
      evalEventIds: ["102"],
      leaseEventIds: ["103"],
      evidenceRecordIds: ["9"],
      evidenceWorkOrderIds: [42],
      traceEventIds: ["101", "102", "103"],
      consistent: true,
      querySource: "PERSISTED_DATABASE",
    })
    expect(evidence.consistencyDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("fails closed when runtime events or evidence cross the persisted work-order identity", () => {
    expect(() => buildProductTruthEvidence({
      workOrder: { id: 42, ref: "WO-HERMES-OUTCOME-8" },
      events: [{ id: 101, eventType: "HERMES_RUNTIME_CHECKPOINT" }],
      evidenceRecords: [],
    })).toThrow("PRODUCT_TRUTH_RELATION_INVALID")

    expect(() => buildProductTruthEvidence({
      workOrder: { id: 42, ref: "WO-HERMES-OUTCOME-8" },
      events: [
        { id: 101, eventType: "HERMES_RUNTIME_CHECKPOINT" },
        { id: 103, eventType: "HERMES_RUNTIME_LEASE" },
      ],
      evidenceRecords: [],
    })).toThrow("PRODUCT_TRUTH_RELATION_INVALID")

    expect(() => buildProductTruthEvidence({
      workOrder: { id: 42, ref: "WO-HERMES-OUTCOME-8" },
      events: [
        { id: 101, eventType: "HERMES_RUNTIME_CHECKPOINT" },
        { id: 103, eventType: "HERMES_RUNTIME_LEASE" },
      ],
      evidenceRecords: [{ id: 9, workOrderId: 77 }],
    })).toThrow("PRODUCT_TRUTH_RELATION_INVALID")
  })
})
