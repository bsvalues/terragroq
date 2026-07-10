import { describe, expect, it } from "vitest"

import {
  CODEX_OPERATOR_GOAL,
  CODEX_OPERATOR_LOOP,
  CODEX_OPERATOR_WORK_ORDERS,
  getCodexOperatorProgram,
} from "@/components/operator/codex-operator-registry"

describe("Codex operator program registry", () => {
  it("adopts the canonical playbook, goal, and loop at the R1 ceiling", () => {
    const program = getCodexOperatorProgram()

    expect(program.documentId).toBe("WILLIAMOS-CODEX-OPERATOR-PLAYBOOK-001")
    expect(CODEX_OPERATOR_GOAL.goalId).toBe("GOAL-WOS-CODEX-OPERATOR-001")
    expect(CODEX_OPERATOR_GOAL.riskCeiling).toBe("R1")
    expect(CODEX_OPERATOR_LOOP.loopId).toBe("LOOP-WOS-CODEX-OPERATOR-001")
    expect(CODEX_OPERATOR_LOOP.continueUntil).toBe("GOAL_COMPLETE_OR_AUTHORITY_WALL")
    expect(program.ownerRole).toBe("Primary / authority owner")
    expect(program.operatorRole).toBe("Codex Work Order Operator")
  })

  it("registers the complete ordered WO-001 through WO-024 chain", () => {
    expect(CODEX_OPERATOR_WORK_ORDERS).toHaveLength(24)
    expect(CODEX_OPERATOR_WORK_ORDERS.map((workOrder) => workOrder.workOrderId)).toEqual(
      Array.from({ length: 24 }, (_, index) =>
        `WO-CODEX-OPERATOR-${String(index + 1).padStart(3, "0")}`,
      ),
    )

    for (const [index, workOrder] of CODEX_OPERATOR_WORK_ORDERS.entries()) {
      expect(["R0", "R1"]).toContain(workOrder.riskClass)
      expect(workOrder.evidencePath).toMatch(/^docs\//)
      if (index === 0) {
        expect(workOrder.dependsOn).toEqual([])
      } else {
        expect(workOrder.dependsOn.length).toBeGreaterThan(0)
        expect(
          workOrder.dependsOn.every((dependency) =>
            CODEX_OPERATOR_WORK_ORDERS.slice(0, index).some(
              (candidate) => candidate.workOrderId === dependency,
            ),
          ),
        ).toBe(true)
      }
    }
  })

  it("keeps product runtime and privileged authority explicitly blocked", () => {
    const blocked = CODEX_OPERATOR_GOAL.blocked.join(" ")

    expect(blocked).toMatch(/command runner/i)
    expect(blocked).toMatch(/auth/i)
    expect(blocked).toMatch(/database|schema/i)
    expect(blocked).toMatch(/Hermes|MCP/i)
    expect(blocked).toMatch(/memory write/i)
    expect(blocked).toMatch(/production write/i)
    expect(blocked).toMatch(/TerraFusion|PACS/i)
  })

  it("starts with WO-022 ready after the adoption implementation batch", () => {
    const program = getCodexOperatorProgram()
    const statuses = new Map(
      program.workOrders.map((workOrder) => [workOrder.workOrderId, workOrder.status]),
    )

    expect(statuses.get("WO-CODEX-OPERATOR-001")).toBe("COMPLETE")
    expect(statuses.get("WO-CODEX-OPERATOR-021")).toBe("COMPLETE")
    expect(statuses.get("WO-CODEX-OPERATOR-022")).toBe("READY")
    expect(statuses.get("WO-CODEX-OPERATOR-023")).toBe("PENDING")
    expect(statuses.get("WO-CODEX-OPERATOR-024")).toBe("PENDING")
  })
})
