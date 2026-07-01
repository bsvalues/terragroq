import { describe, expect, it } from "vitest"
import {
  getHermesWorkerPacketSchema,
  isHermesWorkerPacketReviewable,
} from "@/components/brain-council/hermes-worker-packet-schema"

describe("Hermes worker packet schema", () => {
  it("defines all required worker packet fields", () => {
    const schema = getHermesWorkerPacketSchema()

    expect(schema.executionStatus).toBe("not-active")
    expect(schema.requiredFields.map((field) => field.label)).toEqual([
      "Work Order",
      "Goal",
      "Loop",
      "Authority gate",
      "Allowed actions",
      "Blocked actions",
      "Target system",
      "Evidence required",
      "Safety checks",
      "Rollback / stop condition",
      "Operator approval state",
      "Execution status",
    ])
  })

  it("requires explicit safety controls before review", () => {
    const schema = getHermesWorkerPacketSchema()

    expect(schema.safetyChecks).toEqual([
      "Work Order exists",
      "Primary authority is explicit",
      "blocked actions are listed",
      "evidence requirements are listed",
      "rollback or stop condition is listed",
      "execution status remains not-active",
    ])
  })

  it("does not execute, persist, dispatch, start queues, or write production", () => {
    const schema = getHermesWorkerPacketSchema()

    expect(schema.safety).toEqual({
      schemaOnly: true,
      executesPacket: false,
      persistsPacket: false,
      dispatchesWorker: false,
      startsQueue: false,
      writesProduction: false,
    })
  })

  it("only marks complete packets as reviewable", () => {
    expect(
      isHermesWorkerPacketReviewable({
        "Work Order": "WO-HERMES-003",
        Goal: "Hermes Governed Worker Dock Readiness",
        Loop: "readiness schema",
        "Authority gate": "owner activation gate",
        "Allowed actions": "preview only",
        "Blocked actions": "no dispatch",
        "Target system": "Worker Dock",
        "Evidence required": "tests and production checks",
        "Safety checks": "all blocked capabilities remain false",
        "Rollback / stop condition": "stop on activation request",
        "Operator approval state": "not approved for runtime",
        "Execution status": "not-active",
      }),
    ).toBe(true)

    expect(
      isHermesWorkerPacketReviewable({
        "Work Order": "WO-HERMES-003",
        Goal: "Hermes readiness",
      }),
    ).toBe(false)
  })
})
