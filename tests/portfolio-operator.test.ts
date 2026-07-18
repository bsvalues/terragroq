import { describe, expect, it } from "vitest"

import {
  getPortfolioOperatorProgram,
  type PortfolioProgramRecord,
} from "@/components/operator/portfolio-operator-registry"
import {
  buildGoalPacket,
  buildLoopPacket,
  buildWorkOrderChain,
  evaluateCredentialCustody,
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
    expect(portfolio.backlog[0]).toMatchObject({
      programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
      state: "SELECTED",
      nextGoalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    })
    expect(portfolio.backlog[1]).toMatchObject({
      programId: "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001",
      state: "TERMINAL",
      blockedReason: expect.stringContaining("#357 failed"),
    })
    expect(portfolio.backlog[2]).toMatchObject({
      programId: "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001",
      state: "SUPERSEDED",
    })
    expect(portfolio.backlog.map((program) => program.programId)).toEqual([
      "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
      "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001",
      "PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001",
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

  it("selects WO-MAO-058 after live failure recovery certification completes", () => {
    const portfolio = getPortfolioOperatorProgram()
    const multiAgentOperator = portfolio.backlog[0]

    expect(buildLoopPacket(multiAgentOperator)).toMatchObject({
      activeWorkOrder: "WO-MAO-058",
      eligibleWorkOrders: ["WO-MAO-058"],
      remediationTransition: null,
    })

    expect(resolveNextPortfolioProgram(portfolio.backlog)).toMatchObject({
      decision: "SELECT_PROGRAM",
      reasonCode: "HIGHEST_PRIORITY_EXECUTABLE_PROGRAM",
      programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
      goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
      ownerDecisionRequired: false,
    })
    expect(multiAgentOperator.state).toBe("SELECTED")
  })

  it("preserves deterministic priority and program-id ordering when higher-priority programs are unavailable", () => {
    const portfolio = getPortfolioOperatorProgram()
    const multiAgentOperator = portfolio.backlog[0]
    const release = portfolio.backlog.find((program) => program.programId === "PROGRAM-RELEASE-ENGINEERING-001")!
    const devex = portfolio.backlog.find((program) => program.programId === "PROGRAM-DEVEX-HOOK-TOOLING-001")!

    expect(resolveNextPortfolioProgram([
      { ...multiAgentOperator, state: "BLOCKED" },
      { ...release, priorityScore: 500 },
      { ...devex, priorityScore: 500 },
    ])).toMatchObject({
      decision: "SELECT_PROGRAM",
      programId: "PROGRAM-DEVEX-HOOK-TOOLING-001",
      ownerDecisionRequired: false,
    })
  })

  it("does not preserve an unrelated selected program with no typed remediation transition", () => {
    const portfolio = getPortfolioOperatorProgram()
    const release = portfolio.backlog.find((program) => program.programId === "PROGRAM-RELEASE-ENGINEERING-001")!
    const localRuntime = portfolio.backlog.find((program) => program.programId === "PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001")!

    expect(resolveNextPortfolioProgram([
      {
        ...localRuntime,
        state: "SELECTED",
        authorityMode: "CODEX_ELIGIBLE",
        priorityScore: 1_000,
      },
      release,
    ])).toMatchObject({
      decision: "SELECT_PROGRAM",
      reasonCode: "HIGHEST_PRIORITY_EXECUTABLE_PROGRAM",
      programId: "PROGRAM-RELEASE-ENGINEERING-001",
    })
  })

  it("allows only owner-login keyring credential custody", () => {
    expect(evaluateCredentialCustody("OS_KEYRING")).toEqual({ selectable: true, reasonCode: "OWNER_LOGIN_KEYRING_REQUIRED" })
    expect(evaluateCredentialCustody("RAW_GITHUB_SECRET").selectable).toBe(false)
    expect(evaluateCredentialCustody("RAW_LOCAL_FILE").selectable).toBe(false)
  })

  it("filters complete, blocked, deferred, superseded, dependency-blocked, and authority-blocked entries", () => {
    const seed = getPortfolioOperatorProgram().backlog[0]
    const records: PortfolioProgramRecord[] = [
      { ...seed, programId: "COMPLETE", state: "COMPLETE" },
      { ...seed, programId: "BLOCKED", state: "BLOCKED" },
      { ...seed, programId: "DEFERRED", state: "DEFERRED" },
      { ...seed, programId: "SUPERSEDED", state: "SUPERSEDED" },
      { ...seed, programId: "TERMINAL", state: "TERMINAL" },
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
      goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
      riskCeiling: "R3",
      ownerDecisionRequired: false,
    })
    expect(loop).toMatchObject({
      activeWorkOrder: "WO-MAO-058",
      eligibleWorkOrders: ["WO-MAO-058"],
      remediationTransition: null,
      executionMode: "DEPENDENCY_RESERVATION_ELIGIBLE_SET",
    })
    expect(loop.continuationRule).toContain("contact the Owner only for a genuine authority wall or the final outcome")
    expect(loop.orderedWorkOrderQueue[0]).toBe(workOrders[0].workOrderId)
    expect(workOrders[0]).toMatchObject({
      workOrderId: "WO-MAO-001",
      status: "COMPLETE",
      riskClass: "R1",
      ownerOperationsAllowed: false,
    })
    expect(workOrders[21]).toMatchObject({ workOrderId: "WO-MAO-022", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[22]).toMatchObject({ workOrderId: "WO-MAO-023", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[23]).toMatchObject({ workOrderId: "WO-MAO-024", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[24]).toMatchObject({ workOrderId: "WO-MAO-025", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[25]).toMatchObject({ workOrderId: "WO-MAO-026", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[26]).toMatchObject({ workOrderId: "WO-MAO-027", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[27]).toMatchObject({ workOrderId: "WO-MAO-028", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[28]).toMatchObject({ workOrderId: "WO-MAO-029", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[29]).toMatchObject({ workOrderId: "WO-MAO-030", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[30]).toMatchObject({ workOrderId: "WO-MAO-031", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[31]).toMatchObject({ workOrderId: "WO-MAO-032", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[32]).toMatchObject({ workOrderId: "WO-MAO-033", status: "DEFERRED_PROVIDER_UNAVAILABLE", resumable: true })
    expect(workOrders[33]).toMatchObject({ workOrderId: "WO-MAO-034", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[34]).toMatchObject({ workOrderId: "WO-MAO-035", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[35]).toMatchObject({ workOrderId: "WO-MAO-036", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[36]).toMatchObject({ workOrderId: "WO-MAO-037", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[37]).toMatchObject({ workOrderId: "WO-MAO-038", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[38]).toMatchObject({ workOrderId: "WO-MAO-039", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[39]).toMatchObject({ workOrderId: "WO-MAO-040", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[40]).toMatchObject({ workOrderId: "WO-MAO-041", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[41]).toMatchObject({ workOrderId: "WO-MAO-042", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[42]).toMatchObject({ workOrderId: "WO-MAO-043", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[43]).toMatchObject({ workOrderId: "WO-MAO-044", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[44]).toMatchObject({ workOrderId: "WO-MAO-045", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[45]).toMatchObject({ workOrderId: "WO-MAO-046", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[46]).toMatchObject({ workOrderId: "WO-MAO-047", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[47]).toMatchObject({ workOrderId: "WO-MAO-048", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[48]).toMatchObject({ workOrderId: "WO-MAO-049", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[49]).toMatchObject({ workOrderId: "WO-MAO-050", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[50]).toMatchObject({ workOrderId: "WO-MAO-051", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[51]).toMatchObject({ workOrderId: "WO-MAO-052", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[52]).toMatchObject({ workOrderId: "WO-MAO-053", status: "COMPLETE", riskClass: "R3" })
    expect(workOrders[53]).toMatchObject({ workOrderId: "WO-MAO-054", status: "COMPLETE", riskClass: "R2" })
    expect(workOrders[54]).toMatchObject({ workOrderId: "WO-MAO-055", status: "COMPLETE", riskClass: "R2" })
    expect(workOrders[55]).toMatchObject({ workOrderId: "WO-MAO-056", status: "COMPLETE", riskClass: "R2" })
    expect(workOrders[56]).toMatchObject({ workOrderId: "WO-MAO-057", status: "COMPLETE", riskClass: "R2" })
    expect(workOrders[57]).toMatchObject({ workOrderId: "WO-MAO-058", status: "READY", riskClass: "R2" })
    expect([30, 31, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53].map((number) => workOrders[number - 1].status))
      .toEqual(["COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE"])
    expect(workOrders).toHaveLength(62)
    expect(workOrders.at(-1)?.workOrderId).toBe("WO-MAO-062")
    expect(workOrders.every((workOrder) => "ownerOperationsAllowed" in workOrder && workOrder.ownerOperationsAllowed === false)).toBe(true)
  })

  it("preserves program risk and derives program-specific loop and Work Order identities", () => {
    const backlog = getPortfolioOperatorProgram().backlog
    const devex = backlog.find((program) => program.programId === "PROGRAM-DEVEX-HOOK-TOOLING-001")!
    const protectedProgram = backlog.find((program) => program.programId === "PROGRAM-TERRAPILOT-LIVE-001")!
    const devexWorkOrders = buildWorkOrderChain(devex)

    expect(buildGoalPacket(protectedProgram)).toMatchObject({
      riskCeiling: "R2",
      ownerDecisionRequired: true,
    })
    expect(buildLoopPacket(devex).activeWorkOrder).toBe(devexWorkOrders[0].workOrderId)
    expect(devexWorkOrders[0].workOrderId).toBe("WO-DEVEX-HOOK-TOOLING-001")
    const backend = backlog.find((program) => program.programId === "PROGRAM-BACKEND-OE-001")!
    expect(buildWorkOrderChain(backend)[0].workOrderId).toBe("WO-BACKEND-OE-001")
  })

  it("accepts completed-program evidence when resolving backlog dependencies", () => {
    const portfolio = getPortfolioOperatorProgram()
    const dependent = {
      ...portfolio.backlog.find((program) => program.programId === "PROGRAM-DEVEX-HOOK-TOOLING-001")!,
      dependencies: ["PROGRAM-WILLIAMOS-TF-COMMAND-001"],
      priorityScore: 999,
    }

    expect(resolveNextPortfolioProgram([...portfolio.completedPrograms, dependent])).toMatchObject({
      decision: "SELECT_PROGRAM",
      programId: dependent.programId,
    })
  })
})
