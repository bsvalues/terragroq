import { describe, expect, it } from "vitest"

import { getPortfolioOperatorProgram } from "@/components/operator/portfolio-operator-registry"
import { getPortfolioOperatorSurface } from "@/components/operator/portfolio-operator-surface"

describe("portfolio operator surface", () => {
  it("shows continuous continuation without exposing execution controls", () => {
    const surface = getPortfolioOperatorSurface()

    expect(surface.title).toBe("Portfolio Operator")
    expect(surface.selection).toMatchObject({
      decision: "SELECT_PROGRAM",
      reasonCode: "HIGHEST_PRIORITY_EXECUTABLE_PROGRAM",
      programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    })
    expect(surface.selectedProgram).toMatchObject({
      programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    })
    expect(surface.activeWorkOrder).toMatchObject({
      workOrderId: "WO-MAO-050",
      status: "READY",
    })
    expect(surface.controls).toEqual([])
    expect(surface.safety).toMatchObject({
      commandRunnerAdded: false,
      autonomousRuntimeLoopAdded: false,
      productionWriteAdded: false,
    })
  })

  it("shows no selected program or active work at an owner-decision wall", () => {
    const portfolio = getPortfolioOperatorProgram()
    const surface = getPortfolioOperatorSurface({
      ...portfolio,
      backlog: portfolio.backlog.map((program) => ({ ...program, state: "BLOCKED" as const })),
    })

    expect(surface.selection.decision).toBe("OWNER_DECISION_REQUIRED")
    expect(surface.selectedProgram).toBeNull()
    expect(surface.activeWorkOrder).toBeNull()
  })
})
