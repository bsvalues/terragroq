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
    expect(surface.goal.purpose).toContain("Work Order Engine state visible")
    expect(surface.goal.successState).toContain("inspect goals, loops, active work")
    expect(surface.batch.name).toBe("WILLIAMOS-WOE-INTEGRATION-BATCH-001")
    expect(surface.batch.base).toBe("1423aa6885eba0d5ec0860ee8e7a6ba761a196f2")
    expect(surface.batch.result).toBe("PHASE_PASS")
    expect(surface.workOrder.id).toBe("WO-WOE-001..015")
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
    expect(surface.reportFields).toContain("AUTONOMOUS_LOOP_EXECUTION_ADDED")
    expect(surface.reportFields).toContain("BACKGROUND_WORKER_ADDED")
    expect(surface.reportFields).toContain("PRODUCTION_WRITE_BEHAVIOR_ADDED")
    expect(surface.reportFields).toContain("OWNER_DECISION_REQUIRED")
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
