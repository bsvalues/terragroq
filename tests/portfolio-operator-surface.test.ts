import { describe, expect, it } from "vitest"

import { getPortfolioOperatorSurface } from "@/components/operator/portfolio-operator-surface"

describe("portfolio operator surface", () => {
  it("shows continuous continuation without exposing execution controls", () => {
    const surface = getPortfolioOperatorSurface()

    expect(surface.title).toBe("Portfolio Operator")
    expect(surface.selection).toMatchObject({
      decision: "SELECT_PROGRAM",
      programId: "PROGRAM-RELEASE-ENGINEERING-001",
    })
    expect(surface.activeWorkOrder.workOrderId).toBe("WO-RELEASE-001")
    expect(surface.controls).toEqual([])
    expect(surface.safety).toMatchObject({
      commandRunnerAdded: false,
      autonomousRuntimeLoopAdded: false,
      productionWriteAdded: false,
    })
  })
})
