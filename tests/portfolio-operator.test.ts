import { describe, expect, it } from "vitest"

import {
  getPortfolioOperatorProgram,
  type PortfolioProgramRecord,
} from "@/components/operator/portfolio-operator-registry"
import {
  buildGoalPacket,
  buildLoopPacket,
  buildWorkOrderChain,
  resolveNextPortfolioProgram,
} from "@/components/operator/portfolio-operator-resolver"

describe("portfolio operator", () => {
  it("reconciles completed programs and keeps an ordered ratified backlog", () => {
    const portfolio = getPortfolioOperatorProgram()

    expect(portfolio.goal.goalId).toBe("GOAL-PORTFOLIO-OPERATOR-001")
    expect(portfolio.workOrders).toHaveLength(10)
    expect(portfolio.completedPrograms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ programId: "PROGRAM-WILLIAMOS-TF-COMMAND-001" }),
      ]),
    )
    expect(portfolio.backlog.map((program) => program.programId)).toEqual([
      "PROGRAM-RELEASE-ENGINEERING-001",
      "PROGRAM-DEVEX-HOOK-TOOLING-001",
      "PROGRAM-BACKEND-OE-001",
      "PROGRAM-PROPERTY-WORKBENCH-001",
      "PROGRAM-TERRAPILOT-LIVE-001",
      "PROGRAM-AI-BRAIN-OPS-001",
      "PROGRAM-COUNTY-RUNTIME-READINESS-001",
      "PROGRAM-RELEASE-ROLLBACK-AUTOMATION-001",
      "PROGRAM-PRODUCTION-COUNTY-DEPLOYMENT-001",
    ])
  })

  it("selects the highest-value dependency-cleared program inside authority", () => {
    const portfolio = getPortfolioOperatorProgram()

    expect(resolveNextPortfolioProgram(portfolio.backlog)).toMatchObject({
      decision: "SELECT_PROGRAM",
      programId: "PROGRAM-RELEASE-ENGINEERING-001",
      goalId: "GOAL-RELEASE-ENGINEERING-001",
      ownerDecisionRequired: false,
    })
  })

  it("filters complete, blocked, deferred, superseded, dependency-blocked, and authority-blocked entries", () => {
    const seed = getPortfolioOperatorProgram().backlog[0]
    const records: PortfolioProgramRecord[] = [
      { ...seed, programId: "COMPLETE", state: "COMPLETE" },
      { ...seed, programId: "BLOCKED", state: "BLOCKED" },
      { ...seed, programId: "DEFERRED", state: "DEFERRED" },
      { ...seed, programId: "SUPERSEDED", state: "SUPERSEDED" },
      { ...seed, programId: "DEPENDENCY", dependencies: ["MISSING"] },
      { ...seed, programId: "AUTHORITY", authorityMode: "OWNER_GATED" },
    ]

    expect(resolveNextPortfolioProgram(records)).toMatchObject({
      decision: "OWNER_DECISION_REQUIRED",
      reasonCode: "NO_APPROVED_EXECUTABLE_PROGRAM",
      ownerDecisionRequired: true,
    })
  })

  it("generates bounded goal, loop, and Work Order packets", () => {
    const selected = getPortfolioOperatorProgram().backlog[0]
    const goal = buildGoalPacket(selected)
    const loop = buildLoopPacket(selected)
    const workOrders = buildWorkOrderChain(selected)

    expect(goal).toMatchObject({
      goalId: "GOAL-RELEASE-ENGINEERING-001",
      riskCeiling: "R1",
      ownerDecisionRequired: false,
    })
    expect(loop.continuationRule).toContain("portfolio resolver")
    expect(workOrders[0]).toMatchObject({
      workOrderId: "WO-RELEASE-001",
      status: "ACTIVE",
      riskClass: "R0",
    })
    expect(workOrders.every((workOrder) => workOrder.rollback === "Revert the scoped documentation and static model changes.")).toBe(true)
  })
})
