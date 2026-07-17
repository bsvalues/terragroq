import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao051StatusUxEvidence,
  MULTI_AGENT_STATUS_UX_EVIDENCE,
} from "@/components/operator/multi-agent-status-ux-registry"
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
      workOrderId: "WO-MAO-057",
      status: "READY",
    })
    expect(surface.statusCounts).toEqual({
      total: 62,
      complete: 55,
      ready: 1,
      pending: 5,
      blocked: 0,
      deferred: 1,
    })
    expect(surface.activeDependencyState).toMatchObject({
      total: 1,
      satisfied: 1,
    })
    expect(surface.activeDependencyState?.dependencies.map((dependency) => dependency.workOrderId)).toEqual([
      "WO-MAO-055",
    ])
    expect(surface.activeReservation).toMatchObject({
      evidencePath: "docs/reports/WO-MAO-057.md",
      ownerOperationsAllowed: false,
    })
    expect(surface.activeReservation?.scope).toEqual(["Declared repository evidence", "Reserved R2 paths", "Tests and reports"])
    expect(surface.activeReservation?.discoveryBoundary).toEqual([
      "docs/governance",
      "docs/reports",
      "components/operator",
      "scripts/multi-agent-operator",
      "tests",
    ])
    expect(surface.evidenceChain.map((entry) => entry.workOrderId)).toEqual([
      "WO-MAO-051",
      "WO-MAO-052",
      "WO-MAO-053",
      "WO-MAO-054",
      "WO-MAO-055",
      "WO-MAO-056",
    ])
    expect(surface.ownerAuthorityWalls.map((wall) => wall.programId)).toEqual(expect.arrayContaining([
      "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001",
      "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001",
      "PROGRAM-TERRAPILOT-LIVE-001",
    ]))
    expect(surface.providerPosture).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Hosted Codex", status: "available" }),
      expect.objectContaining({ label: "Claude Code", status: "deferred" }),
      expect.objectContaining({ label: "Local nested Codex", status: "rejected" }),
    ]))
    expect(surface.controls).toEqual([])
    expect(surface.safety).toMatchObject({
      commandRunnerAdded: false,
      autonomousRuntimeLoopAdded: false,
      productionWriteAdded: false,
    })
    expect(MULTI_AGENT_STATUS_UX_EVIDENCE).toMatchObject({
      workOrderId: "WO-MAO-051",
      downstreamWorkOrderId: "WO-MAO-052",
      controlsExposed: 0,
      recordContentHash: "6d3e2279b02f2a50bde868c2494ea20acfef06485c01b6f52dff24c0fff97d77",
    })
    expect(isVerifiedWoMao051StatusUxEvidence()).toBe(true)
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
