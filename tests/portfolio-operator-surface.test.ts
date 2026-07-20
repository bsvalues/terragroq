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
      decision: "OWNER_DECISION_REQUIRED",
      reasonCode: "NO_APPROVED_EXECUTABLE_PROGRAM",
      programId: null,
    })
    expect(surface.selectedProgram).toBeNull()
    expect(surface.activeWorkOrder).toBeNull()
    expect(surface.statusCounts).toEqual({
      total: 0,
      complete: 0,
      ready: 0,
      pending: 0,
      blocked: 0,
      deferred: 0,
    })
    expect(surface.activeDependencyState).toBeNull()
    expect(surface.activeReservation).toBeNull()
    expect(surface.evidenceChain.map((entry) => entry.workOrderId)).toEqual([])
    expect(surface.backlog.find((program) => program.programId === "PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001")).toMatchObject({
      state: "DEFERRED",
      blockedReason: expect.stringContaining("non-executable until a follow-on operator packet"),
    })
    expect(surface.ownerAuthorityWalls.map((wall) => wall.programId)).toEqual(expect.arrayContaining([
      "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001",
      "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001",
      "PROGRAM-PROPERTY-WORKBENCH-001",
      "PROGRAM-TERRAPILOT-LIVE-001",
      "PROGRAM-COUNTY-RUNTIME-READINESS-001",
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
