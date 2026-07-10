import { describe, expect, it } from "vitest"

import { getCodexOperatorProgram } from "@/components/operator/codex-operator-registry"
import {
  buildOperatorStopPacket,
  evaluateOperatorContinuation,
  resolveNextOperatorWorkOrder,
} from "@/components/operator/codex-operator-resolver"

describe("Codex operator next-WO resolver", () => {
  it("selects the same dependency-ready work order deterministically", () => {
    const program = getCodexOperatorProgram()
    const activePilot = {
      ...program,
      status: "ACTIVE" as const,
      workOrders: program.workOrders.map((workOrder, index) => ({
        ...workOrder,
        status: index < 21 ? ("COMPLETE" as const) : index === 21 ? ("READY" as const) : ("PENDING" as const),
      })),
    }

    expect(resolveNextOperatorWorkOrder(activePilot)).toMatchObject({
      decision: "NEXT_WORK_ORDER",
      workOrderId: "WO-CODEX-OPERATOR-022",
    })
    expect(resolveNextOperatorWorkOrder(activePilot)).toEqual(resolveNextOperatorWorkOrder(activePilot))
  })

  it("reports unmet dependencies instead of skipping ahead", () => {
    const program = getCodexOperatorProgram()
    const workOrders = program.workOrders.map((workOrder) =>
      workOrder.workOrderId === "WO-CODEX-OPERATOR-022"
        ? {
            ...workOrder,
            status: "READY" as const,
            dependsOn: [...workOrder.dependsOn, "WO-CODEX-OPERATOR-999"],
          }
        : workOrder.workOrderId > "WO-CODEX-OPERATOR-022"
          ? { ...workOrder, status: "PENDING" as const }
          : workOrder,
    )

    expect(resolveNextOperatorWorkOrder({ ...program, workOrders })).toMatchObject({
      decision: "BLOCKED_DEPENDENCY",
      workOrderId: "WO-CODEX-OPERATOR-022",
      blockers: ["WO-CODEX-OPERATOR-999"],
    })
  })

  it("continues after a normal pass and remediates in-scope validation failures", () => {
    expect(
      evaluateOperatorContinuation({
        previousWorkOrderResult: "PASS",
        nextRiskClass: "R1",
        riskCeiling: "R1",
      }),
    ).toMatchObject({ decision: "CONTINUE", reasonCode: "NEXT_WO_ELIGIBLE" })

    expect(
      evaluateOperatorContinuation({
        previousWorkOrderResult: "FAILED_VALIDATION",
        repairInsideScope: true,
        nextRiskClass: "R1",
        riskCeiling: "R1",
      }),
    ).toMatchObject({ decision: "REMEDIATE", reasonCode: "IN_SCOPE_REPAIR" })
  })

  it.each([
    ["auth behavior", "AUTH_ACCESS_WALL"],
    ["database schema migration", "DB_SCHEMA_WALL"],
    ["secret rotation", "SECRET_WALL"],
    ["PACS mutation", "TERRAFUSION_PACS_WALL"],
    ["Hermes activation", "RUNTIME_ACTIVATION_WALL"],
    ["destructive worktree cleanup", "DESTRUCTIVE_OPERATION_WALL"],
  ])("stops on %s", (requestedCapability, reasonCode) => {
    expect(
      evaluateOperatorContinuation({
        previousWorkOrderResult: "PASS",
        nextRiskClass: "R1",
        riskCeiling: "R1",
        requestedCapability,
      }),
    ).toMatchObject({ decision: "AUTHORITY_WALL", reasonCode })
  })

  it("marks the goal complete only when no registered work remains", () => {
    expect(resolveNextOperatorWorkOrder(getCodexOperatorProgram())).toEqual({
      decision: "GOAL_COMPLETE",
      workOrderId: null,
      blockers: [],
    })

    expect(
      evaluateOperatorContinuation({
        previousWorkOrderResult: "PASS",
        nextRiskClass: null,
        riskCeiling: "R1",
        goalCriteriaProven: true,
      }),
    ).toMatchObject({ decision: "COMPLETE", reasonCode: "GOAL_PROVEN" })
  })

  it("builds one decision-ready, secret-safe stop packet", () => {
    const packet = buildOperatorStopPacket({
      decisionId: "DECISION-AUTH-001",
      blockedWorkOrderId: "WO-CODEX-OPERATOR-022",
      wallType: "AUTH_ACCESS_WALL",
      decisionRequired: "Authorize or reject an auth-policy change.",
      options: ["Keep the current policy", "Open a separately scoped auth goal"],
      recommendedOption: "Keep the current policy",
      risk: "R3",
      safeDefault: "No auth change",
      resumeAction: "Resume the blocked WO only after an explicit owner decision.",
    })

    expect(packet.ownerDecisionRequired).toBe(true)
    expect(packet.doNotProvide).toEqual([
      "passwords",
      "tokens",
      "cookies",
      "session values",
      "private keys",
      "database URLs",
      "secrets",
    ])
    expect(packet.resumeAction).toContain("Resume")
  })
})
