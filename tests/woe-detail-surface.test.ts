import { describe, expect, it } from "vitest"

import {
  getWoeDetailSurface,
  WOE_COMPLETION_REPORT_FIELDS,
  WOE_SAFETY_BADGES,
} from "@/components/work-orders/woe-detail-surface"

describe("WOE detail surface", () => {
  it("shows goal, batch, work order, evidence, blocker, and next work detail", () => {
    const surface = getWoeDetailSurface()

    expect(surface.goal.purpose).toContain("what goal is active")
    expect(surface.goal.successState).toContain("without triggering execution")
    expect(surface.batch.name).toBe("WILLIAMOS-SHELL-WOE-RESUME-BATCH-001")
    expect(surface.batch.result).toBe("PHASE_PASS")
    expect(surface.batch.mergedPrs).toEqual(["#280"])
    expect(surface.workOrder.id).toBe("WO-WOE-022..032")
    expect(surface.workOrder.evidence).toHaveLength(2)
    expect(surface.blockedDecision.ownerDecisionNeeded).toContain("future gate")
    expect(surface.goal.nextRecommendedWork).toContain("Evidence spine expansion")
  })

  it("renders the standard completion report fields", () => {
    const surface = getWoeDetailSurface()

    expect(surface.reportFields).toEqual([...WOE_COMPLETION_REPORT_FIELDS])
    expect(surface.reportFields).toEqual([
      "RESULT",
      "BATCH",
      "WORK_ORDER",
      "COMPLETED_WOS",
      "MERGED_PRS",
      "origin/main",
      "VALIDATION",
      "SAFETY_POSTURE",
      "NEXT_RECOMMENDED_BATCH",
    ])
  })

  it("provides navigation between WOE detail surfaces without action nav", () => {
    const surface = getWoeDetailSurface()
    const links = new Map(surface.navigation.map((item) => [item.label, item.href]))

    expect(links.get("Back to Work Orders")).toBe("/work-orders")
    expect(links.get("View Evidence")).toBe("/audit")
    expect(links.get("View Runtime")).toBe("/runtime")
    expect(links.get("View Decisions")).toBe("/decisions")
  })

  it("defines the expected safety badge model", () => {
    expect(WOE_SAFETY_BADGES).toEqual([
      "READ_ONLY",
      "UI_ONLY",
      "DOCS_ONLY",
      "PROOF_ONLY",
      "BLOCKED_OWNER_DECISION",
      "LOCAL_STATUS_READ_ONLY",
      "NO_COMMAND_EXECUTION",
      "NO_AUTONOMY",
      "NO_RUNTIME_MUTATION",
    ])
  })

  it("does not add execution, mutation, automation, metadata, scheduler, LAN, or secrets", () => {
    const surface = getWoeDetailSurface()
    const serialized = JSON.stringify(surface).toLowerCase()

    expect(surface.safety).toEqual({
      readOnly: true,
      runButtonsAdded: false,
      executeButtonsAdded: false,
      commandExecutionAdded: false,
      commandRunnerAdded: false,
      githubWriteAdded: false,
      codexAutomationAdded: false,
      schedulerAdded: false,
      persistenceImplemented: false,
      dockerMetadataAdded: false,
      backupScanAdded: false,
      portChecksAdded: false,
      lanExposureEnabled: false,
      secretsDisclosed: false,
    })
    expect(serialized).not.toContain("database_url")
    expect(serialized).not.toContain("better_auth_secret")
    expect(serialized).not.toContain("docker inspect")
    expect(serialized).not.toContain("github write action enabled")
    expect(serialized).not.toContain("run batch button")
  })
})
