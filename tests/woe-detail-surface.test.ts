import { describe, expect, it } from "vitest"

import {
  getWoeDetailSurface,
  WOE_COMPLETION_REPORT_FIELDS,
  WOE_SAFETY_BADGES,
} from "@/components/work-orders/woe-detail-surface"

describe("WOE detail surface", () => {
  it("shows native goal, loop, evidence, queue, blocker, and next work detail", () => {
    const surface = getWoeDetailSurface()

    expect(surface.goal.id).toBe("GOAL-WOS-002")
    expect(surface.polish.batch).toBe("WILLIAMOS-WOE-SHELL-POLISH-BATCH-001")
    expect(surface.polish.posture).toBe("read-only/static-first")
    expect(surface.polish.primarySignal).toContain("without encountering execution affordances")
    expect(surface.polish.operatingMap.map((item) => item.label)).toEqual([
      "Intent",
      "Boundary",
      "Motion",
      "Proof",
      "Closure",
    ])
    expect(surface.polish.readabilityCues.map((cue) => cue.label)).toEqual([
      "Read first",
      "Blocked stays visible",
      "Navigation is evidence-led",
    ])
    expect(surface.evidenceClarity.batch).toBe("WILLIAMOS-WOE-EVIDENCE-CLARITY-BATCH-001")
    expect(surface.evidenceClarity.posture).toBe("read-only/static-first")
    expect(surface.evidenceClarity.proofChain.map((item) => item.label)).toEqual([
      "Scope proof",
      "Implementation proof",
      "Cross-link proof",
      "Closure proof",
    ])
    expect(surface.goal.purpose).toContain("central operating primitive")
    expect(surface.goal.successState).toContain("active goals, active loops")
    expect(surface.batch.name).toBe("WILLIAMOS-WORK-ORDER-ENGINE-INTEGRATION-BATCH-001")
    expect(surface.batch.base).toBe("0dc222d1bbfacd05f5ca1e0e8c815dc2dec3f133")
    expect(surface.batch.result).toBe("PHASE_PASS")
    expect(surface.workOrder.id).toBe("WO-WOE-009..022")
    expect(surface.goalRegistry.records).toContain("goal id")
    expect(surface.goalRegistry.blockedPowers).toContain("goal mutation")
    expect(surface.goalIndex.records).toContain("blocked goals")
    expect(surface.goalIndex.blockedPowers).toContain("execution controls")
    expect(surface.loopRegistry.records).toContain("current WO")
    expect(surface.loopRegistry.blockedPowers).toContain("auto-continue")
    expect(surface.workOrder.evidence).toHaveLength(3)
    expect(surface.goalDetail.nativeSurface).toBe("/goal-console")
    expect(surface.loopDetail.blockedPowers).toContain("loop start button")
    expect(surface.evidenceRollup.blockedPowers).toContain("dynamic crawler")
    expect(surface.activeQueue.excludedPowers).toContain("execute WO")
    expect(surface.blockedQueue.excludedPowers).toContain("grant authority")
    expect(surface.blockedDecision.ownerDecisionNeeded).toContain("future owner gate")
  })

  it("renders the standard completion report fields for the operator return packet", () => {
    const surface = getWoeDetailSurface()

    expect(surface.reportFields).toEqual([...WOE_COMPLETION_REPORT_FIELDS])
    expect(surface.reportFields).toContain("RESULT")
    expect(surface.reportFields).toContain("WORK_ORDER")
    expect(surface.reportFields).toContain("GOAL")
    expect(surface.reportFields).toContain("PRODUCTION_VERIFICATION")
    expect(surface.reportFields).toContain("SAFETY_POSTURE")
    expect(surface.reportFields).toContain("NEXT_RECOMMENDED_WO")
  })

  it("clarifies evidence-to-WO links, production routes, PR checks, review state, and proof gaps", () => {
    const surface = getWoeDetailSurface()

    expect(surface.evidenceClarity.proofChain).toEqual([
      expect.objectContaining({
        workOrder: "WO-WOE-033 through WO-WOE-035",
        href: "/goal-console",
      }),
      expect.objectContaining({
        workOrder: "WO-WOE-036 through WO-WOE-043",
        href: "/work-orders",
      }),
      expect.objectContaining({
        workOrder: "WO-WOE-044 through WO-WOE-045",
        href: "/academy",
      }),
      expect.objectContaining({
        workOrder: "WO-WOE-046 through WO-WOE-047",
        href: "/audit",
      }),
    ])
    expect(surface.evidenceClarity.productionVerification.map((item) => item.route)).toEqual([
      "/api/health",
      "/api/auth/readiness",
      "/work-orders",
      "/goal-console",
      "/audit",
    ])
    expect(surface.evidenceClarity.prCheckReviewContext.map((item) => item.label)).toEqual([
      "PR",
      "Checks",
      "Review threads",
    ])
    expect(surface.evidenceClarity.safetyFlagExplanations.map((item) => item.flag)).toEqual([
      "READ_ONLY",
      "NO_COMMAND_RUNNER",
      "NO_AUTONOMOUS_LOOP",
      "NO_PRODUCTION_WRITE",
    ])
    expect(surface.evidenceClarity.proofGaps.map((gap) => gap.status)).toEqual([
      "missing",
      "blocked",
      "not authorized",
    ])
    expect(surface.evidenceClarity.proofGaps[2]?.nextSafeMove).toContain("separate authority packet")
  })

  it("provides navigation between WOE detail surfaces without action nav", () => {
    const surface = getWoeDetailSurface()
    const links = new Map(surface.navigation.map((item) => [item.label, item.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Goal Console")).toBe("/goal-console")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Decisions")).toBe("/decisions")
    expect(links.get("Academy")).toBe("/academy")
    expect(links.get("Wiki")).toBe("/academy")
  })

  it("covers the native registry surfaces for WOE integration", () => {
    const surface = getWoeDetailSurface()
    const links = new Map(surface.registryCoverage.map((item) => [item.label, item.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Goal Console")).toBe("/goal-console")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Decisions")).toBe("/decisions")
    expect(links.get("Academy")).toBe("/academy")
    expect(links.get("Wiki")).toBe("/academy")
    expect(surface.searchFilter.fields).toEqual([
      "query",
      "status",
      "goal",
      "batch/loop",
      "lane",
      "authority",
      "owner decision",
      "safety posture",
      "completion state",
      "ready",
      "blocked",
      "completed",
    ])
  })

  it("defines the expected safety badge model", () => {
    expect(WOE_SAFETY_BADGES).toEqual([
      "READ_ONLY",
      "STATIC_FIRST",
      "UI_ONLY",
      "DOCS_ONLY",
      "PROOF_ONLY",
      "BLOCKED_OWNER_DECISION",
      "NO_COMMAND_EXECUTION",
      "NO_COMMAND_RUNNER",
      "NO_AUTONOMOUS_LOOP",
      "NO_BACKGROUND_WORKER",
      "NO_RUNTIME_MUTATION",
      "NO_PRODUCTION_WRITE",
    ])
  })

  it("does not add execution, mutation, automation, runtime activation, ingestion, production writes, or secrets", () => {
    const surface = getWoeDetailSurface()
    const serialized = JSON.stringify(surface).toLowerCase()

    expect(surface.safety).toEqual({
      readOnly: true,
      staticFirst: true,
      runButtonsAdded: false,
      executeButtonsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      autonomousLoopExecutionAdded: false,
      backgroundWorkerAdded: false,
      schedulerAdded: false,
      serviceRegistered: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      authBehaviorChanged: false,
      authPolicyChanged: false,
      publicSignupReintroduced: false,
      databaseAdded: false,
      dbSchemaChanged: false,
      dataMutationAdded: false,
      envChanged: false,
      packageChanged: false,
      vercelSettingsChanged: false,
      deployAdded: false,
      releaseAdded: false,
      tagAdded: false,
      productionWriteBehaviorAdded: false,
      hermesActivationAdded: false,
      mcpActivationAdded: false,
      workerActivationAdded: false,
      brainCouncilRuntimeAdded: false,
      memoryWriteAdded: false,
      runtimeMemoryReadAdded: false,
      vectorStoreAdded: false,
      embeddingsAdded: false,
      ragRuntimeAdded: false,
      dynamicIngestionAdded: false,
      persistenceImplemented: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      runtimeControlAdded: false,
      lanExposureEnabled: false,
      terraFusionPacsTouched: false,
      secretsDisclosed: false,
    })
    expect(serialized).not.toContain("database_url")
    expect(serialized).not.toContain("better_auth_secret")
    expect(serialized).not.toContain("docker inspect")
    expect(serialized).not.toContain("github write action enabled")
    expect(serialized).not.toContain("run batch button")
    expect(serialized).not.toContain("sign up")
    expect(serialized).not.toContain("workspace")
    expect(serialized).toContain("work order engine")
  })
})
