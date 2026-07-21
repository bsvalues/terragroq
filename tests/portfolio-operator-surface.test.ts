import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao051StatusUxEvidence,
  MULTI_AGENT_STATUS_UX_EVIDENCE,
} from "@/components/operator/multi-agent-status-ux-registry"
import { getPortfolioOperatorProgram } from "@/components/operator/portfolio-operator-registry"
import { getPortfolioOperatorSurface } from "@/components/operator/portfolio-operator-surface"
import type { OwnerOutcomeSource } from "@/components/operator/owner-outcome-delivery"

const eligibleOwnerOutcome: OwnerOutcomeSource = {
  ref: "GOAL-0099",
  command: "Improve the WilliamOS goal console layout",
  lane: "ui",
  mode: "implement",
  risk: "low",
  authority: "A2_WRITE_OWN",
  verdict: "allow",
  requiresApproval: false,
  matchedRules: [],
  status: "classified",
}

describe("portfolio operator surface", () => {
  it("shows active owner-outcome continuation without exposing execution controls", () => {
    const surface = getPortfolioOperatorSurface(getPortfolioOperatorProgram(), [eligibleOwnerOutcome])

    expect(surface.title).toBe("Portfolio Operator")
    expect(surface.selection).toMatchObject({
      decision: "SELECT_PROGRAM",
      reasonCode: "HIGHEST_PRIORITY_EXECUTABLE_PROGRAM",
      programId: "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001",
      goalId: "GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001",
      ownerOutcomeRef: "GOAL-0099",
      ownerDecisionRequired: false,
    })
    expect(surface.selectedProgram).toMatchObject({
      programId: "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001",
      state: "READY",
      authorityMode: "CODEX_ELIGIBLE",
      riskClass: "R1",
    })
    expect(surface.selectedOwnerOutcome).toMatchObject({
      ref: "GOAL-0099",
      command: "Improve the WilliamOS goal console layout",
    })
    expect(surface.activeWorkOrder).toMatchObject({
      workOrderId: "WO-OWNER-OUTCOME-009",
      status: "READY",
      title: "Rolling Owner Outcome Intake",
    })
    expect(surface.statusCounts).toEqual({
      total: 9,
      complete: 8,
      ready: 1,
      pending: 0,
      blocked: 0,
      deferred: 0,
    })
    expect(surface.activeDependencyState).toEqual({
      total: 0,
      satisfied: 0,
      dependencies: [],
    })
    expect(surface.activeReservation).toMatchObject({
      evidencePath: "docs/reports/WO-OWNER-OUTCOME-009.md",
      ownerOperationsAllowed: false,
    })
    expect(surface.readyWorkOrders).toEqual(["WO-OWNER-OUTCOME-009"])
    expect(surface.evidenceChain.map((entry) => entry.workOrderId)).toEqual([
      "WO-OWNER-OUTCOME-003",
      "WO-OWNER-OUTCOME-004",
      "WO-OWNER-OUTCOME-005",
      "WO-OWNER-OUTCOME-006",
      "WO-OWNER-OUTCOME-007",
      "WO-OWNER-OUTCOME-008",
    ])
    expect(surface.backlog.find((program) => program.programId === "PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001")).toMatchObject({
      state: "COMPLETE",
      blockedReason: expect.stringContaining("completed as a WilliamOS-native"),
    })
    expect(surface.backlog.find((program) => program.programId === "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001")).toMatchObject({
      state: "READY",
      blockedReason: expect.stringContaining("standing"),
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

  it("pins and re-identifies eligible outcomes through fallback IDs", () => {
    const legacyOutcome: OwnerOutcomeSource = {
      ...eligibleOwnerOutcome,
      id: 77,
      ref: null,
    }
    const surface = getPortfolioOperatorSurface(getPortfolioOperatorProgram(), [legacyOutcome])

    expect(surface.selection).toMatchObject({
      decision: "SELECT_PROGRAM",
      ownerOutcomeRef: "GOAL-77",
    })
    expect(surface.selectedOwnerOutcome).toMatchObject({
      id: 77,
      ref: null,
      command: "Improve the WilliamOS goal console layout",
    })
  })

  it("pins the same eligible outcome when a newer record is blocked", () => {
    const blockedLatest: OwnerOutcomeSource = {
      ...eligibleOwnerOutcome,
      ref: "GOAL-0100",
      command: "Deploy TerraFusion to production",
    }
    const surface = getPortfolioOperatorSurface(
      getPortfolioOperatorProgram(),
      [blockedLatest, eligibleOwnerOutcome],
    )

    expect(surface.selection).toMatchObject({
      decision: "SELECT_PROGRAM",
      ownerOutcomeRef: "GOAL-0099",
    })
    expect(surface.selectedOwnerOutcome?.ref).toBe("GOAL-0099")
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
